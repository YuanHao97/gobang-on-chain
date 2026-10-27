import assert from "node:assert/strict";
import test from "node:test";
import { relayNetworkConfig, relayOptionsForChain } from "../src/relayConfig.mjs";

test("adding Base does not change legacy Sepolia defaults", () => {
  const env = { SEPOLIA_RPC_URL: "https://ethereum.example", BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org" };
  assert.deepEqual(relayNetworkConfig(env), { rpcUrl: "https://ethereum.example", chainId: 11155111 });
  assert.deepEqual(relayNetworkConfig({ ...env, RELAY_CHAIN_ID: "84532" }), {
    rpcUrl: "https://sepolia.base.org", chainId: 84532
  });
});

test("honors explicit RPC and chain overrides", () => {
  assert.deepEqual(relayNetworkConfig({
    RELAY_RPC_URL: "https://custom-base.example",
    RELAY_CHAIN_ID: "84532"
  }), { rpcUrl: "https://custom-base.example", chainId: 84532 });
});

test("selects each chain's contracts and computer NFT without leaking the legacy NFT into Base", () => {
  const env = {
    SEPOLIA_RPC_URL: "https://ethereum.example", GAME_MANAGER_ADDRESS: "old-game",
    RELAYER_PRIVATE_KEY: "test-key", ROBOT_PIECE_ID: "12",
    BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org", BASE_SEPOLIA_GAME_MANAGER_ADDRESS: "base-game"
  };
  const ethereum = relayOptionsForChain(11155111, env);
  const base = relayOptionsForChain(84532, env);
  assert.equal(ethereum.gameManagerAddress, "old-game");
  assert.equal(ethereum.computerPieceId, "12");
  assert.equal(base.gameManagerAddress, "base-game");
  assert.equal(base.computerPieceId, "");
  assert.equal(base.rpcUrl, "https://sepolia.base.org");
  assert.equal(base.privateKey, "test-key");
  assert.throws(() => relayOptionsForChain(1, env), /Unsupported/);
});
