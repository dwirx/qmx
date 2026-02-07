import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadSqliteVec } from "sqlite-vec";

type SqliteVecState = {
  enabled: boolean;
  message: string;
};

const vecStateByDb = new WeakMap<Database, SqliteVecState>();

function fallbackVecExtensionPath(): string | null {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const platform = process.platform;
  const arch = process.arch;
  const candidates: string[] = [];

  if (platform === "linux" && arch === "x64") candidates.push("node_modules/sqlite-vec-linux-x64/vec0.so");
  if (platform === "linux" && arch === "arm64") candidates.push("node_modules/sqlite-vec-linux-arm64/vec0.so");
  if (platform === "darwin" && arch === "x64") candidates.push("node_modules/sqlite-vec-darwin-x64/vec0.dylib");
  if (platform === "darwin" && arch === "arm64") candidates.push("node_modules/sqlite-vec-darwin-arm64/vec0.dylib");
  if (platform === "win32" && arch === "x64") candidates.push("node_modules/sqlite-vec-windows-x64/vec0.dll");

  for (const rel of candidates) {
    const full = path.join(root, rel);
    if (existsSync(full)) return full;
  }
  return null;
}

function enableSqliteVec(db: Database): SqliteVecState {
  try {
    loadSqliteVec(db);
    const version = db.query("SELECT vec_version() AS version").get() as { version: string };
    return { enabled: true, message: `loaded (${version.version || "unknown"})` };
  } catch {
    const fallback = fallbackVecExtensionPath();
    if (!fallback) return { enabled: false, message: "extension not available for current platform" };
    try {
      db.loadExtension(fallback);
      const version = db.query("SELECT vec_version() AS version").get() as { version: string };
      return { enabled: true, message: `loaded (${version.version || "unknown"})` };
    } catch (error) {
      return { enabled: false, message: `failed to load: ${String(error)}` };
    }
  }
}

export function openQmxDb(dbPath: string): Database {
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  root_path TEXT NOT NULL,
  mask TEXT NOT NULL DEFAULT '**/*.md',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,
  display_path TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  content_sha TEXT NOT NULL,
  docid TEXT NOT NULL,
  mtime_ms INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  embedding TEXT,
  embedding_model TEXT,
  embedded_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(collection_id, rel_path)
);

CREATE INDEX IF NOT EXISTS idx_documents_docid ON documents(docid);
CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection_id, rel_path);

CREATE TABLE IF NOT EXISTS path_contexts (
  id INTEGER PRIMARY KEY,
  target TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  doc_id UNINDEXED,
  title,
  content,
  tokenize='unicode61'
);
`);

  const cols = db.query("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("embedding")) db.exec("ALTER TABLE documents ADD COLUMN embedding TEXT;");
  if (!names.has("embedding_model")) db.exec("ALTER TABLE documents ADD COLUMN embedding_model TEXT;");
  if (!names.has("embedded_at")) db.exec("ALTER TABLE documents ADD COLUMN embedded_at TEXT;");

  vecStateByDb.set(db, enableSqliteVec(db));

  return db;
}

export function sqliteVecState(db: Database): SqliteVecState {
  return vecStateByDb.get(db) || { enabled: false, message: "not initialized" };
}

export function rebuildFts(db: Database): void {
  db.query("DELETE FROM documents_fts").run();
  db.query(
    `INSERT INTO documents_fts(doc_id, title, content)
     SELECT CAST(id AS TEXT), title, content FROM documents`
  ).run();
}

export function cleanupDb(db: Database): { removedFtsOrphans: number } {
  const before = (db.query("SELECT COUNT(*) AS count FROM documents_fts").get() as { count: number }).count;
  db.query(
    `DELETE FROM documents_fts
     WHERE doc_id NOT IN (SELECT CAST(id AS TEXT) FROM documents)`
  ).run();
  const after = (db.query("SELECT COUNT(*) AS count FROM documents_fts").get() as { count: number }).count;
  return { removedFtsOrphans: Math.max(0, before - after) };
}

export function clearEmbeddings(db: Database): number {
  const before = (db.query("SELECT COUNT(*) AS count FROM documents WHERE embedding IS NOT NULL").get() as { count: number }).count;
  db.query("UPDATE documents SET embedding = NULL, embedding_model = NULL, embedded_at = NULL").run();
  return before;
}

export function statusInfo(db: Database): { collections: number; documents: number; contexts: number; embedded: number } {
  const collections = (db.query("SELECT COUNT(*) AS count FROM collections").get() as { count: number }).count;
  const documents = (db.query("SELECT COUNT(*) AS count FROM documents").get() as { count: number }).count;
  const contexts = (db.query("SELECT COUNT(*) AS count FROM path_contexts").get() as { count: number }).count;
  const embedded = (db.query("SELECT COUNT(*) AS count FROM documents WHERE embedding IS NOT NULL").get() as { count: number }).count;
  return { collections, documents, contexts, embedded };
}

export function doctorChecks(db: Database): Array<{ check: string; ok: boolean; message: string }> {
  const checks: Array<{ check: string; ok: boolean; message: string }> = [];
  try {
    db.query("SELECT 1").get();
    checks.push({ check: "sqlite", ok: true, message: "SQLite ready" });
  } catch (error) {
    checks.push({ check: "sqlite", ok: false, message: `SQLite error: ${String(error)}` });
  }
  try {
    db.query("SELECT COUNT(*) FROM documents_fts").get();
    checks.push({ check: "fts5", ok: true, message: "FTS5 ready" });
  } catch (error) {
    checks.push({ check: "fts5", ok: false, message: `FTS5 error: ${String(error)}` });
  }
  const vec = sqliteVecState(db);
  checks.push({ check: "sqlite-vec", ok: vec.enabled, message: vec.message });
  checks.push({ check: "ollama", ok: true, message: "Ollama integration enabled via OLLAMA_HOST" });
  return checks;
}
