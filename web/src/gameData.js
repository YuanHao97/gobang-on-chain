const READ_BATCH_SIZE = 8;

export async function loadMatch(game, id, overrides = {}) {
  const data = await game.getMatch(id, overrides);
  return {
    id: id.toString(), creator: data.creator, joiner: data.joiner,
    creatorPieceId: data.creatorPieceId.toString(), joinerPieceId: data.joinerPieceId.toString(),
    boardSize: Number(data.boardSize), moveCount: Number(data.moveCount),
    currentPlayer: data.currentPlayer, deadline: Number(data.turnDeadline),
    status: Number(data.status), reason: Number(data.finishReason), winner: data.winner
  };
}

export async function loadConfirmedMatch(game, provider, id, transactionHash) {
  const receipt = await provider.getTransactionReceipt(transactionHash)
    || await provider.waitForTransaction(transactionHash, 1, 30_000);
  if (!receipt || Number(receipt.status) !== 1) throw new Error("The computer transaction could not be confirmed.");
  const match = await loadMatch(game, id, { blockTag: receipt.blockNumber });
  return { ...match, confirmedBlock: receipt.blockNumber };
}

export function mergeMatchHistory(current, incoming) {
  const matches = new Map(current.map((match) => [match.id, match]));
  for (const match of incoming) {
    const previous = matches.get(match.id);
    // RPC endpoints can briefly report a state older than an already confirmed move.
    if (previous && (previous.moveCount > match.moveCount || previous.status > match.status)) continue;
    const sameState = previous?.moveCount === match.moveCount && previous?.status === match.status;
    matches.set(match.id, sameState && previous.confirmedBlock && !match.confirmedBlock
      ? { ...match, confirmedBlock: previous.confirmedBlock }
      : match);
  }
  return [...matches.values()].sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0);
}

export async function loadMatchHistory(game) {
  const nextMatchId = BigInt(await game.nextMatchId());
  const matches = [];

  for (let first = 1n; first < nextMatchId; first += BigInt(READ_BATCH_SIZE)) {
    const ids = Array.from({ length: READ_BATCH_SIZE }, (_, offset) => first + BigInt(offset))
      .filter((id) => id < nextMatchId);
    const batch = await Promise.all(ids.map((id) => loadMatch(game, id)));
    matches.push(...batch);
  }

  return matches.reverse();
}

export async function loadOwnedPieces(pieceContract, account) {
  const expectedBalance = BigInt(await pieceContract.balanceOf(account));
  if (expectedBalance === 0n) return [];

  const ownedIds = [];
  const normalizedAccount = account.toLowerCase();

  // ChessPieceNFT mints sequential IDs starting at 1 and exposes no burn function.
  // Current ownership reads also find transferred pieces without historical logs.
  for (let id = 1; BigInt(ownedIds.length) < expectedBalance; id += 1) {
    let owner;
    try {
      owner = await pieceContract.ownerOf(id);
    } catch (error) {
      if (error.code === "CALL_EXCEPTION" && error.revert?.name === "ERC721NonexistentToken") break;
      throw error;
    }
    if (owner.toLowerCase() === normalizedAccount) ownedIds.push(id);

    if (BigInt(ownedIds.length) === expectedBalance) {
      return Promise.all(ownedIds.map(async (id) => ({
        id: String(id),
        name: await pieceContract.displayNameOf(id)
      })));
    }
  }

  throw new Error("Unable to load all owned chess pieces. Use Refresh to try again.");
}
