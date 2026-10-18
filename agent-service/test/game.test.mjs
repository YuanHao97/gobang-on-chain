import assert from "node:assert/strict";
import test from "node:test";
import { rankCandidateMoves, validateRecommendationRequest } from "../src/game.mjs";

function emptyBoard() {
  return Array(225).fill(0);
}

test("recommends the center on an empty board", () => {
  const [move] = rankCandidateMoves({ board: emptyBoard(), boardSize: 15, playerStone: 1 });
  assert.deepEqual({ x: move.x, y: move.y }, { x: 7, y: 7 });
});

test("ranks an immediate winning move first", () => {
  const board = emptyBoard();
  [3, 4, 5, 6].forEach((x) => { board[7 * 15 + x] = 1; });
  const [move] = rankCandidateMoves({ board, boardSize: 15, playerStone: 1 });
  assert.equal(move.y, 7);
  assert.ok(move.x === 2 || move.x === 7);
  assert.equal(move.reason, "Wins immediately.");
});

test("ranks a required block ahead of ordinary development", () => {
  const board = emptyBoard();
  [3, 4, 5, 6].forEach((x) => { board[7 * 15 + x] = 2; });
  const [move] = rankCandidateMoves({ board, boardSize: 15, playerStone: 1 });
  assert.equal(move.y, 7);
  assert.ok(move.x === 2 || move.x === 7);
  assert.equal(move.reason, "Blocks an immediate loss.");
});

test("rejects malformed or full boards", () => {
  assert.throws(
    () => validateRecommendationRequest({ board: [0], boardSize: 15, playerStone: 1 }),
    /225 cells/
  );
  assert.throws(
    () => validateRecommendationRequest({ board: Array(225).fill(1), boardSize: 15, playerStone: 1 }),
    /no legal moves/
  );
});
