// The board room.
//
// Boards, pieces and turns. Nothing is staked and nothing is hidden — which
// makes the server's job simpler and more important at once: with no secrets to
// protect, the only thing standing between a player and an illegal move is that
// the server refuses it.

import { thayam } from './thayam.js';
import { paramapadham } from './paramapadham.js';

export const BOARD_GAMES = [thayam, paramapadham];
