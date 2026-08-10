// The board room.
//
// Boards, pieces and turns. Nothing is staked and nothing is hidden — which
// makes the server's job simpler and more important at once: with no secrets to
// protect, the only thing standing between a player and an illegal move is that
// the server refuses it.

import { thayam } from './thayam.js';
import { paramapadham } from './paramapadham.js';
import { ludo } from './ludo.js';
import { chess } from './chess.js';
import { shogi } from './shogi.js';
import { mahjong } from './mahjong.js';

export const BOARD_GAMES = [thayam, paramapadham, ludo, chess, shogi, mahjong];
