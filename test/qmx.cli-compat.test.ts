import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

let workspace = "";

function runCli(args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync(["bun", "src/qmx.ts", "--index", "compat", ...args], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      XDG_CACHE_HOME: path.join(workspace, "cache"),
      XDG_CONFIG_HOME: path.join(workspace, "config"),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    stdout: Buffer.from(proc.stdout).toString("utf8"),
    stderr: Buffer.from(proc.stderr).toString("utf8"),
    exitCode: proc.exitCode,
  };
}

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "qmx-cli-"));
  cpSync(path.resolve("test/fixtures"), path.join(workspace, "vault"), { recursive: true });
});

afterEach(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

describe("qmx cli compatibility", () => {
  test("expands home path when adding collection with ~", () => {
    const fakeHome = path.join(workspace, "home");
    const notesPath = path.join(fakeHome, "notes");
    cpSync(path.join(workspace, "vault"), notesPath, { recursive: true });

    let result = runCli(["collection", "add", "~/notes", "--name", "notes"], { HOME: fakeHome });
    expect(result.exitCode).toBe(0);

    result = runCli(["collection", "list"], { HOME: fakeHome });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(path.resolve(notesPath));
  });

  test("supports setup command for one-shot bootstrap", () => {
    const notes = path.join(workspace, "notes");
    const meetings = path.join(workspace, "meetings");
    cpSync(path.join(workspace, "vault"), notes, { recursive: true });
    cpSync(path.join(workspace, "vault"), meetings, { recursive: true });

    let result = runCli(["setup", "--notes", notes, "--meetings", meetings, "--no-embed"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Setup selesai");

    result = runCli(["collection", "list"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("notes");
    expect(result.stdout).toContain("meetings");

    result = runCli(["context", "list"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("qmx://notes");
    expect(result.stdout).toContain("qmx://meetings");
  });

  test(
    "supports qmd-like collection/context aliases",
    () => {
      const collectionPath = path.join(workspace, "vault");

      let result = runCli(["collection", "add", collectionPath, "--name", "notes"]);
      expect(result.exitCode).toBe(0);

      result = runCli(["collection", "ls"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Collections:");
      expect(result.stdout).toContain("Collections (1):");
      expect(result.stdout).toContain("qmx://notes/");
      expect(result.stdout).toContain("qmx://notes/");
      expect(result.stdout).toContain("Pattern:");
      expect(result.stdout).toContain("Files:");
      expect(result.stdout).toContain("Updated:");
      expect(result.stdout).toContain("Summary:");

      result = runCli(["collection", "ls", "--compact", "--plain", "--no-summary"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("notes | pattern=");

      result = runCli(["context", "add", "qmd://notes", "Personal notes and ideas"]);
      expect(result.exitCode).toBe(0);

      result = runCli(["context", "remove", "qmd://notes"]);
      expect(result.exitCode).toBe(0);

      result = runCli(["collection", "rm", "notes"]);
      expect(result.exitCode).toBe(0);
    },
    20000
  );

  test("supports qmd-like retrieval/search flow", () => {
    const collectionPath = path.join(workspace, "vault");

    let result = runCli(["collection", "add", collectionPath, "--name", "notes"]);
    expect(result.exitCode).toBe(0);

    result = runCli(["update", "--no-embed"]);
    expect(result.exitCode).toBe(0);

    result = runCli(["search", "Incremental", "-c", "notes", "--files", "--all", "--min-score", "0.1"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("notes/");

    result = runCli(["get", "notes/notes-a.md"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Bun Search Notes");

    result = runCli(["multi-get", "notes/*.md"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("notes/notes-a.md");
    expect(result.stdout).toContain("notes/notes-b.md");
  });

  test("highlights search query in yellow when color is enabled", () => {
    const collectionPath = path.join(workspace, "vault");

    let result = runCli(["collection", "add", collectionPath, "--name", "notes"]);
    expect(result.exitCode).toBe(0);

    result = runCli(["update", "--no-embed"]);
    expect(result.exitCode).toBe(0);

    result = runCli(["search", "Bun"], { FORCE_COLOR: "1" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("\u001b[33mBun\u001b[0m");
  });

  test(
    "supports native index/vector/rerank commands",
    () => {
    const collectionPath = path.join(workspace, "vault");

    let result = runCli(["collection", "add", collectionPath, "--name", "notes"]);
    expect(result.exitCode).toBe(0);

    result = runCli(["index", "--no-embed"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Index updated");

    result = runCli(["vector"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Embed selesai");

    result = runCli(["rerank"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: qmx rerank <query>");
    },
    20000
  );

  test("publishes only qmx binary", () => {
    const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      bin?: Record<string, string>;
    };

    expect(pkg.bin?.qmx).toBe("qmx");
    expect(pkg.bin?.qmd).toBeUndefined();
  });

  test("includes requested dependencies and scripts", () => {
    const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(pkg.dependencies?.["sqlite-vec"]).toBe("^0.1.7-alpha.2");
    expect(pkg.dependencies?.yaml).toBe("^2.8.2");
    expect(pkg.dependencies?.zod).toBe("^4.2.1");
    expect(pkg.dependencies?.["@modelcontextprotocol/sdk"]).toBe("^1.25.1");

    expect(pkg.optionalDependencies?.["sqlite-vec-darwin-arm64"]).toBe("^0.1.7-alpha.2");
    expect(pkg.optionalDependencies?.["sqlite-vec-darwin-x64"]).toBe("^0.1.7-alpha.2");
    expect(pkg.optionalDependencies?.["sqlite-vec-linux-x64"]).toBe("^0.1.7-alpha.2");
    expect(pkg.optionalDependencies?.["sqlite-vec-linux-arm64"]).toBe("^0.1.7-alpha.2");
    expect(pkg.optionalDependencies?.["sqlite-vec-windows-x64"]).toBe("^0.1.7-alpha.2");

    expect(pkg.scripts?.index).toBe("bun src/qmx.ts index");
    expect(pkg.scripts?.vector).toBe("bun src/qmx.ts vector");
    expect(pkg.scripts?.search).toBe("bun src/qmx.ts search");
    expect(pkg.scripts?.vsearch).toBe("bun src/qmx.ts vsearch");
    expect(pkg.scripts?.rerank).toBe("bun src/qmx.ts rerank");
    expect(pkg.scripts?.link).toBe("bun link");
    expect(pkg.scripts?.mcp).toBe("bun src/qmx.ts mcp");
    expect(pkg.scripts?.inspector).toBe("npx @modelcontextprotocol/inspector bun src/qmx.ts mcp");
  });
});
