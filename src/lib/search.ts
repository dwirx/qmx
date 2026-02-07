import { Database } from "bun:sqlite";
import { embedText, expandQuery, rerankDocuments } from "./ollama";
import type { DocumentRow, GetOptions, HybridRow, SearchOptions, SearchRow, VectorSearchOptions } from "./types";
import { cosineSimilarity, safeSearchQuery, withLines } from "./utils";

export function searchDocuments(db: Database, options: SearchOptions): SearchRow[] {
  const limit = options.all ? 1000 : Math.max(1, options.limit ?? 5);
  const minScore = options.minScore ?? 0;
  const collection = options.collection ?? "";
  const normalizedQuery = safeSearchQuery(options.query);
  if (!normalizedQuery) return [];

  const rows = db
    .query(
      `SELECT d.docid,
              d.display_path AS displayPath,
              d.title,
              snippet(documents_fts, 2, '[', ']', ' ... ', 14) AS snippet,
              bm25(documents_fts) AS bm25
       FROM documents_fts
       JOIN documents d ON CAST(d.id AS TEXT) = documents_fts.doc_id
       JOIN collections c ON c.id = d.collection_id
       WHERE documents_fts MATCH ?
         AND (? = '' OR c.name = ?)
       ORDER BY bm25 ASC, d.display_path ASC
       LIMIT ?`
    )
    .all(normalizedQuery, collection, collection, limit) as Array<{
    docid: string;
    displayPath: string;
    title: string;
    snippet: string;
    bm25: number;
  }>;

  return rows
    .map((row) => ({
      docid: row.docid,
      displayPath: row.displayPath,
      title: row.title,
      snippet: row.snippet || "",
      score: 1 / (1 + Math.abs(row.bm25 ?? 0)),
    }))
    .filter((row) => row.score >= minScore);
}

export async function vsearchDocuments(db: Database, options: VectorSearchOptions): Promise<SearchRow[]> {
  const limit = options.all ? 1000 : Math.max(1, options.limit ?? 5);
  const minScore = options.minScore ?? 0;
  const collection = options.collection ?? "";

  const queryEmbedding = await embedText(options.query, options.host, options.model);
  const candidates = db
    .query(
      `SELECT d.docid, d.display_path AS displayPath, d.title, d.content, d.embedding
       FROM documents d
       JOIN collections c ON c.id = d.collection_id
       WHERE d.embedding IS NOT NULL
         AND (? = '' OR c.name = ?)
       LIMIT 5000`
    )
    .all(collection, collection) as Array<{
    docid: string;
    displayPath: string;
    title: string;
    content: string;
    embedding: string;
  }>;

  const scored = candidates
    .map((row) => {
      let vec: number[] = [];
      try {
        vec = JSON.parse(row.embedding) as number[];
      } catch {
        vec = [];
      }
      const raw = cosineSimilarity(queryEmbedding, vec);
      const score = (raw + 1) / 2;
      return {
        docid: row.docid,
        displayPath: row.displayPath,
        title: row.title,
        snippet: row.content.slice(0, 180).replace(/\s+/g, " ").trim(),
        score,
      };
    })
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score || a.displayPath.localeCompare(b.displayPath));

  return scored.slice(0, limit);
}

export function fuseRrf(
  keyword: Array<{ key: string; score: number }>,
  vector: Array<{ key: string; score: number }>,
  k = 60
): Array<{ key: string; score: number }> {
  const acc = new Map<string, number>();
  for (let i = 0; i < keyword.length; i += 1) {
    const key = keyword[i]!.key;
    const raw = keyword[i]!.score;
    const prev = acc.get(key) ?? 0;
    acc.set(key, prev + 1 / (k + i + 1) + raw * 1e-3);
  }
  for (let i = 0; i < vector.length; i += 1) {
    const key = vector[i]!.key;
    const raw = vector[i]!.score;
    const prev = acc.get(key) ?? 0;
    acc.set(key, prev + 1 / (k + i + 1) + raw * 1e-3);
  }
  return Array.from(acc.entries())
    .map(([key, score]) => ({ key, score }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

export async function queryDocuments(db: Database, options: VectorSearchOptions): Promise<HybridRow[]> {
  const baseLimit = Math.max(options.limit ?? 5, 30);
  const variations = options.noExpand ? [] : await expandQuery(options.query, options.host, options.expanderModel);
  const queries = [options.query, ...variations].slice(0, 3);

  const keywordMerged = new Map<string, SearchRow>();
  const vectorMerged = new Map<string, SearchRow>();

  for (const q of queries) {
    const kws = searchDocuments(db, { ...options, query: q, limit: baseLimit });
    for (const row of kws) {
      const existing = keywordMerged.get(row.docid);
      if (!existing || row.score > existing.score) keywordMerged.set(row.docid, row);
    }

    const vqs = await vsearchDocuments(db, { ...options, query: q, limit: baseLimit });
    for (const row of vqs) {
      const existing = vectorMerged.get(row.docid);
      if (!existing || row.score > existing.score) vectorMerged.set(row.docid, row);
    }
  }

  const keyword = Array.from(keywordMerged.values()).sort((a, b) => b.score - a.score);
  const vector = Array.from(vectorMerged.values()).sort((a, b) => b.score - a.score);
  const minScore = options.minScore ?? 0;

  const fused = fuseRrf(
    keyword.map((x) => ({ key: x.docid, score: x.score })),
    vector.map((x) => ({ key: x.docid, score: x.score }))
  );

  const keywordMap = new Map(keyword.map((x) => [x.docid, x]));
  const vectorMap = new Map(vector.map((x) => [x.docid, x]));

  const out: HybridRow[] = [];
  for (const row of fused) {
    const krow = keywordMap.get(row.key);
    const vrow = vectorMap.get(row.key);
    const base = krow || vrow;
    if (!base) continue;
    out.push({
      docid: base.docid,
      displayPath: base.displayPath,
      title: base.title,
      snippet: krow?.snippet || vrow?.snippet || "",
      score: row.score,
      keywordScore: krow?.score,
      vectorScore: vrow?.score,
    });
  }

  let filtered = out.filter((row) => row.score >= minScore);

  if (!options.noRerank && filtered.length > 0) {
    const rerank = await rerankDocuments(
      options.query,
      filtered.slice(0, 30).map((r) => ({ docid: r.docid, title: r.title, snippet: r.snippet })),
      options.host,
      options.rerankerModel
    );
    filtered = filtered
      .map((row, idx) => {
        const rr = rerank.get(row.docid);
        if (rr === undefined) return row;
        const retrievalWeight = idx < 3 ? 0.75 : idx < 10 ? 0.6 : 0.4;
        const rerankWeight = 1 - retrievalWeight;
        return { ...row, score: row.score * retrievalWeight + rr * rerankWeight };
      })
      .sort((a, b) => b.score - a.score || a.displayPath.localeCompare(b.displayPath));
  }

  const limit = options.all ? filtered.length : Math.max(1, options.limit ?? 5);
  return filtered.slice(0, limit);
}

export function getDocument(db: Database, ref: string, options?: GetOptions): DocumentRow | null {
  const fromLine = options?.fromLine ?? 1;
  const maxLines = options?.maxLines ?? 0;
  const lineNumbers = options?.lineNumbers ?? false;

  type DbDocument = { docid: string; displayPath: string; title: string; content: string };
  let row: DbDocument | null = null;

  if (ref.startsWith("#")) {
    row = db
      .query(
        `SELECT docid, display_path AS displayPath, title, content
         FROM documents WHERE docid = ? ORDER BY display_path LIMIT 1`
      )
      .get(ref.slice(1)) as DbDocument | null;
  } else {
    row = db
      .query(
        `SELECT docid, display_path AS displayPath, title, content
         FROM documents WHERE display_path = ? LIMIT 1`
      )
      .get(ref) as DbDocument | null;
    if (!row) {
      row = db
        .query(
          `SELECT docid, display_path AS displayPath, title, content
           FROM documents WHERE rel_path = ? ORDER BY display_path LIMIT 1`
        )
        .get(ref) as DbDocument | null;
    }
  }

  if (!row) return null;
  return {
    docid: row.docid,
    displayPath: row.displayPath,
    title: row.title,
    content: withLines(row.content, fromLine, maxLines, lineNumbers),
  };
}

function hasGlobPattern(value: string): boolean {
  return /[*?[\]]/.test(value);
}

export function multiGetDocuments(db: Database, input: string, options?: GetOptions): DocumentRow[] {
  const tokens = input.split(",").map((v) => v.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: DocumentRow[] = [];

  for (const token of tokens) {
    if (token.startsWith("#")) {
      const doc = getDocument(db, token, options);
      if (doc && !seen.has(doc.displayPath)) {
        seen.add(doc.displayPath);
        out.push(doc);
      }
      continue;
    }

    if (hasGlobPattern(token)) {
      const rows = db
        .query(
          `SELECT docid, display_path AS displayPath, title, content
           FROM documents WHERE display_path GLOB ? ORDER BY display_path`
        )
        .all(token) as Array<{ docid: string; displayPath: string; title: string; content: string }>;

      for (const row of rows) {
        if (seen.has(row.displayPath)) continue;
        seen.add(row.displayPath);
        out.push({
          docid: row.docid,
          displayPath: row.displayPath,
          title: row.title,
          content: withLines(row.content, options?.fromLine ?? 1, options?.maxLines ?? 0, options?.lineNumbers ?? false),
        });
      }
      continue;
    }

    const doc = getDocument(db, token, options);
    if (doc && !seen.has(doc.displayPath)) {
      seen.add(doc.displayPath);
      out.push(doc);
    }
  }

  return out.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
}

export function lsCollection(db: Database, target?: string): string[] {
  if (!target) {
    return (db.query("SELECT name, root_path AS rootPath FROM collections ORDER BY name").all() as Array<{ name: string; rootPath: string }>).map(
      (c) => `collection ${c.name} -> ${c.rootPath}`
    );
  }

  const [maybeName, ...rest] = target.split("/");
  const collectionName = maybeName || "";
  const prefix = rest.join("/");

  const collection = db.query("SELECT id FROM collections WHERE name = ?").get(collectionName) as { id: number } | null;
  if (!collection) return [];

  const rows = db
    .query(
      `SELECT display_path AS displayPath
       FROM documents
       WHERE collection_id = ? AND (? = '' OR rel_path LIKE ?)
       ORDER BY rel_path LIMIT 500`
    )
    .all(collection.id, prefix, `${prefix}%`) as Array<{ displayPath: string }>;

  return rows.map((r) => r.displayPath);
}
