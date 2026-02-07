import { Database } from "bun:sqlite";
import path from "node:path";
import type { CollectionInput, CollectionRow, ContextInput } from "./types";

function expandHomePath(inputPath: string): string {
  if (!inputPath.startsWith("~")) return inputPath;
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) return inputPath;
  if (inputPath === "~") return home;
  if (inputPath.startsWith("~/")) return path.join(home, inputPath.slice(2));
  return inputPath;
}

export function addCollection(db: Database, input: CollectionInput): void {
  const mask = input.mask?.trim() || "**/*.md";
  const rootPath = path.resolve(expandHomePath(input.rootPath));
  db.query(
    `INSERT INTO collections(name, root_path, mask) VALUES(?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET root_path = excluded.root_path, mask = excluded.mask`
  ).run(input.name.trim(), rootPath, mask);
}

export function removeCollection(db: Database, name: string): void {
  db.query("DELETE FROM collections WHERE name = ?").run(name);
}

export function renameCollection(db: Database, oldName: string, newName: string): void {
  db.query("UPDATE collections SET name = ? WHERE name = ?").run(newName, oldName);
  db.query(
    `UPDATE documents
     SET display_path = (
       SELECT collections.name || '/' || documents.rel_path
       FROM collections
       WHERE collections.id = documents.collection_id
     )`
  ).run();
}

export function listCollections(db: Database): CollectionRow[] {
  return db
    .query(
      `SELECT id, name, root_path AS rootPath, mask
       FROM collections
       ORDER BY name`
    )
    .all() as CollectionRow[];
}

export function listCollectionSummaries(
  db: Database
): Array<{ name: string; rootPath: string; mask: string; fileCount: number; updatedAt: string | null }> {
  return db
    .query(
      `SELECT c.name,
              c.root_path AS rootPath,
              c.mask,
              COUNT(d.id) AS fileCount,
              MAX(d.updated_at) AS updatedAt
       FROM collections c
       LEFT JOIN documents d ON d.collection_id = c.id
       GROUP BY c.id, c.name, c.root_path, c.mask
       ORDER BY c.name`
    )
    .all() as Array<{ name: string; rootPath: string; mask: string; fileCount: number; updatedAt: string | null }>;
}

export function addContext(db: Database, input: ContextInput): void {
  db.query(
    `INSERT INTO path_contexts(target, value) VALUES(?, ?)
     ON CONFLICT(target) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(input.target.trim(), input.value.trim());
}

export function removeContext(db: Database, target: string): void {
  db.query("DELETE FROM path_contexts WHERE target = ?").run(target);
}

export function listContexts(db: Database): Array<{ target: string; value: string }> {
  return db.query("SELECT target, value FROM path_contexts ORDER BY target").all() as Array<{ target: string; value: string }>;
}
