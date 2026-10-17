const EMPTY_ADDRESS = "0x0000000000000000000000000000000000000000";

export function buildVictoryLeaderboard(matches, limit = 3) {
  const winsByPlayer = new Map();

  matches.forEach((match) => {
    if (match.status !== 2 || !match.winner || match.winner.toLowerCase() === EMPTY_ADDRESS) return;

    const key = match.winner.toLowerCase();
    const current = winsByPlayer.get(key);
    winsByPlayer.set(key, {
      address: current?.address || match.winner,
      wins: (current?.wins || 0) + 1
    });
  });

  return [...winsByPlayer.values()]
    .sort((left, right) => right.wins - left.wins || left.address.toLowerCase().localeCompare(right.address.toLowerCase()))
    .slice(0, Math.max(0, limit));
}
