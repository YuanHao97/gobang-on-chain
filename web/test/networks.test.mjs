import assert from "node:assert/strict";
import test from "node:test";
import { loadNetworkDeployment, switchWalletNetwork } from "../src/networks.js";

test("adds a missing Base Sepolia network before switching to it", async () => {
  const calls = [];
  await switchWalletNetwork({ request: async (request) => {
    calls.push(request);
    if (calls.length === 1) throw Object.assign(new Error("Unknown chain"), { code: 4902 });
  } }, 84532);
  assert.deepEqual(calls.map((call) => call.method), ["wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain"]);
  assert.equal(calls[1].params[0].chainId, "0x14a34");
  assert.deepEqual(calls[1].params[0].rpcUrls, ["https://sepolia.base.org"]);
});

test("propagates a rejected wallet switch without attempting to add a network", async () => {
  const calls = [];
  await assert.rejects(switchWalletNetwork({ request: async (request) => {
    calls.push(request);
    throw Object.assign(new Error("User rejected"), { code: 4001 });
  } }, 11155111), /User rejected/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[0].chainId, "0xaa36a7");
});

test("loads network-specific deployments and rejects a mismatched chain", async () => {
  for (const [chainId, file] of [[11155111, "sepolia"], [84532, "baseSepolia"]]) {
    const deployment = await loadNetworkDeployment(chainId, "/gobang-on-chain/", async (url) => {
      assert.equal(url, `/gobang-on-chain/deployments/${file}.json`);
      return { ok: true, json: async () => ({ chainId }) };
    });
    assert.equal(deployment.chainId, chainId);
  }
  await assert.rejects(loadNetworkDeployment(84532, "/", async () => ({
    ok: true, json: async () => ({ chainId: 11155111 })
  })), /does not match/);
});
