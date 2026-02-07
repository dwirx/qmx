# QMX MCP Server Setup

Manual MCP configuration for use without the qmx plugin.

> **Note**: If using the qmx plugin, MCP configuration is included automatically. This is only needed for manual setup.

## Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "qmx": {
      "command": "qmx",
      "args": ["mcp"]
    }
  }
}
```

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "qmx": {
      "command": "qmx",
      "args": ["mcp"]
    }
  }
}
```

## Available MCP Tools

Once configured, these tools become available:

### search
Fast BM25 keyword search.

**Parameters:**
- `query` (required): Search query string
- `collection` (optional): Restrict to specific collection
- `limit` (optional): Number of results (default: 5)
- `minScore` (optional): Minimum relevance score

### search (mode = vector)
Semantic vector search for conceptual similarity.

**Parameters:**
- `query` (required): Search query string
- `collection` (optional): Restrict to specific collection
- `limit` (optional): Number of results (default: 5)
- `minScore` (optional): Minimum relevance score

### search (mode = hybrid)
Hybrid search combining BM25, vector search, and LLM re-ranking.

**Parameters:**
- `query` (required): Search query string
- `collection` (optional): Restrict to specific collection
- `limit` (optional): Number of results (default: 5)
- `minScore` (optional): Minimum relevance score

### get
Retrieve a document by path or docid.

**Parameters:**
- `ref` (required): Document path or docid (e.g., `#abc123`)
- `lineNumbers` (optional): Include line numbers
- `fromLine` (optional): Start line
- `maxLines` (optional): Max lines

### multi_get
Retrieve multiple documents.

**Parameters:**
- `pattern` (required): Glob pattern or comma-separated list
- `maxBytes` (optional): Skip files larger than this (default: 10KB)

### status
Get index health and collection information.

**Parameters:** None

### embed
Generate/update embeddings.

**Parameters:**
- `force` (optional): Clear old embeddings first

### setup
Bootstrap collections + contexts in one step.

**Parameters:**
- `notes` (optional): Path to notes collection
- `meetings` (optional): Path to meetings collection
- `docs` (optional): Path to docs collection
- `mask` (optional): Glob mask (default `**/*.md`)
- `noEmbed` (optional): Skip embedding step

## Troubleshooting

### MCP server not starting
- Ensure qmx is in your PATH: `which qmx`
- Try running `qmx mcp` manually to see errors
- Check that Bun is installed: `bun --version`

### No results returned
- Verify collections exist: `qmx collection list`
- Check index status: `qmx status`
- Ensure embeddings are generated: `qmx embed`

### Slow searches
- For fastest results, use `search` with mode `keyword`
- The first search may be slow while models load (~3GB)
- Subsequent searches are much faster

## Choosing Between CLI and MCP

| Scenario | Recommendation |
|----------|---------------|
| MCP configured | Use `qmx` MCP tools directly |
| No MCP | Use Bash with `qmx` commands |
| Complex pipelines | Bash may be more flexible |
| Simple lookups | MCP tools are cleaner |
