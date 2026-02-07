---
name: qmx
description: Search personal markdown knowledge bases, notes, meeting transcripts, and documentation using QMX - a local hybrid search engine. Combines BM25 keyword search, vector semantic search, and LLM re-ranking. Use when users ask to search notes, find documents, look up information in their knowledge base, retrieve meeting notes, or search documentation. Triggers on "search markdown files", "search my notes", "find in docs", "look up", "what did I write about", "meeting notes about".
license: MIT
compatibility: Requires qmx CLI or MCP server. Install via `bun install -g https://github.com/dwirx/qmx`.
metadata:
  author: dwirx
  version: "2.0.0"
allowed-tools: Bash(qmx:*), mcp__qmx__*
---

# QMX - Quick Markdown Search

QMX is a local, on-device search engine for markdown content. It indexes your notes, meeting transcripts, documentation, and knowledge bases for fast retrieval.

## QMX Status

!`qmx status 2>/dev/null || echo "Not installed. Run: bun install -g https://github.com/dwirx/qmx"`

## When to Use This Skill

- User asks to search their notes, documents, or knowledge base
- User needs to find information in their markdown files
- User wants to retrieve specific documents or search across collections
- User asks "what did I write about X" or "find my notes on Y"
- User needs semantic search (conceptual similarity) not just keyword matching
- User mentions meeting notes, transcripts, or documentation lookup

## Search Commands

Choose the right search mode for the task:

| Command | Use When | Speed |
|---------|----------|-------|
| `qmx search` | Exact keyword matches needed | Fast |
| `qmx vsearch` | Keywords aren't working, need conceptual matches | Medium |
| `qmx query` | Best results needed, speed not critical | Slower |

```bash
# Fast keyword search (BM25)
qmx search "your query"

# Semantic vector search (finds conceptually similar content)
qmx vsearch "your query"

# Hybrid search with re-ranking (best quality)
qmx query "your query"
```

## Common Options

```bash
-n <num>                 # Number of results (default: 5)
-c, --collection <name>  # Restrict to specific collection
--all                    # Return all matches
--min-score <num>        # Minimum score threshold (0.0-1.0)
--full                   # Show full document content
--json                   # JSON output for processing
--files                  # List files with scores
--line-numbers           # Add line numbers to output
```

## Document Retrieval

```bash
# Get document by path
qmx get "collection/path/to/doc.md"

# Get document by docid (shown in search results as #abc123)
qmx get "#abc123"

# Get with line numbers for code review
qmx get "docs/api.md" --line-numbers

# Get multiple documents by glob pattern
qmx multi-get "docs/*.md"

# Get multiple documents by list
qmx multi-get "doc1.md, doc2.md, #abc123"
```

## Index Management

```bash
# Check index status and available collections
qmx status

# List all collections
qmx collection list

# List files in a collection
qmx ls <collection-name>

# Update index (re-scan files for changes)
qmx update
```

## Score Interpretation

| Score | Meaning | Action |
|-------|---------|--------|
| 0.8 - 1.0 | Highly relevant | Show to user |
| 0.5 - 0.8 | Moderately relevant | Include if few results |
| 0.2 - 0.5 | Somewhat relevant | Only if user wants more |
| 0.0 - 0.2 | Low relevance | Usually skip |

## Recommended Workflow

1. **Check what's available**: `qmx status`
2. **Start with keyword search**: `qmx search "topic" -n 10`
3. **Try semantic if needed**: `qmx vsearch "describe the concept"`
4. **Use hybrid for best results**: `qmx query "question" --min-score 0.4`
5. **Retrieve full documents**: `qmx get "#docid"`

## Example: Finding Meeting Notes

```bash
# Search for meetings about a topic
qmx search "quarterly review" -c meetings -n 5

# Get semantic matches
qmx vsearch "performance discussion" -c meetings

# Retrieve the full meeting notes
qmx get "#abc123"
```

## Example: Research Across All Notes

```bash
# Hybrid search for best results
qmx query "authentication implementation" --min-score 0.3 --json

# Get all relevant files for deeper analysis
qmx query "auth flow" --all --files --min-score 0.4
```

## MCP Server Integration (QMX)

This plugin configures the qmx MCP server automatically. When available, prefer MCP tools over Bash for tighter integration:

| MCP Tool | Equivalent CLI | Purpose |
|----------|---------------|---------|
| `search` | `qmx search` | Fast BM25 keyword search |
| `get` | `qmx get` | Retrieve document by path or docid |
| `multi_get` | `qmx multi-get` | Retrieve multiple documents |
| `embed` | `qmx embed` | Generate/update embeddings |
| `setup` | `qmx setup` | Bootstrap collections + contexts |
| `status` | `qmx status` | Index health and collection info |

For manual MCP setup without the plugin, see [references/mcp-setup.md](references/mcp-setup.md).
