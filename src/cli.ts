#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { ApiError, runCheck } from "./api.js";
import { collectProject } from "./collect.js";
import {
  CONFIG_FILE,
  type EppConfig,
  type Goal,
  parseGoal,
  parsePlatforms,
  readConfig,
  readLink,
  writeConfig,
  writeLink,
} from "./config.js";
import { formatReport } from "./report.js";

const VERSION = "0.1.0";
const DASHBOARD_URL = "https://electronpublish.com/dashboard/analyses";
const TOKENS_URL = "https://electronpublish.com/dashboard/account-settings";

const HELP = `epp ${VERSION} — Electron Publish Pro CLI

Usage
  epp init   [--goal direct|store] [--platforms macos,windows,linux] [--name <name>] [--yes]
  epp check  [--json] [--fail-on fail|warning] [--goal ...] [--platforms ...]
  epp files  List the files "epp check" would send

Environment
  EPP_TOKEN    API token from ${TOKENS_URL}

Exit codes
  0  check finished (and --fail-on threshold not reached)
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

function defaultProjectName(cwd: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    return pkg.productName || pkg.build?.productName || pkg.name || basename(cwd);
  } catch {
    return basename(cwd);
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
  console.log(`Next: export EPP_TOKEN=... (create one at ${TOKENS_URL}), then run: epp check`);
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

function files(cwd: string, flags: Record<string, string | boolean>) {
  const config = readConfig(cwd);
  const collected = collectProject(cwd, config?.check);
  console.log(`File tree: ${collected.treeSize} paths`);
  console.log(`Files sent with contents (${collected.content.length.toLocaleString()} characters${collected.truncated ? ", truncated" : ""}):`);
  for (const f of collected.files) console.log(`  ${f}`);
  if (flags.json) console.log(JSON.stringify(collected.files));
}

async function check(cwd: string, flags: Record<string, string | boolean>) {
  const token = process.env.EPP_TOKEN;
  if (!token) fail(`EPP_TOKEN is not set. Create a token at ${TOKENS_URL}`);
  if (!token.startsWith("epp_")) fail("EPP_TOKEN must start with epp_");

  const config = resolveConfig(cwd, flags);
  const collected = collectProject(cwd, config.check);
  if (!flags.json) {
    console.error(`Checking ${config.project} (${config.goal}, ${config.platforms.join(", ")}): ${collected.files.length} files…`);
  }

  const link = readLink(cwd);
  let result;
  try {
    result = await runCheck(token, {
      projectId: link?.projectId,
      projectName: config.project,
      goal: config.goal,
      platforms: config.platforms,
      codeContent: collected.content,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403 && link) {
      fail(`the linked project was not found for this token. Delete .epp/ and run again to create a new project.`);
    }
    fail(error instanceof ApiError ? error.message : `request failed: ${(error as Error).message}`);
  }

  if (!link || link.projectId !== result.projectId) writeLink(cwd, { projectId: result.projectId });

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

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (flags.version) return console.log(VERSION);
  switch (command) {
    case "init":
      return init(cwd, flags);
    case "check":
      return check(cwd, flags);
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
