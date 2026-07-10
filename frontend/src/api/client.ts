import type {
  HealthResponse,
  SolveOrientRequest,
  SolveOrientResponse,
  SolversResponse,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${path} failed: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export function getHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>("/api/health");
}

export function getSolvers(): Promise<SolversResponse> {
  return requestJson<SolversResponse>("/api/solve/solvers");
}

export function solveOrientation(payload: SolveOrientRequest): Promise<SolveOrientResponse> {
  return requestJson<SolveOrientResponse>("/api/solve/orient", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
