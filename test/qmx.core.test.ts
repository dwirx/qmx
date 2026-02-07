import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  openQmxDb,
  addCollection,
  listCollections,
  runIndexUpdate,
  searchDocuments,
  getDocument,
} from "../src/lib/api";

let workspace = "";

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "qmx-test-"));
  cpSync(path.resolve("test/fixtures"), path.join(workspace, "vault"), { recursive: true });
});

afterEach(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

describe("qmx core", () => {
  test("creates collection, indexes files, and supports keyword search", async () => {
    const dbPath = path.join(workspace, "index.sqlite");
    const db = openQmxDb(dbPath);

    addCollection(db, {
      name: "notes",
      rootPath: path.join(workspace, "vault"),
      mask: "**/*.md",
    });

    const collections = listCollections(db);
    expect(collections.length).toBe(1);
    expect(collections[0]?.name).toBe("notes");

    const changed = await runIndexUpdate(db, { embed: false });
    expect(changed.added + changed.updated).toBe(2);

    const results = searchDocuments(db, {
      query: "incremental indexing",
      limit: 5,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.displayPath).toContain("notes/");
  });

  test("gets document by path and docid", async () => {
    const dbPath = path.join(workspace, "index.sqlite");
    const db = openQmxDb(dbPath);

    addCollection(db, {
      name: "notes",
      rootPath: path.join(workspace, "vault"),
      mask: "**/*.md",
    });

    await runIndexUpdate(db, { embed: false });
    const results = searchDocuments(db, { query: "keyword search", limit: 5 });
    expect(results.length).toBeGreaterThan(0);

    const first = results[0]!;
    const byPath = getDocument(db, first.displayPath);
    expect(byPath).not.toBeNull();

    const byDocId = getDocument(db, `#${first.docid}`);
    expect(byDocId).not.toBeNull();
    expect(byDocId?.docid).toBe(first.docid);
  });

  test("can stop indexing safely and continue later", async () => {
    const dbPath = path.join(workspace, "index.sqlite");
    const db = openQmxDb(dbPath);

    addCollection(db, {
      name: "notes",
      rootPath: path.join(workspace, "vault"),
      mask: "**/*.md",
    });

    let checks = 0;
    const firstRun = await runIndexUpdate(db, {
      embed: false,
      shouldStop: () => {
        checks += 1;
        return checks > 2;
      },
    });

    expect(firstRun.cancelled).toBe(true);
    expect(firstRun.scanned).toBeGreaterThan(0);
    expect(firstRun.scanned).toBeLessThan(2);

    const secondRun = await runIndexUpdate(db, { embed: false });
    expect(secondRun.cancelled).toBe(false);

    const results = searchDocuments(db, { query: "Bun Search Notes", limit: 10 });
    expect(results.length).toBeGreaterThan(0);
  });
});
