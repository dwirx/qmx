import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

export type QmxConfig = {
  ollamaHost?: string;
  embedModel?: string;
  expanderModel?: string;
  rerankerModel?: string;
};

const QmxConfigSchema = z
  .object({
    ollamaHost: z.string().trim().min(1).optional(),
    embedModel: z.string().trim().min(1).optional(),
    expanderModel: z.string().trim().min(1).optional(),
    rerankerModel: z.string().trim().min(1).optional(),
  })
  .strip();

function configDir(): string {
  return process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, "qmx") : path.join(homedir(), ".config", "qmx");
}

export function configPath(): string {
  return path.join(configDir(), "config.yaml");
}

function legacyConfigPath(): string {
  return path.join(configDir(), "config.json");
}

export function loadConfig(): QmxConfig {
  const yamlPath = configPath();
  const jsonPath = legacyConfigPath();
  if (!existsSync(yamlPath) && !existsSync(jsonPath)) return {};

  const targetPath = existsSync(yamlPath) ? yamlPath : jsonPath;
  try {
    const raw = readFileSync(targetPath, "utf8");
    const parsed = targetPath.endsWith(".yaml") ? YAML.parse(raw) : JSON.parse(raw);
    const result = QmxConfigSchema.safeParse(parsed ?? {});
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

export function saveConfig(cfg: QmxConfig): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  const parsed = QmxConfigSchema.safeParse(cfg);
  const safeConfig = parsed.success ? parsed.data : {};
  writeFileSync(configPath(), YAML.stringify(safeConfig));
}

export function setConfigValue(
  key: "ollamaHost" | "embedModel" | "expanderModel" | "rerankerModel",
  value: string
): QmxConfig {
  const current = loadConfig();
  const next: QmxConfig = { ...current, [key]: value };
  saveConfig(next);
  return next;
}
