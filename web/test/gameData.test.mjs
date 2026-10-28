import assert from "node:assert/strict";
import test from "node:test";
import { loadConfirmedMatch, loadMatchHistory, loadOwnedPieces, mergeMatchHistory } from "../src/gameData.js";

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

test("a confirmed computer move updates the player's turn even when a subsequent RPC refresh is stale", async () => {
  const stale = { ...matchData(1n), status: 1n, moveCount: 1n, currentPlayer: OPPONENT };
  const updated = { ...stale, moveCount: 2n, currentPlayer: PLAYER };
  const game = {
    nextMatchId: async () => 2n,
    getMatch: async (id, overrides) => {
      assert.equal(String(id), "1");
      return overrides.blockTag === 123 ? updated : stale;
    }
  };
  const provider = { getTransactionReceipt: async (hash) => {
    assert.equal(hash, "computer-move-hash");
    return { status: 1, blockNumber: 123 };
  } };
  const confirmed = await loadConfirmedMatch(game, provider, "1", "computer-move-hash");
  const merged = mergeMatchHistory([confirmed], await loadMatchHistory(game));
  assert.equal(merged[0].currentPlayer, PLAYER);
  assert.equal(merged[0].moveCount, 2);
  assert.equal(merged[0].confirmedBlock, 123);
});

test("a winning computer move remains finished after an older active state is returned", async () => {
  const confirmed = await loadConfirmedMatch({ getMatch: async () => ({
    ...matchData(10n), status: 2n, moveCount: 10n, winner: OPPONENT, finishReason: 1n
  }) }, { getTransactionReceipt: async () => ({ status: 1, blockNumber: 123 }) }, "1", "winning-move");
  const [match] = mergeMatchHistory([confirmed], [{ ...confirmed, status: 1, winner: "" }]);
  assert.equal(match.status, 2);
  assert.equal(match.winner, OPPONENT);
});

test("later moves replace the confirmed snapshot instead of keeping its old board block", () => {
  const previous = { id: "1", moveCount: 2, status: 1, currentPlayer: PLAYER, confirmedBlock: 123 };
  const next = { id: "1", moveCount: 3, status: 1, currentPlayer: OPPONENT };
  assert.deepEqual(mergeMatchHistory([previous], [next]), [next]);
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
