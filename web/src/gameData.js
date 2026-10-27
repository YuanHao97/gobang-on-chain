const READ_BATCH_SIZE = 8;

export async function loadMatchHistory(game) {
  const nextMatchId = BigInt(await game.nextMatchId());
  const matches = [];

  for (let first = 1n; first < nextMatchId; first += BigInt(READ_BATCH_SIZE)) {
    const ids = Array.from({ length: READ_BATCH_SIZE }, (_, offset) => first + BigInt(offset))
      .filter((id) => id < nextMatchId);
    const batch = await Promise.all(ids.map(async (id) => {
      const data = await game.getMatch(id);
      return {
        id: id.toString(),
        creator: data.creator,
        joiner: data.joiner,
        creatorPieceId: data.creatorPieceId.toString(),
        joinerPieceId: data.joinerPieceId.toString(),
        boardSize: Number(data.boardSize),
        moveCount: Number(data.moveCount),
        currentPlayer: data.currentPlayer,
        deadline: Number(data.turnDeadline),
        status: Number(data.status),
        reason: Number(data.finishReason),
        winner: data.winner
      };
    }));
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
