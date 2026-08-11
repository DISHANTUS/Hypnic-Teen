// Settings that belong to this machine, in one file both launchers read.
//
// They used to live only inside START-ONLINE.cmd as `set NAME=value`, which
// meant the studio behaved differently depending on how it was started. Run it
// with `npm start` and OWNER_ID was empty, so `isOwner` was false for everyone —
// the owner lost the controls that are only theirs, most visibly the button for
// removing a tournament somebody else posted. Nothing was broken and nothing
// said so; the studio simply had no owner that time.
//
// So the settings move to a `.env` beside the project, and every way in loads
// it. START-ONLINE.cmd may still set whatever it likes — a value already in the
// environment always wins, because an explicit `set` is somebody being
// deliberate and this file is only the default.
//
// Imported for its side effect, and imported first, so anything reading
// process.env at module load sees a filled-in environment.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

/**
 * Read a .env-shaped file into process.env without overwriting what is there.
 *
 * Deliberately small: NAME=value, `export` allowed, `#` comments, quotes
 * stripped. No interpolation, no multi-line values — a settings file that needs
 * a parser is a settings file that will be got wrong.
 *
 * @returns {string[]} the names it set, for the launcher to report
 */
export function loadEnv(file = path.join(ROOT, '.env')) {
  if (!existsSync(file)) return [];
  const set = [];
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 1) continue;
    const key = line.slice(0, at).replace(/^export\s+/, '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    // Already set wins. Somebody typing `set OWNER_ID=...` before starting
    // means it, and a file should never quietly override a person.
    if (process.env[key] !== undefined && process.env[key] !== '') continue;
    let value = line.slice(at + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    process.env[key] = value;
    set.push(key);
  }
  return set;
}

export const LOADED = loadEnv();
