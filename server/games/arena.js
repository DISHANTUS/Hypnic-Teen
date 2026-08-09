// Orb Rush - the platform's smoke-test game.
// It is deliberately simple, but it exercises everything a real-time game needs:
// server-authoritative movement, spawning, scoring, join/leave mid-match and a
// timed finish. Keep it as the reference when adding new real-time games.

const WORLD = { w: 1000, h: 600 };
const PLAYER_RADIUS = 18;
const ORB_RADIUS = 12;
const SPEED = 260; // world units per second
const ORB_COUNT = 6;
const ROUND_SECONDS = 60;

const COLORS = ['#ff5c8a', '#4ad6ff', '#ffd166', '#8affc1', '#c084fc', '#ff9f45', '#7c5cff', '#3ddc97'];

function spawnPlayer(player, index) {
  const angle = (index / 8) * Math.PI * 2;
  return {
    id: player.id,
    name: player.name,
    color: COLORS[index % COLORS.length],
    x: WORLD.w / 2 + Math.cos(angle) * 200,
    y: WORLD.h / 2 + Math.sin(angle) * 150,
    dx: 0,
    dy: 0,
    score: 0,
    alive: true,
  };
}

function randomOrb(id) {
  return {
    id,
    x: ORB_RADIUS * 2 + Math.random() * (WORLD.w - ORB_RADIUS * 4),
    y: ORB_RADIUS * 2 + Math.random() * (WORLD.h - ORB_RADIUS * 4),
    value: Math.random() < 0.15 ? 3 : 1,
  };
}

export default {
  id: 'orb-rush',
  name: 'Orb Rush',
  tagline: 'Grab the glowing orbs before your friends do. 60 seconds, no mercy.',
  emoji: '⚡',
  accent: '#4ad6ff',
  minPlayers: 1,
  maxPlayers: 8,
  tickRate: 20,

  // The only game on the site that had none. Everything else explains itself
  // before it starts, and the one that does not is the one somebody joins and
  // spends the first twenty of its sixty seconds working out.
  howToPlay: [
    'Steer with the arrow keys, or drag your thumb anywhere on the screen.',
    'Touch a glowing orb to collect it. The bigger ones are worth more.',
    'Sixty seconds, everybody in the same arena, and no way to stop anybody else.',
    'Most collected when the clock runs out wins it.',
  ],
  // A racer steers constantly; the default CPU pause would be a crash course.
  botPause: 120,

  createState(players) {
    return {
      world: WORLD,
      players: players.map(spawnPlayer),
      orbs: Array.from({ length: ORB_COUNT }, (_, i) => randomOrb(i)),
      nextOrbId: ORB_COUNT,
      timeLeft: ROUND_SECONDS,
    };
  },

  onPlayerJoin(state, player) {
    if (state.players.some((p) => p.id === player.id)) {
      const p = state.players.find((x) => x.id === player.id);
      p.alive = true;
      return;
    }
    state.players.push(spawnPlayer(player, state.players.length));
  },

  onPlayerLeave(state, player) {
    const p = state.players.find((x) => x.id === player.id);
    if (p) p.alive = false;
  },

  onAction(state, player, action) {
    if (action?.type !== 'move') return;
    const p = state.players.find((x) => x.id === player.id);
    if (!p || !p.alive) return;
    // Clamp the client's input vector - never trust the magnitude it sends.
    const dx = Number(action.dx) || 0;
    const dy = Number(action.dy) || 0;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      p.dx = dx / len;
      p.dy = dy / len;
    } else {
      p.dx = dx;
      p.dy = dy;
    }
  },

  /** A CPU racer: head for the best orb, valuing the big ones over the near ones. */
  botAction(state, bot) {
    const me = state.players.find((p) => p.id === bot.id);
    if (!me?.alive || !state.orbs.length) return null;
    let best = null;
    let bestCost = Infinity;
    for (const orb of state.orbs) {
      const cost = Math.hypot(orb.x - me.x, orb.y - me.y) / (orb.value > 1 ? 2.2 : 1);
      if (cost < bestCost) {
        bestCost = cost;
        best = orb;
      }
    }
    if (!best) return null;
    const dx = best.x - me.x;
    const dy = best.y - me.y;
    const len = Math.hypot(dx, dy) || 1;
    return { type: 'move', dx: dx / len, dy: dy / len };
  },

  onTick(state, dt) {
    state.timeLeft = Math.max(0, state.timeLeft - dt);

    for (const p of state.players) {
      if (!p.alive) continue;
      p.x = Math.min(WORLD.w - PLAYER_RADIUS, Math.max(PLAYER_RADIUS, p.x + p.dx * SPEED * dt));
      p.y = Math.min(WORLD.h - PLAYER_RADIUS, Math.max(PLAYER_RADIUS, p.y + p.dy * SPEED * dt));

      for (const orb of state.orbs) {
        if (Math.hypot(p.x - orb.x, p.y - orb.y) < PLAYER_RADIUS + ORB_RADIUS) {
          p.score += orb.value;
          Object.assign(orb, randomOrb(state.nextOrbId++));
        }
      }
    }
  },

  isOver(state) {
    return state.timeLeft <= 0;
  },

  results(state) {
    return [...state.players]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ playerId: p.id, name: p.name, score: p.score, place: i + 1 }));
  },

  serialize(state) {
    return {
      world: state.world,
      timeLeft: Math.ceil(state.timeLeft),
      players: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        x: Math.round(p.x),
        y: Math.round(p.y),
        score: p.score,
        alive: p.alive,
      })),
      orbs: state.orbs.map((o) => ({ id: o.id, x: Math.round(o.x), y: Math.round(o.y), value: o.value })),
    };
  },
};
