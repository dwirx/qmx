import { describe, expect, test } from "bun:test";
import { buildEmbedIntro, chunkByTokenCount } from "../src/lib/chunking";

describe("embed progress", () => {
  test("chunks long text with overlap", () => {
    const text = Array.from({ length: 520 }, (_, i) => `t${i}`).join(" ");
    const chunks = chunkByTokenCount(text, 200, 40);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]?.length).toBeGreaterThan(0);
  });

  test("formats intro summary", () => {
    const out = buildEmbedIntro({ documents: 30, chunks: 139, bytes: 353_100, splitDocuments: 15, model: "embeddinggemma" });
    expect(out[0]).toContain("Chunking 30 documents by token count");
    expect(out[1]).toContain("Embedding 30 documents (139 chunks, 344.8 KB)");
    expect(out[2]).toContain("15 documents split into multiple chunks");
    expect(out[3]).toContain("Model: embeddinggemma");
  });
});
