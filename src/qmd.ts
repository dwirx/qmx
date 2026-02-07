#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type SearchResult = {
  file: string;
  score: number;
  matches: number;
  preview: string;
};

function printHelp() {
  console.log(`QMD - Query Markup Documents (Bun prototype)

Usage:
  qmd <command> [options]

Available commands:
  qmd ls [path]
  qmd get <file>
  qmd multi-get <pattern>
  qmd search <query> [--json] [-n <num>]
  qmd status

Planned commands:
  qmd collection ...
  qmd context ...
  qmd update
  qmd embed
  qmd vsearch <query>
  qmd query <query>
`);
}

function planned(command: string): never {
  console.error(`[Planned] Command '${command}' belum diimplementasikan di versi prototype ini.`);
  process.exit(2);
}

function toAbsolute(inputPath: string): string {
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(process.cwd(), inputPath);
}

function formatWithLineNumbers(content: string): string {
  return content
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(4, " ")} | ${line}`)
    .join("\n");
}

function listPath(targetArg?: string) {
  const target = toAbsolute(targetArg ?? ".");
  if (!existsSync(target)) {
    console.error(`Path tidak ditemukan: ${targetArg ?? "."}`);
    process.exit(1);
  }

  const st = statSync(target);
  if (st.isFile()) {
    console.log(path.relative(process.cwd(), target));
    return;
  }

  const entries = readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.name !== ".git" && entry.name !== "node_modules")
    .map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`)
    .sort((a, b) => a.localeCompare(b));

  for (const line of entries) console.log(line);
}

function getFile(fileArg: string, lineNumbers: boolean) {
  if (fileArg.startsWith("#")) {
    console.error("DocID (#abc123) masih Planned. Gunakan path file untuk saat ini.");
    process.exit(2);
  }

  const filePath = toAbsolute(fileArg);
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    console.error(`File tidak ditemukan: ${fileArg}`);
    process.exit(1);
  }

  const content = readFileSync(filePath, "utf8");
  console.log(lineNumbers ? formatWithLineNumbers(content) : content);
}

function expandPatterns(patternArg: string): string[] {
  const items = patternArg
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const out = new Set<string>();

  for (const item of items) {
    if (item.startsWith("#")) {
      console.error(`DocID '${item}' masih Planned.`);
      continue;
    }

    const hasGlob = /[*?[\]{}]/.test(item);
    if (!hasGlob) {
      const abs = toAbsolute(item);
      if (existsSync(abs) && statSync(abs).isFile()) out.add(abs);
      continue;
    }

    const glob = new Bun.Glob(item);
    for (const hit of glob.scanSync({ cwd: process.cwd(), absolute: true })) {
      if (existsSync(hit) && statSync(hit).isFile()) out.add(hit);
    }
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function parseNumberFlag(args: string[], shortFlag: string, fallback: number): number {
  const idx = args.indexOf(shortFlag);
  if (idx < 0 || idx + 1 >= args.length) return fallback;
  const value = Number(args[idx + 1]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function multiGet(args: string[]) {
  const patternArg = args[0];
  if (!patternArg) {
    console.error("Usage: qmd multi-get <pattern>");
    process.exit(1);
  }

  const lineNumbers = args.includes("--line-numbers");
  const maxLines = parseNumberFlag(args, "-l", 0);

  const maxBytesIdx = args.indexOf("--max-bytes");
  let maxBytes = 10_240;
  if (maxBytesIdx >= 0 && maxBytesIdx + 1 < args.length) {
    const n = Number(args[maxBytesIdx + 1]);
    if (Number.isFinite(n) && n > 0) maxBytes = Math.floor(n);
  }

  const files = expandPatterns(patternArg);
  if (files.length === 0) {
    console.error("Tidak ada file yang cocok.");
    process.exit(1);
  }

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const st = statSync(file);
    if (st.size > maxBytes) {
      console.log(`\n--- ${rel} (skip: ${st.size} bytes > max ${maxBytes}) ---`);
      continue;
    }

    let content = readFileSync(file, "utf8");
    if (maxLines > 0) content = content.split("\n").slice(0, maxLines).join("\n");
    if (lineNumbers) content = formatWithLineNumbers(content);

    console.log(`\n--- ${rel} ---`);
    console.log(content);
  }
}

function buildPreview(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length <= 140 ? clean : `${clean.slice(0, 140)}...`;
}

function countMatches(content: string, query: string): number {
  const source = content.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;

  let from = 0;
  let count = 0;
  while (true) {
    const idx = source.indexOf(q, from);
    if (idx === -1) break;
    count += 1;
    from = idx + q.length;
  }
  return count;
}

function search(args: string[]) {
  const query = args[0];
  if (!query) {
    console.error("Usage: qmd search <query>");
    process.exit(1);
  }

  const asJson = args.includes("--json");
  const n = parseNumberFlag(args, "-n", 10);

  const glob = new Bun.Glob("**/*.md");
  const results: SearchResult[] = [];

  for (const hit of glob.scanSync({ cwd: process.cwd(), absolute: true })) {
    if (hit.includes("/node_modules/")) continue;

    const content = readFileSync(hit, "utf8");
    const matches = countMatches(content, query);
    if (matches <= 0) continue;

    results.push({
      file: path.relative(process.cwd(), hit),
      score: matches,
      matches,
      preview: buildPreview(content),
    });
  }

  results.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  const sliced = results.slice(0, n);

  if (asJson) {
    console.log(JSON.stringify(sliced, null, 2));
    return;
  }

  if (sliced.length === 0) {
    console.log("Tidak ada hasil.");
    return;
  }

  for (const row of sliced) {
    console.log(`${row.file} | score=${row.score} | matches=${row.matches}`);
    console.log(`  ${row.preview}`);
  }
}

function status() {
  console.log("QMD status: prototype aktif");
  console.log(`Runtime: Bun ${Bun.version}`);
  console.log(`Workspace: ${process.cwd()}`);
  console.log("Storage SQLite/vector: Planned");
}

function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "ls") {
    listPath(rest[0]);
    return;
  }

  if (command === "get") {
    const fileArg = rest[0];
    if (!fileArg) {
      console.error("Usage: qmd get <file>");
      process.exit(1);
    }
    getFile(fileArg, rest.includes("--line-numbers"));
    return;
  }

  if (command === "multi-get") {
    multiGet(rest);
    return;
  }

  if (command === "search") {
    search(rest);
    return;
  }

  if (command === "status") {
    status();
    return;
  }

  if (command === "collection" || command === "context" || command === "update" || command === "embed" || command === "vsearch" || command === "query") {
    planned(command);
  }

  console.error(`Command tidak dikenal: ${command}`);
  printHelp();
  process.exit(1);
}

main();
