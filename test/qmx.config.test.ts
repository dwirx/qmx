import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, setConfigValue } from "../src/lib/config";
import { resolveOllamaHost } from "../src/lib/ollama";

const originalConfigHome = process.env.XDG_CONFIG_HOME;

let configRoot = "";

afterEach(() => {
  if (configRoot) rmSync(configRoot, { recursive: true, force: true });
  configRoot = "";
  if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalConfigHome;
});

describe("config host resolution", () => {
  test("persists host and model in config", () => {
    configRoot = mkdtempSync(path.join(tmpdir(), "qmx-cfg-"));
    process.env.XDG_CONFIG_HOME = configRoot;

    setConfigValue("ollamaHost", "http://172.20.32.1:11434");
    setConfigValue("embedModel", "nomic-embed-text");
    setConfigValue("expanderModel", "hf.co/tobil/qmd-query-expansion-1.7B-gguf:Q4_K_M");
    setConfigValue("rerankerModel", "fanyx/Qwen3-Reranker-0.6B-Q8_0:latest");

    const cfg = loadConfig();
    expect(cfg.ollamaHost).toBe("http://172.20.32.1:11434");
    expect(cfg.embedModel).toBe("nomic-embed-text");
    expect(cfg.expanderModel).toBe("hf.co/tobil/qmd-query-expansion-1.7B-gguf:Q4_K_M");
    expect(cfg.rerankerModel).toBe("fanyx/Qwen3-Reranker-0.6B-Q8_0:latest");
  });

  test("normalizes host with missing scheme", () => {
    const host = resolveOllamaHost("172.20.32.1:11434");
    expect(host).toBe("http://172.20.32.1:11434");
  });
});
