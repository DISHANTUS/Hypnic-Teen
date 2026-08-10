// The card room.
//
// Traditional games, no chips. Everything here is played for points the same
// way the party games are, so a good night at Hearts moves your rank and a bad
// one costs you nothing you had to buy.

import { cheat } from './cheat.js';
import { snap, slapjack, war } from './flip.js';
import { gofish } from './gofish.js';
import { hearts } from './hearts.js';
import { crazy8s, switchGame } from './crazy8s.js';
import { president } from './president.js';
import { sevens } from './sevens.js';
import { speed } from './speed.js';
import { oldmaid } from './oldmaid.js';
import { memory } from './memory.js';
import { spoons } from './spoons.js';
import { TRICK_GAMES } from './tricks.js';

export const CARD_GAMES = [
  cheat, snap, slapjack, gofish, hearts, war,
  crazy8s, switchGame, president, sevens, speed,
  oldmaid, memory, spoons,
  ...TRICK_GAMES,
];
