// The card room.
//
// Traditional games, no chips. Everything here is played for points the same
// way the party games are, so a good night at Hearts moves your rank and a bad
// one costs you nothing you had to buy.

import { cheat } from './cheat.js';
import { snap } from './snap.js';
import { gofish } from './gofish.js';
import { hearts } from './hearts.js';

export const CARD_GAMES = [cheat, snap, gofish, hearts];
