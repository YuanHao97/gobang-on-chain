const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const { Contract, getBytes, JsonRpcProvider, NonceManager, solidityPackedKeccak256, Wallet } = require("ethers");

const HUMAN_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ROOT = path.join(__dirname, "..");
const deployment = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "public", "contracts.json"), "utf8"));
const chessPieceArtifact = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", "contracts", "ChessPieceNFT.sol", "ChessPieceNFT.json"), "utf8"));
const gameArtifact = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", "contracts", "GameManager.sol", "GameManager.json"), "utf8"));

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  const humanWallet = new Wallet(HUMAN_PRIVATE_KEY, provider);
  const human = new NonceManager(humanWallet);
  const chessPiece = new Contract(deployment.chessPieceNFT, chessPieceArtifact.abi, human);
  const game = new Contract(deployment.gameManager, gameArtifact.abi, human);

  const pieceTransaction = await chessPiece.mint("Smoke Test Player", "data:application/json;base64,e30=");
  const pieceReceipt = await pieceTransaction.wait();
  const mintEvent = pieceReceipt.logs.map((log) => {
    try { return chessPiece.interface.parseLog(log); } catch { return null; }
  }).find((event) => event?.name === "ChessPieceCreated");
  const matchId = await game.nextMatchId();
  const createTransaction = await game.createMatch(mintEvent.args.pieceId, 15, 600);
  await createTransaction.wait();

  const joinResponse = await fetch("http://127.0.0.1:8787/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId: matchId.toString() })
  });
  assert.equal(joinResponse.ok, true, await joinResponse.text());

  const latestBlock = await provider.getBlock("latest");
  const network = await provider.getNetwork();
  const sessionWallet = Wallet.createRandom();
  const expiresAt = BigInt(latestBlock.timestamp + 3600);
  const activationNonce = await game.sessionActivationNonces(await human.getAddress());
  const activationHash = solidityPackedKeccak256(
    ["address", "uint256", "address", "address", "uint64", "uint256"],
    [deployment.gameManager, network.chainId, await human.getAddress(), sessionWallet.address, expiresAt, activationNonce]
  );
  const activationSignature = await humanWallet.signMessage(getBytes(activationHash));
  const activationResponse = await fetch("http://127.0.0.1:8787/relay/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      player: await human.getAddress(), sessionKey: sessionWallet.address, expiresAt: expiresAt.toString(),
      nonce: activationNonce.toString(), signature: activationSignature
    })
  });
  assert.equal(activationResponse.ok, true, await activationResponse.text());

  const moveDeadline = BigInt(latestBlock.timestamp + 60);
  const moveHash = solidityPackedKeccak256(
    ["address", "uint256", "uint256", "uint8", "uint8", "address", "uint64"],
    [deployment.gameManager, network.chainId, matchId, 7, 7, await human.getAddress(), moveDeadline]
  );
  const moveSignature = await sessionWallet.signMessage(getBytes(moveHash));
  const playerMoveResponse = await fetch("http://127.0.0.1:8787/relay/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      matchId: matchId.toString(), x: 7, y: 7, player: await human.getAddress(),
      signatureDeadline: moveDeadline.toString(), signature: moveSignature
    })
  });
  assert.equal(playerMoveResponse.ok, true, await playerMoveResponse.text());

  const computerResponse = await fetch("http://127.0.0.1:8787/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId: matchId.toString() })
  });
  assert.equal(computerResponse.ok, true, await computerResponse.text());

  const match = await game.getMatch(matchId);
  assert.equal(Number(match.status), 1);
  assert.equal(match.currentPlayer.toLowerCase(), (await human.getAddress()).toLowerCase());
  assert.equal(Number(match.moveCount), 2);
  console.log(`Local computer smoke test passed for match #${matchId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
