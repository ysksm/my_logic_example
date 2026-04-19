import type { ApiGraph } from "./types";

export async function analyze(
  path: string,
  opts: { includeTests?: boolean; excludeDirs?: string[] } = {},
): Promise<ApiGraph> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path,
      includeTests: opts.includeTests ?? false,
      excludeDirs: opts.excludeDirs ?? [],
    }),
  });
  if (!res.ok) {
    throw new Error(`analyze failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as ApiGraph;
}
