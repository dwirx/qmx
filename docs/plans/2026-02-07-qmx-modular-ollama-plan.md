# QMX Modular Ollama Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor `qmx` jadi modular dan menambahkan `vsearch` + `query` berbasis Ollama (`OLLAMA_HOST`) dengan fallback aman.

**Architecture:** Pisahkan domain menjadi modul `db`, `collections`, `indexer`, `ollama`, `search`, `cli`. Simpan embedding di SQLite (`documents.embedding`) sehingga `vsearch` dan `query` bisa dijalankan tanpa sqlite-vec extension. `query` menggabungkan FTS + vector pakai RRF.

**Tech Stack:** Bun, TypeScript, bun:sqlite, bun:test, fetch (Ollama HTTP API).

---

### Task 1: TDD test untuk hybrid fusion
**Files:**
- Create: `test/qmx.hybrid.test.ts`
- Modify: `src/lib/search.ts` (target API)

1. Tulis test gagal untuk fungsi RRF fusion ranking.
2. Jalankan `bun test test/qmx.hybrid.test.ts` dan pastikan gagal.

### Task 2: Modularisasi library
**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/db.ts`
- Create: `src/lib/utils.ts`
- Create: `src/lib/collections.ts`
- Create: `src/lib/ollama.ts`
- Create: `src/lib/indexer.ts`
- Create: `src/lib/search.ts`
- Modify: `src/lib/api.ts` (jadi facade kecil)

1. Pindahkan logic dari file besar ke modul kecil.
2. Tambah kolom embedding dan migrasi idempotent.
3. Pastikan API lama tetap kompatibel untuk test existing.

### Task 3: Tambah vsearch/query/cleanup di CLI
**Files:**
- Modify: `src/qmx.ts`
- Modify: `README.md`

1. Tambah command `vsearch`, `query`, `cleanup`.
2. Gunakan default `OLLAMA_HOST=http://172.20.32.1:11434` jika env tidak di-set.
3. Tambah opsi `--model` untuk model embedding.

### Task 4: Verification
**Files:**
- Modify: `test/qmx.core.test.ts` (jika perlu)

1. Jalankan `bun test`.
2. Jalankan `bunx tsc --noEmit`.
3. Jalankan smoke test command utama.
