const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export function validateRecommendationRequest(input) {
  if (!input || typeof input !== "object") throw new Error("A recommendation request is required.");

  const boardSize = Number(input.boardSize);
  const playerStone = Number(input.playerStone);
  if (boardSize !== 15) throw new Error("Only a 15x15 Gobang board is supported.");
  if (playerStone !== 1 && playerStone !== 2) throw new Error("playerStone must be 1 or 2.");
  if (!Array.isArray(input.board) || input.board.length !== boardSize * boardSize) {
    throw new Error("The board must contain exactly 225 cells.");
  }

  const board = input.board.map(Number);
  if (board.some((cell) => !Number.isInteger(cell) || cell < 0 || cell > 2)) {
    throw new Error("Board cells must be 0, 1, or 2.");
  }
  if (!board.includes(0)) throw new Error("The board has no legal moves.");

  return { board, boardSize, playerStone };
}

function isInside(size, x, y) {
  return x >= 0 && x < size && y >= 0 && y < size;
}

function countDirection(board, size, x, y, stone, dx, dy) {
  let count = 0;
  let nextX = x + dx;
  let nextY = y + dy;
  while (isInside(size, nextX, nextY) && board[nextY * size + nextX] === stone) {
    count += 1;
    nextX += dx;
    nextY += dy;
  }
  return count;
}

function lineLengthAfterMove(board, size, index, stone) {
  const x = index % size;
  const y = Math.floor(index / size);
  return Math.max(...DIRECTIONS.map(([dx, dy]) => 1
    + countDirection(board, size, x, y, stone, dx, dy)
    + countDirection(board, size, x, y, stone, -dx, -dy)));
}

function nearbyStones(board, size, index, radius = 2) {
  const x = index % size;
  const y = Math.floor(index / size);
  let count = 0;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const nextX = x + offsetX;
      const nextY = y + offsetY;
      if (isInside(size, nextX, nextY) && board[nextY * size + nextX] !== 0) count += 1;
    }
  }
  return count;
}

function candidateReason(ownLine, opponentLine) {
  if (ownLine >= 5) return "Wins immediately.";
  if (opponentLine >= 5) return "Blocks an immediate loss.";
  if (ownLine >= 4) return "Creates a four-stone threat.";
  if (opponentLine >= 4) return "Blocks a strong four-stone threat.";
  if (ownLine >= 3) return "Builds an attacking three-stone line.";
  if (opponentLine >= 3) return "Disrupts the opponent's developing line.";
  return "Develops influence near existing stones.";
}

export function rankCandidateMoves(input, limit = 12) {
  const { board, boardSize, playerStone } = validateRecommendationRequest(input);
  const opponentStone = playerStone === 1 ? 2 : 1;
  const center = Math.floor(boardSize / 2);
  const occupiedCount = board.filter((cell) => cell !== 0).length;

  const candidates = board.flatMap((cell, index) => {
    if (cell !== 0) return [];
    const neighbors = nearbyStones(board, boardSize, index);
    if (occupiedCount > 0 && neighbors === 0) return [];

    const x = index % boardSize;
    const y = Math.floor(index / boardSize);
    const ownLine = lineLengthAfterMove(board, boardSize, index, playerStone);
    const opponentLine = lineLengthAfterMove(board, boardSize, index, opponentStone);
    const centerDistance = Math.abs(x - center) + Math.abs(y - center);
    const score = (ownLine >= 5 ? 1_000_000 : 0)
      + (opponentLine >= 5 ? 900_000 : 0)
      + ownLine ** 4 * 180
      + opponentLine ** 4 * 150
      + neighbors * 18
      + Math.max(0, boardSize - centerDistance);

    return [{ x, y, score, reason: candidateReason(ownLine, opponentLine) }];
  });

  if (candidates.length === 0) {
    return [{ x: center, y: center, score: boardSize, reason: "Controls the center on an empty board." }];
  }

  return candidates
    .sort((left, right) => right.score - left.score || left.y - right.y || left.x - right.x)
    .slice(0, Math.max(1, limit));
}
