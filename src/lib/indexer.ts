import { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { listCollections } from "./collections";
import { chunkByTokenCount } from "./chunking";
import { embedText } from "./ollama";
import type { IndexStats } from "./types";
import { extractTitle, normalizeRelPath, sha256 } from "./utils";

type ProgressEvent =
  | { stage: "plan"; documents: number; chunks: number; bytes: number; splitDocuments: number; model: string }
  | { stage: "doc"; index: number; total: number; displayPath: string; chunks: number }
  | { stage: "done"; stats: IndexStats };

function readMarkdownFile(filePath: string): { content: string; mtimeMs: number; sizeBytes: number } {
  const st = statSync(filePath);
  const content = readFileSync(filePath, "utf8");
  return { content, mtimeMs: Math.floor(st.mtimeMs), sizeBytes: st.size };
}

function iterCollectionFiles(rootPath: string, mask: string): string[] {
  const glob = new Bun.Glob(mask || "**/*.md");
  const out: string[] = [];
  for (const rel of glob.scanSync({ cwd: rootPath })) {
    if (!rel.endsWith(".md")) continue;
    out.push(normalizeRelPath(rel));
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function upsertFts(db: Database, docNumericId: number, title: string, content: string): void {
  const docId = String(docNumericId);
  db.query("DELETE FROM documents_fts WHERE doc_id = ?").run(docId);
  db.query("INSERT INTO documents_fts(doc_id, title, content) VALUES(?, ?, ?)").run(docId, title, content);
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0]?.length ?? 0;
  if (!dim) return [];

  const out = new Array<number>(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i += 1) out[i] = (out[i] ?? 0) + (vec[i] ?? 0);
  }
  for (let i = 0; i < dim; i += 1) out[i] = (out[i] ?? 0) / vectors.length;
  return out;
}

async function embedChunks(chunks: string[], host?: string, model?: string): Promise<number[] | null> {
  try {
    const vectors: number[][] = [];
    for (const chunk of chunks) {
      const v = await embedText(chunk.slice(0, 8000), host, model);
      if (v.length > 0) vectors.push(v);
    }
    if (vectors.length === 0) return null;
    return averageVectors(vectors);
  } catch {
    return null;
  }
}

export async function runIndexUpdate(
  db: Database,
  options?: { embed?: boolean; host?: string; model?: string; onProgress?: (event: ProgressEvent) => void; shouldStop?: () => boolean }
): Promise<IndexStats> {
  const collections = listCollections(db);
  const stats: IndexStats = {
    added: 0,
    updated: 0,
    removed: 0,
    scanned: 0,
    embeddedDocs: 0,
    embeddedChunks: 0,
    embeddedBytes: 0,
    splitDocuments: 0,
    cancelled: false,
  };
  const useEmbed = options?.embed ?? true;
  let embedAttempted = 0;
  let stopRequested = false;

  const planDocs: Array<{ collectionId: number; relPath: string; displayPath: string; content: string; title: string; chunks: string[] }> = [];

  for (const collection of collections) {
    if (!existsSync(collection.rootPath)) continue;
    const relPaths = iterCollectionFiles(collection.rootPath, collection.mask);
    for (const relPath of relPaths) {
      const absPath = path.join(collection.rootPath, relPath);
      if (!existsSync(absPath)) continue;
      const { content } = readMarkdownFile(absPath);
      const title = extractTitle(content, relPath);
      const displayPath = `${collection.name}/${relPath}`;
      const chunks = chunkByTokenCount(`${title}\n\n${content}`);
      planDocs.push({ collectionId: collection.id, relPath, displayPath, content, title, chunks });
    }
  }

  if (useEmbed && options?.onProgress) {
    const totalChunks = planDocs.reduce((acc, d) => acc + d.chunks.length, 0);
    const totalBytes = planDocs.reduce((acc, d) => acc + Buffer.byteLength(d.content, "utf8"), 0);
    const splitDocs = planDocs.filter((d) => d.chunks.length > 1).length;
    options.onProgress({
      stage: "plan",
      documents: planDocs.length,
      chunks: totalChunks,
      bytes: totalBytes,
      splitDocuments: splitDocs,
      model: options.model || "nomic-embed-text",
    });
  }

  for (const collection of collections) {
    if (options?.shouldStop?.()) {
      stopRequested = true;
      break;
    }
    if (!existsSync(collection.rootPath)) continue;
    const relPaths = iterCollectionFiles(collection.rootPath, collection.mask);
    const aliveSet = new Set(relPaths);

    for (const relPath of relPaths) {
      if (options?.shouldStop?.()) {
        stopRequested = true;
        break;
      }
      const absPath = path.join(collection.rootPath, relPath);
      if (!existsSync(absPath)) continue;

      const { content, mtimeMs, sizeBytes } = readMarkdownFile(absPath);
      const contentSha = sha256(content);
      const docid = contentSha.slice(0, 6);
      const title = extractTitle(content, relPath);
      const displayPath = `${collection.name}/${relPath}`;
      stats.scanned += 1;

      const existing = db
        .query("SELECT id, content_sha AS contentSha, embedding FROM documents WHERE collection_id = ? AND rel_path = ?")
        .get(collection.id, relPath) as { id: number; contentSha: string; embedding: string | null } | null;

      let embeddingJson: string | null = existing?.embedding ?? null;
      let embedModel: string | null = null;

      const shouldEmbed = useEmbed && (!existing || existing.contentSha !== contentSha || !existing.embedding);
      if (shouldEmbed) {
        const chunks = chunkByTokenCount(`${title}\n\n${content}`);
        embedAttempted += 1;
        const embedded = await embedChunks(chunks, options?.host, options?.model);
        embeddingJson = embedded ? JSON.stringify(embedded) : existing?.embedding ?? null;
        embedModel = embedded ? options?.model || "nomic-embed-text" : null;

        stats.embeddedDocs += embedded ? 1 : 0;
        stats.embeddedChunks += chunks.length;
        stats.embeddedBytes += Buffer.byteLength(content, "utf8");
        if (chunks.length > 1) stats.splitDocuments += 1;

        if (options?.onProgress) {
          options.onProgress({
            stage: "doc",
            index: embedAttempted,
            total: planDocs.length,
            displayPath,
            chunks: chunks.length,
          });
        }
      }

      if (!existing) {
        const inserted = db
          .query(
            `INSERT INTO documents(
              collection_id, rel_path, display_path, title, content, content_sha, docid, mtime_ms, size_bytes, embedding, embedding_model, embedded_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            collection.id,
            relPath,
            displayPath,
            title,
            content,
            contentSha,
            docid,
            mtimeMs,
            sizeBytes,
            embeddingJson,
            embedModel,
            embeddingJson ? new Date().toISOString() : null
          );
        upsertFts(db, Number(inserted.lastInsertRowid), title, content);
        stats.added += 1;
        continue;
      }

      if (existing.contentSha === contentSha && (!useEmbed || existing.embedding)) continue;

      db.query(
        `UPDATE documents
         SET display_path = ?, title = ?, content = ?, content_sha = ?, docid = ?, mtime_ms = ?, size_bytes = ?,
             embedding = ?, embedding_model = COALESCE(?, embedding_model),
             embedded_at = CASE WHEN ? IS NOT NULL THEN ? ELSE embedded_at END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        displayPath,
        title,
        content,
        contentSha,
        docid,
        mtimeMs,
        sizeBytes,
        embeddingJson,
        embedModel,
        embeddingJson,
        new Date().toISOString(),
        existing.id
      );

      upsertFts(db, existing.id, title, content);
      stats.updated += 1;
    }
    if (stopRequested) break;

    const allDocs = db
      .query("SELECT id, rel_path AS relPath FROM documents WHERE collection_id = ?")
      .all(collection.id) as Array<{ id: number; relPath: string }>;

    for (const doc of allDocs) {
      if (aliveSet.has(doc.relPath)) continue;
      db.query("DELETE FROM documents_fts WHERE doc_id = ?").run(String(doc.id));
      db.query("DELETE FROM documents WHERE id = ?").run(doc.id);
      stats.removed += 1;
    }
  }

  if (stopRequested) stats.cancelled = true;
  options?.onProgress?.({ stage: "done", stats });
  return stats;
}
