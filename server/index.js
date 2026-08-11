// First, and on purpose. Everything below may read process.env while it is
// being imported, so the .env has to be in place before any of it evaluates.
import './env.js';

import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import QRCode from 'qrcode';
import { Server } from 'socket.io';

import { listGames, getGame } from './games/index.js';
import { createRoom, getRoom, roomStats } from './rooms.js';
import { publicQuiz } from './identity.js';
import { titleCatalogue } from './titles.js';
import { warmUp as warmUpAI, isEnabled as aiEnabled } from './ai.js';
import {
  signup,
  login,
  verifyToken,
  getProfile,
  publicProfile,
  leaderboard,
  memberCount,
  memberIds,
  recoverId,
  recoveryHints,
  setRecovery,
  hasRecovery,
  saveAccounts,
} from './accounts.js';
import { attachNotices, postNotice, removeNotice, noticesFor, markRead, ensureNotice } from './notices.js';
import {
  attachSocial,
  arrive,
  depart,
  setWhereabouts,
  roster,
  directory,
  requestFriend,
  acceptFriend,
  declineFriend,
  unfriend,
  requestsFor,
  friendList,
  sendMessage,
  conversation,
  totalUnread,
  inviteOne,
  publicCard,
} from './social.js';
import { warmUpLLM } from './llm.js';
import { CLUE_DIR, clueFor, clueVocabulary, mediaStatus } from './media.js';
import { joinAddresses } from './addresses.js';
import { OWN_DIR, ownClues, ownCluesStatus, ownTitles, saveOwnClue } from './own-clues.js';
import { mayUse, accessState, setAccess, isOwner } from './access.js';
import {
  walletFor,
  award as awardChips,
  buyChips,
  spendablePoints,
  historyFor,
  claimDaily,
  chipBoard,
  CAGE_RATE,
  DAILY_TOP_UP,
  TOP_UP_CEILING,
} from './chips.js';
import { addFeedback, addReply, feedbackList, unreadFeedback, markFeedbackRead, removeFeedback } from './feedback.js';
import {
  attachTournaments,
  createTournament,
  register as tourneyRegister,
  withdraw as tourneyWithdraw,
  pairStrays,
  startTournament,
  cancelTournament,
  listTournaments,
  getTournament,
  liveMatchFor,
} from './tournaments.js';

const PORT = Number(process.env.PORT) || 8008;
const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');

// Dev tools (the device harness and the phase preview) are handy locally but
// have no business on a link you send to someone. Off unless asked for.
const ALLOW_DEV = process.env.ALLOW_DEV === '1' || process.env.NODE_ENV !== 'production';

// Probe the local model once at boot; CPU players fall back to canned lines if
// it never answers, so this failing is not an error.
warmUpLLM();

// How long a host must wait between shouting about their room.
const INVITE_COOLDOWN_MS = 30_000;

/**
 * A fingerprint of the code the browser is running, worked out once at startup.
 * A tab that was opened before an update keeps running the old modules with no
 * error anywhere — this is what lets it notice and offer to reload.
 */
function buildId() {
  const dir = path.join(import.meta.dirname, '..', 'public');
  const files = ['js', 'css', 'games/_party']
    .flatMap((sub) => {
      const full = path.join(dir, sub);
      return existsSync(full) ? readdirSync(full).map((f) => path.join(full, f)) : [];
    })
    .concat(path.join(dir, 'index.html'))
    .filter((f) => /\.(js|css|html)$/.test(f));

  const stamp = files
    .sort()
    .map((f) => {
      const s = statSync(f);
      return `${path.basename(f)}:${s.size}:${Math.floor(s.mtimeMs)}`;
    })
    .join('|');
  return createHash('sha256').update(stamp).digest('hex').slice(0, 12);
}

const BUILD = buildId();

const app = express();
const httpServer = createServer(app);

/**
 * How long a request may take before this server gives up on it.
 *
 * Node's default is exactly 300s, which is exactly what Study's grading routes
 * declare as their budget — so a route using its full allowance races the
 * server hosting it, and cron/refresh at 800s loses outright. Those routes are
 * slow because they are doing real work: fetching an article, rewriting it to
 * exam standard, and running local inference. A minute of silence is normal.
 *
 * The failure this prevents is the worst kind to debug: somebody writes a
 * 250-word essay, submits, waits, and gets a network error while the model is
 * still working — and it looks like Study's fault.
 *
 * Bounded rather than disabled, because this port faces the internet through a
 * tunnel and an unbounded request is something to hold open forever.
 */
const LONG_REQUEST_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 900_000; // 15 min
httpServer.requestTimeout = LONG_REQUEST_MS;
// Time allowed to receive the *headers*, which is about a slow client rather
// than a slow response, so it stays short.
httpServer.headersTimeout = 65_000;
const io = new Server(httpServer, {
  cors: { origin: '*' }, // same-origin in practice; open so a phone on the LAN never gets blocked
  pingTimeout: 20_000,
  maxHttpBufferSize: 1e5, // 100KB — nothing this game sends is bigger
});

// Behind a tunnel or a host's load balancer, the real client IP arrives in a
// header. Without this the rate limiter would see one IP for everybody.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(compression());
app.use(express.json({ limit: '32kb' }));

if (!ALLOW_DEV) {
  app.use('/_dev', (_req, res) => res.status(404).send('Not found'));
}

app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      // The shell must always revalidate or a deploy never reaches anyone;
      // fingerprint-free assets get a short cache instead of a long one.
      // Code must always revalidate. These filenames carry no fingerprint, so
      // a max-age here means a friend who refreshes still runs last week's
      // build and there is no way to tell from either side. On a LAN a
      // revalidation is a 304 and costs nothing.
      if (/\.(html|js|css|webmanifest)$/.test(filePath) || filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    },
  })
);

/**
 * Small in-memory rate limiter. A public link means strangers can hit the
 * signup endpoint in a loop; this keeps one IP from filling the studio with
 * junk accounts. Not a dependency — a Map and a clock is enough here.
 */
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, list] of hits) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length) hits.set(ip, kept);
      else hits.delete(ip);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => t > now - windowMs);
    if (recent.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: message });
    }
    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}

// A whole party usually shares one public IP — college WiFi, a hotspot, or any
// home router puts everybody behind the same NAT. So these limits are sized for
// "a room full of friends all signing up at once", not for one person. They
// still stop a script making thousands of accounts. Raise them with env vars if
// you ever run a bigger event.
const signupLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.SIGNUP_LIMIT) || 120,
  message: 'A lot of new IDs from this network already. Try again in a bit.',
});
const loginLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.LOGIN_LIMIT) || 300,
  message: 'Too many sign-in attempts from this network. Give it a few minutes.',
});

// Picture clues live outside the repo — they are bulk, they are generated, and
// a clone of this project should not have to download a gigabyte of
// photographs to run. Served straight off disk, cached hard: a picture never
// changes once it is downloaded.
if (CLUE_DIR && existsSync(CLUE_DIR)) {
  app.use(
    '/media/clues',
    express.static(CLUE_DIR, {
      maxAge: '30d',
      immutable: true,
      fallthrough: false,
      index: false,
      dotfiles: 'deny',
    })
  );
}

/**
 * Is Hypnic Study up, and where?
 *
 * The browser cannot answer this for itself. A cross-origin probe to another
 * port comes back opaque — it resolves whether Study answered, 404ed or was
 * something else entirely — and on a page served over the tunnel it is blocked
 * as mixed content before it is even sent. So the studio, which is on the same
 * machine as Study, checks properly and says.
 */
const STUDY_PORT = Number(process.env.STUDY_PORT) || 3000;
let studyLastSeen = 0;
let studyUp = false;
// The proxy only counts as a route once Study is actually answering — an
// enabled proxy in front of nothing is a 503, not a destination.
// Explicit opt-in, set by the launcher and only when it built Study with a
// matching BASE_PATH. Proxying to a Study that does not know its own prefix
// serves a page whose every asset 404s — worse than no link at all.
const STUDY_PROXIED = process.env.STUDY_PROXY === '1';
let proxyReady = false;

async function pollStudy() {
  try {
    const res = await fetch(`http://127.0.0.1:${STUDY_PORT}/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(2500),
    });
    studyUp = res.status < 500;
  } catch {
    studyUp = false;
  }
  proxyReady = STUDY_PROXIED && studyUp;
  studyLastSeen = Date.now();
  return studyUp;
}

app.get('/api/study', async (req, res) => {
  // Cached briefly: every visitor's page asks this on load, and a room full of
  // phones should not become a HEAD flood against a dev server.
  if (Date.now() - studyLastSeen > 10_000) await pollStudy();

  // With the proxy on, /study is served from this very port, so it reaches
  // whoever this page reached — including a friend who came through the
  // tunnel. Same-origin, so no mixed content and no second port to expose.
  if (proxyReady) {
    return res.json({ running: true, reachable: true, url: '/study', why: null });
  }

  // Without it, Study is only on its own port, and a second port on this
  // laptop is reachable from the same WiFi and never from outside. Saying so
  // beats handing somebody in another city a link that will hang.
  const host = String(req.hostname ?? '');
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);

  res.json({
    running: studyUp,
    reachable: studyUp && local,
    url: studyUp && local ? `http://${host}:${STUDY_PORT}` : null,
    // Said plainly so the client can explain itself rather than just hiding.
    why: !studyUp ? 'not running' : local ? null : 'only on the same WiFi',
  });
});

/* --------------------------- hypnic study, proxied ------------------------ */

// Study runs on its own port, which is fine in the room and useless outside
// it: the tunnel carries this port and only this port, so a second one has no
// route from another city. Passing /study through to it means one address
// covers both, and a friend who is not here can use the trainer too.
//
// Study must be built with BASE_PATH=/study for this to work — Next has to
// know its own prefix or it will hand out asset URLs that land back here.
/**
 * Headers that belong to a single connection rather than to the message, and
 * so must never cross a proxy. RFC 9110 §7.6.1.
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const strip = (headers) =>
  Object.fromEntries(Object.entries(headers).filter(([k]) => !HOP_BY_HOP.has(k.toLowerCase())));

if (STUDY_PROXIED) {
  // Study's cron endpoint is a local job — an in-process scheduler calls it
  // hourly, and Task Scheduler can call it too. Nothing about it wants a
  // public route, and giving it one is actively harmful: its auth guard only
  // engages when CRON_SECRET is set, which is deliberate for a local install
  // and becomes "anyone with the URL can trigger a full content rebuild"
  // behind a tunnel. Each rebuild burns minutes of GPU on the same machine
  // running the games, so it is a free denial-of-service rather than a leak.
  app.use('/study/api/cron', (_req, res) =>
    res.status(404).type('html').send('<h1>Not found</h1>')
  );

  app.use('/study', (req, res) => {
    const proxied = httpRequest(
      {
        host: '127.0.0.1',
        port: STUDY_PORT,
        // express strips the mount path, so it has to go back on.
        path: `/study${req.originalUrl.slice('/study'.length)}`,
        method: req.method,
        // Next checks that a Server Action's `origin` agrees with the host it
        // believes it is serving, and aborts if they differ — a CSRF guard
        // doing exactly its job. Rewriting `host` to the upstream port while
        // leaving `origin` as the address the browser actually used made every
        // action fail with "Invalid Server Actions request", which surfaces as
        // a blank "a server error occurred" and appears in no log the person
        // sitting in front of it can see.
        //
        // So Study is told the truth about where the request came from, and
        // `origin` is left exactly as the browser sent it.
        headers: {
          ...strip(req.headers),
          host: `127.0.0.1:${STUDY_PORT}`,
          'x-forwarded-host': req.headers.host ?? '',
          'x-forwarded-proto': req.protocol,
          'x-forwarded-for': req.ip ?? '',
        },
      },
      (upstream) => {
        // Hop-by-hop headers describe *this* connection and must not be
        // relayed onto the next one. Passing `transfer-encoding: chunked`
        // through while Node applies its own chunking frames the body twice:
        // curl tolerates it, Chrome does not, and the page fails to load with
        // a server error that never appears in any log because nothing on
        // either side considered it an error.
        res.writeHead(upstream.statusCode ?? 502, strip(upstream.headers));
        upstream.pipe(res);
      }
    );
    // Grading takes as long as it takes — a reading build has run to 175s and
    // an essay evaluation to 36s. Any timeout shorter than the route's own
    // budget cuts off work that was going to succeed, so there is none here
    // and the inbound server's limit is the only ceiling.
    proxied.setTimeout(0);
    proxied.on('socket', (socket) => socket.setTimeout(0));
    res.setTimeout?.(0);

    proxied.on('error', () => {
      if (!res.headersSent) {
        res
          .status(503)
          .type('html')
          .send('<h1>IELTS training is not running</h1><p>Start it on the laptop, then reload.</p>');
      }
    });
    req.pipe(proxied);
  });

  // Next's hot-reload and any websocket it opens ride an upgrade, which
  // express never sees. Without this the page loads and then sits there.
  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/study')) return; // socket.io handles its own
    const proxied = httpRequest({
      host: '127.0.0.1',
      port: STUDY_PORT,
      path: req.url,
      method: 'GET',
      headers: { ...req.headers, host: `127.0.0.1:${STUDY_PORT}` },
    });
    proxied.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${Object.entries(upstreamRes.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n')}\r\n\r\n`
      );
      if (upstreamHead?.length) socket.unshift(upstreamHead);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    proxied.on('error', () => socket.destroy());
    if (head?.length) proxied.write(head);
    proxied.end();
  });
}

// Picture rounds written by the players, served from the same store. Not
// cached as hard as the downloaded ones: somebody adding a folder wants to
// see it that evening, not after a browser decides a month has passed.
if (OWN_DIR && existsSync(OWN_DIR)) {
  app.use('/media/mine', express.static(OWN_DIR, { maxAge: '1h', index: false, dotfiles: 'deny' }));
}

/* --------------------------- rounds sent in by friends -------------------- */

// Where the pictures live and how many there are. Small, but the one question
// that has no other answer: MEDIA_DIR falls back through several candidates,
// and "the files went somewhere else" looks exactly like "the files are gone".
app.get('/api/media', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ...mediaStatus(), own: ownCluesStatus() });
});

// What has already been sent in. Handed over whole rather than searched here,
// because the page needs to answer "has anyone done this one?" on every
// keystroke and a round trip per letter over a hotspot would be unusable.
// Never cached: somebody who just added a round should see it on the next
// person's screen, not after a browser decides an hour has passed.
app.get('/api/clues', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ titles: ownTitles() });
});

// Pictures arrive as data URLs, already shrunk in the browser, so this route
// needs a body limit the rest of the site would be reckless to allow.
app.post('/api/clues', express.json({ limit: '40mb' }), (req, res) => {
  const out = saveOwnClue(req.body ?? {});
  if (out.error) {
    // A duplicate is a fact about the store, not a malformed request, and the
    // page tells the two apart to say something more useful than "no".
    return res.status(out.taken ? 409 : 400).json(out);
  }
  console.log(`[clues] "${out.answer}" — ${out.pictures} pictures`);
  res.json(out);
});

/* ------------------------------- what people say -------------------------- */

// No sign-in required. The person most likely to hit something broken is the
// one who could not get past it, and asking them to log in first would lose
// exactly the reports worth having.
app.post('/api/feedback', (req, res) => {
  const out = addFeedback({ ...(req.body ?? {}) });
  res.status(out.error ? 400 : 200).json(out);
});

// Reading it is owner-only — it is a pile of other people’s words.
app.get('/api/feedback', requireAuth, (req, res) => {
  if (!isOwner(req.accountId)) return res.status(403).json({ error: 'Only the studio owner can read this.' });
  res.json({ items: feedbackList(), unread: unreadFeedback() });
});

app.post('/api/feedback/:id', requireAuth, (req, res) => {
  if (!isOwner(req.accountId)) return res.status(403).json({ error: 'Only the studio owner can do that.' });
  if (req.body?.remove) return res.json(removeFeedback(req.params.id));

  // An answer. It is recorded against the report and delivered to the person
  // who wrote it, as a notice only they can see — somebody who took the
  // trouble to report a bug should hear back, and hearing back on the public
  // board would be worse than silence.
  if (typeof req.body?.reply === 'string') {
    const out = addReply(req.params.id, req.body.reply, req.accountId);
    if (out.error) return res.status(400).json(out);

    const posted = postNotice({
      title: 'A reply from the studio',
      body: `You said: “${out.item.text.slice(0, 160)}${out.item.text.length > 160 ? '…' : ''}”\n\n${req.body.reply}`,
      kind: 'news',
      from: 'Hypnic Teen Studio',
      to: out.item.from,
    });
    return res.json({ ok: true, delivered: Boolean(posted.ok), item: out.item });
  }

  res.json(markFeedbackRead(req.params.id));
});

/* ------------------------------ who may enter ---------------------------- */

// Study calls this after the studio has verified an ID and PIN, so the answer
// is about a member who has already proved who they are.
// Is this member allowed in? Answered for anybody, because the app on the
// other side has to ask before it lets someone through.
//
// The answer used to be built as { ...mayUse(), ...accessState() }, and both
// of those have an `allowed` key — one a boolean decision, the other the list
// of everybody permitted. The list won. So this route answered
// `allowed: ["Hypnic>AzureSloth<Teen"]`, Study read it as Boolean(...), a
// non-empty array is true, and every member with a valid PIN walked straight
// into an app that was supposed to be invite-only. The door reported itself
// locked the entire time.
//
// The list is not sent at all now. It named the owner and everybody let in, to
// anyone who asked, unauthenticated — that is the owner's business, and it
// belongs in the owner's panel, which has a token behind it.
app.get('/api/access/:app', (req, res) => {
  const id = String(req.query.id ?? '').trim();
  const verdict = mayUse(req.params.app, id);
  res.json({ allowed: verdict.allowed === true, why: verdict.why ?? null, app: req.params.app });
});

// The whole picture — who is in, who owns it — for the owner alone.
app.get('/api/access/:app/list', requireAuth, (req, res) => {
  if (!isOwner(req.accountId)) return res.status(403).json({ error: 'Only the studio owner can see this.' });
  res.json(accessState(req.params.app));
});

// Owner-only, and the owner is whoever OWNER_ID names — a signed token, not
// a claim in the body.
app.post('/api/access/:app', requireAuth, (req, res) => {
  const out = setAccess(req.params.app, req.accountId, req.body ?? {});
  res.status(out.error ? 403 : 200).json(out);
});

app.get('/api/games', (_req, res) => res.json(listGames()));
app.get('/api/health', (_req, res) => res.json({ ok: true, members: memberCount(), ...roomStats() }));
app.get('/api/room/:code', (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(room.publicInfo());
});

/* --------------------------- studio membership -------------------------- */

/**
 * QR for any link the app wants to show on screen. With no internet and a room
 * full of people, nobody should be typing an IP address off someone's laptop.
 */
app.get('/api/qr.svg', async (req, res) => {
  const text = String(req.query.text ?? '').slice(0, 512);
  if (!text) return res.status(400).send('missing text');
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=3600').send(svg);
  } catch (err) {
    res.status(400).send('bad text');
  }
});

// The address the outside world can reach this studio on, when there is one.
// Everyone in the room joins over WiFi or the hotspot; a friend three states
// away needs a link that does not begin with 192.168, and only the launcher
// knows what that link is.
let publicUrl = process.env.PUBLIC_URL || null;

app.get('/api/where', (_req, res) => res.json({ publicUrl }));

// Set by tools/launch.mjs on the loopback interface once its tunnel is up.
// Refusing anything that did not come from this machine keeps a stranger from
// rewriting everybody's invite link to point at themselves.
app.post('/api/public-url', (req, res) => {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (!local) return res.status(403).json({ error: 'Local only.' });
  const url = String(req.body?.url ?? '');
  if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(url)) return res.status(400).json({ error: 'Not a URL.' });
  publicUrl = url;
  console.log(`[net] reachable from anywhere at ${url}`);
  io.emit('app:where', { publicUrl });
  res.json({ ok: true });
});

/* ------------------------------ getting back in --------------------------- */

// Which question a returning member set, so the form can ask it. Never the
// answer, and never whether the PIN was right — that comes later, together.
app.get('/api/recover/hint', (req, res) => res.json(recoveryHints(req.query.name)));

app.post('/api/recover', loginLimit, (req, res) => {
  const out = recoverId(req.body ?? {});
  res.status(out.error ? 400 : 200).json(out);
});

app.post('/api/recovery', requireAuth, (req, res) => {
  const out = setRecovery(req.accountId, req.body ?? {});
  res.status(out.error ? 400 : 200).json(out);
});

/* -------------------------------- the board ------------------------------- */

app.get('/api/notices', (req, res) => {
  const id = verifyToken((req.headers.authorization ?? '').replace(/^Bearer /, ''));
  res.json(noticesFor(id ?? ''));
});

app.post('/api/notices/read', requireAuth, (req, res) => res.json(markRead(req.accountId, req.body?.ids)));

// Posting is the owner's alone. The owner is whoever holds OWNER_ID — set it
// in the environment; without it nobody can post, which is the safe default
// for a studio somebody else has downloaded and is running themselves.
app.post('/api/notices', requireAuth, (req, res) => {
  if (!process.env.OWNER_ID || req.accountId !== process.env.OWNER_ID) {
    return res.status(403).json({ error: 'Only the studio can post notices.' });
  }
  const out = postNotice({ ...(req.body ?? {}), from: req.body?.from ?? 'Hypnic Teen Studio' });
  res.status(out.error ? 400 : 200).json(out);
});

// Chips for a test's stand-in players, and nothing else.
//
// Gated on NODE_ENV === 'test' rather than on ALLOW_DEV, which is on whenever
// the studio is not running as production — including the copy on this laptop
// that friends connect to. A route that hands out chips has to be unreachable
// there, not merely inconvenient to find.
if (process.env.NODE_ENV === 'test') {
  app.post('/api/_test/chips', (req, res) => {
    const id = String(req.body?.id ?? '');
    const chips = Math.floor(Number(req.body?.chips ?? 0));
    if (!id || !Number.isFinite(chips) || chips <= 0) return res.status(400).json({ error: 'no' });
    awardChips(id, chips, 'test');
    res.json({ ok: true, balance: walletFor(id).balance });
  });
}

/* ---------------------------------- the cage ------------------------------ */

// Chips are not points, and the split is the whole point of them. Points are
// the record of what somebody has done — the level, the leaderboard, two
// titles — and a night at the tables must not be able to rewrite that. So the
// cage takes points one way and hands back chips, and nothing ever comes back.
app.get('/api/chips', requireAuth, (req, res) => {
  const profile = getProfile(req.accountId);
  res.set('Cache-Control', 'no-store');
  res.json({
    ...walletFor(req.accountId),
    spendablePoints: spendablePoints(profile),
    rate: CAGE_RATE,
    dailyTopUp: DAILY_TOP_UP,
    topUpCeiling: TOP_UP_CEILING,
    history: historyFor(req.accountId),
  });
});

/**
 * The daily top-up.
 *
 * It was written the day the casino opened and never given a route, so the
 * ceiling that stops somebody sitting on a fortune of free chips has been
 * enforcing itself against nobody. It tops you *up to* a floor rather than
 * adding a flat amount, which is why somebody who is doing well gets nothing
 * and somebody who has lost everything can still sit down tomorrow.
 */
app.post('/api/chips/daily', requireAuth, (req, res) => {
  const out = claimDaily(req.accountId);
  if (out.error) return res.status(400).json(out);
  res.json({ ...out, ...walletFor(req.accountId) });
});

app.post('/api/chips/buy', requireAuth, (req, res) => {
  const profile = getProfile(req.accountId);
  const out = buyChips(profile, req.body?.points);
  if (out.error) return res.status(400).json(out);
  // buyChips marks the points as spent on the profile; the accounts store has
  // to be told to write that down.
  saveAccounts();
  res.json({ ...out, spendablePoints: spendablePoints(profile) });
});

// Its own board, deliberately separate from the leaderboard. Who is holding
// the most chips is a fact about tonight; the leaderboard is a fact about who
// plays well, and mixing them is exactly what the two-currency split prevents.
app.get('/api/chips/board', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    board: chipBoard(10).map((row) => ({
      ...row,
      name: publicCard(row.id)?.name ?? null,
    })),
  });
});

// Every member's ID and name, so the owner can address a notice to somebody
// without typing a Hypnic ID from memory — they are long, and one wrong
// character sends a private note nowhere with nothing to say it went astray.
// Owner-only: a full member list is not something to hand out.
app.get('/api/members', requireAuth, (req, res) => {
  if (!isOwner(req.accountId)) return res.status(403).json({ error: 'Only the studio owner can see this.' });
  res.set('Cache-Control', 'no-store');
  res.json({
    members: memberIds()
      .map((id) => ({ id, name: publicCard(id)?.name ?? null }))
      .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id)),
  });
});

app.delete('/api/notices/:id', requireAuth, (req, res) => {
  if (!process.env.OWNER_ID || req.accountId !== process.env.OWNER_ID) {
    return res.status(403).json({ error: 'Only the studio can remove notices.' });
  }
  const out = removeNotice(req.params.id);
  res.status(out.error ? 400 : 200).json(out);
});

app.get('/api/quiz', (_req, res) => res.json({ questions: publicQuiz() }));

// The titles page is personal, because half of it is.
//
// Open titles are the same for everybody. Secret ones appear only for whoever
// has actually earned them, so this has to know who is asking — and it must not
// insist, because the page is readable signed out. A bad or missing token means
// the open half and a count of the secrets, which is exactly what a stranger
// should see.
app.get('/api/titles', (req, res) => {
  const token = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const id = verifyToken(token);
  res.json(titleCatalogue(id ? getProfile(id) : null));
});

/**
 * Signing in hands back the same `isOwner` that /api/me does.
 *
 * It did not, and only /api/me did — which is read on boot and nowhere else.
 * So the owner had their controls after a page load and lost them the moment
 * anything replaced the stored profile: a fresh login, a signup, or finishing
 * a match. The symptom was a button that came and went for no reason anybody
 * could describe, which is why the flag now travels with every profile the
 * server hands out rather than with one of them.
 */
const withOwner = (result) =>
  (result?.profile ? { ...result, profile: { ...result.profile, isOwner: isOwner(result.profile.id) } } : result);

app.post('/api/auth/signup', signupLimit, (req, res) => {
  const result = signup(req.body ?? {});
  res.status(result.error ? 400 : 200).json(withOwner(result));
});

app.post('/api/auth/login', loginLimit, (req, res) => {
  const result = login(req.body ?? {});
  res.status(result.error ? 401 : 200).json(withOwner(result));
});

/** Resolves the bearer token into req.accountId, or 401s. */
function requireAuth(req, res, next) {
  const token = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const id = verifyToken(token);
  if (!id) return res.status(401).json({ error: 'Sign in first.' });
  req.accountId = id;
  next();
}

// `isOwner` rides along so the site can show the owner their own controls.
// It decides what a button looks like, never what is allowed — every route
// that matters asks the server again, because a flag in a browser is a
// suggestion.
app.get('/api/me', requireAuth, (req, res) =>
  res.json({ profile: { ...publicProfile(getProfile(req.accountId)), isOwner: isOwner(req.accountId) } })
);

app.get('/api/leaderboard', (req, res) => {
  const { gameId, room, sort, limit } = req.query;
  res.json(
    leaderboard({
      gameId: gameId || undefined,
      room: room || undefined,
      sort: ['points', 'wins', 'best'].includes(sort) ? sort : 'points',
      limit: Math.min(Number(limit) || 50, 100),
    })
  );
});

// Everything else falls through to the single-page shell.
app.use((_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

/* ------------------------------- tournaments ------------------------------ */

// Who is on the site right now, so a bracket can tell people their tie is
// ready without them having to be staring at the tournament page.
/** @type {Map<string, Set<string>>} accountId -> socket ids */
const online = new Map();

const seatOnline = (accountId, socketId) => {
  if (!online.has(accountId)) online.set(accountId, new Set());
  online.get(accountId).add(socketId);
};
const seatOffline = (accountId, socketId) => {
  const seats = online.get(accountId);
  if (!seats) return;
  seats.delete(socketId);
  if (!seats.size) online.delete(accountId);
};
const tellPlayer = (accountId, event, payload) => {
  for (const sid of online.get(accountId) ?? []) io.to(sid).emit(event, payload);
};

/** How long a tie waits for both sides before CPUs stand in for the missing. */
const TIE_GRACE_MS = 45_000;

attachNotices(io, tellPlayer);
attachSocial({
  server: io,
  tellPlayer: (id, event, payload) => tellPlayer(id, event, payload),
  getProfile: (id) => publicProfile(getProfile(id)),
});

// Members who joined before recovery existed have no way back in if they lose
// their ID — which is exactly how this feature came to be written. Ask them
// once, on the board, rather than interrupting a match to demand it.
ensureNotice('set-recovery', {
  title: 'Add a way back into your account',
  body:
    'Your Hypnic ID is the only key to your points, titles and history — and it is easy to lose. ' +
    'Open your profile and set a recovery question, so your name and PIN can find it again if you ever clear your browser.',
  kind: 'warning',
  pinned: true,
});

attachTournaments({
  server: io,
  open: ({ gameId, seats, tourneyId, matchId, label, settings }) => {
    const room = createRoom(gameId, io);
    if (!room) return null;
    room.tourney = { id: tourneyId, matchId, label, expected: seats.map((s) => s.playerId) };
    if (settings && Object.keys(settings).length) room.applySettings(settings);
    room.armTie(TIE_GRACE_MS);
    for (const seat of seats) {
      tellPlayer(seat.playerId, 'tourney:match', { code: room.code, tourneyId, label });
    }
    console.log(`[cup] ${label} → room ${room.code} (${seats.length} seats)`);
    return room.code;
  },
});

io.on('connection', (socket) => {
  // Set once the socket is inside a room; used by every later handler.
  let ctx = null;
  /** The signed-in account behind this socket, once it identifies itself. */
  let account = null;

  socket.emit('app:version', { build: BUILD });

  // Hopping straight from one room to another — which is exactly what accepting
  // an invite does — must vacate the old seat, or the room you left keeps
  // counting you and waits for an answer that is never coming.
  const leaveCurrent = () => {
    const previous = ctx && getRoom(ctx.code);
    if (!previous) return;
    socket.leave(previous.code);
    previous.markDisconnected(ctx.playerId);
    if (account) setWhereabouts(account.id, null);
    previous.broadcastRoom();
    ctx = null;
  };

  const enter = (room, playerId) => {
    if (ctx && ctx.code !== room.code) leaveCurrent();
    ctx = { code: room.code, playerId };
    // The roster says "in a lobby" or "playing" rather than just "online".
    if (account) setWhereabouts(account.id, { code: room.code, phase: room.phase, game: room.game?.name, open: true });
    socket.join(room.code);
    socket.emit('room:joined', { room: room.publicInfo(), youId: playerId });
    room.broadcastRoom();
    if (room.phase === 'playing' && room.state) {
      socket.emit('game:start', room.startFrameFor(playerId));
    }
  };

  /** Identity always comes from the signed token, never from the client's claim. */
  const authenticate = (token) => {
    const id = verifyToken(token);
    const profile = id ? getProfile(id) : null;
    // Remember the face at the door: tournaments need to reach a player who is
    // on the site but not in any room.
    if (profile && account?.id !== profile.id) {
      if (account) seatOffline(account.id, socket.id);
    // Only really gone once the last tab closes.
    if (account && !online.has(account.id)) depart(account.id);
      account = profile;
      seatOnline(profile.id, socket.id);
    }
    return profile;
  };

  // Signing in without joining anything — the tournament board needs to know
  // you are here, and you need to know if a tie of yours is already running.
  socket.on('hello', ({ token } = {}, ack) => {
    const me = authenticate(token);
    if (!me) return ack?.({ error: 'Your session expired. Sign in again.' });
    arrive(me);
    const waiting = liveMatchFor(me.id);
    if (waiting) socket.emit('tourney:match', { code: waiting.roomCode, tourneyId: waiting.tourneyId, label: waiting.name });
    ack?.({ ok: true, tournaments: listTournaments() });
  });

  socket.on('room:create', ({ gameId, token }, ack) => {
    const account = authenticate(token);
    if (!account) return ack?.({ error: 'Your session expired. Sign in again.' });
    if (!getGame(gameId)) return ack?.({ error: 'Unknown game.' });

    const room = createRoom(gameId, io);
    const player = room.addPlayer({ id: account.id, name: account.name, socketId: socket.id });
    room.hostId = player.id;
    enter(room, player.id);
    ack?.({ ok: true, code: room.code });
  });

  socket.on('room:join', ({ code, token }, ack) => {
    const account = authenticate(token);
    if (!account) return ack?.({ error: 'Your session expired. Sign in again.' });

    const room = getRoom(code);
    if (!room) return ack?.({ error: 'No room with that code.' });

    const known = room.players.has(account.id);
    const connected = [...room.players.values()].filter((p) => p.connected).length;
    if (!known && connected >= (room.game?.maxPlayers ?? 8)) {
      return ack?.({ error: 'That room is full.' });
    }
    const player = room.addPlayer({ id: account.id, name: account.name, socketId: socket.id });
    enter(room, player.id);
    ack?.({ ok: true, code: room.code, gameId: room.gameId });
  });

  socket.on('room:ready', (ready) => {
    const room = ctx && getRoom(ctx.code);
    const player = room?.players.get(ctx.playerId);
    if (!player) return;
    player.ready = Boolean(ready);
    room.broadcastRoom();
  });

  // Whether the room gets walked through the rules first. Host's call, and
  // it is the same question at every table so it lives on the room rather
  // than in thirty separate option blocks.
  socket.on('room:tutorial', ({ on } = {}, ack) => {
    const room = ctx && getRoom(ctx.code);
    if (!room) return ack?.({ error: 'Not in a room.' });
    if (room.hostId !== ctx.playerId) return ack?.({ error: 'Only the host can change that.' });
    room.tutorial = Boolean(on);
    room.broadcastRoom();
    ack?.({ ok: true, tutorial: room.tutorial });
  });

  socket.on('room:start', (_payload, ack) => {
    const room = ctx && getRoom(ctx.code);
    if (!room) return ack?.({ error: 'Not in a room.' });
    if (room.hostId !== ctx.playerId) return ack?.({ error: 'Only the host can start.' });
    ack?.(room.start());
  });

  // CPU players, so nobody has to wait for a room to fill up to play.
  socket.on('room:bot', ({ add, id } = {}, ack) => {
    const room = ctx && getRoom(ctx.code);
    if (!room) return ack?.({ error: 'Not in a room.' });
    if (room.hostId !== ctx.playerId) return ack?.({ error: 'Only the host can add CPU players.' });
    ack?.(add === false ? room.removeBot(id) : room.addBot());
  });

  socket.on('room:fill', (_payload, ack) => {
    const room = ctx && getRoom(ctx.code);
    if (!room) return ack?.({ error: 'Not in a room.' });
    if (room.hostId !== ctx.playerId) return ack?.({ error: 'Only the host can add CPU players.' });
    ack?.(room.fillWithBots());
  });

  socket.on('room:settings', (patch, ack) => {
    const room = ctx && getRoom(ctx.code);
    if (!room) return ack?.({ error: 'Not in a room.' });
    if (room.hostId !== ctx.playerId) return ack?.({ error: 'Only the host can change the setup.' });
    ack?.(room.applySettings(patch ?? {}));
  });

  socket.on('room:lobby', () => {
    const room = ctx && getRoom(ctx.code);
    if (room && room.hostId === ctx.playerId) room.returnToLobby();
  });

  socket.on('room:leave', leaveCurrent);

  socket.on('game:action', (action) => {
    const room = ctx && getRoom(ctx.code);
    room?.handleAction(ctx.playerId, action);
  });

  // The host can call everyone who is on the site but not already playing.
  // One shout per room every half minute — an invite people learn to ignore is
  // worse than no invite at all.
  socket.on('room:invite', (_payload, ack) => {
    const room = ctx && getRoom(ctx.code);
    if (!room) return ack?.({ error: 'Not in a room.' });
    if (room.hostId !== ctx.playerId) return ack?.({ error: 'Only the host can invite.' });

    const now = Date.now();
    const waited = now - (room.lastInviteAt ?? 0);
    if (waited < INVITE_COOLDOWN_MS) {
      return ack?.({ error: `Wait ${Math.ceil((INVITE_COOLDOWN_MS - waited) / 1000)}s before calling again.` });
    }
    room.lastInviteAt = now;

    const host = room.players.get(ctx.playerId);
    const seated = [...room.players.values()].filter((p) => p.connected).length;

    // Count who this actually reaches, so a shout into an empty room says so
    // instead of reporting a cheerful success nobody heard.
    const inRoom = io.sockets.adapter.rooms.get(room.code) ?? new Set();
    const reached = [...io.sockets.sockets.keys()].filter((id) => !inRoom.has(id)).length;

    // Everyone except the people already sitting in this room.
    socket.broadcast.except(room.code).emit('invite:new', {
      code: room.code,
      game: room.game?.name ?? 'a game',
      emoji: room.game?.emoji ?? '🎮',
      host: host?.name ?? 'Someone',
      players: seated,
      at: now,
    });
    console.log(`[invite] ${host?.name ?? '?'} called ${reached} player(s) to ${room.code}`);
    ack?.({ ok: true, reached });
  });

  /* ------------------------------ tournaments ----------------------------- */

  // Every one of these needs a signed-in account, and none of them trusts the
  // client for who that is.
  const withAccount = (token, ack, fn) => {
    const me = authenticate(token);
    if (!me) return ack?.({ error: 'Your session expired. Sign in again.' });
    ack?.(fn(me));
  };

  /* -------------------------------- the room ------------------------------ */

  // Who is here, and where. The roster is only useful if it is current, so
  // every arrival, departure and room move is reported.
  socket.on('social:here', ({ token } = {}, ack) => {
    const me = authenticate(token);
    if (!me) return ack?.({ error: 'Sign in first.' });
    arrive(me);
    ack?.({
      ok: true,
      roster: roster(me.id),
      directory: directory(me.id, memberIds),
      friends: friendList(me.id),
      requests: requestsFor(me.id),
      unread: totalUnread(me.id),
    });
  });

  socket.on('social:card', ({ id } = {}, ack) => {
    const card = publicCard(id);
    ack?.(card ? { ok: true, card } : { error: 'No member with that ID.' });
  });

  const social = (token, ack, fn) => {
    const me = authenticate(token);
    if (!me) return ack?.({ error: 'Sign in first.' });
    ack?.(fn(me));
  };

  socket.on('social:add', ({ token, id } = {}, ack) => social(token, ack, (me) => requestFriend(me.id, id)));
  socket.on('social:accept', ({ token, id } = {}, ack) =>
    social(token, ack, (me) => ({ ...acceptFriend(me.id, id), friends: friendList(me.id) })));
  socket.on('social:decline', ({ token, id } = {}, ack) => social(token, ack, (me) => declineFriend(me.id, id)));
  socket.on('social:remove', ({ token, id } = {}, ack) =>
    social(token, ack, (me) => ({ ...unfriend(me.id, id), friends: friendList(me.id) })));

  socket.on('social:say', ({ token, id, text } = {}, ack) => social(token, ack, (me) => sendMessage(me.id, id, text)));
  socket.on('social:thread', ({ token, id } = {}, ack) =>
    social(token, ack, (me) => ({ ok: true, ...conversation(me.id, id) })));

  // An invite aimed at one person, carrying the code so they arrive in a tap.
  socket.on('social:invite', ({ token, id } = {}, ack) =>
    social(token, ack, (me) => {
      const room = ctx && getRoom(ctx.code);
      if (!room) return { error: 'Open a room first.' };
      return inviteOne(me.id, id, { code: room.code, game: room.game?.name, emoji: room.game?.emoji });
    }));

  socket.on('tourney:list', (_p, ack) => ack?.({ ok: true, tournaments: listTournaments() }));

  socket.on('tourney:create', ({ token, ...spec } = {}, ack) =>
    withAccount(token, ack, (me) => createTournament({ ...spec, hostId: me.id, hostName: me.name })));

  socket.on('tourney:join', ({ token, id, team } = {}, ack) =>
    withAccount(token, ack, (me) => tourneyRegister(id, { id: me.id, name: me.name }, String(team ?? ''))));

  socket.on('tourney:leave', ({ token, id } = {}, ack) =>
    withAccount(token, ack, (me) => tourneyWithdraw(id, me.id)));

  socket.on('tourney:pair', ({ token, id } = {}, ack) =>
    withAccount(token, ack, (me) => pairStrays(id, me.id)));

  socket.on('tourney:start', ({ token, id } = {}, ack) =>
    withAccount(token, ack, (me) => startTournament(id, me.id)));

  // The organiser can call off their own; the owner can call off any, because
  // whoever started it may well have gone home and left it on everybody's
  // home screen.
  socket.on('tourney:cancel', ({ token, id } = {}, ack) =>
    withAccount(token, ack, (me) => cancelTournament(id, me.id, isOwner(me.id))));

  socket.on('tourney:get', ({ id } = {}, ack) => {
    const t = getTournament(id);
    ack?.(t ? { ok: true, tournament: t } : { error: 'No such tournament.' });
  });

  socket.on('chat:send', (text) => {
    const room = ctx && getRoom(ctx.code);
    const player = room?.players.get(ctx.playerId);
    if (!player) return;
    const message = String(text ?? '').slice(0, 200).trim();
    if (message) {
      io.to(room.code).emit('chat:message', { name: player.name, text: message, at: Date.now() });
    }
  });

  socket.on('disconnect', () => {
    if (account) seatOffline(account.id, socket.id);
    const room = ctx && getRoom(ctx.code);
    if (!room) return;
    room.markDisconnected(ctx.playerId);
    room.broadcastRoom();
  });
});

// A public link means one unexpected request must never take the studio down
// mid-match. Log and keep serving.
process.on('uncaughtException', (err) => console.error('[fatal] uncaught:', err));
process.on('unhandledRejection', (err) => console.error('[fatal] unhandled rejection:', err));

// Express error handler — must take four arguments to be recognised as one.
app.use((err, _req, res, _next) => {
  console.error('[http]', err.message);
  res.status(500).json({ error: 'Something broke on our side.' });
});

httpServer.listen(PORT, '0.0.0.0', async () => {
  const games = listGames().length;
  const addresses = joinAddresses();
  console.log('\n  \x1b[36m✦ HYPNIC TEEN\x1b[0m \x1b[2m·\x1b[0m FUN WORLD');
  console.log(`  ${games} game${games === 1 ? '' : 's'} loaded`);

  /**
   * Under the launcher this stops here.
   *
   * Both used to print a list of addresses. The server's comes first, because
   * it is listening within a second, and it cannot contain the public link —
   * the tunnel takes another twenty. So the first thing on screen was a
   * complete-looking list of ways to join with the one for a friend far away
   * missing from it, and the real list scrolled up out of sight behind a QR
   * code. "I can't see the link my friend can join with" is the obvious
   * consequence, and it took a screenshot to notice.
   *
   * One list, printed once, by whoever knows all of it.
   */
  if (process.env.UNDER_LAUNCHER === '1') {
    console.log('');
    warmUpAI().catch((err) => console.warn('  [ai] warm-up failed:', err.message));
    return;
  }

  console.log('');
  console.log(`  On this PC     http://localhost:${PORT}`);
  for (const a of addresses) {
    console.log(`  Friends join   \x1b[36mhttp://${a.ip}:${PORT}\x1b[0m \x1b[2mon ${a.what}\x1b[0m`);
  }

  // A scannable code beats reading an IP address out to twenty people. It gets
  // the first address, which joinAddresses() has already put in the order that
  // works for the most people — the hotspot before the house WiFi.
  const joinUrl = addresses.length ? `http://${addresses[0].ip}:${PORT}` : null;
  if (joinUrl) {
    try {
      const qr = await QRCode.toString(joinUrl, { type: 'terminal', small: true });
      console.log(`\n  Point a phone camera at this — no typing, no internet needed:\n`);
      console.log(qr);
    } catch {
      /* a terminal that can't draw it still has the URL above */
    }
  }

  console.log('  (Everyone on the same WiFi or router. Ctrl+C to stop.)\n');

  // Never blocks startup — the built-in banks are already loaded.
  warmUpAI().catch((err) => console.warn('  [ai] warm-up failed:', err.message));
  if (!aiEnabled()) {
    console.log('  Tip: set AI_GAME_MASTER=1 (and install @anthropic-ai/sdk) for fresh questions each week.\n');
  }
});
