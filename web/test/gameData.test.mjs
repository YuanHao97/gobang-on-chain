import assert from "node:assert/strict";
import test from "node:test";
import { loadMatchHistory, loadOwnedPieces } from "../src/gameData.js";

const PLAYER = "0x1111111111111111111111111111111111111111";
const OPPONENT = "0x2222222222222222222222222222222222222222";

function matchData(id) {
  return {
    creator: PLAYER,
    joiner: OPPONENT,
    creatorPieceId: 2n,
    joinerPieceId: 4n,
    boardSize: 15n,
    moveCount: id,
    currentPlayer: PLAYER,
    turnDeadline: 1_793_113_620n,
    status: id === 5n ? 1n : 2n,
    finishReason: id === 5n ? 0n : 4n,
    winner: PLAYER
  };
}

function missingToken() {
  return Object.assign(new Error("Token does not exist."), {
    code: "CALL_EXCEPTION",
    revert: { name: "ERC721NonexistentToken" }
  });
}

test("loads all historical matches from state when historical logs are unavailable", async () => {
  const game = {
    nextMatchId: async () => 6n,
    getMatch: async (id) => matchData(id),
    queryFilter: async () => { throw new Error("pruned history unavailable"); }
  };

  const matches = await loadMatchHistory(game);

  assert.deepEqual(matches.map((match) => match.id), ["5", "4", "3", "2", "1"]);
  assert.equal(matches[0].moveCount, 5);
  assert.equal(matches[0].status, 1);
  assert.equal(matches[4].status, 2);
  assert.equal(matches[0].creatorPieceId, "2");
});

test("returns an empty match history only when no match has been created", async () => {
  const game = {
    nextMatchId: async () => 1n,
    getMatch: async () => { throw new Error("No matches should be read."); }
  };
  assert.deepEqual(await loadMatchHistory(game), []);
});

test("recovers owned and transferred chess pieces without mint-event logs", async () => {
  const piece = {
    balanceOf: async () => 2n,
    ownerOf: async (id) => {
      if (id > 4) throw missingToken();
      return id === 2 || id === 4 ? PLAYER : OPPONENT;
    },
    displayNameOf: async (id) => `Piece ${id}`,
    queryFilter: async () => { throw new Error("pruned history unavailable"); }
  };

  assert.deepEqual(await loadOwnedPieces(piece, PLAYER), [
    { id: "2", name: "Piece 2" },
    { id: "4", name: "Piece 4" }
  ]);
});

test("does not scan token IDs for an account with no chess pieces", async () => {
  const piece = {
    balanceOf: async () => 0n,
    ownerOf: async () => { throw new Error("No tokens should be read."); }
  };
  assert.deepEqual(await loadOwnedPieces(piece, PLAYER), []);
});

test("surfaces RPC failures instead of treating a failed ownership read as an empty wallet", async () => {
  const piece = {
    balanceOf: async () => 1n,
    ownerOf: async () => { throw new Error("RPC request failed."); }
  };
  await assert.rejects(loadOwnedPieces(piece, PLAYER), /RPC request failed/);
});

test("rejects incomplete inventory rather than silently hiding owned chess pieces", async () => {
  const piece = {
    balanceOf: async () => 2n,
    ownerOf: async (id) => {
      if (id > 1) throw missingToken();
      return PLAYER;
    }
  };
  await assert.rejects(loadOwnedPieces(piece, PLAYER), /Unable to load all owned chess pieces/);
});
