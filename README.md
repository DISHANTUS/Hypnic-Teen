# Hypnic Teens Fun World

The web home of the **Hypnic Teen** gaming studio. One server, played on laptops
and Android phones, over college WiFi or over the internet. No installs, no app
store, no Gmail.

## Run it

```bash
npm install
npm start
```

The terminal prints two addresses:

```
On this PC     http://localhost:8008
Friends join   http://192.168.1.7:8008     <- give this one out
```

Everyone on the same WiFi (or your phone's hotspot) opens the *Friends join*
address. You pick a game, tell them the 4-letter room code, they join.

## Hypnic IDs at scale

Uniqueness is **guaranteed by construction**, not by luck: the generator probes
a taken-index and widens a base-32 tag until it finds free space, so it cannot
hand out a duplicate however full the studio gets.

```bash
npm run test:identity 200000
```

```
word pools: 72 prefixes × 48 creatures = 3,456 clean names
200,000 IDs · all unique · 262,000 IDs/sec · no slowdown as the studio fills
20,000 people with identical answers → 20,000 unique IDs
```

The first 3,456 members get a clean `PrefixCreature`. After that a short tag is
appended (`ShadowFox7K`), widening as needed — about **3.7 trillion** IDs total.
Lookups and the uniqueness check are O(1).

**The real ceiling is storage, not IDs.** `server/store.js` keeps every profile
in memory and rewrites the file on save. That is right for a studio of
thousands and wrong for millions — the server warns you at 25,000 members.
Going bigger means swapping that one module for a database; nothing else in the
codebase touches the filesystem, and `accounts.js` is the only caller.

## Big rooms (65+ in one game)

Quiz and Poll run in **mass mode** (`mass: true`, `maxPlayers: 2000`). The rest
cap at 12–16 because they're social games — Imposter with 200 people isn't a
game.

The thing that makes this work isn't connections, it's the payload. A normal
room sends every player a list of every player, which is quadratic:

| Players | Mass mode | Per-player list would be |
|---:|---:|---:|
| 65 | **1.1 KB** | ~440 KB per update, room-wide |
| 250 | **1.1 KB** | ~5.7 MB |
| 1000 | **1.1 KB** | ~89 MB |

Mass rooms send **counts plus a top-10 board** — the same size at any crowd
size — broadcast once by the room rather than serialised per player. Each
player's private slice (your answer, your score) is 118 bytes and goes only to
the one player it changed for, which is only ever whoever just acted.

Measured on one laptop:

```bash
URL=http://localhost:3100 npm run load 250 1 quiz
→ 250 players · 1 room · 0 dropped · 0 errors
```

The UI adapts too: instead of 250 name chips, you get a "how many are in"
meter and a live top-10.

**To make a new game mass-capable**, set `mass: true` and a high `maxPlayers`.
It has to be a game where everyone acts independently and results aggregate —
multiple choice, voting, buzzing in. Anything needing players to read each
other's answers doesn't belong in a 200-person room.

## Data usage

Party games send state only when something changes; each client runs its own
countdown. Measured:

| | per player |
|---|---|
| State updates | ~0.3 / second |
| Bandwidth | **~1.6 MB / hour** |

So an evening of games costs a few MB of mobile data — which is what makes
playing over the internet, with no WiFi at all, practical.

## The Android app

```bash
npm run apk
→ android/out/HypnicTeen.apk   (25 KB)
```

Send that file to a friend, they tap it, allow "install from unknown sources",
done. No Play Store, no accounts, no internet.

**What it adds over the browser:** it finds the host by itself. On launch it
sweeps the phone's own /24 for a server answering `/api/health`, confirms the
reply is actually ours, and offers a Join button. Nobody reads an IP address
out loud. The address is remembered, so the next launch goes straight in.

It also fixes something the browser can't: over plain `http://` on a LAN,
Chrome refuses to install a PWA or register a service worker, so "Add to Home
screen" is unavailable to everyone except the host on `localhost`. The APK has
no such restriction — and `usesCleartextTraffic` is set, without which Android
9+ would block a plain-http LAN server outright.

`domStorageEnabled` is on because the Hypnic ID and session token live in
`localStorage`; without it everyone would be signed out on every launch.

### Building it

Needs only what Android Studio already installs — SDK platform, build-tools,
and the bundled JDK. The script picks the newest of each it finds:

```
aapt2 → javac → d8 → zipalign → apksigner
```

No Gradle, no wrapper download, no plugin/JDK version matching. Output is
`minSdk 24`, `targetSdk 36`, signed with **v2 + v3** schemes (Android 11+
rejects v1-only APKs). Override locations with `ANDROID_SDK` / `ANDROID_JBR`.

The first build creates `android/hypnic.keystore`. **Keep that file.** It is
git-ignored, and if it is lost, friends have to uninstall before they can take
an update.

> Adding a third-party library later (a QR scanner, Kotlin, Compose) is the
> point where Gradle earns its keep. Until then this stays dependency-free,
> which is why the APK is 25 KB and builds in seconds.

## Playing with no internet at all

**You do not need internet to have a network.** That is the whole trick.

A WiFi router with *nothing plugged into its internet port* still creates a
local network. Phones connect to it, your laptop runs the server, everyone
plays. No SIM, no data, no bill — and no 10-device hotspot cap, because a
router handles 30–250 clients instead of 8.

| Option | Devices | Needs |
|---|---|---|
| **Any WiFi router, no internet** | 30–250 | a router (₹800+, or an old one from home) and a power socket |
| Phone hotspot | 8–10 | nothing — fine for a small group |
| College / home WiFi | many | a network that doesn't isolate clients |

Steps for the router:

1. Power the router on. Leave its WAN/internet port empty — it doesn't matter.
2. Connect your laptop to it (cable or WiFi) and run `npm start`.
3. Everyone else joins the same WiFi name.
4. **Scan the QR code** the terminal prints. It carries the join address, so
   nobody types an IP.

Inside a room, **Show QR** puts the invite on screen as a big code — hold up
the laptop and the room scans it. Both codes are generated locally; the QR
endpoint never touches the internet.

### What is not possible

Wi-Fi Direct and Bluetooth mesh would let phones link with no router at all,
but **a web page cannot reach those APIs** — only a native Android app can.
Chaining two hotspots doesn't work either: they are separate networks with no
path between them except the internet, and if you have internet you don't need
the hotspots. A cheap router is the honest answer.

## How many friends can join

**A phone hotspot caps at 8–10 devices. That is the phone's limit, not the
app's.** Measured on one laptop:

```
60 players · 5 rooms · 0 dropped · 0 errors · 235 state updates/sec
```

Reproduce it yourself — this is a real test, not a claim:

```bash
DATA_DIR=./tmp-load PORT=3100 node server/index.js
URL=http://localhost:3100 npm run load 60 5
```

So for a big group, don't use a hotspot:

| Way in | Device limit | Needs |
|---|---|---|
| **College / home WiFi** | none | everyone on the same network; the network must not block device-to-device traffic |
| **`npm run share`** | none | your laptop online; friends use any network or their own data |
| **Deployed** | none | a host; your laptop can be closed |

**Test WiFi before the party.** Some college networks use client isolation,
which blocks phones from reaching your laptop even on the same SSID. Have one
friend open the *Friends join* address. If it loads, you're fine for everyone;
if it hangs, that network is isolated — use `npm run share` instead.

One more thing for a big group: a single room holds 12–16 players depending on
the game, so 60 people means several rooms running at once. The server handles
that (that's what the test above proves) — just start a few rooms and share
different codes.

## Sending someone a link

A `192.168.x.x` address only works for people on your WiFi. For anyone else,
pick one of these.

### Right now, temporary

```bash
npm start          # terminal 1
npm run share      # terminal 2
```

`share` prints a public `https://` link. It tunnels over plain SSH to
localhost.run — no account, no install, nothing to sign up for. The link works
from any network for as long as you leave it running; close the terminal and it
dies. First run asks you to trust a host key — type `yes`.

### Permanent

Push to GitHub, then either:

- **Render** — New → Blueprint → pick the repo. `render.yaml` is already here.
- **Any container host** — the `Dockerfile` is ready: `docker build -t hypnic .`

**Attach a disk either way.** Accounts, points and titles live on the
filesystem, so a host with an ephemeral disk wipes everyone's Hypnic ID on each
deploy. `render.yaml` mounts one at `/var/data` and points `DATA_DIR` at it;
the Dockerfile does the same with a volume.

### Before you send it

Set `NODE_ENV=production`. That blocks `/_dev/*` — the device harness and the
phase preview are for you, not for visitors. Everything else is on by default:
gzip, cache headers, `trust proxy` for real client IPs behind a tunnel, a
rate limiter on signup and login (12 IDs and 30 sign-in attempts per IP), and
process-level error handlers so one bad request can't take the studio down
mid-match.

A visitor arriving alone can still play — game cards are badged **Solo OK** or
**Needs 4**, and a lobby below its minimum says how many more people it wants
instead of failing when someone presses Start.

## The Hypnic ID

There is no email login. A new teen answers six questions and the studio derives
an identity from their name, age and answers:

```
Hypnic>ShadowFox<Teen
```

The word in the middle is deterministic — the same person always gets the same
one — and unique across the studio. That ID plus a 4-digit PIN is how they sign
back in on any device. Points, titles and stats follow the ID, not the browser.

Answers also decide their profile colour and their **spirit** (e.g. *Sneaky
Tactician*), shown in the lobby and on the leaderboard.

## What's stored

`data/users.json` — profiles, points, per-game stats, titles, PIN hashes
(scrypt, never plaintext). `data/secret.json` — the session signing key.

Both are created on first run and are git-ignored. Back up `data/` and the whole
studio moves with you. Point `DATA_DIR` elsewhere to override.

## The games

| Game | Players | How it works |
|---|---|---|
| 🎭 **Imposter** | 4+ | Everyone gets the secret word except one player, who gets a decoy. Answer a question about it, then vote on who was faking. |
| 🎲 **Truth or Dare** | 2+ | The app picks a player, they pick their poison, the room decides whether they actually did it. |
| 🤔 **Situations** | 3+ | An impossible scenario. Everyone answers, the room votes for the answer it liked best. |
| ❓ **Quiz** | 1+ | MCQs across movies, cricket, coding, anime, college and general knowledge. Fastest correct takes a bonus. |
| 🔤 **Find the Word** | 1+ | Hints drip in one at a time — guess on the first hint and keep the biggest bonus. Includes unscrambles. |
| 🎬 **Guess the Movie** | 1+ | Emoji, then a dialogue, then a character name. |
| 🎵 **Guess the Song** | 1+ | Emoji, then a lyric, then the film it's from. |
| 📊 **Poll Game** | 3+ | "Who is most likely to…" — anonymous votes, results as percentages. |
| ⚡ **Orb Rush** | 1+ | The original real-time tech demo. |

Scoring is shared: **+10** correct, **+5** fastest, **+20** to the match winner, and
per-round bonuses each game defines (surviving as the imposter, catching one,
guessing before the hints run out). Timers are 30 / 20 / 10 seconds by difficulty.

### What a game can ask the engine for

Every capability is **opt-in and independent** — a game takes what it needs and
the rest never appears in its payload. There are tests that fail if a feature
leaks into a game that didn't ask for it.

| Config | Gives you | Used by |
|---|---|---|
| `mode` | `answer-vote` · `race` · `mcq` · `poll` · `turn` | all |
| `mass: true` | crowd counts + top-10 instead of a player list; flat payload at any size | Quiz, Poll, Clash |
| `teams: 2` (up to 4) | balanced sides, per-team totals, auto-assignment on join | Clash |
| `rounds`, `phases` | how many rounds, how long each phase lasts | all |
| `assignRoles` | per-round secret roles | Imposter |
| `secretFor` | a private card only that player sees | Imposter |
| `scoreRound` | your own scoring rules | Imposter, Clash |
| `revealFor` | your own results screen | most |
| `extra(state)` | **any custom fields you want in the shared payload** | Clash (the rope) |
| `onAction` | intercept an action before the engine handles it | — |

`extra()` is the general escape hatch: return an object and it rides along in
every broadcast, constant-size, without the engine knowing what it means.
Clash uses it for the rope; a different game could use it for a timer, a board,
a boss's health, a shared map — whatever that game needs.

The client renders what it recognises and ignores what it doesn't, so adding a
field never breaks another game.

### Adding a game

Seven of the eight party games are the same loop with a different collection
step, so `server/party.js` owns that loop — phases, timers, submissions, votes,
scoring, and the private-view split. A game module is content plus rules:

```js
export default createPartyGame({
  id: 'my-game', name: 'My Game', emoji: '🎯', mode: 'race',
  buildDeck: () => [{ answer: 'Apple', hints: ['🍎', 'Keeps a doctor away'] }],
});
```

Register it in `server/games/index.js` and it appears on the site, in the lobby,
on the leaderboard and in the titles system. The five modes are `answer-vote`,
`race`, `mcq`, `poll` and `turn`. **No client work is needed** — party games all
share `public/games/_party/client.js`, which renders whatever phase the server
names. Real-time games (like Orb Rush) ship their own renderer instead.

Games that hide information implement `serializeFor(state, playerId)` and the
room sends each player a private view — that's how the imposter's word stays
secret; the shared state never contains it (there's a test for exactly that).

## Sound and effects

**Not one audio file ships with the studio.** Every cue in `public/js/sound.js`
is synthesised at runtime from oscillators and filtered noise through the Web
Audio API. That means nothing to download on college WiFi, nothing to cache, no
licensing, and each sound is a few numbers you can tune instead of an asset you
have to re-record. Pitch even carries meaning — a 3-point orb sounds higher than
a 1-point one, because the cue is built from the value.

Cues cover the whole loop: clicks, someone joining or leaving the lobby, chat,
match start, each phase change, a countdown tick over the last five seconds, a
rising arpeggio for a correct answer, a buzz for a wrong one, the reveal sting,
a sparkle per title unlocked, and win/lose fanfares. Browsers refuse to make
noise before a gesture, so the audio context is created lazily and resumed on
the first tap. The 🔊 button in the header mutes everything, and the choice is
remembered.

`public/js/fx.js` handles the visual side — confetti (on your ID reveal, a
first-place finish, and being first to crack a clue), floating `+10` score
gains, good/bad flashes, shakes, and a pop on a player's chip the moment they
lock something in. **Every effect is decorative**: all of them are suppressed
under `prefers-reduced-motion` and nothing depends on them, so the games stay
fully playable with motion off.

### Looking at a game phase

`public/_dev/party-preview.html` renders every party-game phase side by side
from canned state. The party client takes `Net` as a parameter, so a stub is
enough to drive it — no server, no sockets, and no waiting 60 seconds for a
phase to change. Use it to iterate on one phase in isolation.

## AI Game Master (optional)

Off by default, and strictly additive — the built-in banks are always loaded, so
a laptop with no internet plays a full night unchanged. When enabled it tops the
banks up so a regular group stops seeing the same twenty questions:

```bash
npm install @anthropic-ai/sdk
export ANTHROPIC_API_KEY=...      # or: ant auth login
export AI_GAME_MASTER=1
npm start
```

It runs once a week in the background at startup, never blocks the server, and
caches results to `data/ai-content.json` so material generated once online stays
available offline. Failures are swallowed — a bad key or no network just means
the static banks.

## Look and feel

The studio is the primary entity: the front door is a studio landing page, and
the arcade is one of its wings. Signed-out visitors get the wordmark, the
marquee, the games and the ecosystem; signed-in members get the arcade first.

Styling is three layers, and no layer may reach into another's job:

| File | Owns | Never |
|---|---|---|
| `css/tokens.css` | spacing grid, radii, type scale, motion, **palettes** | components |
| `css/site.css` | every component, built only from tokens | raw colours or durations |
| `css/styles.css` | **style packs** — material overrides | layout |

A **theme** is a palette + a style pack. The palette changes colour; the pack
changes *material* — outline weight, shadow shape, corners, texture, type weight
and how things move. Neither owns layout, so switching either can't break a
screen. 25 themes ship across five packs (`◐` in the header):

- **Modern comic** — the studio default. Built by subtraction: no glow, no
  blur, no gradient fill, no neon, because those four are what make a page look
  generated. Depth is solid offset shadow the way print does it, and the ink is
  warm espresso rather than pure black — pure black is a printer setting, not a
  drawn line. The human part is the imperfection: panels sit a fraction
  off-square, the wordmark carries a misregistered second impression like cheap
  colour printing, and the hero rule is a drawn squiggle, not a straight line.
  On top of that sit real comic devices — halftone dot screens shading the
  corner of every panel, speed lines raking across a card as you reach for it,
  action bursts radiating behind the studio mark and the room code, chat lines
  drawn as speech bubbles with tails, and pills tilted like stickers.
  *Peach Panel* is the default; *Night Panel* is the same ink language
  inverted, for a dark theme that stays warm instead of going neon.
- **Retro comic** — newsprint and halftone dots, heavy uppercase, 3px ink.
- **Cartoon** — the same drawn outline but round and chunky; buttons have a
  bottom lip and physically depress when pressed.
- **Minimal** — clean and dark, high contrast. *Hypnic Signal* lives here:
  deep night with one cold luminous accent, for a studio named after the edge
  of sleep.
- **Hyperreal** — no flat fills. Layered glass with a lit top edge, inner
  shadow at the base, real depth beneath, vignette, and light that sweeps
  across a card as the pointer crosses it.

Packs deliberately avoid exotic font families — a phone on college WiFi has no
internet to fetch them. Character comes from weight, tracking and case, which
every device already has.

Motion follows one rule everywhere: nothing pops in, everything fades with a
breath of upward drift, and `prefers-reduced-motion` turns all of it off.

Adding a pack is a `[data-style='…']` block plus an entry in `theme.js`;
`npm run check` fails the build if a theme names a palette or pack that doesn't
exist.

## Layout

```
server/
  index.js        HTTP + Socket.IO, auth routes, socket handlers
  rooms.js        lobby/room lifecycle - game agnostic
  accounts.js     signup, login, sessions, points, leaderboards
  identity.js     the quiz and Hypnic ID derivation
  titles.js       achievement rules
  store.js        atomic JSON persistence
  games/          one module per game (server-authoritative rules)
public/
  index.html      single-page shell, all views as <template>
  css/tokens.css  design tokens + the skin catalogue (tokens only)
  css/site.css    components, built entirely from those tokens
  js/site.js      router + every view
  js/net.js       socket wrapper
  js/auth.js      membership + session
  js/theme.js     skin catalogue + picker
  js/engine.js    canvas, frame loop, keyboard + touch input, interpolation
  games/<id>/client.js   one renderer per game
  _dev/harness.html      dev-only device harness (see Testing)
tools/
  gen-icons.mjs   PWA icons, zero dependencies
  check-ui.mjs    static wiring check for the shell
  smoke-test.mjs  end-to-end test (membership + a real match)
  seed-demo.mjs   fills a throwaway studio with members and a played match
```

## Adding a game

1. Write `server/games/<id>.js` — the rules, running on the server so nobody can
   cheat. Copy `arena.js` as the template.
2. Register it in `server/games/index.js`.
3. Write `public/games/<id>/client.js` — draws server snapshots, sends input.

It then appears on the site, in the lobby, on the leaderboard and in the
`Explorer` title automatically. Set `tickRate: 0` for turn-based games; state is
pushed after every action instead of on a clock.

## Testing

```bash
npm run check                                          # static, instant

DATA_DIR=./tmp-test PORT=3100 node server/index.js     # throwaway studio
URL=http://localhost:3100 npm run smoke
```

`check` cross-references the shell: every id the JS looks up must exist in a
template, every template the router renders must exist, every asset the HTML
references must be on disk, every CSS custom property must be declared, and
every skin in `theme.js` must have a block in `tokens.css`.

`smoke` covers the quiz, ID minting, login (wrong PIN, forged tokens), a full
two-player match, anti-cheat clamping, points, titles and leaderboards. It takes
~70s because it plays a real 60-second round.

To look at the signed-in screens, seed the throwaway studio and open the dev
harness with the token it prints:

```bash
URL=http://localhost:3100 npm run seed
# → /_dev/harness.html?r=%23/profile&w=412&token=<token>
```

The harness renders the site at a chosen width inside a fixed iframe and reports
any box that escapes the viewport. Use it rather than resizing a real window:
Chrome clamps window widths to about 500px, so a phone-width screenshot is
otherwise just a crop of a wider layout — which makes correct pages look broken.

## Install on Android

Chrome → menu → **Add to Home screen**. It launches fullscreen like a native app
and the shell works offline (games still need the server).
