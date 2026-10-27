export const chessPieceAbi = [
  "function mint(string displayName, string metadataURI) returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function displayNameOf(uint256 pieceId) view returns (string)",
  "event ChessPieceCreated(uint256 indexed pieceId, address indexed owner, string displayName, string metadataURI)",
  "error ERC721NonexistentToken(uint256 tokenId)"
];

export const gameManagerAbi = [
  "function nextMatchId() view returns (uint256)",
  "function createMatch(uint256 pieceId, uint8 boardSize, uint32 turnDuration) returns (uint256)",
  "function joinMatch(uint256 matchId, uint256 pieceId)",
  "function playMove(uint256 matchId, uint8 x, uint8 y)",
  "function sessionActivationNonces(address player) view returns (uint256)",
  "function sessionKeys(address player) view returns (address key, uint64 expiresAt)",
  "function resign(uint256 matchId)",
  "function expireMatch(uint256 matchId)",
  "function getCell(uint256 matchId, uint8 x, uint8 y) view returns (uint8)",
  "function getMatch(uint256 matchId) view returns ((address creator, address joiner, uint256 creatorPieceId, uint256 joinerPieceId, uint8 boardSize, uint16 moveCount, address currentPlayer, uint64 turnDeadline, uint32 turnDuration, uint8 status, uint8 finishReason, address winner))",
  "event MatchCreated(uint256 indexed matchId, address indexed creator, uint256 indexed creatorPieceId, uint8 boardSize, uint64 turnDeadline)"
];
