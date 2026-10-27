import assert from "node:assert/strict";
import test from "node:test";
import { Wallet, getBytes } from "ethers";
import {
  computerJoinAuthorization,
  validateActivation,
  validateComputerJoin,
  validateComputerMove,
  validateMove
} from "../src/relay.mjs";
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

for (const chainId of [11155111, 84532]) test(`requires a match-creator signature on chain ${chainId}`, async () => {
  const player = Wallet.createRandom();
  const gameManager = Wallet.createRandom().address;
  const authorizationDeadline = Math.floor(Date.now() / 1000) + 120;
  const authorization = computerJoinAuthorization(
    gameManager,
    chainId,
    7,
    player.address,
    authorizationDeadline
  );
  const signature = await player.signMessage(getBytes(authorization));
  const input = validateComputerJoin({
    matchId: "7",
    player: player.address,
    authorizationDeadline: String(authorizationDeadline),
    signature
  }, { contractAddress: gameManager, chainId });

  assert.equal(input.matchId, 7n);
  assert.equal(input.player, player.address);
  assert.throws(() => validateComputerJoin({
    matchId: "8",
    player: player.address,
    authorizationDeadline: String(authorizationDeadline),
    signature
  }, { contractAddress: gameManager, chainId }), /signature is invalid/);
  assert.throws(() => validateComputerJoin({
    matchId: "7",
    player: player.address,
    authorizationDeadline: String(authorizationDeadline),
    signature
  }, { contractAddress: gameManager, chainId: chainId === 84532 ? 11155111 : 84532 }), /signature is invalid/);
  assert.equal(validateComputerMove({ matchId: "9" }).matchId, 9n);
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

test("routes computer operations through the transaction queue", async () => {
  const handler = createVercelRelayHandler({
    getRelayer: async () => ({
      computerMove: async (body) => ({ transactionHash: "0xabcd", matchId: body.matchId })
    })
  });
  const response = mockResponse();
  await handler({
    method: "POST",
    query: { operation: "computerMove" },
    headers: { origin: "https://yuanhao97.github.io", "x-forwarded-for": "computer-test" },
    body: { matchId: "4" }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.transactionHash, "0xabcd");
  assert.equal(response.payload.matchId, "4");
});

test("routes Base requests to the Base relay and keeps old clients without a chain ID compatible", async () => {
  const requestedChains = [];
  const handler = createVercelRelayHandler({
    getRelayer: async (chainId) => {
      requestedChains.push(chainId);
      return { computerMove: async () => ({ transactionHash: "0xabcd" }) };
    }
  });
  for (const body of [{ chainId: 84532, matchId: "1" }, { matchId: "2" }]) {
    const response = mockResponse();
    await handler({ method: "POST", query: { operation: "computerMove" },
      headers: { origin: "https://yuanhao97.github.io", "x-forwarded-for": "multi-chain-test" }, body }, response);
    assert.equal(response.statusCode, 200);
  }
  assert.deepEqual(requestedChains, [84532, undefined]);
});

test("allows the relay to prepare its reusable computer piece", async () => {
  const handler = createVercelRelayHandler({
    getRelayer: async () => ({
      computerPrepare: async () => ({ computerPieceId: "12", created: true, transactionHash: "0x5678" })
    })
  });
  const response = mockResponse();
  await handler({
    method: "POST",
    query: { operation: "computerPrepare" },
    headers: { origin: "https://yuanhao97.github.io", "x-forwarded-for": "computer-prepare-test" },
    body: {}
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.computerPieceId, "12");
  assert.equal(response.payload.created, true);
});

