// Tiny JSON-file store. No database to install - it just works on your laptop
// and on any host with a disk. Writes are atomic (tmp file + rename) and
// debounced so a busy match never thrashes the disk.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(import.meta.dirname, '..', 'data');
const SAVE_DEBOUNCE_MS = 400;

export class JsonStore {
  /**
   * @param {string} filename
   * @param {object} initial value used when the file does not exist yet
   */
  constructor(filename, initial = {}) {
    mkdirSync(DATA_DIR, { recursive: true });
    this.file = path.join(DATA_DIR, filename);
    this.timer = null;
    this.data = initial;

    if (existsSync(this.file)) {
      try {
        this.data = JSON.parse(readFileSync(this.file, 'utf8'));
      } catch (err) {
        // Never lose data to a parse error - park the bad file and start fresh.
        const backup = `${this.file}.corrupt-${Date.now()}`;
        renameSync(this.file, backup);
        console.error(`[store] ${filename} was unreadable, moved to ${path.basename(backup)}`);
      }
    }
  }

  /** Queue a debounced save. */
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
    this.timer.unref?.();
  }

  /**
   * Write it out now, for the changes that must not be lost.
   *
   * The debounce plus the shutdown hook is enough on a machine where a process
   * gets asked to stop. On Windows a forced stop is TerminateProcess, which
   * cannot be caught by anything — so the hook never runs and up to four
   * hundred milliseconds of writes go with it. That is invisible for a score
   * that will be rewritten in a minute, and very visible for a tournament
   * somebody just posted, which simply is not there when the studio comes back.
   */
  saveNow() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  flush() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }
}

// Make sure nothing in flight is lost on Ctrl+C.
const stores = new Set();
export function registerStore(store) {
  stores.add(store);
  return store;
}
for (const signal of ['SIGINT', 'SIGTERM', 'beforeExit']) {
  process.on(signal, () => {
    for (const s of stores) {
      if (s.timer) clearTimeout(s.timer);
      try {
        s.flush();
      } catch {}
    }
    if (signal !== 'beforeExit') process.exit(0);
  });
}
