import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Keep in sync with supabase/functions/analyze-code in electron-public-pro.
export const MAX_CODE_SIZE = 150_000;
const MAX_TREE_PATHS = 2000;
const MAX_MAIN_PROCESS_FILES = 10;
const MAX_BUILDER_VARIANTS = 3;
const MAX_FILE_SIZE = 200_000;

const PRIORITY_FILES = [
  "package.json",
  "release/app/package.json",
  "app/package.json",
  "electron-builder.json",
  "electron-builder.json5",
  "electron-builder.yml",
  "electron-builder.config.js",
  "electron-builder.config.ts",
  "electron-builder.config.cjs",
  "electron-builder.config.mjs",
  "build/electron-builder.json",
  "build/electron-builder.yml",
  "src/main.ts",
  "src/main.js",
  "main.js",
  "electron/main.ts",
  "electron/main.js",
  "src/main/main.ts",
  "src/main/main.js",
  "src/main/index.ts",
  "src/main/index.js",
  "electron/main/index.ts",
  "src/main/preload.ts",
  "src/preload/index.ts",
  "src/preload/index.js",
  "electron/preload/index.ts",
  "src/preload.ts",
  "src/preload.js",
  "preload.js",
  "electron/preload.ts",
  "electron/preload.js",
  ".nvmrc",
  ".node-version",
  "entitlements.mac.plist",
  "entitlements.plist",
  "build/entitlements.mac.plist",
  "entitlements.mas.plist",
  "build/entitlements.mas.plist",
  "build/entitlements.mac.inherit.plist",
  "notarize.js",
  "scripts/notarize.js",
  "build/notarize.js",
  "snap/snapcraft.yaml",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "electron.vite.config.ts",
  "electron.vite.config.js",
  "electron.vite.config.mjs",
  "webpack.config.js",
  "forge.config.js",
  "forge.config.ts",
];

const MAIN_ENTRY_FILES = ["src/index.ts", "src/index.js", "src/electron.ts", "src/electron.js", "electron.js", "electron/index.ts", "electron/index.js"];
const HTML_ENTRY_FILES = ["index.html", "static/index.html", "src/index.html", "src/renderer/index.html", "public/index.html"];

const MAIN_PROCESS_FILE = /((^|\/)(main|preload|preloads|electron)\/.+|(^|\/)[^/]*(window|preload)[^/]*)\.(ts|js|mjs|cjs)$/i;
const BUILDER_VARIANT_FILE = /^electron-builder\.[\w-]+\.(json5?|ya?ml|[cm]?js|ts)$/;
const SKIP_FILE = /(\.(test|spec|config)\.|(^|\/)(tests?|__tests__|mocks?|__mocks__|fixtures|examples?|demos?|docs|static|scripts|node_modules)\/)/i;
const WALK_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", "release", "build-output", ".next", ".vite", ".webpack", ".epp", "coverage"]);

function mainProcessRank(path: string): number {
  const name = path.split("/").pop() ?? "";
  return (/window|preload/i.test(name) ? 2 : 0) + (/^(main|index)\./i.test(name) ? 1 : 0);
}

function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      pattern += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") pattern += "[^/]*";
    else if (c === "?") pattern += "[^/]";
    else pattern += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`);
}

function listFiles(cwd: string): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter(Boolean).sort();
  } catch {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!WALK_SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
        } else if (entry.isFile()) {
          files.push(relative(cwd, join(dir, entry.name)).split(sep).join("/"));
        }
      }
    };
    walk(cwd);
    return files.sort();
  }
}

export function selectFilesToRead(treePaths: string[], include: string[] = []): string[] {
  const inTree = new Set(treePaths);
  const includeRes = include.map(globToRegExp);
  const selected = [...PRIORITY_FILES, ...MAIN_ENTRY_FILES, ...HTML_ENTRY_FILES].filter((path) => inTree.has(path));
  selected.unshift(...treePaths.filter((path) => includeRes.some((re) => re.test(path)) && !selected.includes(path)));
  selected.push(
    ...treePaths.filter((path) => BUILDER_VARIANT_FILE.test(path) && !selected.includes(path)).slice(0, MAX_BUILDER_VARIANTS)
  );
  const mainProcess = treePaths
    .filter(
      (path) =>
        MAIN_PROCESS_FILE.test(path) &&
        !SKIP_FILE.test(path) &&
        !path.endsWith(".d.ts") &&
        !/(^|\/)renderer\/(?!.*preload)/i.test(path) &&
        !selected.includes(path)
    )
    .sort((a, b) => mainProcessRank(b) - mainProcessRank(a) || a.split("/").length - b.split("/").length)
    .slice(0, MAX_MAIN_PROCESS_FILES);
  return [...selected, ...mainProcess];
}

export interface Collected {
  content: string;
  files: string[];
  treeSize: number;
  truncated: boolean;
}

export function collectProject(cwd: string, check: { include?: string[]; ignore?: string[] } = {}): Collected {
  const ignoreRes = (check.ignore ?? []).map(globToRegExp);
  const treePaths = listFiles(cwd).filter((path) => !ignoreRes.some((re) => re.test(path)));
  const shown = treePaths.slice(0, MAX_TREE_PATHS);
  const omitted = treePaths.length - shown.length;
  let content = `--- PROJECT FILE TREE ---\n${shown.join("\n")}${omitted > 0 ? `\n... ${omitted} more files not shown` : ""}\n\n`;

  const files: string[] = [];
  let truncated = false;
  for (const path of selectFilesToRead(treePaths, check.include)) {
    if (content.length >= MAX_CODE_SIZE) {
      truncated = true;
      break;
    }
    const full = join(cwd, path);
    let text: string;
    try {
      if (statSync(full).size > MAX_FILE_SIZE) continue;
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const entry = `--- FILE: ${path} ---\n${text}\n\n`;
    files.push(path);
    if (content.length + entry.length > MAX_CODE_SIZE) {
      content += entry.slice(0, MAX_CODE_SIZE - content.length);
      truncated = true;
      break;
    }
    content += entry;
  }

  return { content, files, treeSize: treePaths.length, truncated };
}
