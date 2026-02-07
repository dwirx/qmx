import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type QmxConfig = {
  ollamaHost?: string;
  embedModel?: string;
  expanderModel?: string;
  rerankerModel?: string;
};

function configDir(): string {
  return process.env.XDG_CONFIG_HOME ? path.join(process.env.XDG_CONFIG_HOME, "qmx") : path.join(homedir(), ".config", "qmx");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function loadConfig(): QmxConfig {
  const cfgPath = configPath();
  if (!existsSync(cfgPath)) return {};
  try {
    const raw = readFileSync(cfgPath, "utf8");
    const parsed = JSON.parse(raw) as QmxConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveConfig(cfg: QmxConfig): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
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
