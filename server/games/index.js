// Game registry. Add one module per game here and it shows up on the site,
// in the lobby, on the leaderboard and in the titles system automatically.
//
// Most games are built with createPartyGame() from ../party.js — a game module
// there is just content plus rules. See server/party.js for the modes.
// Real-time games (server/games/arena.js) implement the raw interface instead:
//
//   export default {
//     id, name, tagline, emoji, minPlayers, maxPlayers,
//     tickRate,                       // 0 = turn-based (state pushed on each action)
//     createState(players, ctx),      // build the authoritative state
//     onAction(state, player, action, api),
//     onTick(state, dt, api),         // only if tickRate > 0
//     onPlayerJoin(state, player),    // optional, join mid-match
//     onPlayerLeave(state, player),   // optional
//     isOver(state),
//     results(state),                 // [{ playerId, name, score, place }]
//     serialize(state),               // shared view
//     serializeFor(state, playerId),  // optional private view per player
//   }

import clash from './clash.js';
import imposter from './imposter.js';
import truthDare from './truth-dare.js';
import situations from './situations.js';
import findWord from './find-word.js';
import quiz from './quiz.js';
import poll from './poll.js';
import movies from './movies.js';
import songs from './songs.js';
import arena from './arena.js';
import battleship from './battleship.js';
import standoff from './standoff.js';
import crossword from './crossword.js';

const modules = [clash, imposter, truthDare, situations, quiz, findWord, movies, songs, poll, standoff, crossword, arena, battleship];

const registry = new Map(modules.map((g) => [g.id, g]));

export function getGame(id) {
  return registry.get(id) ?? null;
}

/** Catalogue for the website's game grid. */
export function listGames() {
  return modules.map((g) => ({
    id: g.id,
    name: g.name,
    tagline: g.tagline ?? '',
    emoji: g.emoji ?? '🎮',
    minPlayers: g.minPlayers,
    maxPlayers: g.maxPlayers,
    accent: g.accent ?? '#7c5cff',
    status: g.status ?? 'ready',
    // What a host can tune. The lobby learns this from the room it is in, but
    // a tournament is set up before any room exists, so the organiser needs
    // the knobs from the catalogue.
    options: g.options ?? null,
    /**
     * Which renderer draws this game. A module may name one outright; the
     * fallback recognises party games by their tick rate, which is how every
     * game predating the `client` field is still routed to the shared
     * renderer at public/games/_party/client.js.
     */
    client: g.client ?? (g.tickRate === 4 ? '_party' : g.id),
  }));
}
