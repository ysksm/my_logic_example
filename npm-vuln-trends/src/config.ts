import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Registry, Taxonomy } from './domain/types.ts';

export const ROOT = resolve(import.meta.dir, '..');

export interface AppConfig {
  dbPath: string;
  outDir: string;
  registryPath: string;
  taxonomyPath: string;
  githubToken: string | undefined;
  /** 差分取得の重複窓（時間）。 */
  overlapHours: number;
  userAgent: string;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    dbPath: process.env.NVT_DB ?? resolve(ROOT, 'data/npm-vuln-trends.sqlite'),
    outDir: process.env.NVT_OUT ?? resolve(ROOT, 'dist'),
    registryPath: process.env.NVT_REGISTRY ?? resolve(ROOT, 'config/registry.json'),
    taxonomyPath: process.env.NVT_TAXONOMY ?? resolve(ROOT, 'config/taxonomy.json'),
    githubToken: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
    overlapHours: Number(process.env.NVT_OVERLAP_HOURS ?? 48),
    userAgent: 'npm-vuln-trends/0.1 (+https://github.com/ysksm/my_logic_example)',
    ...overrides,
  };
}

export function loadRegistry(path: string): Registry {
  return JSON.parse(readFileSync(path, 'utf8')) as Registry;
}

export function loadTaxonomy(path: string): Taxonomy {
  return JSON.parse(readFileSync(path, 'utf8')) as Taxonomy;
}

export function hashContent(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(text).digest('hex');
}
