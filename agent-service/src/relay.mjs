import {
  Contract,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  getAddress,
  getBytes,
  id,
  isAddress,
  solidityPackedKeccak256,
  verifyMessage
} from "ethers";
import { rankCandidateMoves } from "./game.mjs";
import { relayNetworkConfig } from "./relayConfig.mjs";

const GAME_ABI = [
  "function activateSessionKey(address player, address sessionKey, uint64 expiresAt, uint256 nonce, bytes signature)",
  "function playMoveWithSession(uint256 matchId, uint8 x, uint8 y, address player, uint64 signatureDeadline, bytes signature)",
  "function chessPiece() view returns (address)",
  "function joinMatch(uint256 matchId, uint256 pieceId)",
  "function playMove(uint256 matchId, uint8 x, uint8 y)",
  "function getCell(uint256 matchId, uint8 x, uint8 y) view returns (uint8)",
  "function getMatch(uint256 matchId) view returns ((address creator, address joiner, uint256 creatorPieceId, uint256 joinerPieceId, uint8 boardSize, uint16 moveCount, address currentPlayer, uint64 turnDeadline, uint32 turnDuration, uint8 status, uint8 finishReason, address winner))"
];
const PIECE_ABI = [
  "function mint(string displayName, string metadataURI) returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event ChessPieceCreated(uint256 indexed pieceId, address indexed owner, string displayName, string metadataURI)"
];
const MAX_SESSION_SECONDS = 3 * 60 * 60;
const MAX_MOVE_DEADLINE_SECONDS = 5 * 60;
const MAX_COMPUTER_JOIN_DEADLINE_SECONDS = 5 * 60;
const COMPUTER_JOIN_DOMAIN = id("GOBANG_SOLO_JOIN_V1");

function requiredString(value, name) {
  if (!value || typeof value !== "string") throw new Error(`${name} is required.`);
  return value;
}

function addressValue(value, name) {
  if (!isAddress(value || "")) throw new Error(`${name} must be a valid address.`);
  return getAddress(value);
}

function unsignedInteger(value, name) {
  if (!/^\d+$/.test(String(value ?? ""))) throw new Error(`${name} must be an unsigned integer.`);
  return BigInt(value);
}

function signatureValue(value) {
  const signature = requiredString(value, "signature");
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("signature must be a 65-byte hex value.");
  return signature;
}

function ensureNearTermDeadline(value, name, maximumSeconds) {
  const deadline = unsignedInteger(value, name);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now) throw new Error(`${name} has expired.`);
  if (deadline > now + BigInt(maximumSeconds)) throw new Error(`${name} is too far in the future.`);
  return deadline;
}

export function validateActivation(body) {
  return {
    player: addressValue(body?.player, "player"),
    sessionKey: addressValue(body?.sessionKey, "sessionKey"),
    expiresAt: ensureNearTermDeadline(body?.expiresAt, "expiresAt", MAX_SESSION_SECONDS),
    nonce: unsignedInteger(body?.nonce, "nonce"),
    signature: signatureValue(body?.signature)
  };
}

export function validateMove(body) {
  const x = Number(body?.x);
  const y = Number(body?.y);
  if (!Number.isInteger(x) || x < 0 || x >= 15) throw new Error("x must be an integer from 0 to 14.");
  if (!Number.isInteger(y) || y < 0 || y >= 15) throw new Error("y must be an integer from 0 to 14.");
  return {
    matchId: unsignedInteger(body?.matchId, "matchId"),
    x,
    y,
    player: addressValue(body?.player, "player"),
    signatureDeadline: ensureNearTermDeadline(
      body?.signatureDeadline,
      "signatureDeadline",
      MAX_MOVE_DEADLINE_SECONDS
    ),
    signature: signatureValue(body?.signature)
  };
}

function matchIdValue(value) {
  const matchId = unsignedInteger(value, "matchId");
  if (matchId === 0n) throw new Error("matchId must be greater than zero.");
  return matchId;
}

export function computerJoinAuthorization(contractAddress, chainId, matchId, player, authorizationDeadline) {
  return solidityPackedKeccak256(
    ["bytes32", "address", "uint256", "uint256", "address", "uint64"],
    [
      COMPUTER_JOIN_DOMAIN,
      addressValue(contractAddress, "GAME_MANAGER_ADDRESS"),
      BigInt(chainId),
      matchIdValue(matchId),
      addressValue(player, "player"),
      BigInt(authorizationDeadline)
    ]
  );
}

export function validateComputerJoin(body, { contractAddress, chainId }) {
  const input = {
    matchId: matchIdValue(body?.matchId),
    player: addressValue(body?.player, "player"),
    authorizationDeadline: ensureNearTermDeadline(
      body?.authorizationDeadline,
      "authorizationDeadline",
      MAX_COMPUTER_JOIN_DEADLINE_SECONDS
    ),
    signature: signatureValue(body?.signature)
  };
  const authorization = computerJoinAuthorization(
    contractAddress,
    chainId,
    input.matchId,
    input.player,
    input.authorizationDeadline
  );
  const signer = verifyMessage(getBytes(authorization), input.signature);
  if (signer.toLowerCase() !== input.player.toLowerCase()) {
    throw new Error("The computer-match authorization signature is invalid.");
  }
  return input;
}

export function validateComputerMove(body) {
  return { matchId: matchIdValue(body?.matchId) };
}

function computerMetadataURI() {
  const metadata = {
    name: "Gobang Computer",
    description: "The on-chain computer opponent operated by the Gobang relay.",
    attributes: [
      { trait_type: "Role", value: "Computer" },
      { trait_type: "Style", value: "Circuit" },
      { trait_type: "Palette", value: "Ocean" }
    ]
  };
  return `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString("base64")}`;
}

export function createSepoliaRelayer({
  rpcUrl = relayNetworkConfig().rpcUrl,
  privateKey = process.env.RELAYER_PRIVATE_KEY,
  gameManagerAddress = process.env.GAME_MANAGER_ADDRESS,
  chainId = relayNetworkConfig().chainId,
  computerPieceId = process.env.ROBOT_PIECE_ID || ""
} = {}) {
  if (!rpcUrl) throw new Error("The transaction relay is not configured.");
  if (!privateKey) throw new Error("The transaction relay is not configured.");
  const contractAddress = addressValue(gameManagerAddress, "GAME_MANAGER_ADDRESS");
  const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  const wallet = new Wallet(privateKey, provider);
  const signer = new NonceManager(wallet);
  const game = new Contract(contractAddress, GAME_ABI, signer);
  const robotAddress = wallet.address;
  const configuredComputerPieceId = computerPieceId ? unsignedInteger(computerPieceId, "ROBOT_PIECE_ID") : null;
  let computerPiecePromise;

  async function createComputerPiece() {
    const pieceAddress = await game.chessPiece();
    const piece = new Contract(pieceAddress, PIECE_ABI, signer);
    if (configuredComputerPieceId !== null) {
      const owner = await piece.ownerOf(configuredComputerPieceId);
      if (owner.toLowerCase() !== robotAddress.toLowerCase()) {
        throw new Error("ROBOT_PIECE_ID is not owned by the relay account.");
      }
      return { pieceId: configuredComputerPieceId, transactionHash: null };
    }

    const transaction = await piece.mint("Gobang Computer", computerMetadataURI());
    const receipt = await transaction.wait(1);
    const created = receipt.logs.map((log) => {
      try { return piece.interface.parseLog(log); } catch { return null; }
    }).find((event) => event?.name === "ChessPieceCreated");
    if (!created) throw new Error("The computer chess-piece mint event was not found.");
    return { pieceId: created.args.pieceId, transactionHash: receipt.hash };
  }

  async function ensureComputerPiece() {
    computerPiecePromise ||= createComputerPiece();
    try {
      return await computerPiecePromise;
    } catch (error) {
      computerPiecePromise = undefined;
      throw error;
    }
  }

  return {
    chainId,
    robotAddress,
    async activate(body) {
      const input = validateActivation(body);
      await game.activateSessionKey.staticCall(
        input.player,
        input.sessionKey,
        input.expiresAt,
        input.nonce,
        input.signature
      );
      const transaction = await game.activateSessionKey(
        input.player,
        input.sessionKey,
        input.expiresAt,
        input.nonce,
        input.signature
      );
      const receipt = await transaction.wait(1);
      return { transactionHash: receipt.hash };
    },
    async move(body) {
      const input = validateMove(body);
      await game.playMoveWithSession.staticCall(
        input.matchId,
        input.x,
        input.y,
        input.player,
        input.signatureDeadline,
        input.signature
      );
      const transaction = await game.playMoveWithSession(
        input.matchId,
        input.x,
        input.y,
        input.player,
        input.signatureDeadline,
        input.signature
      );
      const receipt = await transaction.wait(1);
      return { transactionHash: receipt.hash };
    },
    async computerJoin(body) {
      const input = validateComputerJoin(body, { contractAddress, chainId });
      const match = await game.getMatch(input.matchId);
      if (Number(match.status) !== 0) throw new Error("The match is no longer open.");
      if (match.creator.toLowerCase() !== input.player.toLowerCase()) {
        throw new Error("Only the match creator can invite the computer.");
      }
      if (match.creator.toLowerCase() === robotAddress.toLowerCase()) {
        throw new Error("The relay account cannot play against itself.");
      }

      const { pieceId } = await ensureComputerPiece();
      await game.joinMatch.staticCall(input.matchId, pieceId);
      const transaction = await game.joinMatch(input.matchId, pieceId);
      const receipt = await transaction.wait(1);
      return {
        transactionHash: receipt.hash,
        computerPieceId: pieceId.toString(),
        robotAddress
      };
    },
    async computerPrepare() {
      const { pieceId, transactionHash } = await ensureComputerPiece();
      return {
        computerPieceId: pieceId.toString(),
        robotAddress,
        created: Boolean(transactionHash),
        transactionHash
      };
    },
    async computerMove(body) {
      const input = validateComputerMove(body);
      const match = await game.getMatch(input.matchId);
      if (Number(match.status) !== 1) {
        return { skipped: true, reason: "The match is no longer active." };
      }
      if (match.joiner.toLowerCase() !== robotAddress.toLowerCase()) {
        throw new Error("This match does not belong to the relay computer.");
      }
      if (match.currentPlayer.toLowerCase() !== robotAddress.toLowerCase()) {
        return { skipped: true, reason: "It is not the computer's turn." };
      }

      const boardSize = Number(match.boardSize);
      const board = await Promise.all(Array.from({ length: boardSize * boardSize }, async (_, index) => {
        const x = index % boardSize;
        const y = Math.floor(index / boardSize);
        return Number(await game.getCell(input.matchId, x, y));
      }));
      const [selectedMove] = rankCandidateMoves({ board, boardSize, playerStone: 2 }, 1);
      await game.playMove.staticCall(input.matchId, selectedMove.x, selectedMove.y);
      const transaction = await game.playMove(input.matchId, selectedMove.x, selectedMove.y);
      const receipt = await transaction.wait(1);
      return {
        transactionHash: receipt.hash,
        x: selectedMove.x,
        y: selectedMove.y,
        index: selectedMove.y * boardSize + selectedMove.x,
        robotAddress
      };
    }
  };
}

