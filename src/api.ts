import { SUPABASE_URL } from "./auth.js";

const DEFAULT_API_URL = `${SUPABASE_URL}/functions/v1`;

export interface Category {
  name: string;
  status: "pass" | "warning" | "fail";
  message: string;
  details: string;
  recommendations: string[];
}

export interface Report {
  categories: Category[];
  summary: string;
  criticalIssues: string[];
  recommendations: string[];
  readinessScore: number;
}

export interface CheckResult {
  projectId: string;
  analysisId: string;
  results: Report;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
  }
}

export async function runCheck(
  token: string,
  body: {
    projectId?: string;
    projectName: string;
    goal: string;
    platforms: string[];
    codeContent: string;
  }
): Promise<CheckResult> {
  const apiUrl = (process.env.EPP_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
  const response = await fetch(`${apiUrl}/analyze-code`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, sourceType: "cli", analysisType: "code" }),
  });

  const data = (await response.json().catch(() => ({}))) as Partial<CheckResult> & { error?: string; code?: string };
  if (!response.ok || !data.results) {
    throw new ApiError(data.error || `Request failed with status ${response.status}`, response.status, data.code);
  }
  return data as CheckResult;
}
