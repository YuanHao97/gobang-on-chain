import assert from "node:assert/strict";
import test from "node:test";
import healthHandler from "../api/health.mjs";
import { createVercelRecommendationHandler } from "../api/recommend.mjs";

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

test("serves Vercel health responses", () => {
  const previousRpc = process.env.SEPOLIA_RPC_URL;
  const previousKey = process.env.RELAYER_PRIVATE_KEY;
  const previousGame = process.env.GAME_MANAGER_ADDRESS;
  process.env.SEPOLIA_RPC_URL = "https://rpc.example";
  process.env.RELAYER_PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  process.env.GAME_MANAGER_ADDRESS = "0x42B9B91bbFaA6c48A91592B0730722DAc05f1Fd1";
  const response = mockResponse();
  try {
    healthHandler({ method: "GET", headers: { origin: "https://yuanhao97.github.io" } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.ok, true);
    assert.equal(response.payload.robotAddress, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    assert.equal(response.headers["Access-Control-Allow-Origin"], "https://yuanhao97.github.io");
  } finally {
    if (previousRpc === undefined) delete process.env.SEPOLIA_RPC_URL;
    else process.env.SEPOLIA_RPC_URL = previousRpc;
    if (previousKey === undefined) delete process.env.RELAYER_PRIVATE_KEY;
    else process.env.RELAYER_PRIVATE_KEY = previousKey;
    if (previousGame === undefined) delete process.env.GAME_MANAGER_ADDRESS;
    else process.env.GAME_MANAGER_ADDRESS = previousGame;
  }
});

test("serves Vercel recommendation responses with approved CORS", async () => {
  const handler = createVercelRecommendationHandler({
    recommend: async () => ({ x: 7, y: 7, reason: "Center control.", confidence: 0.7 }),
    allowedOrigins: new Set(["https://yuanhao97.github.io"])
  });
  const request = {
    method: "POST",
    headers: { origin: "https://yuanhao97.github.io", "x-forwarded-for": "127.0.0.1" },
    body: { board: Array(225).fill(0), boardSize: 15, playerStone: 1 }
  };
  const response = mockResponse();

  await handler(request, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.x, 7);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "https://yuanhao97.github.io");
});

test("reports Base relay configuration separately from the legacy Ethereum deployment", () => {
  const values = {
    RELAY_CHAIN_ID: "11155111",
    SEPOLIA_RPC_URL: "https://ethereum.example",
    GAME_MANAGER_ADDRESS: "0x42B9B91bbFaA6c48A91592B0730722DAc05f1Fd1",
    RELAYER_PRIVATE_KEY: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
    BASE_SEPOLIA_GAME_MANAGER_ADDRESS: "0x1111111111111111111111111111111111111111"
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    for (const [chainId, contract] of [[84532, values.BASE_SEPOLIA_GAME_MANAGER_ADDRESS], [11155111, values.GAME_MANAGER_ADDRESS]]) {
      const response = mockResponse();
      healthHandler({ method: "GET", headers: { origin: "https://yuanhao97.github.io" }, query: { chainId } }, response);
      assert.equal(response.payload.relayerConfigured, true);
      assert.equal(response.payload.relayChainId, chainId);
      assert.equal(response.payload.gameManagerAddress, contract);
    }
    const response = mockResponse();
    healthHandler({ method: "GET", headers: { origin: "https://yuanhao97.github.io" }, query: { chainId: 1 } }, response);
    assert.equal(response.statusCode, 400);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("rejects unapproved Vercel browser origins", async () => {
  const handler = createVercelRecommendationHandler({
    recommend: async () => ({}),
    allowedOrigins: new Set(["https://yuanhao97.github.io"])
  });
  const response = mockResponse();

  await handler({ method: "POST", headers: { origin: "https://untrusted.example" }, body: {} }, response);
  assert.equal(response.statusCode, 403);
});

test("normalizes configured origins that include a path", async () => {
  const previousOrigins = process.env.AI_ALLOWED_ORIGINS;
  process.env.AI_ALLOWED_ORIGINS = "https://yuanhao97.github.io/gobang-on-chain/";
  try {
    const response = mockResponse();
    await createVercelRecommendationHandler({
      recommend: async () => ({ x: 7 }),
      allowedOrigins: undefined
    })({
      method: "OPTIONS",
      headers: { origin: "https://yuanhao97.github.io" }
    }, response);
    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["Access-Control-Allow-Origin"], "https://yuanhao97.github.io");
    assert.equal(response.headers.Vary, "Origin");
  } finally {
    if (previousOrigins === undefined) delete process.env.AI_ALLOWED_ORIGINS;
    else process.env.AI_ALLOWED_ORIGINS = previousOrigins;
  }
});
