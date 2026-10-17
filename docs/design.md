# On-Chain Gobang: Design Document

## 1. Purpose

Build a two-player Gobang (five-in-a-row) game in which every player can create, own, and use a custom chess-piece identity. The game must provide deterministic rules, transparent match history, and a practical user experience with low transaction costs.

This document defines the first release architecture. It is deliberately modular so that ranked play, tournaments, additional chains, and richer cosmetics can be introduced later without changing the core game rules.

## 2. Product Goals

- Let a player create a personal chess piece with a name, visual metadata, and optional on-chain attributes.
- Let two players create a match, join it, and play Gobang according to verifiable rules.
- Make game outcomes and match history publicly auditable.
- Keep board rendering and non-critical visual content off-chain.
- Prevent custom chess pieces from giving players an unfair gameplay advantage.
- Make the first version deployable on an EVM-compatible low-fee network.

## 3. Non-Goals for v1

- AI opponents.
- Betting, token rewards, or real-money staking.
- A fully on-chain 15x15 board after every move on Ethereum mainnet.
- Transferable advantages, paid power-ups, or rule-changing chess pieces.
- Private or hidden-information gameplay.

## 4. Terminology

| Term | Meaning |
| --- | --- |
| Gobang | A two-player game in which the first player to make five or more contiguous stones wins. |
| Stone | One move placed at a board coordinate. |
| Chess Piece | A player-owned identity/cosmetic asset selected for a match. It is represented by a token. |
| Match | A single game between two wallet addresses. |
| Creator | The player who opens a match and plays first. |
| Joiner | The player who accepts an open match and plays second. |

## 5. Core User Experience

1. A user connects a wallet.
2. The user creates a chess piece by submitting a display name and metadata URI.
3. The user opens a match, selecting one owned chess piece and a board size.
4. Another user accepts the match with one of their own chess pieces.
5. Players alternate turns. The web client calculates a candidate move locally and submits it as a transaction.
6. The contract verifies the turn, coordinate, vacancy, and win condition, then records the move.
7. When a player wins, resigns, or the match expires, the contract finalizes the match. The client displays the immutable result and move list.

## 6. Functional Requirements

### 6.1 Custom Chess Pieces

- A wallet can mint multiple chess pieces.
- Each chess piece has an immutable token ID and creator address.
- Each chess piece has a display name, metadata URI, creation time, and optional color palette or style identifiers.
- A player must own the selected chess piece when creating or joining a match.
- A chess piece can be transferred, but a match stores the selected token ID and player address at match start. Transfers do not alter an active match.
- The contract treats chess pieces as cosmetic identity only. The token ID has no effect on move order, legal moves, victory conditions, or rewards.

### 6.2 Match Lifecycle

`Open -> Active -> Finished` is the normal lifecycle.

- **Open:** The creator has selected a piece and waits for an opponent.
- **Active:** Both players have joined and can submit moves in turn.
- **Finished:** A win, resignation, draw, cancellation, or expiration has been recorded. No further moves are allowed.

Additional transitions:

- The creator can cancel an open match.
- Either player can resign an active match.
- Anyone can expire an inactive match after its deadline; the opponent wins if exactly one player failed to move before the deadline.
- A board with no empty cells and no winner ends in a draw.

### 6.3 Game Rules

- The initial board size is fixed at 15 x 15 for standard play. Contract support for 9 x 9 and 19 x 19 can be added through an allowlist of board sizes.
- Coordinates are zero-based: `x` and `y` must each be within `[0, boardSize - 1]`.
- The creator places black stones and moves first. The joiner places white stones.
- A player may place a stone only on an empty coordinate and only on their turn.
- A player wins immediately after creating a horizontal, vertical, diagonal, or anti-diagonal line of at least five contiguous stones.
- v1 uses freestyle Gobang: overlines count as a win, and there are no Renju forbidden-move rules.

## 7. Architecture

```text
Wallet + Web Client
        |
        | signed transactions / indexed reads
        v
  GameManager Contract <----> ChessPiece NFT Contract
        |
        | events
        v
 Indexer / Subgraph ----> API or Client Query Layer
        |
        v
 Web UI: lobby, board, profile, match history

Metadata URI -> IPFS or another content-addressed storage service
```

### 7.1 On-Chain Components

#### ChessPieceNFT

An ERC-721 contract representing player-created chess pieces.

Responsibilities:

- Mint a token to the caller.
- Store or expose token metadata through `tokenURI`.
- Enforce a bounded display-name length and metadata URI length.
- Emit `ChessPieceCreated`.
- Support normal ERC-721 ownership and transfer behavior.

Recommended implementation: OpenZeppelin `ERC721`, `ERC721URIStorage` only if mutable URI storage is truly required, and `Ownable` or role-based access only for protocol configuration.

#### GameManager

The authoritative rules engine and match state store.

Responsibilities:

- Create, join, cancel, play, resign, and expire matches.
- Verify chess-piece ownership at match creation and join time.
- Store board occupancy, turn state, deadlines, and results.
- Verify a winning line after every legal move.
- Emit all lifecycle events needed by the UI and indexer.

### 7.2 Off-Chain Components

#### Web Client

Suggested stack: Next.js, TypeScript, wagmi, viem, and a component library such as shadcn/ui.

The client:

- Connects wallets and selects networks.
- Renders boards from contract state and indexed events.
- Pre-validates moves for responsive feedback, while treating the contract as final authority.
- Uploads chess-piece metadata to IPFS through a trusted upload provider or user-selected gateway.
- Shows pending, confirmed, and failed transaction states clearly.

#### Indexer

A subgraph or event-indexing service builds efficient views for match discovery and history. It must never be treated as authoritative; if indexed data disagrees with contract state, contract state wins.

Indexed entities should include `ChessPiece`, `Match`, `Move`, and `PlayerProfile`.

## 8. Data Model

### 8.1 Chess Piece Metadata

Metadata should be JSON stored at a content-addressed URI.

```json
{
  "name": "Aurora Stone",
  "description": "A personal Gobang chess piece.",
  "image": "ipfs://...",
  "attributes": [
    { "trait_type": "Style", "value": "Aurora" },
    { "trait_type": "Palette", "value": "Violet" }
  ]
}
```

The UI must sanitize all displayed metadata and treat image URLs and text as untrusted content.

### 8.2 Match State

```solidity
enum MatchStatus { Open, Active, Finished }
enum FinishReason { None, FiveInARow, Resignation, Draw, Expired, Cancelled }

struct Match {
    address creator;
    address joiner;
    uint256 creatorPieceId;
    uint256 joinerPieceId;
    uint8 boardSize;
    uint16 moveCount;
    address currentPlayer;
    uint64 turnDeadline;
    MatchStatus status;
    FinishReason finishReason;
    address winner;
}
```

Board occupancy can be represented as two bitboards for 15 x 15 boards. A 225-cell board fits in two `uint256` values per player, or in a compact coordinate-to-owner mapping for simpler first implementation. The selected representation should prioritize correct, reviewable logic before gas micro-optimization.

## 9. Contract Interface Sketch

The following is a design-level interface, not production-ready code.

```solidity
interface IChessPieceNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IGameManager {
    function createMatch(uint256 pieceId, uint8 boardSize, uint64 turnDuration)
        external
        returns (uint256 matchId);

    function joinMatch(uint256 matchId, uint256 pieceId) external;

    function cancelOpenMatch(uint256 matchId) external;

    function playMove(uint256 matchId, uint8 x, uint8 y) external;

    function resign(uint256 matchId) external;

    function expireMatch(uint256 matchId) external;

    function getMatch(uint256 matchId) external view returns (Match memory);

    function getCell(uint256 matchId, uint8 x, uint8 y) external view returns (uint8);
}
```

Suggested events:

```solidity
event ChessPieceCreated(uint256 indexed pieceId, address indexed owner, string name, string metadataURI);
event MatchCreated(uint256 indexed matchId, address indexed creator, uint256 indexed creatorPieceId, uint8 boardSize);
event MatchJoined(uint256 indexed matchId, address indexed joiner, uint256 indexed joinerPieceId);
event MovePlayed(uint256 indexed matchId, uint16 indexed moveNumber, address indexed player, uint8 x, uint8 y);
event MatchFinished(uint256 indexed matchId, address indexed winner, FinishReason reason);
```

## 10. Move Validation and Win Detection

For every `playMove` call, the contract performs the following checks in order:

1. The match is active.
2. The caller is `currentPlayer`.
3. The current time is not later than `turnDeadline`.
4. The coordinate is inside the board.
5. The cell is empty.
6. Record the stone for the caller.
7. Count contiguous stones for the caller in four direction pairs: horizontal, vertical, diagonal, and anti-diagonal.
8. If any count is at least five, finalize with `FiveInARow`.
9. Otherwise, finalize as a draw if the board is full; otherwise advance the turn and deadline.

Only lines crossing the newly placed stone need to be checked. This gives bounded work per move and avoids scanning the entire board.

## 11. Security and Fairness

### 11.1 Contract Security

- Use Solidity `^0.8.x` checked arithmetic.
- Apply checks-effects-interactions and avoid arbitrary external calls during move handling.
- Use OpenZeppelin contracts rather than custom ERC-721 code.
- Cap board sizes and turn durations to prevent unreasonable gas use and configuration abuse.
- Validate token ownership only when the match is created or joined; do not make active games depend on later NFT transfers.
- Ensure each finished match can only be finalized once.
- Add unit, fuzz, and invariant tests for move legality, turn alternation, win detection, resignation, and expiry.
- Obtain an independent security review before enabling any economic features.

### 11.2 Gameplay Fairness

- Black always moves first in v1. The lobby should label this clearly.
- Custom chess pieces are visual identities only; neither metadata nor token traits influence the game.
- Every move is public and irreversible after confirmation, so players should be warned before signing.
- A turn deadline prevents a player from permanently stalling a match.

### 11.3 Front-Running Considerations

In a turn-based public game, a valid move is bound to the current player and coordinate. A third party cannot replace it because the contract checks `msg.sender`. The opposing player can see a pending move, but cannot legally play during that player's turn. The UI should still use transaction replacement and status monitoring to help users recover from delayed or dropped transactions.

## 12. Network and Cost Strategy

Deploy v1 on a low-fee EVM chain or rollup, such as an Ethereum L2, to keep each move affordable. The deployment decision should consider wallet support, reliable RPC providers, block finality, and indexer availability.

The initial storage approach should be benchmarked on the chosen chain. If per-match storage becomes too expensive, a later version can store a Merkle commitment to moves or use a state channel design, but those approaches add meaningful complexity and are not recommended for the first public release.

## 13. UX Requirements

- A player can view open matches, active matches, and completed matches.
- The board clearly marks the active player, selected chess pieces, move count, and turn deadline.
- The UI disables clearly illegal moves but never assumes client validation is sufficient.
- A transaction panel provides a link to the block explorer and supports retry guidance.
- Piece creation provides an image preview, metadata validation, and an ownership confirmation.
- Accessibility includes keyboard-operable board cells, coordinate labels, and non-color-only stone differentiation.

## 14. Testing Strategy

### Smart Contracts

- Unit tests for every state transition and revert condition.
- Table-driven tests for all four win directions and board edges.
- Fuzz tests for arbitrary legal and illegal move sequences.
- Invariant tests: occupied cells never change owner, turns alternate after non-final moves, move count matches occupied cells, and a finished match never accepts a move.
- Gas snapshots for `createMatch`, `joinMatch`, and `playMove`.

### Client

- Component tests for board rendering and turn status.
- Integration tests against a local EVM node.
- End-to-end tests for wallet connection, piece creation, match creation, joining, winning, resignation, and expiration.

## 15. Delivery Plan

### Milestone 1: Contract Foundation

- Implement `ChessPieceNFT` and `GameManager`.
- Implement 15 x 15 freestyle rules and event emission.
- Complete unit, fuzz, and invariant test coverage.

### Milestone 2: Playable Web Client

- Build wallet connection, chess-piece creation, lobby, and live board.
- Integrate contract reads/writes and explorer links.
- Add responsive transaction feedback.

### Milestone 3: Indexing and History

- Index contract events.
- Build player profile, match history, and open-match discovery.

### Milestone 4: Testnet Release

- Deploy to a selected EVM testnet.
- Run usability testing and collect gas measurements.
- Perform contract review and address findings.

## 16. Open Decisions

- Which EVM L2 is the initial target network?
- Should chess-piece minting be free, protocol-paid, or paid by the creator?
- What are the permitted board sizes after the 15 x 15 default?
- What default turn duration best balances casual and competitive play?
- Should an unjoined open match expire automatically after a configurable period?
- Should v2 introduce a ranked queue, and if so, how will ratings be computed and stored?

## 17. Acceptance Criteria for v1

- A wallet can mint a custom chess piece and see its metadata in the UI.
- Two distinct wallets can create and join a 15 x 15 match using owned chess pieces.
- The contract rejects out-of-turn, out-of-bounds, duplicate-cell, and post-finish moves.
- The contract correctly finalizes horizontal, vertical, diagonal, and anti-diagonal five-in-a-row wins.
- Either player can resign, and inactivity can be resolved through expiration.
- The UI can display an immutable match result and its sequence of moves from chain data or indexed events.
