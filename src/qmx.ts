#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  addCollection,
  addContext,
  buildEmbedIntro,
  cleanupDb,
  clearEmbeddings,
  configPath,
  DEFAULT_EMBED_MODEL,
  DEFAULT_EXPANDER_MODEL,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_RERANKER_MODEL,
  doctorChecks,
  getDocument,
  listCollectionSummaries,
  listContexts,
  loadConfig,
  lsCollection,
  multiGetDocuments,
  openQmxDb,
  queryDocuments,
  rebuildFts,
  removeCollection,
  removeContext,
  renameCollection,
  resolveOllamaHost,
  runIndexUpdate,
  searchDocuments,
  setConfigValue,
  sqliteVecState,
  statusInfo,
  vsearchDocuments,
} from "./lib/api";
import { runMcpServer } from "./lib/mcp";

function printHelp(): void {
  console.log(`QMX - Query Markup Experience

Usage:
  qmx <command> [options]

Commands:
  qmx collection add <path> --name <name> [--mask <glob>]
  qmx collection list [--plain] [--compact] [--no-summary]
  qmx collection remove <name>
  qmx collection rename <old> <new>

  qmx context add <target> <text>
  qmx context list
  qmx context rm <target>
  qmx setup [--notes <path>] [--meetings <path>] [--docs <path>] [--mask <glob>] [--no-embed]

  qmx config set-host <url>
  qmx config set-model <name>
  qmx config set-expander <name>
  qmx config set-reranker <name>
  qmx config get

  qmx update [--no-embed] [--host <url>] [--model <name>]
  qmx index [--no-embed] [--host <url>] [--model <name>]
  qmx embed [--host <url>] [--model <name>] [-f] [--plain] [--compact] [--no-summary]
  qmx vector [--host <url>] [--model <name>] [-f] [--plain] [--compact] [--no-summary]
  qmx cleanup
  qmx ls [collection[/prefix]]
  qmx search <query> [-n <num>] [-c <collection>] [--json|--files|--csv|--md|--xml] [--all] [--min-score <num>]
  qmx vsearch <query> [-n <num>] [-c <collection>] [--host <url>] [--model <name>] [--json|--files|--csv|--md|--xml] [--all] [--min-score <num>]
  qmx query <query> [-n <num>] [-c <collection>] [--host <url>] [--model <name>] [--expander-model <name>] [--reranker-model <name>] [--no-expand] [--no-rerank] [--json|--files|--csv|--md|--xml] [--all] [--min-score <num>]
  qmx rerank <query> [-n <num>] [-c <collection>] [--host <url>] [--model <name>] [--expander-model <name>] [--reranker-model <name>] [--json|--files|--csv|--md|--xml] [--all] [--min-score <num>]
  qmx get <path|#docid> [-l <lines>] [--from <line>] [--line-numbers]
  qmx multi-get <pattern|list|docids> [-l <lines>] [--max-bytes <num>] [--json]
  qmx mcp
  qmx status
  qmx doctor

Global options:
  --index <name>  Use named DB index (default: index.sqlite)
`);
}

type UiOptions = {
  plain: boolean;
  compact: boolean;
  noSummary: boolean;
};

function parseUiOptions(args: string[]): UiOptions {
  return {
    plain: args.includes("--plain") || process.env.NO_COLOR !== undefined,
    compact: args.includes("--compact"),
    noSummary: args.includes("--no-summary"),
  };
}

function colorize(text: string, color: "cyan" | "green" | "yellow" | "dim", ui: UiOptions): string {
  if (ui.plain || !process.stdout.isTTY) return text;
  if (color === "cyan") return `\x1b[36m${text}\x1b[0m`;
  if (color === "green") return `\x1b[32m${text}\x1b[0m`;
  if (color === "yellow") return `\x1b[33m${text}\x1b[0m`;
  return `\x1b[2m${text}\x1b[0m`;
}

function padCell(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value.padEnd(width, " ");
}

function parseGlobalIndex(args: string[]): { args: string[]; indexName: string } {
  const next = [...args];
  let indexName = "index";
  const idx = next.indexOf("--index");
  if (idx >= 0 && idx + 1 < next.length) {
    indexName = next[idx + 1] || "index";
    next.splice(idx, 2);
  }
  return { args: next, indexName };
}

function getDbPath(indexName: string): string {
  const base = process.env.XDG_CACHE_HOME ? path.join(process.env.XDG_CACHE_HOME, "qmx") : path.join(homedir(), ".cache", "qmx");
  mkdirSync(base, { recursive: true });
  return path.join(base, `${indexName}.sqlite`);
}

function requireValue(value: string | undefined, message: string): string {
  if (!value) {
    console.error(message);
    process.exit(1);
  }
  return value;
}

function parseFlagNumber(args: string[], flag: string, fallback: number): number {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) return fallback;
  const n = Number(args[idx + 1]);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function parseFlagString(args: string[], shortFlag: string | null, longFlag: string, fallback = ""): string {
  if (shortFlag) {
    const shortIdx = args.indexOf(shortFlag);
    if (shortIdx >= 0 && shortIdx + 1 < args.length) return args[shortIdx + 1] || fallback;
  }
  const longIdx = args.indexOf(longFlag);
  if (longIdx >= 0 && longIdx + 1 < args.length) return args[longIdx + 1] || fallback;
  return fallback;
}

function parseRefWithLine(rawRef: string): { ref: string; fromLine: number } {
  if (rawRef.startsWith("#")) return { ref: rawRef, fromLine: 1 };
  const match = rawRef.match(/^(.*):(\d+)$/);
  if (!match) return { ref: rawRef, fromLine: 1 };
  return { ref: match[1] ?? rawRef, fromLine: Number(match[2]) };
}

function toCsvRow(values: string[]): string {
  return values
    .map((v) => {
      if (v.includes(",") || v.includes('"') || v.includes("\n")) return `"${v.replaceAll('"', '""')}"`;
      return v;
    })
    .join(",");
}

function printRows(rows: Array<{ displayPath: string; docid: string; score: number; title: string; snippet: string }>): void {
  if (rows.length === 0) {
    console.log("Tidak ada hasil.");
    return;
  }
  for (const row of rows) {
    console.log(`${row.displayPath} #${row.docid} score=${row.score.toFixed(3)}`);
    console.log(`  ${row.title}`);
    console.log(`  ${row.snippet}`);
  }
}

function formatUpdatedAgo(timestamp: string | null): string {
  if (!timestamp) return "-";
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return timestamp;
  const diffMs = Date.now() - ms;
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function renderCollectionList(
  rows: Array<{ name: string; rootPath: string; mask: string; fileCount: number; updatedAt: string | null }>,
  ui: UiOptions
): void {
  if (rows.length === 0) {
    console.log("Collections: belum ada.");
    return;
  }

  const totalFiles = rows.reduce((acc, row) => acc + row.fileCount, 0);
  console.log(colorize(`Collections (${rows.length}):`, "cyan", ui));

  if (ui.compact) {
    for (const row of rows) {
      const updated = formatUpdatedAgo(row.updatedAt);
      console.log(`${row.name} | qmx://${row.name}/ | files=${row.fileCount} | updated=${updated}`);
    }
  } else {
    const header = `${padCell("NAME", 16)} ${padCell("URI", 24)} ${padCell("FILES", 7)} UPDATED`;
    console.log(header);
    console.log(`${"-".repeat(16)} ${"-".repeat(24)} ${"-".repeat(7)} ${"-".repeat(10)}`);
    for (const row of rows) {
      const updated = formatUpdatedAgo(row.updatedAt);
      console.log(`${padCell(row.name, 16)} ${padCell(`qmx://${row.name}/`, 24)} ${padCell(String(row.fileCount), 7)} ${updated}`);
      console.log(colorize(`  root=${row.rootPath}  pattern=${row.mask}`, "dim", ui));
    }
  }

  if (!ui.noSummary) {
    const summary = `Summary: collections=${rows.length} files=${totalFiles}`;
    console.log(colorize(summary, "green", ui));
  }
}

function outputRows(rows: Array<{ displayPath: string; docid: string; score: number; title: string; snippet: string }>, args: string[]): void {
  if (args.includes("--json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (args.includes("--files")) {
    for (const row of rows) console.log(`${row.docid},${row.score.toFixed(4)},${row.displayPath},${row.title}`);
    return;
  }
  if (args.includes("--csv")) {
    console.log(toCsvRow(["docid", "score", "path", "title", "snippet"]));
    for (const row of rows) console.log(toCsvRow([row.docid, row.score.toFixed(4), row.displayPath, row.title, row.snippet]));
    return;
  }
  if (args.includes("--md")) {
    for (const row of rows) {
      console.log(`- **${row.displayPath}** (#${row.docid}) score=${row.score.toFixed(4)}`);
      console.log(`  - ${row.title}`);
      console.log(`  - ${row.snippet}`);
    }
    return;
  }
  if (args.includes("--xml")) {
    console.log("<results>");
    for (const row of rows) {
      console.log(`  <result docid=\"${row.docid}\" score=\"${row.score.toFixed(4)}\">`);
      console.log(`    <path>${row.displayPath}</path>`);
      console.log(`    <title>${row.title}</title>`);
      console.log(`    <snippet>${row.snippet}</snippet>`);
      console.log("  </result>");
    }
    console.log("</results>");
    return;
  }
  printRows(rows);
}

async function main() {
  const parsed = parseGlobalIndex(process.argv.slice(2));
  const args = parsed.args;
  const dbPath = getDbPath(parsed.indexName);
  const db = openQmxDb(dbPath);
  const cfg = loadConfig();

  const [command, ...rest] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const host = resolveOllamaHost(parseFlagString(rest, null, "--host", ""), cfg.ollamaHost || DEFAULT_OLLAMA_HOST);
  const model = parseFlagString(rest, null, "--model", cfg.embedModel || DEFAULT_EMBED_MODEL);
  const expanderModel = parseFlagString(rest, null, "--expander-model", cfg.expanderModel || DEFAULT_EXPANDER_MODEL);
  const rerankerModel = parseFlagString(rest, null, "--reranker-model", cfg.rerankerModel || DEFAULT_RERANKER_MODEL);

  if (command === "config") {
    const [sub, ...subArgs] = rest;
    if (sub === "set-host") {
      const raw = requireValue(subArgs[0], "Usage: qmx config set-host <url>");
      const normalized = resolveOllamaHost(raw);
      setConfigValue("ollamaHost", normalized);
      console.log(`Ollama host tersimpan: ${normalized}`);
      console.log(`Config: ${configPath()}`);
      return;
    }
    if (sub === "set-model") {
      const m = requireValue(subArgs[0], "Usage: qmx config set-model <name>");
      setConfigValue("embedModel", m);
      console.log(`Embedding model tersimpan: ${m}`);
      console.log(`Config: ${configPath()}`);
      return;
    }
    if (sub === "set-expander") {
      const m = requireValue(subArgs[0], "Usage: qmx config set-expander <name>");
      setConfigValue("expanderModel", m);
      console.log(`Expander model tersimpan: ${m}`);
      console.log(`Config: ${configPath()}`);
      return;
    }
    if (sub === "set-reranker") {
      const m = requireValue(subArgs[0], "Usage: qmx config set-reranker <name>");
      setConfigValue("rerankerModel", m);
      console.log(`Reranker model tersimpan: ${m}`);
      console.log(`Config: ${configPath()}`);
      return;
    }
    if (sub === "get" || !sub) {
      console.log(`Config file: ${configPath()}`);
      console.log(`ollamaHost: ${cfg.ollamaHost || "(default)"}`);
      console.log(`embedModel: ${cfg.embedModel || "(default)"}`);
      console.log(`expanderModel: ${cfg.expanderModel || "(default)"}`);
      console.log(`rerankerModel: ${cfg.rerankerModel || "(default)"}`);
      console.log(`effectiveHost: ${host}`);
      console.log(`effectiveModel: ${model}`);
      console.log(`effectiveExpanderModel: ${expanderModel}`);
      console.log(`effectiveRerankerModel: ${rerankerModel}`);
      return;
    }
    console.error("Usage: qmx config <set-host|set-model|set-expander|set-reranker|get>");
    process.exit(1);
  }

  if (command === "collection") {
    const [rawSub, ...subArgs] = rest;
    const sub = rawSub === "ls" ? "list" : rawSub === "rm" ? "remove" : rawSub;
    if (sub === "add") {
      const rootPath = requireValue(subArgs[0], "Usage: qmx collection add <path> --name <name> [--mask <glob>]");
      const name = parseFlagString(subArgs, "-n", "--name");
      const mask = parseFlagString(subArgs, null, "--mask", "**/*.md");
      if (!name) {
        console.error("Flag --name wajib diisi.");
        process.exit(1);
      }
      addCollection(db, { name, rootPath, mask });
      console.log(`Collection '${name}' tersimpan.`);
      return;
    }
    if (sub === "list") {
      const rows = listCollectionSummaries(db);
      renderCollectionList(rows, parseUiOptions(subArgs));
      return;
    }
    if (sub === "remove") {
      const name = requireValue(subArgs[0], "Usage: qmx collection remove <name>");
      removeCollection(db, name);
      console.log(`Collection '${name}' dihapus.`);
      return;
    }
    if (sub === "rename") {
      const oldName = requireValue(subArgs[0], "Usage: qmx collection rename <old> <new>");
      const newName = requireValue(subArgs[1], "Usage: qmx collection rename <old> <new>");
      renameCollection(db, oldName, newName);
      console.log(`Collection '${oldName}' -> '${newName}'.`);
      return;
    }
    console.error("Usage: qmx collection <add|list|remove|rename> ...");
    process.exit(1);
  }

  if (command === "context") {
    const [rawSub, ...subArgs] = rest;
    const sub = rawSub === "remove" ? "rm" : rawSub;
    if (sub === "add") {
      const target = requireValue(subArgs[0], "Usage: qmx context add <target> <text>");
      const text = requireValue(subArgs[1], "Usage: qmx context add <target> <text>");
      addContext(db, { target, value: text });
      console.log(`Context '${target}' tersimpan.`);
      return;
    }
    if (sub === "list") {
      const rows = listContexts(db);
      if (rows.length === 0) return console.log("Belum ada context.");
      for (const row of rows) console.log(`${row.target}\t${row.value}`);
      return;
    }
    if (sub === "rm") {
      const target = requireValue(subArgs[0], "Usage: qmx context rm <target>");
      removeContext(db, target);
      console.log(`Context '${target}' dihapus.`);
      return;
    }
    console.error("Usage: qmx context <add|list|rm> ...");
    process.exit(1);
  }

  if (command === "setup") {
    const notesPath = parseFlagString(rest, null, "--notes", "");
    const meetingsPath = parseFlagString(rest, null, "--meetings", "");
    const docsPath = parseFlagString(rest, null, "--docs", "");
    const mask = parseFlagString(rest, null, "--mask", "**/*.md");
    const doEmbed = !rest.includes("--no-embed");

    const entries = [
      { name: "notes", rootPath: notesPath, context: "Personal notes and ideas" },
      { name: "meetings", rootPath: meetingsPath, context: "Meeting transcripts and notes" },
      { name: "docs", rootPath: docsPath, context: "Work documentation" },
    ].filter((entry) => entry.rootPath);

    if (entries.length === 0) {
      console.error("Usage: qmx setup [--notes <path>] [--meetings <path>] [--docs <path>] [--mask <glob>] [--no-embed]");
      process.exit(1);
    }

    for (const entry of entries) {
      addCollection(db, { name: entry.name, rootPath: entry.rootPath, mask });
      addContext(db, { target: `qmx://${entry.name}`, value: entry.context });
      console.log(`Collection '${entry.name}' + context 'qmx://${entry.name}' siap.`);
    }

    const stats = await runIndexUpdate(db, { embed: doEmbed, host, model });
    console.log(
      `Setup selesai | scanned=${stats.scanned} added=${stats.added} updated=${stats.updated} removed=${stats.removed} embed=${doEmbed ? "on" : "off"}`
    );
    return;
  }

  if (command === "update" || command === "index") {
    const embed = !rest.includes("--no-embed");
    const stats = await runIndexUpdate(db, { embed, host, model });
    console.log(`Index updated | scanned=${stats.scanned} added=${stats.added} updated=${stats.updated} removed=${stats.removed}`);
    return;
  }

  if (command === "embed" || command === "vector") {
    const ui = parseUiOptions(rest);
    const startedAt = Date.now();
    const force = rest.includes("-f") || rest.includes("--force");
    if (force) {
      const cleared = clearEmbeddings(db);
      console.log(`Embedding cache dibersihkan: ${cleared} dokumen.`);
    }
    let printedHeader = false;
    const stats = await runIndexUpdate(db, {
      embed: true,
      host,
      model,
      onProgress: (event) => {
        if (event.stage === "plan") {
          if (ui.compact) {
            console.log(`Embed plan | docs=${event.documents} chunks=${event.chunks} model=${event.model}`);
          } else {
            console.log(colorize("Embed Plan", "cyan", ui));
            const lines = buildEmbedIntro({
              documents: event.documents,
              chunks: event.chunks,
              bytes: event.bytes,
              splitDocuments: event.splitDocuments,
              model: event.model,
            });
            for (const line of lines) console.log(`  ${line}`);
          }
          printedHeader = true;
          return;
        }
        if (event.stage === "doc") {
          const percent = event.total > 0 ? Math.round((event.index / event.total) * 100) : 0;
          if (ui.compact) {
            console.log(`[${event.index}/${event.total}] ${event.displayPath} (${event.chunks} chunks)`);
          } else {
            console.log(`[${padCell(`${percent}%`, 4)}] [${event.index}/${event.total}] ${event.displayPath} (${event.chunks} chunks)`);
          }
        }
      },
    });
    if (!printedHeader) {
      const lines = buildEmbedIntro({
        documents: stats.embeddedDocs,
        chunks: stats.embeddedChunks,
        bytes: stats.embeddedBytes,
        splitDocuments: stats.splitDocuments,
        model,
      });
      for (const line of lines) console.log(line);
    }
    const duration = formatDurationMs(Date.now() - startedAt);
    const finalLine = `Embed selesai | scanned=${stats.scanned} added=${stats.added} updated=${stats.updated} removed=${stats.removed} embedded_docs=${stats.embeddedDocs} embedded_chunks=${stats.embeddedChunks}`;
    console.log(colorize(finalLine, "green", ui));
    if (!ui.noSummary) console.log(colorize(`Duration: ${duration}`, "dim", ui));
    return;
  }

  if (command === "cleanup") {
    const cleaned = cleanupDb(db);
    rebuildFts(db);
    console.log(`Cleanup done | removed_fts_orphans=${cleaned.removedFtsOrphans}`);
    return;
  }

  if (command === "ls") {
    const rows = lsCollection(db, rest[0]);
    if (rows.length === 0) return console.log("Tidak ada data.");
    for (const row of rows) console.log(row);
    return;
  }

  if (command === "search") {
    const query = requireValue(rest[0], "Usage: qmx search <query>");
    const n = parseFlagNumber(rest, "-n", 5);
    const collection = parseFlagString(rest, "-c", "--collection", "");
    const minScoreIdx = rest.indexOf("--min-score");
    const minScore = minScoreIdx >= 0 && minScoreIdx + 1 < rest.length ? Number(rest[minScoreIdx + 1]) || 0 : 0;
    const rows = searchDocuments(db, { query, limit: n, collection: collection || undefined, all: rest.includes("--all"), minScore });
    outputRows(rows, rest);
    return;
  }

  if (command === "vsearch") {
    const query = requireValue(rest[0], "Usage: qmx vsearch <query>");
    const n = parseFlagNumber(rest, "-n", 5);
    const collection = parseFlagString(rest, "-c", "--collection", "");
    const minScoreIdx = rest.indexOf("--min-score");
    const minScore = minScoreIdx >= 0 && minScoreIdx + 1 < rest.length ? Number(rest[minScoreIdx + 1]) || 0 : 0;
    try {
      const rows = await vsearchDocuments(db, {
        query,
        limit: n,
        collection: collection || undefined,
        host,
        model,
        all: rest.includes("--all"),
        minScore,
      });
      outputRows(rows, rest);
    } catch (error) {
      console.error(`vsearch gagal menghubungi Ollama di ${host}: ${String(error)}`);
      process.exit(1);
    }
    return;
  }

  if (command === "query") {
    const query = requireValue(rest[0], "Usage: qmx query <query>");
    const n = parseFlagNumber(rest, "-n", 5);
    const collection = parseFlagString(rest, "-c", "--collection", "");
    const minScoreIdx = rest.indexOf("--min-score");
    const minScore = minScoreIdx >= 0 && minScoreIdx + 1 < rest.length ? Number(rest[minScoreIdx + 1]) || 0 : 0;
    try {
      const rows = await queryDocuments(db, {
        query,
        limit: n,
        collection: collection || undefined,
        host,
        model,
        expanderModel,
        rerankerModel,
        noExpand: rest.includes("--no-expand"),
        noRerank: rest.includes("--no-rerank"),
        all: rest.includes("--all"),
        minScore,
      });
      outputRows(rows, rest);
    } catch (error) {
      console.error(`query gagal menghubungi Ollama di ${host}: ${String(error)}`);
      process.exit(1);
    }
    return;
  }

  if (command === "rerank") {
    const query = requireValue(rest[0], "Usage: qmx rerank <query>");
    const n = parseFlagNumber(rest, "-n", 5);
    const collection = parseFlagString(rest, "-c", "--collection", "");
    const minScoreIdx = rest.indexOf("--min-score");
    const minScore = minScoreIdx >= 0 && minScoreIdx + 1 < rest.length ? Number(rest[minScoreIdx + 1]) || 0 : 0;
    try {
      const rows = await queryDocuments(db, {
        query,
        limit: n,
        collection: collection || undefined,
        host,
        model,
        expanderModel,
        rerankerModel,
        noExpand: true,
        noRerank: false,
        all: rest.includes("--all"),
        minScore,
      });
      outputRows(rows, rest);
    } catch (error) {
      console.error(`rerank gagal menghubungi Ollama di ${host}: ${String(error)}`);
      process.exit(1);
    }
    return;
  }

  if (command === "get") {
    const refInput = requireValue(rest[0], "Usage: qmx get <path|#docid> [-l <lines>] [--from <line>] [--line-numbers]");
    const parsedRef = parseRefWithLine(refInput);
    const maxLines = parseFlagNumber(rest, "-l", 0);
    const fromIdx = rest.indexOf("--from");
    const fromLine = fromIdx >= 0 && fromIdx + 1 < rest.length ? Number(rest[fromIdx + 1]) || parsedRef.fromLine : parsedRef.fromLine;

    const doc = getDocument(db, parsedRef.ref, { fromLine, maxLines, lineNumbers: rest.includes("--line-numbers") });
    if (!doc) {
      console.error(`Dokumen tidak ditemukan: ${parsedRef.ref}`);
      process.exit(1);
    }
    console.log(`--- ${doc.displayPath} #${doc.docid} ---`);
    console.log(doc.content);
    return;
  }

  if (command === "multi-get") {
    const pattern = requireValue(rest[0], "Usage: qmx multi-get <pattern|list|docids>");
    const maxLines = parseFlagNumber(rest, "-l", 0);
    const maxBytesIdx = rest.indexOf("--max-bytes");
    const maxBytes = maxBytesIdx >= 0 && maxBytesIdx + 1 < rest.length ? Number(rest[maxBytesIdx + 1]) || 10240 : 10240;

    const docs = multiGetDocuments(db, pattern, {
      fromLine: 1,
      maxLines,
      lineNumbers: rest.includes("--line-numbers"),
    }).filter((d) => Buffer.byteLength(d.content, "utf8") <= maxBytes);

    if (rest.includes("--json")) return console.log(JSON.stringify(docs, null, 2));
    if (docs.length === 0) return console.log("Tidak ada dokumen cocok.");

    for (const doc of docs) {
      console.log(`\n--- ${doc.displayPath} #${doc.docid} ---`);
      console.log(doc.content);
    }
    return;
  }

  if (command === "status") {
    const info = statusInfo(db);
    const vec = sqliteVecState(db);
    console.log("QMX status: active");
    console.log(`Runtime: Bun ${Bun.version}`);
    console.log(`DB: ${dbPath}`);
    console.log(`Collections: ${info.collections}`);
    console.log(`Documents: ${info.documents}`);
    console.log(`Embedded docs: ${info.embedded}`);
    console.log(`Contexts: ${info.contexts}`);
    console.log(`Config file: ${configPath()}`);
    console.log(`Ollama host: ${host}`);
    console.log(`Embed model: ${model}`);
    console.log(`Expander model: ${expanderModel}`);
    console.log(`Reranker model: ${rerankerModel}`);
    console.log(`sqlite-vec: ${vec.enabled ? "enabled" : "disabled"} (${vec.message})`);
    return;
  }

  if (command === "mcp") {
    await runMcpServer({ db, host, model });
    return;
  }

  if (command === "doctor") {
    const checks = doctorChecks(db);
    for (const check of checks) {
      console.log(`${check.ok ? "OK" : "WARN"}\t${check.check}\t${check.message}`);
    }
    return;
  }

  console.error(`Command tidak dikenal: ${command}`);
  printHelp();
  process.exit(1);
}

void main();
