import { createHash } from "node:crypto";
import path from "node:path";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function extractTitle(content: string, fallbackPath: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return path.basename(fallbackPath, path.extname(fallbackPath));
}

export function normalizeRelPath(relPath: string): string {
  return relPath.split(path.sep).join("/");
}

export function safeSearchQuery(query: string): string {
  const q = query.trim();
  if (!q) return q;
  return q
    .split(/\s+/)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" ");
}

export function withLines(content: string, fromLine: number, maxLines: number, lineNumbers: boolean): string {
  const lines = content.split("\n");
  const start = Math.max(1, fromLine);
  const end = maxLines > 0 ? start + maxLines - 1 : lines.length;
  const sliced = lines.slice(start - 1, end);
  if (!lineNumbers) return sliced.join("\n");
  return sliced.map((line, i) => `${String(start + i).padStart(4, " ")} | ${line}`).join("\n");
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
