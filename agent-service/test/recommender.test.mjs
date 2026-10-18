import assert from "node:assert/strict";
import test from "node:test";
import { createGobangRecommender } from "../src/recommender.mjs";

function boardWithThreat() {
  const board = Array(225).fill(0);
  [3, 4, 5, 6].forEach((x) => { board[7 * 15 + x] = 1; });
  return board;
}

test("registers an AgentKit action and returns a legal structured recommendation", async () => {
  const openaiClient = {
    responses: {
      create: async () => ({
        output_text: JSON.stringify({ x: 7, y: 7, reason: "Complete five in a row.", confidence: 0.99 })
      })
    }
  };
  const recommend = await createGobangRecommender({ openaiClient, model: "test-model" });
  const result = await recommend({ board: boardWithThreat(), boardSize: 15, playerStone: 1 });

  assert.deepEqual(result, {
    x: 7,
    y: 7,
    reason: "Complete five in a row.",
    confidence: 0.99,
    model: "test-model",
    source: "coinbase-agentkit"
  });
});

test("replaces an illegal model suggestion with a legal tactical fallback", async () => {
  const openaiClient = {
    responses: {
      create: async () => ({
        output_text: JSON.stringify({ x: 3, y: 7, reason: "Use this occupied cell.", confidence: 0.8 })
      })
    }
  };
  const recommend = await createGobangRecommender({ openaiClient, model: "test-model" });
  const board = boardWithThreat();
  const result = await recommend({ board, boardSize: 15, playerStone: 1 });

  assert.equal(board[result.y * 15 + result.x], 0);
  assert.match(result.reason, /invalid/);
});
