import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE = "epp.json";
export const LINK_DIR = ".epp";
export const SCHEMA_URL = "https://electronpublish.com/schema/epp.v1.json";

export type Goal = "direct" | "store";
export type Platform = "macOS" | "Windows" | "Linux";

export interface EppConfig {
  $schema?: string;
  version: 1;
  project: string;
  goal: Goal;
  platforms: Platform[];
  check?: {
    include?: string[];
    ignore?: string[];
  };
}

export interface ProjectLink {
  projectId: string;
}

const PLATFORM_NAMES: Record<string, Platform> = {
  macos: "macOS",
  mac: "macOS",
  darwin: "macOS",
  windows: "Windows",
  win: "Windows",
  win32: "Windows",
  linux: "Linux",
};

export function parsePlatforms(value: string): Platform[] {
  const platforms = value
    .split(",")
    .map((p) => PLATFORM_NAMES[p.trim().toLowerCase()])
    .filter((p): p is Platform => Boolean(p));
  return [...new Set(platforms)];
}

export function parseGoal(value: string): Goal | null {
  return value === "direct" || value === "store" ? value : null;
}

export function readConfig(cwd: string): EppConfig | null {
  const path = join(cwd, CONFIG_FILE);
  if (!existsSync(path)) return null;
  const config = JSON.parse(readFileSync(path, "utf8")) as EppConfig;
  if (config.version !== 1) throw new Error(`${CONFIG_FILE}: unsupported version ${config.version}`);
  if (!parseGoal(config.goal)) throw new Error(`${CONFIG_FILE}: "goal" must be "direct" or "store"`);
  if (!Array.isArray(config.platforms) || config.platforms.length === 0) {
    throw new Error(`${CONFIG_FILE}: "platforms" must list at least one of macOS, Windows, Linux`);
  }
  return config;
}

export function writeConfig(cwd: string, config: EppConfig): string {
  const path = join(cwd, CONFIG_FILE);
  writeFileSync(path, JSON.stringify({ $schema: SCHEMA_URL, ...config }, null, 2) + "\n");
  return path;
}

export function readLink(cwd: string): ProjectLink | null {
  const path = join(cwd, LINK_DIR, "project.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ProjectLink) : null;
}

export function writeLink(cwd: string, link: ProjectLink): void {
  const dir = join(cwd, LINK_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify(link, null, 2) + "\n");

  const gitignore = join(cwd, ".gitignore");
  const content = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  if (!content.split("\n").some((line) => line.trim().replace(/\/$/, "") === LINK_DIR)) {
    appendFileSync(gitignore, `${content && !content.endsWith("\n") ? "\n" : ""}${LINK_DIR}/\n`);
  }
}
