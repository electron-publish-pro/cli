#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { ApiError, listProjects, runCheck } from "./api.js";
import { readGitRemote } from "./git.js";
import { credentialsPath, deleteCredentials, login, readCredentials, resolveToken, revokeToken, saveCredentials } from "./auth.js";
import { collectProject } from "./collect.js";
import {
  CONFIG_FILE,
  type EppConfig,
  type Goal,
  parseGoal,
  parsePlatforms,
  readConfig,
  writeConfig,
} from "./config.js";
import { formatReport } from "./report.js";

const VERSION: string = createRequire(import.meta.url)("../package.json").version;
const DASHBOARD_URL = "https://electronpublish.com/dashboard/analyses";
const TOKENS_URL = "https://electronpublish.com/dashboard/account-settings";

const HELP = `epp ${VERSION} — Electron Publish Pro CLI

Usage
  epp login  [--email <email>]   Sign in and store an API token (password from prompt or EPP_PASSWORD)
  epp logout                     Revoke the stored token and delete it
  epp whoami                     Show which token epp uses
  epp init   [--goal direct|store] [--platforms macos,windows,linux] [--name <name>] [--yes]
  epp check  [--json] [--fail-on fail|warning] [--goal ...] [--platforms ...]
  epp files     List the files "epp check" would send
  epp projects  List your dashboard projects [--json]

A check goes to the dashboard project with the same GitHub repo or the same
name as "project" in epp.json (default: the git remote's repo name), and
creates one when none matches.

Environment
  EPP_TOKEN    API token; overrides the one stored by "epp login". Create one at ${TOKENS_URL}

Exit codes
  0  done; for check: finished (and --fail-on threshold not reached)
  1  --fail-on threshold reached
  2  error (no token, invalid config, API error, daily limit)
`;

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=", 2);
      const next = argv[i + 1];
      if (inline !== undefined) flags[key] = inline;
      else if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(arg);
  }
  return { command: positional[0], flags };
}

function fail(message: string): never {
  console.error(`epp: ${message}`);
  process.exit(2);
}

// Matches how the dashboard names projects: after the repository.
function defaultProjectName(cwd: string): string {
  const remote = readGitRemote(cwd);
  if (remote) return remote.repoName;
  if (basename(cwd)) return basename(cwd);
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    return pkg.productName || pkg.name || "electron-app";
  } catch {
    return "electron-app";
  }
}

async function init(cwd: string, flags: Record<string, string | boolean>) {
  if (existsSync(join(cwd, CONFIG_FILE)) && !flags.force) {
    fail(`${CONFIG_FILE} already exists. Use --force to overwrite.`);
  }

  let goal = typeof flags.goal === "string" ? parseGoal(flags.goal) : null;
  let platforms = typeof flags.platforms === "string" ? parsePlatforms(flags.platforms) : [];
  const name = typeof flags.name === "string" ? flags.name : defaultProjectName(cwd);

  const interactive = process.stdin.isTTY && !flags.yes;
  if ((!goal || platforms.length === 0) && interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    while (!goal) goal = parseGoal((await rl.question("Distribution (direct/store) [direct]: ")).trim() || "direct");
    while (platforms.length === 0) {
      platforms = parsePlatforms((await rl.question("Platforms (macos,windows,linux) [macos,windows]: ")).trim() || "macos,windows");
    }
    rl.close();
  }
  if (!goal) goal = "direct";
  if (platforms.length === 0) fail("pass --platforms macos,windows,linux");

  const path = writeConfig(cwd, { version: 1, project: name, goal, platforms });
  console.log(`Created ${path}`);
  console.log(readCredentials() || process.env.EPP_TOKEN ? "Next: epp check" : "Next: epp login, then epp check");
}

function resolveConfig(cwd: string, flags: Record<string, string | boolean>): EppConfig {
  let config: EppConfig | null;
  try {
    config = readConfig(cwd);
  } catch (error) {
    fail((error as Error).message);
  }
  const goal: Goal | null = typeof flags.goal === "string" ? parseGoal(flags.goal) : config?.goal ?? null;
  const platforms = typeof flags.platforms === "string" ? parsePlatforms(flags.platforms) : config?.platforms ?? [];
  if (!goal || platforms.length === 0) {
    fail(`no ${CONFIG_FILE} found. Run "epp init" or pass --goal and --platforms.`);
  }
  return { version: 1, project: config?.project ?? defaultProjectName(cwd), goal, platforms, check: config?.check };
}

async function projectsCommand(flags: Record<string, string | boolean>) {
  const resolved = resolveToken();
  if (!resolved) fail(`not signed in. Run "epp login", or set EPP_TOKEN.`);
  let projects;
  try {
    projects = await listProjects(resolved.token);
  } catch (error) {
    fail(error instanceof ApiError ? error.message : `request failed: ${(error as Error).message}`);
  }
  if (flags.json) return console.log(JSON.stringify(projects, null, 2));
  if (projects.length === 0) return console.log('No projects yet. Run "epp check" in a project folder to create one.');
  for (const p of projects) {
    const score = p.readinessScore == null ? "  —" : String(p.readinessScore).padStart(3);
    console.log(`${score}  ${p.name}  (${p.goal}, ${p.platforms.join(", ")})${p.githubRepo ? `  github.com/${p.githubRepo}` : ""}`);
  }
}

function files(cwd: string, flags: Record<string, string | boolean>) {
  const config = readConfig(cwd);
  const collected = collectProject(cwd, config?.check);
  console.log(`File tree: ${collected.treeSize} paths`);
  console.log(`Files sent with contents (${collected.content.length.toLocaleString()} characters${collected.truncated ? ", truncated" : ""}):`);
  for (const f of collected.files) console.log(`  ${f}`);
  if (flags.json) console.log(JSON.stringify(collected.files));
}

async function check(cwd: string, flags: Record<string, string | boolean>) {
  const resolved = resolveToken();
  if (!resolved) fail(`not signed in. Run "epp login", or set EPP_TOKEN (create one at ${TOKENS_URL}).`);
  const token = resolved.token;
  if (!token.startsWith("epp_")) fail("the API token must start with epp_");

  const config = resolveConfig(cwd, flags);
  const collected = collectProject(cwd, config.check);
  if (!flags.json) {
    console.error(`Checking ${config.project} (${config.goal}, ${config.platforms.join(", ")}): ${collected.files.length} files…`);
  }

  let result;
  try {
    result = await runCheck(token, {
      projectName: config.project,
      githubRepo: readGitRemote(cwd)?.githubRepo ?? undefined,
      goal: config.goal,
      platforms: config.platforms,
      codeContent: collected.content,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      fail(`the API token was rejected (revoked or invalid). Run "epp login" again${resolved.source === "env" ? " or update EPP_TOKEN" : ""}.`);
    }
    fail(error instanceof ApiError ? error.message : `request failed: ${(error as Error).message}`);
  }

  if (flags.json) {
    console.log(JSON.stringify({ projectId: result.projectId, analysisId: result.analysisId, filesSent: collected.files, ...result.results }, null, 2));
  } else {
    console.log(formatReport(result.results, DASHBOARD_URL));
  }

  const failOn = flags["fail-on"];
  const statuses = result.results.categories.map((c) => c.status);
  if ((failOn === "fail" && statuses.includes("fail")) || (failOn === "warning" && statuses.some((s) => s !== "pass"))) {
    process.exit(1);
  }
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      // A paste arrives as one chunk, often with the Enter key at the end.
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        } else if (char === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        } else if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function loginCommand(flags: Record<string, string | boolean>) {
  let email = typeof flags.email === "string" ? flags.email : "";
  let password = process.env.EPP_PASSWORD || "";
  if ((!email || !password) && !process.stdin.isTTY) {
    fail("run epp login in a terminal, or pass --email with EPP_PASSWORD set. For CI use EPP_TOKEN.");
  }
  if (!email) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    email = (await rl.question("Email: ")).trim();
    rl.close();
  }
  if (!password) password = await askHidden("Password: ");
  if (!email || !password) fail("email and password are required");

  const previous = readCredentials();
  const credentials = await login(email, password);
  saveCredentials(credentials);
  if (previous?.token) await revokeToken(previous.token).catch(() => false);
  console.log(`Signed in as ${email}. Token saved to ${credentialsPath()}`);
  console.log("Next: epp init (once per project), then epp check");
}

async function logoutCommand() {
  const credentials = readCredentials();
  if (!credentials) {
    console.log("Not signed in.");
    return;
  }
  const revoked = await revokeToken(credentials.token).catch(() => false);
  deleteCredentials();
  console.log(revoked ? "Signed out. The token was revoked." : "Signed out. The stored token was deleted.");
  if (process.env.EPP_TOKEN) console.log("Note: EPP_TOKEN is still set in this shell and will be used.");
}

function whoamiCommand() {
  const resolved = resolveToken();
  if (!resolved) {
    console.log('Not signed in. Run "epp login" or set EPP_TOKEN.');
    process.exit(2);
  }
  const prefix = resolved.token.slice(0, 12);
  console.log(
    resolved.source === "env"
      ? `Using EPP_TOKEN from the environment (${prefix}…)`
      : `Signed in as ${resolved.email} (${prefix}…, stored in ${credentialsPath()})`
  );
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (flags.version) return console.log(VERSION);
  switch (command) {
    case "login":
      return loginCommand(flags);
    case "logout":
      return logoutCommand();
    case "whoami":
      return whoamiCommand();
    case "init":
      return init(cwd, flags);
    case "check":
      return check(cwd, flags);
    case "projects":
      return projectsCommand(flags);
    case "files":
      return files(cwd, flags);
    case undefined:
    case "help":
      return console.log(HELP);
    default:
      fail(`unknown command "${command}". Run "epp help".`);
  }
}

main().catch((error) => fail((error as Error).message));
