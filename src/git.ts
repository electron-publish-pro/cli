import { execFileSync } from "node:child_process";

export interface GitRemote {
  repoName: string;
  githubRepo: string | null;
}

// Reads "origin" and returns the repo name, plus owner/repo when it is on GitHub.
export function readGitRemote(cwd: string): GitRemote | null {
  let url: string;
  try {
    url = execFileSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
  const match = url.match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  const [, host, path] = match;
  const parts = path.split("/").filter(Boolean);
  const repoName = parts[parts.length - 1];
  if (!repoName) return null;
  return {
    repoName,
    githubRepo: host.toLowerCase() === "github.com" && parts.length === 2 ? `${parts[0]}/${parts[1]}` : null,
  };
}
