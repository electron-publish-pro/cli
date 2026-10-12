import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

export const SUPABASE_URL = (process.env.EPP_SUPABASE_URL || "https://gzvqsjmkxfmupydipscr.supabase.co").replace(/\/$/, "");
// Public (anon) key, the same one the website ships to every browser.
const SUPABASE_ANON_KEY =
  process.env.EPP_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd6dnFzam1reGZtdXB5ZGlwc2NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxNjQ3OTYsImV4cCI6MjA4Mjc0MDc5Nn0.VLmaDpdWPVReK_GnLShu4jMKQWGoYyBgVKLxA3gMf_M";

export interface Credentials {
  token: string;
  email: string;
  createdAt: string;
}

function configDir(): string {
  if (process.env.EPP_CONFIG_DIR) return process.env.EPP_CONFIG_DIR;
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "epp");
}

export function credentialsPath(): string {
  return join(configDir(), "credentials.json");
}

export function readCredentials(): Credentials | null {
  const path = credentialsPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(credentials: Credentials): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = credentialsPath();
  writeFileSync(path, JSON.stringify(credentials, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function deleteCredentials(): void {
  rmSync(credentialsPath(), { force: true });
}

export function resolveToken(): { token: string; source: "env" | "file"; email?: string } | null {
  if (process.env.EPP_TOKEN) return { token: process.env.EPP_TOKEN, source: "env" };
  const credentials = readCredentials();
  return credentials ? { token: credentials.token, source: "file", email: credentials.email } : null;
}

async function supabaseRequest(path: string, body: unknown, accessToken?: string) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

export async function login(email: string, password: string): Promise<Credentials> {
  const session = await supabaseRequest("/auth/v1/token?grant_type=password", { email, password });
  if (!session.ok || typeof session.data.access_token !== "string") {
    const code = String(session.data.error_code || session.data.error || "");
    if (code === "email_not_confirmed") {
      throw new Error("Confirm your email first: open the link we sent when you signed up.");
    }
    if (code === "invalid_credentials" || code === "invalid_grant" || session.status === 400) {
      throw new Error(
        "Wrong email or password. If you sign in with GitHub, your account has no password yet: set one in Account Settings → Security on electronpublish.com, or create a token in Account Settings → API Tokens and set EPP_TOKEN."
      );
    }
    throw new Error(String(session.data.msg || session.data.error_description || `Sign-in failed (${session.status})`));
  }

  const created = await supabaseRequest(
    "/rest/v1/rpc/create_api_token",
    { p_name: `epp CLI on ${hostname()}`.slice(0, 64) },
    session.data.access_token
  );
  if (!created.ok || typeof created.data !== "string") {
    const message = String((created.data as { message?: string }).message || "");
    if (message.includes("token_limit")) {
      throw new Error("You have 10 active tokens. Revoke one in Account Settings → API Tokens and try again.");
    }
    throw new Error(`Could not create an API token (${created.status})`);
  }

  return { token: created.data as string, email, createdAt: new Date().toISOString() };
}

export async function revokeToken(token: string): Promise<boolean> {
  const result = await supabaseRequest("/rest/v1/rpc/revoke_api_token_by_value", { p_token: token });
  return result.ok && (result.data as unknown) === true;
}
