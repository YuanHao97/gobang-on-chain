const fs = require("fs");
const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");
const { Contract, JsonRpcProvider, NonceManager, Wallet } = require("ethers");

const PORT = 8787;
const RPC_URL = "http://127.0.0.1:8545";
// This publicly known Hardhat key is for localhost development only. Never use it outside a local chain.
const COMPUTER_PRIVATE_KEY = process.env.LOCAL_COMPUTER_PRIVATE_KEY
  || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const RELAYER_PRIVATE_KEY = process.env.LOCAL_RELAYER_PRIVATE_KEY
  || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const deploymentPath = path.join(__dirname, "..", "web", "public", "contracts.json");
const chessPieceArtifactPath = path.join(__dirname, "..", "artifacts", "contracts", "ChessPieceNFT.sol", "ChessPieceNFT.json");
const gameArtifactPath = path.join(__dirname, "..", "artifacts", "contracts", "GameManager.sol", "GameManager.json");

let computerPieceId;
const provider = new JsonRpcProvider(RPC_URL);
const computerWallet = new Wallet(COMPUTER_PRIVATE_KEY, provider);
const computerSigner = new NonceManager(computerWallet);
const relayerSigner = new NonceManager(new Wallet(RELAYER_PRIVATE_KEY, provider));

function readDeployment() {
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  if (!deployment.chessPieceNFT || !deployment.gameManager) {
    throw new Error("Contracts are not deployed. Run npm run deploy:local first.");
  }
  return deployment;
}

function contracts() {
  const deployment = readDeployment();
  const chessPieceArtifact = JSON.parse(fs.readFileSync(chessPieceArtifactPath, "utf8"));
  const gameArtifact = JSON.parse(fs.readFileSync(gameArtifactPath, "utf8"));
  return {
    deployment,
    wallet: computerSigner,
    chessPiece: new Contract(deployment.chessPieceNFT, chessPieceArtifact.abi, computerSigner),
    game: new Contract(deployment.gameManager, gameArtifact.abi, computerSigner),
    relayGame: new Contract(deployment.gameManager, gameArtifact.abi, relayerSigner)
  };
}

async function ensureComputerPiece() {
  const { deployment, wallet, chessPiece } = contracts();
  if (computerPieceId !== undefined) {
    const owner = await chessPiece.ownerOf(computerPieceId);
    if (owner.toLowerCase() === (await wallet.getAddress()).toLowerCase()) return computerPieceId;
  }

  const computerAddress = await wallet.getAddress();
  const filter = chessPiece.filters.ChessPieceCreated(null, computerAddress);
  const events = await chessPiece.queryFilter(filter, deployment.deploymentBlock || 0, "latest");
  for (const event of [...events].reverse()) {
    const pieceId = event.args.pieceId;
    if ((await chessPiece.ownerOf(pieceId)).toLowerCase() === computerAddress.toLowerCase()) {
      computerPieceId = pieceId;
      return computerPieceId;
    }
  }

  const metadata = Buffer.from(JSON.stringify({
    name: "Local Computer",
    description: "A local Hardhat computer opponent.",
    attributes: [
      { trait_type: "Role", value: "Computer" },
      { trait_type: "Style", value: "Orbit" },
      { trait_type: "Palette", value: "Ocean" }
    ]
  })).toString("base64");
  const transaction = await chessPiece.mint("Local Computer", `data:application/json;base64,${metadata}`);
  const receipt = await transaction.wait();
  const event = receipt.logs.map((log) => {
    try { return chessPiece.interface.parseLog(log); } catch { return null; }
  }).find((parsed) => parsed?.name === "ChessPieceCreated");
  computerPieceId = event.args.pieceId;
  return computerPieceId;
}

async function joinMatch(matchId) {
  const { game } = contracts();
  const match = await game.getMatch(matchId);
  if (Number(match.status) !== 0) throw new Error("The match is no longer open.");
  const pieceId = await ensureComputerPiece();
  const transaction = await game.joinMatch(matchId, pieceId);
  const receipt = await transaction.wait();
  return { transactionHash: receipt.hash, computerPieceId: pieceId.toString() };
}

async function playMove(matchId) {
  const { game, wallet } = contracts();
  const match = await game.getMatch(matchId);
  if (Number(match.status) !== 1) throw new Error("The match is not active.");
  if (match.currentPlayer.toLowerCase() !== (await wallet.getAddress()).toLowerCase()) {
    return { skipped: true, reason: "It is not the computer's turn." };
  }

  const { chooseComputerMove } = await import(pathToFileURL(path.join(__dirname, "..", "web", "src", "soloGame.js")).href);
  const boardSize = Number(match.boardSize);
  const cells = await Promise.all(Array.from({ length: boardSize * boardSize }, async (_, index) => {
    const x = index % boardSize;
    const y = Math.floor(index / boardSize);
    return Number(await game.getCell(matchId, x, y));
  }));
  const index = chooseComputerMove(cells);
  if (index === null) return { skipped: true, reason: "The board is full." };
  const transaction = await game.playMove(matchId, index % boardSize, Math.floor(index / boardSize));
  const receipt = await transaction.wait();
  return { transactionHash: receipt.hash, index };
}

async function activateSessionKey(body) {
  const { relayGame } = contracts();
  const transaction = await relayGame.activateSessionKey(
    body.player, body.sessionKey, body.expiresAt, body.nonce, body.signature
  );
  const receipt = await transaction.wait();
  return { transactionHash: receipt.hash };
}

async function relaySessionMove(body) {
  const { relayGame } = contracts();
  const transaction = await relayGame.playMoveWithSession(
    body.matchId, body.x, body.y, body.player, body.signatureDeadline, body.signature
  );
  const receipt = await transaction.wait();
  return { transactionHash: receipt.hash };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "http://127.0.0.1:5173",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify(payload));
}

async function parseBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") return sendJson(response, 204, {});
  if (request.method !== "POST") return sendJson(response, 405, { error: "Only POST requests are supported." });

  try {
    const body = await parseBody(request);
    if (request.url === "/join") {
      if (!body.matchId) throw new Error("matchId is required.");
      return sendJson(response, 200, await joinMatch(body.matchId));
    }
    if (request.url === "/move") {
      if (!body.matchId) throw new Error("matchId is required.");
      return sendJson(response, 200, await playMove(body.matchId));
    }
    if (request.url === "/relay/activate") return sendJson(response, 200, await activateSessionKey(body));
    if (request.url === "/relay/move") return sendJson(response, 200, await relaySessionMove(body));
    return sendJson(response, 404, { error: "Unknown endpoint." });
  } catch (error) {
    return sendJson(response, 400, { error: error.shortMessage || error.message || "Computer request failed." });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local computer is ready at http://127.0.0.1:${PORT}`);
});
