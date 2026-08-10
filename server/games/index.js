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
import roulette from './roulette.js';
import holdem from './holdem.js';
import blackjack from './blackjack.js';
import lottery from './lottery.js';
import { slots, plinko, wheel, scratch } from './chance.js';
import { SHOWDOWN_GAMES } from './showdowns.js';
import { POOL_GAMES } from './craps.js';
import { DRAW_GAMES } from './draws.js';
import { SPORT_GAMES } from './sports.js';
import { CARD_GAMES } from './cards/index.js';

const modules = [clash, imposter, truthDare, situations, quiz, findWord, movies, songs, poll, standoff, crossword, arena, battleship, roulette, holdem, blackjack, lottery, slots, plinko, wheel, scratch, ...SHOWDOWN_GAMES, ...POOL_GAMES, ...DRAW_GAMES, ...SPORT_GAMES, ...CARD_GAMES];

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
    /**
     * Which face a shared renderer should wear.
     *
     * Slots, plinko, the wheel and scratch cards are one game in four
     * costumes and share a client. Without this the client had nothing to
     * tell them apart and drew all four as slots — plinko with three reels
     * instead of a board, the wheel with no wedge at all.
     */
    machine: g.machine ?? null,
    /**
     * The same for the shared pool renderer: craps and the horses use one
     * screen and it has to know which. Without it every pool table drew the
     * craps dice, so the horses ran an invisible race behind two dice.
     */
    pool: g.pool ?? null,
    /**
     * And the same again for the card room, which shares one renderer across
     * every game in it. Twice now a shared client has been given no way to
     * tell its games apart and has drawn all of them as the first one, so this
     * is added at the same time as the client rather than after the bug.
     */
    face: g.face ?? null,
    /** Whether this table is played for chips, so the lobby can say so. */
    stakes: g.stakes ?? null,
    /**
     * Which room of the studio this belongs in.
     *
     * One flat grid was right at a dozen games and stopped being right at
     * thirty: a shelf where Blackjack, Bingo and Go Fish sit in the same
     * undifferentiated pile is a shelf nobody reads to the bottom of. Anything
     * played for chips is the casino by definition, so that one is derived
     * rather than declared and cannot drift out of step with `stakes`.
     */
    room: g.stakes === 'chips' ? 'casino' : (g.room ?? 'party'),
    /**
     * How to play it, in the catalogue rather than only inside a running match.
     *
     * Somebody deciding whether to open a game they have never heard of wants
     * to know what it is first, and somebody who has just been dropped into
     * one wants to know before the clock starts. Both need it before the game
     * module is anywhere near being loaded.
     */
    howToPlay: g.howToPlay ?? [],
  }));
}
