# QMX Local Search Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Membangun CLI `qmx` yang jauh lebih lengkap dari prototype saat ini: collection management, indexing SQLite FTS5 incremental, search/get/multi-get, context metadata, status/doctor.

**Architecture:** Pisahkan domain ke modul `db`, `indexer`, `search`, dan `cli`; gunakan SQLite sebagai source of truth + FTS5 untuk BM25; indexing per-collection incremental berbasis hash konten. Vector search tetap opsional/planned, tapi fondasi hybrid-ready sudah disiapkan.

**Tech Stack:** Bun + TypeScript + `bun:sqlite` + `bun:test`.

---

### Task 1: Red tests untuk perilaku inti
**Files:**
- Create: `test/qmx.core.test.ts`
- Create: `test/fixtures/notes-a.md`
- Create: `test/fixtures/notes-b.md`

1. Tulis test gagal untuk: init DB, add/list collection, index collection, search BM25, get by docid/path.
2. Jalankan `bun test test/qmx.core.test.ts` dan pastikan fail.

### Task 2: Implement storage + schema
**Files:**
- Create: `src/lib/db.ts`
- Create: `src/lib/types.ts`

1. Implement schema (`collections`, `documents`, `documents_fts`, `path_contexts`) + migrasi idempotent.
2. Implement helper CRUD collection/context.
3. Jalankan test dan pastikan sebagian masih gagal.

### Task 3: Implement indexer + retrieval
**Files:**
- Create: `src/lib/indexer.ts`
- Create: `src/lib/search.ts`
- Modify: `test/qmx.core.test.ts`

1. Implement incremental indexing dari mask glob.
2. Implement search BM25 + snippet + score normalisasi.
3. Implement get by docid/path dan multi-get resolver.
4. Jalankan test hingga hijau.

### Task 4: Implement CLI `qmx`
**Files:**
- Create: `src/qmx.ts`
- Create: `qmx`
- Modify: `package.json`
- Modify: `README.md`

1. Implement command routing: `collection`, `context`, `update`, `search`, `get`, `multi-get`, `ls`, `status`, `doctor`.
2. Tambahkan wrapper shell `qmx` yang memanggil `bun src/qmx.ts`.
3. Update README quickstart & command examples.

### Task 5: Verification gate
**Files:**
- Modify: `AGENTS.md` (opsional bila perlu sinkron command)

1. Jalankan `bun test`.
2. Jalankan smoke test CLI (`status`, `collection add/list`, `update`, `search`).
3. Ringkas hasil verifikasi + batasan (vector/hybrid advanced masih planned).
