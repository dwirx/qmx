# QMX - Query Markup Experience

QMX adalah mesin pencarian lokal untuk dokumen Markdown dengan mode:

- `search` (FTS5/BM25, keyword)
- `vsearch` (semantic, embedding)
- `query` (hybrid + expansion + rerank)

Versi ini sudah ditingkatkan dengan:

- Config `YAML` + validasi `zod`
- Integrasi `sqlite-vec` (akselerasi vector scoring di SQL, fallback aman)
- Server `MCP` bawaan (`qmx mcp`) untuk agent/inspector
- Tampilan `collection list` yang lebih rapi dan informatif

## Requirements

- Bun >= 1.0
- Ollama (untuk `embed`, `vsearch`, `query`)

## Install

Install global langsung dari repo:

```bash
bun install -g https://github.com/dwirx/qmx
```

Atau local development:

```bash
bun install
chmod +x qmx
```

## Quick Start

```bash
# 1) Setup cepat (collection + context + indexing)
./qmx setup \
  --notes ~/notes \
  --meetings ~/Documents/meetings \
  --docs ~/work/docs

# 2) Search
./qmx search "project timeline"
./qmx vsearch "how to deploy"
./qmx query "quarterly planning process"

# 3) Retrieve docs
./qmx get "meetings/2024-01-15.md"
./qmx get "#abc123"
./qmx multi-get "journals/2025-05*.md"
```

## Workflow (QMX Native)

Contoh alur penggunaan full native `qmx`:

```bash
# Create collections for your notes, docs, and meeting transcripts
qmx collection add ~/notes --name notes
qmx collection add ~/Documents/meetings --name meetings
qmx collection add ~/work/docs --name docs

# Add context to help with search results
qmx context add qmx://notes "Personal notes and ideas"
qmx context add qmx://meetings "Meeting transcripts and notes"
qmx context add qmx://docs "Work documentation"

# Generate embeddings for semantic search
qmx embed

# Search across everything
qmx search "project timeline"
qmx vsearch "how to deploy"
qmx query "quarterly planning process"

# Get documents
qmx get "meetings/2024-01-15.md"
qmx get "#abc123"
qmx multi-get "journals/2025-05*.md"

# Search within collection
qmx search "API" -c notes

# Export all matches for an agent
qmx search "API" --all --files --min-score 0.3
```

## Commands

```bash
qmx collection add <path> --name <name> [--mask <glob>]
qmx collection list
qmx collection ls                # alias
qmx collection remove <name>
qmx collection rm <name>         # alias
qmx collection rename <old> <new>

qmx context add <target> <text>
qmx context list
qmx context rm <target>
qmx context remove <target>      # alias

qmx setup [--notes <path>] [--meetings <path>] [--docs <path>] [--mask <glob>] [--no-embed]

qmx update [--no-embed] [--host <url>] [--model <name>]
qmx index [--no-embed] [--host <url>] [--model <name>]     # alias update
qmx embed [--host <url>] [--model <name>] [-f]
qmx vector [--host <url>] [--model <name>] [-f]            # alias embed
qmx search <query> [-n <num>] [-c <collection>] [--json|--files|--csv|--md|--xml] [--all] [--min-score <num>]
qmx vsearch <query> ...
qmx query <query> ...
qmx rerank <query> ...                                      # query + rerank only

qmx get <path|#docid> [-l <lines>] [--from <line>] [--line-numbers]
qmx multi-get <pattern|list|docids> [-l <lines>] [--max-bytes <num>] [--json]

qmx mcp
qmx status
qmx doctor
qmx cleanup
```

## Better Collection View

Output `qmx collection list` sekarang lebih mudah dibaca:

```text
Collections (2):

notes (qmx://notes/)
  Root:    /home/user/notes
  Pattern: **/*.md
  Files:   42
  Updated: 2h ago

meetings (qmx://meetings/)
  Root:    /home/user/Documents/meetings
  Pattern: **/*.md
  Files:   18
  Updated: 1d ago
```

## Configuration (YAML + Zod)

Lokasi config:

- `~/.config/qmx/config.yaml` (atau `XDG_CONFIG_HOME`)

Contoh isi:

```yaml
ollamaHost: http://172.20.32.1:11434
embedModel: nomic-embed-text
expanderModel: hf.co/tobil/qmd-query-expansion-1.7B-gguf:Q4_K_M
rerankerModel: fanyx/Qwen3-Reranker-0.6B-Q8_0:latest
```

Atur via CLI:

```bash
./qmx config set-host http://172.20.32.1:11434
./qmx config set-model nomic-embed-text
./qmx config set-expander hf.co/tobil/qmd-query-expansion-1.7B-gguf:Q4_K_M
./qmx config set-reranker fanyx/Qwen3-Reranker-0.6B-Q8_0:latest
./qmx config get
```

Jika YAML tidak valid, QMX fallback ke config kosong (tidak crash).

## sqlite-vec Integration

`sqlite-vec` dicoba load saat DB dibuka. Jika berhasil, `vsearch` memakai SQL cosine distance (`vec_distance_cosine`) untuk scoring. Jika extension gagal load, QMX otomatis fallback ke jalur JS cosine sehingga fitur tetap jalan.

Cek status:

```bash
./qmx status
./qmx doctor
```

## MCP Server

Jalankan server MCP via stdio:

```bash
./qmx mcp
```

Tools MCP yang tersedia:

- `collections`
- `search` (`keyword|vector|hybrid`)
- `get`
- `multi_get`
- `embed`
- `setup`
- `status`

Inspector script:

```bash
bun run inspector
```

## Output Formats

Untuk `search`, `vsearch`, `query`:

- `--json`
- `--files`
- `--csv`
- `--md`
- `--xml`

Contoh:

```bash
./qmx search "API" --all --files --min-score 0.3
./qmx query "incident response" --json -n 20
```

## NPM/Bun Scripts

```bash
bun run test
bun run typecheck
bun run index
bun run vector
bun run search
bun run vsearch
bun run rerank
bun run mcp
bun run inspector
```

## Data Paths

- DB index: `~/.cache/qmx/index.sqlite`
- Config: `~/.config/qmx/config.yaml`

Dapat dioverride dengan:

- `XDG_CACHE_HOME`
- `XDG_CONFIG_HOME`

## License

MIT
