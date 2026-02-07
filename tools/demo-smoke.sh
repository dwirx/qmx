#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HOST="${OLLAMA_HOST:-http://172.20.32.1:11434}"
EMBED_MODEL="${QMX_EMBED_MODEL:-embeddinggemma:latest}"
EXPANDER_MODEL="${QMX_EXPANDER_MODEL:-hf.co/tobil/qmd-query-expansion-1.7B-gguf:Q4_K_M}"
RERANKER_MODEL="${QMX_RERANKER_MODEL:-fanyx/Qwen3-Reranker-0.6B-Q8_0:latest}"

export XDG_CACHE_HOME="$ROOT_DIR/.tmp/cache"
export XDG_CONFIG_HOME="$ROOT_DIR/.tmp/config"

mkdir -p "$ROOT_DIR/vault/notes" "$ROOT_DIR/vault/meetings" "$ROOT_DIR/vault/docs"

cat > "$ROOT_DIR/vault/notes/roadmap-q1.md" <<'MD'
# Q1 Roadmap

Fokus Q1:
- stabilisasi pipeline indexing
- kualitas hasil query hybrid
- integrasi agent workflow
MD

cat > "$ROOT_DIR/vault/notes/deployment-checklist.md" <<'MD'
# Deployment Checklist

Checklist deploy production:
- backup index sqlite
- jalankan qmx cleanup
- jalankan qmx update
- verifikasi qmx query "smoke test"
MD

cat > "$ROOT_DIR/vault/meetings/2026-02-07-planning.md" <<'MD'
# Meeting Planning 2026-02-07

Agenda:
- review kualitas search BM25
- evaluasi semantic vector search
- adopsi reranking untuk hasil top 30
MD

cat > "$ROOT_DIR/vault/docs/architecture.md" <<'MD'
# QMX Architecture

QMX menggabungkan FTS5, embedding vector, RRF fusion, dan reranking.
MD

./qmx config set-host "$HOST"
./qmx config set-model "$EMBED_MODEL"
./qmx config set-expander "$EXPANDER_MODEL"
./qmx config set-reranker "$RERANKER_MODEL"

./qmx collection remove demo >/dev/null 2>&1 || true
./qmx collection add vault --name demo --mask "**/*.md"
./qmx embed

./qmx status
./qmx search "deployment checklist" -n 3 --json
./qmx vsearch "how to deploy production safely" -n 3 --json
./qmx query "quarterly planning process" -n 3 --no-rerank --json
./qmx get demo/docs/architecture.md -l 12
./qmx multi-get "demo/notes/*.md" -l 8

echo "Smoke test selesai."
