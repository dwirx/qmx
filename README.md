# QMX - Query Markup Experience

QMX adalah search engine lokal untuk koleksi Markdown (notes, docs, meeting transcript) dengan 3 mode pencarian:

- `search`: BM25 / FTS5 (keyword exact)
- `vsearch`: semantic search (embedding via Ollama)
- `query`: hybrid (BM25 + vector + query expansion + reranking)

QMX berjalan lokal dengan Bun + SQLite dan cocok untuk workflow agentic / RAG.

## Features

- Collection management: `collection add/list/remove/rename`
- Context metadata: `context add/list/rm`
- Index + embedding pipeline: `update`, `embed`
- Retrieval: `get`, `multi-get`, `ls`
- Output formats: `--json`, `--files`, `--csv`, `--md`, `--xml`
- Config persisten host/model Ollama
- Interactive embed progress (chunking summary + progress per dokumen)

## Requirements

- Bun >= 1.0
- Ollama running (default host: `http://172.20.32.1:11434`)

## Installation

```bash
bun install
chmod +x qmx
```

## Quick Start

```bash
# 1) Set host + models (sekali saja)
./qmx config set-host http://172.20.32.1:11434
./qmx config set-model embeddinggemma:latest
./qmx config set-expander hf.co/tobil/qmd-query-expansion-1.7B-gguf:Q4_K_M
./qmx config set-reranker fanyx/Qwen3-Reranker-0.6B-Q8_0:latest

# 2) Tambah collection
./qmx collection add /path/ke/vault --name myvault --mask "**/*.md"

# 3) Build index + embedding
./qmx embed

# 4) Search
./qmx search "deployment checklist" -n 5
./qmx vsearch "how to deploy safely" -n 5
./qmx query "quarterly planning process" -n 8
```

## Configuration

Lihat config aktif:

```bash
./qmx config get
```

Set config:

```bash
./qmx config set-host <url>
./qmx config set-model <embedding-model>
./qmx config set-expander <query-expansion-model>
./qmx config set-reranker <reranker-model>
```

Prioritas resolusi config:

1. CLI flags (`--host`, `--model`, `--expander-model`, `--reranker-model`)
2. Environment variable (`OLLAMA_HOST`)
3. File config (`~/.config/qmx/config.json`)
4. Default internal

## Detailed Usage

### 1) Collection Management

```bash
./qmx collection add . --name project --mask "**/*.md"
./qmx collection list
./qmx collection rename project project-notes
./qmx collection remove project-notes
```

### 2) Context Management

```bash
./qmx context add qmx://project "Engineering notes and runbooks"
./qmx context list
./qmx context rm qmx://project
```

### 3) Indexing & Embedding

```bash
# update index + embedding (default)
./qmx update

# update index tanpa embedding
./qmx update --no-embed

# embed ulang semua dokumen
./qmx embed -f
```

Contoh output interaktif embed:

```text
Chunking 30 documents by token count...
Embedding 30 documents (139 chunks, 353.1 KB)
15 documents split into multiple chunks
Model: embeddinggemma:latest
[1/30] embedded notes/a.md (3 chunks)
...
Embed selesai | scanned=30 added=0 updated=30 removed=0 embedded_docs=30 embedded_chunks=139
```

### 4) Search Modes

#### Keyword Search (FTS5)

```bash
./qmx search "API design" -n 10
./qmx search "error handling" -c project --min-score 0.2 --json
```

#### Vector Search (Semantic)

```bash
./qmx vsearch "how to rollback deployment" -n 10
./qmx vsearch "release checklist" --files
```

#### Hybrid Query

```bash
./qmx query "quarterly planning process" -n 10
./qmx query "auth migration" --json --min-score 0.1

# optional control
./qmx query "auth migration" --no-expand
./qmx query "auth migration" --no-rerank
```

### 5) Retrieve Documents

```bash
# by path
./qmx get project/docs/architecture.md

# by docid
./qmx get "#abc123"

# with line controls
./qmx get project/docs/architecture.md:40 -l 80 --line-numbers

# multi-get glob/list/docid
./qmx multi-get "project/notes/*.md" -l 30
./qmx multi-get "project/a.md,project/b.md,#abc123" --json
```

### 6) Output Formats

Dipakai pada `search`, `vsearch`, `query`:

- `--json`
- `--files`
- `--csv`
- `--md`
- `--xml`

Contoh:

```bash
./qmx query "incident response" --json -n 20
./qmx search "runbook" --csv
./qmx vsearch "deployment" --md
```

### 7) Maintenance

```bash
./qmx status
./qmx doctor
./qmx cleanup
```

## Data Locations

- Index DB: `~/.cache/qmx/index.sqlite`
- Config: `~/.config/qmx/config.json`

Dapat diubah via:

- `XDG_CACHE_HOME`
- `XDG_CONFIG_HOME`

## Common Workflow

```bash
# cek status
./qmx status

# update index+embedding
./qmx update

# cari data
./qmx query "release plan" -n 8 --json

# ambil dokumen relevan
./qmx multi-get "project/notes/*.md" -l 40
```

## Troubleshooting

### Ollama tidak bisa diakses

- pastikan host benar: `./qmx config get`
- cek model tersedia: `OLLAMA_HOST=<host> ollama list`
- override sekali jalan: `./qmx query "..." --host http://ip:11434`

### Hasil semantic kosong

- jalankan `./qmx embed -f`
- cek model embedding aktif di `qmx config get`

### Query lambat

- pakai `--no-rerank`
- kurangi `-n`
- update model lebih ringan

## License

MIT
