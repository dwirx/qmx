# Repository Guidelines

## Project Structure & Module Organization
- `src/qmd.ts`: main CLI prototype (`qmd`) with command parsing and handlers.
- `index.ts`: minimal Bun entrypoint example.
- `README.md`: quick-start for install/run.
- `ide.md`: product/command notes and feature status (`Available` vs `Planned`).
- `tsconfig.json`: strict TypeScript settings (no emit; bundler resolution).
- No dedicated `test/` directory yet; add tests as `*.test.ts` near related source files or under a future `tests/` folder.

## Build, Test, and Development Commands
- `bun install`: install dependencies.
- `bun run index.ts`: run the starter entrypoint.
- `bun src/qmd.ts status`: run the CLI prototype directly.
- `bun src/qmd.ts search "query" -n 5`: quick functional check for search flow.
- `bun test`: run tests using Bun’s test runner.
- `bunx tsc --noEmit`: type-check against `tsconfig.json`.

## Coding Style & Naming Conventions
- Language: TypeScript (ES modules) on Bun.
- Indentation: 2 spaces; keep functions focused and side effects explicit.
- Naming: `camelCase` for variables/functions, `PascalCase` for types, kebab-case for docs/scripts where applicable.
- Prefer Bun/native APIs when feasible; keep CLI output human-readable and consistent.
- Keep planned features clearly marked and return explicit non-zero exit codes for unsupported paths.

## Testing Guidelines
- Framework: `bun:test` (`import { test, expect } from "bun:test"`).
- Test files: `*.test.ts` (example: `src/qmd.search.test.ts`).
- Focus on command behavior, argument parsing, exit codes, and output shape.
- Before opening a PR, run at minimum: `bun test` and `bunx tsc --noEmit`.

## Commit & Pull Request Guidelines
- This directory is not currently a Git root, so local commit history conventions are not directly inspectable here.
- Use Conventional Commit style: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`.
- Keep commits atomic and scoped to one change.
- PRs should include: purpose, behavior changes, verification commands run, and representative CLI examples/output when UX changes.
