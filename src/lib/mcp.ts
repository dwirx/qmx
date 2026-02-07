import type { Database } from "bun:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { addCollection, addContext, listCollectionSummaries } from "./collections";
import { runIndexUpdate } from "./indexer";
import { clearEmbeddings, sqliteVecState, statusInfo } from "./db";
import { multiGetDocuments } from "./search";
import { getDocument, queryDocuments, searchDocuments, vsearchDocuments } from "./search";

type RunMcpServerOptions = {
  db: Database;
  host: string;
  model: string;
};

function rowsToText(rows: Array<{ docid: string; displayPath: string; title: string; snippet: string; score: number }>): string {
  if (rows.length === 0) return "No results.";
  return rows
    .map((row) => `${row.displayPath} #${row.docid} score=${row.score.toFixed(3)}\n  ${row.title}\n  ${row.snippet}`)
    .join("\n");
}

export async function runMcpServer(options: RunMcpServerOptions): Promise<void> {
  const server = new McpServer({
    name: "qmx-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "collections",
    {
      description: "List indexed collections with root path, file count, and update info.",
    },
    async () => {
      const rows = listCollectionSummaries(options.db);
      const text = rows.length
        ? rows
            .map((row) => `${row.name} (qmx://${row.name}/)\nroot=${row.rootPath}\npattern=${row.mask}\nfiles=${row.fileCount}`)
            .join("\n\n")
        : "No collections.";

      return {
        content: [{ type: "text", text }],
        structuredContent: { collections: rows },
      };
    }
  );

  server.registerTool(
    "multi_get",
    {
      description: "Get multiple documents by pattern/list/docids.",
      inputSchema: {
        pattern: z.string().min(1),
        maxLines: z.number().int().nonnegative().default(0),
        maxBytes: z.number().int().positive().default(10_240),
        lineNumbers: z.boolean().default(false),
      },
    },
    async ({ pattern, maxLines, maxBytes, lineNumbers }) => {
      const docs = multiGetDocuments(options.db, pattern, {
        fromLine: 1,
        maxLines,
        lineNumbers,
      }).filter((d) => Buffer.byteLength(d.content, "utf8") <= maxBytes);

      return {
        content: [{ type: "text", text: docs.length ? docs.map((d) => `${d.displayPath} #${d.docid}`).join("\n") : "No matching documents." }],
        structuredContent: { documents: docs },
      };
    }
  );

  server.registerTool(
    "embed",
    {
      description: "Run embedding update for indexed documents.",
      inputSchema: {
        force: z.boolean().default(false),
      },
    },
    async ({ force }) => {
      if (force) clearEmbeddings(options.db);
      const stats = await runIndexUpdate(options.db, {
        embed: true,
        host: options.host,
        model: options.model,
      });
      return {
        content: [
          {
            type: "text",
            text: `Embed done scanned=${stats.scanned} added=${stats.added} updated=${stats.updated} removed=${stats.removed} embedded_docs=${stats.embeddedDocs}`,
          },
        ],
        structuredContent: { stats },
      };
    }
  );

  server.registerTool(
    "setup",
    {
      description: "Bootstrap collections + contexts, then index or embed.",
      inputSchema: {
        notes: z.string().optional(),
        meetings: z.string().optional(),
        docs: z.string().optional(),
        mask: z.string().default("**/*.md"),
        noEmbed: z.boolean().default(false),
      },
    },
    async ({ notes, meetings, docs, mask, noEmbed }) => {
      const entries = [
        { name: "notes", rootPath: notes, context: "Personal notes and ideas" },
        { name: "meetings", rootPath: meetings, context: "Meeting transcripts and notes" },
        { name: "docs", rootPath: docs, context: "Work documentation" },
      ].filter((entry) => entry.rootPath);

      if (entries.length === 0) {
        return {
          isError: true,
          content: [{ type: "text", text: "At least one path is required: notes, meetings, or docs." }],
        };
      }

      for (const entry of entries) {
        addCollection(options.db, { name: entry.name, rootPath: entry.rootPath!, mask });
        addContext(options.db, { target: `qmx://${entry.name}`, value: entry.context });
      }

      const stats = await runIndexUpdate(options.db, {
        embed: !noEmbed,
        host: options.host,
        model: options.model,
      });

      return {
        content: [{ type: "text", text: `Setup complete collections=${entries.length} scanned=${stats.scanned}` }],
        structuredContent: { entries: entries.map((e) => ({ name: e.name, rootPath: e.rootPath })), stats },
      };
    }
  );

  server.registerTool(
    "search",
    {
      description: "Search documents using keyword, vector, or hybrid mode.",
      inputSchema: {
        query: z.string().min(1),
        mode: z.enum(["keyword", "vector", "hybrid"]).default("hybrid"),
        limit: z.number().int().positive().max(100).default(5),
        collection: z.string().optional(),
        minScore: z.number().min(0).max(1).default(0),
      },
    },
    async ({ query, mode, limit, collection, minScore }) => {
      const base = { query, limit, collection, minScore };
      const rows =
        mode === "keyword"
          ? searchDocuments(options.db, base)
          : mode === "vector"
            ? await vsearchDocuments(options.db, { ...base, host: options.host, model: options.model })
            : await queryDocuments(options.db, { ...base, host: options.host, model: options.model });

      return {
        content: [{ type: "text", text: rowsToText(rows) }],
        structuredContent: { mode, results: rows },
      };
    }
  );

  server.registerTool(
    "get",
    {
      description: "Get a document by path or #docid.",
      inputSchema: {
        ref: z.string().min(1),
        fromLine: z.number().int().positive().default(1),
        maxLines: z.number().int().nonnegative().default(0),
        lineNumbers: z.boolean().default(false),
      },
    },
    async ({ ref, fromLine, maxLines, lineNumbers }) => {
      const doc = getDocument(options.db, ref, { fromLine, maxLines, lineNumbers });
      if (!doc) {
        return {
          isError: true,
          content: [{ type: "text", text: `Document not found: ${ref}` }],
        };
      }

      return {
        content: [{ type: "text", text: `--- ${doc.displayPath} #${doc.docid} ---\n${doc.content}` }],
        structuredContent: { document: doc },
      };
    }
  );

  server.registerTool(
    "status",
    {
      description: "Get index and runtime status.",
    },
    async () => {
      const status = statusInfo(options.db);
      const vec = sqliteVecState(options.db);
      return {
        content: [
          {
            type: "text",
            text: `collections=${status.collections} documents=${status.documents} embedded=${status.embedded} sqlite-vec=${vec.enabled ? "enabled" : "disabled"}`,
          },
        ],
        structuredContent: { ...status, sqliteVec: vec },
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
