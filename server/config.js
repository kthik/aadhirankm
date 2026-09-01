import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const CONFIG_PATH = path.join(ROOT, 'config', 'app.config.json');
export const DATA_DIR = path.join(__dirname, 'data');

let cached = null;
let cachedAt = 0;

/** Reads app.config.json, re-reading at most once a second so edits apply without a restart. */
export function config() {
  const now = Date.now();
  if (!cached || now - cachedAt > 1000) {
    cached = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cachedAt = now;
  }
  return cached;
}

export function moduleEnabled(name) {
  return config().modules?.[name] === true;
}

/** Route guard: 404s a whole feature when its module is switched off in config. */
export function requireModule(name) {
  return (req, res, next) =>
    moduleEnabled(name) ? next() : res.status(404).json({ error: `Module "${name}" is disabled` });
}
