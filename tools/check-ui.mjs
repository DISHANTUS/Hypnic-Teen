// Static wiring check for the single-page shell.
//
// The smoke test drives the server; nothing drives the DOM. This catches the
// class of bug that costs the most time there: a renderer reaching for an id
// that no template defines (or the other way round), and stylesheet/script
// references that don't exist on disk.
//
//   node tools/check-ui.mjs

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const html = readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
// Every browser module, wherever it lives — game clients set custom properties
// and inject markup too, so leaving them out produces phantom failures.
const scripts = [
  'js/site.js',
  'js/auth.js',
  'js/net.js',
  'js/theme.js',
  'js/engine.js',
  'js/sound.js',
  'js/fx.js',
  'games/_party/client.js',
  'games/orb-rush/client.js',
].map((rel) => ({
  name: rel,
  src: readFileSync(path.join(ROOT, 'public', rel), 'utf8'),
}));

const problems = [];
const note = (msg) => problems.push(msg);

/* ---- every id the HTML defines (templates included), plus the ones the JS
       injects itself through innerHTML ---- */
const definedIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
for (const { src } of scripts) {
  for (const m of src.matchAll(/\bid="([^"]+)"/g)) definedIds.add(m[1]);
}

/* ---- every id the JS looks up ---- */
const wanted = new Map(); // id -> file
for (const { name, src } of scripts) {
  const hits = [
    ...src.matchAll(/getElementById\(\s*'([^']+)'/g),
    ...src.matchAll(/\$\(\s*'#([A-Za-z][\w-]*)'/g),
    ...src.matchAll(/querySelector\(\s*'#([A-Za-z][\w-]*)'/g),
  ];
  for (const m of hits) if (!wanted.has(m[1])) wanted.set(m[1], name);
}

for (const [id, file] of wanted) {
  if (!definedIds.has(id)) note(`${file} looks up #${id}, but no element defines it`);
}

/* ---- and no id may be claimed twice ----
   Templates are cloned into the live page, so an id used in a template and
   again in the shell really are two elements with one name. getElementById
   then silently picks one of them — usually the wrong one, and only once the
   template happens to be on screen, which is the worst kind of bug to chase. */
{
  const places = new Map(); // id -> the files/templates that claim it
  const claim = (id, where) => places.set(id, [...(places.get(id) ?? []), where]);
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) claim(m[1], 'index.html');
  for (const { name, src } of scripts) {
    // One mention per file: a loop that stamps the same id on every row is a
    // different mistake, and flagging it here would only hide this one.
    for (const id of new Set([...src.matchAll(/\bid="([^"${]+)"/g)].map((m) => m[1]))) claim(id, name);
  }
  for (const [id, where] of places) {
    if (where.length > 1) note(`#${id} is defined ${where.length} times (${where.join(', ')}) — getElementById picks whichever is on screen`);
  }
}

/* ---- templates the router renders must exist ---- */
const templates = new Set([...html.matchAll(/<template id="([^"]+)"/g)].map((m) => m[1]));
const siteSrc = scripts.find((s) => s.name === 'js/site.js').src;
for (const m of siteSrc.matchAll(/render\(\s*'([^']+)'\s*\)/g)) {
  if (!templates.has(m[1])) note(`site.js renders template "${m[1]}", which index.html does not define`);
}

/* ---- local assets referenced by the shell must exist on disk ---- */
for (const m of html.matchAll(/(?:href|src)="(\/[^"]+)"/g)) {
  const url = m[1];
  if (url.startsWith('/socket.io/')) continue; // served by the socket.io middleware
  const file = path.join(ROOT, 'public', url);
  if (!existsSync(file)) note(`index.html references ${url}, which is missing from public/`);
}

/* ---- css custom properties used by components must be declared ---- */
const tokens = readFileSync(path.join(ROOT, 'public', 'css', 'tokens.css'), 'utf8');
const site = readFileSync(path.join(ROOT, 'public', 'css', 'site.css'), 'utf8');
const styles = readFileSync(path.join(ROOT, 'public', 'css', 'styles.css'), 'utf8');
const declared = new Set([
  ...[...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
  ...[...site.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
  ...[...styles.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
  // Per-element properties the JS sets at runtime (game tint, theme swatches).
  ...scripts.flatMap(({ src }) => [...src.matchAll(/setProperty\(\s*'(--[\w-]+)'/g)].map((m) => m[1])),
]);
for (const [file, css] of [['site.css', site], ['styles.css', styles]]) {
  for (const m of css.matchAll(/var\((--[\w-]+)/g)) {
    if (!declared.has(m[1])) note(`${file} uses ${m[1]}, which nothing declares`);
  }
}

/* ---- every theme in theme.js needs a palette block and a style pack ---- */
const themeSrc = scripts.find((s) => s.name === 'js/theme.js').src;
const skins = [...themeSrc.matchAll(/id:\s*'([^']+)',\s*name:\s*'[^']*',\s*style:\s*'([^']+)'/g)].map((m) => ({
  id: m[1],
  style: m[2],
}));
const packIds = new Set([...themeSrc.matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'[^']*',\s*blurb:/g)].map((m) => m[1]));

for (const { id, style } of skins) {
  if (id !== 'hypnic' && !tokens.includes(`[data-theme='${id}']`)) {
    note(`theme.js offers theme "${id}", but tokens.css has no [data-theme='${id}'] palette`);
  }
  if (!packIds.has(style)) note(`theme "${id}" names style pack "${style}", which STYLE_PACKS does not list`);
  if (style !== 'flat' && !styles.includes(`[data-style='${style}']`)) {
    note(`style pack "${style}" has no [data-style='${style}'] block in styles.css`);
  }
}
const skinCount = skins.length;
const packCount = packIds.size;
if (!skinCount) note('theme.js exposes no themes - the picker would be empty');

/* ---- every event the server sends must be forwarded to the page ---- */

// net.js relays a fixed list of socket events to the rest of the app. Add a new
// emit on the server and forget that list, and the browser goes silent with no
// error anywhere — which is exactly how the invite banner failed the first time.
{
  const netSrc = scripts.find((s) => s.name === 'js/net.js').src;
  const forwarded = new Set(
    (netSrc.match(/for \(const event of \[([\s\S]*?)\]\)/)?.[1] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
  );

  // Handled by name in net.js itself rather than through the relay list.
  const wiredDirectly = new Set(['connect', 'disconnect', 'status']);
  // Delivered straight to a game client, which subscribes to the raw socket.
  const roomScoped = new Set(['wrong', 'solved']);

  const serverDir = path.join(ROOT, 'server');
  const serverSrc = ['index.js', 'rooms.js', 'tournaments.js', 'social.js', 'notices.js']
    .map((f) => readFileSync(path.join(serverDir, f), 'utf8'))
    .join('\n');

  // Two ways an event leaves the server: straight off a socket, or through a
  // helper that knows how to find one player's sockets. Scanning only for
  // `.emit(` missed every event social.js sends, and reported them as dead.
  const emitted = new Set([
    ...[...serverSrc.matchAll(/\.emit\(\s*'([a-z]+:[a-z]+)'/gi)].map((m) => m[1]),
    ...[...serverSrc.matchAll(/\btell(?:Player)?\(\s*[^,]+,\s*'([a-z]+:[a-z]+)'/gi)].map((m) => m[1]),
  ]);

  for (const event of emitted) {
    if (forwarded.has(event) || wiredDirectly.has(event) || roomScoped.has(event)) continue;
    note(`the server emits "${event}" but net.js never relays it — the page would never hear it`);
  }

  for (const event of forwarded) {
    if (!emitted.has(event)) {
      note(`net.js relays "${event}", which nothing on the server sends any more`);
    }
  }
}

/* ---- report ---- */
console.log(`\n  UI wiring check\n`);
console.log(`  ${definedIds.size} ids defined · ${wanted.size} looked up by JS`);
console.log(`  ${templates.size} view templates · ${skinCount} themes across ${packCount} style packs\n`);

if (problems.length) {
  for (const p of problems) console.log(`  \x1b[31mFAIL\x1b[0m  ${p}`);
  console.log(`\n  ${problems.length} problem(s)\n`);
  process.exit(1);
}
console.log('  \x1b[32mPASS\x1b[0m  every lookup, template, asset, token and skin resolves\n');
