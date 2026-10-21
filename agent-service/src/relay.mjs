import { Contract, JsonRpcProvider, Wallet, getAddress, isAddress } from "ethers";

const GAME_ABI = [
  "function activateSessionKey(address player, address sessionKey, uint64 expiresAt, uint256 nonce, bytes signature)",
  "function playMoveWithSession(uint256 matchId, uint8 x, uint8 y, address player, uint64 signatureDeadline, bytes signature)"
];
const MAX_SESSION_SECONDS = 3 * 60 * 60;
const MAX_MOVE_DEADLINE_SECONDS = 5 * 60;

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

export function createSepoliaRelayer({
  rpcUrl = process.env.SEPOLIA_RPC_URL,
  privateKey = process.env.RELAYER_PRIVATE_KEY,
  gameManagerAddress = process.env.GAME_MANAGER_ADDRESS,
  chainId = Number(process.env.RELAY_CHAIN_ID || 11155111)
} = {}) {
  if (!rpcUrl) throw new Error("The Sepolia relay is not configured.");
  if (!privateKey) throw new Error("The Sepolia relay is not configured.");
  const contractAddress = addressValue(gameManagerAddress, "GAME_MANAGER_ADDRESS");
  const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  const signer = new Wallet(privateKey, provider);
  const game = new Contract(contractAddress, GAME_ABI, signer);

  return {
    chainId,
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
    }
  };
}

