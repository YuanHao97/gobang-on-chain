import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";
import { validateActivation, validateMove } from "../src/relay.mjs";
import { createVercelRelayHandler } from "../api/relay.mjs";

function mockResponse() {
  return {
    headers: {},
    statusCode: 200,
    payload: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; },
    end() { return this; }
  };
}

function validInput() {
  const player = Wallet.createRandom();
  const session = Wallet.createRandom();
  const now = Math.floor(Date.now() / 1000);
  return {
    activation: {
      player: player.address,
      sessionKey: session.address,
      expiresAt: String(now + 3600),
      nonce: "0",
      signature: `0x${"11".repeat(65)}`
    },
    move: {
      matchId: "1",
      x: 7,
      y: 8,
      player: player.address,
      signatureDeadline: String(now + 60),
      signature: `0x${"22".repeat(65)}`
    }
  };
}

test("validates bounded relay payloads", () => {
  const input = validInput();
  assert.equal(validateActivation(input.activation).nonce, 0n);
  assert.equal(validateMove(input.move).x, 7);
  assert.throws(() => validateMove({ ...input.move, x: 15 }), /0 to 14/);
});

test("serves an approved relay request with CORS", async () => {
  const input = validInput();
  const handler = createVercelRelayHandler({
    getRelayer: async () => ({
      activate: async (body) => {
        assert.equal(body.player, input.activation.player);
        return { transactionHash: "0x1234" };
      }
    })
  });
  const response = mockResponse();
  await handler({
    method: "POST",
    query: { operation: "activate" },
    headers: { origin: "https://yuanhao97.github.io", "x-forwarded-for": "relay-test" },
    body: input.activation
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.transactionHash, "0x1234");
  assert.equal(response.headers["Access-Control-Allow-Origin"], "https://yuanhao97.github.io");
});

