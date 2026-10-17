// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title GameManager
/// @notice The authoritative, turn-based rules engine for standard freestyle Gobang.
contract GameManager {
    uint8 public constant STANDARD_BOARD_SIZE = 15;
    uint32 public constant MIN_TURN_DURATION = 1 minutes;
    uint32 public constant MAX_TURN_DURATION = 7 days;

    enum MatchStatus { Open, Active, Finished }
    enum FinishReason { None, FiveInARow, Resignation, Draw, Expired, Cancelled }

    struct MatchData {
        address creator;
        address joiner;
        uint256 creatorPieceId;
        uint256 joinerPieceId;
        uint8 boardSize;
        uint16 moveCount;
        address currentPlayer;
        uint64 turnDeadline;
        uint32 turnDuration;
        MatchStatus status;
        FinishReason finishReason;
        address winner;
    }

    struct SessionKey {
        address key;
        uint64 expiresAt;
    }

    IERC721 public immutable chessPiece;
    uint256 public nextMatchId = 1;

    mapping(uint256 matchId => MatchData) private _matches;
    // Cell values are 0 for empty, 1 for the creator's black stone, and 2 for the joiner's white stone.
    mapping(uint256 matchId => mapping(uint16 cellIndex => uint8 stone)) private _cells;
    mapping(address player => SessionKey session) public sessionKeys;
    mapping(address player => uint256 nonce) public sessionActivationNonces;

    event MatchCreated(
        uint256 indexed matchId,
        address indexed creator,
        uint256 indexed creatorPieceId,
        uint8 boardSize,
        uint64 turnDeadline
    );
    event MatchJoined(uint256 indexed matchId, address indexed joiner, uint256 indexed joinerPieceId);
    event MovePlayed(
        uint256 indexed matchId,
        uint16 indexed moveNumber,
        address indexed player,
        uint8 x,
        uint8 y
    );
    event MatchFinished(uint256 indexed matchId, address indexed winner, FinishReason reason);
    event SessionKeyActivated(address indexed player, address indexed sessionKey, uint64 expiresAt);
    event SessionKeyRevoked(address indexed player, address indexed sessionKey);

    error MatchNotFound();
    error NotMatchCreator();
    error CannotJoinOwnMatch();
    error InvalidMatchStatus();
    error NotCurrentPlayer();
    error TurnExpired();
    error TurnNotExpired();
    error InvalidBoardSize();
    error InvalidTurnDuration();
    error CoordinateOutOfBounds();
    error CellOccupied();
    error PieceNotOwned();
    error InvalidSessionKey();
    error SessionKeyExpired();
    error InvalidSessionAuthorization();
    error InvalidSessionNonce();
    error SessionMoveExpired();

    constructor(IERC721 chessPiece_) {
        chessPiece = chessPiece_;
    }

    /// @notice Opens a standard 15x15 match. The creator plays black and moves first after an opponent joins.
    function createMatch(uint256 pieceId, uint8 boardSize, uint32 turnDuration) external returns (uint256 matchId) {
        if (boardSize != STANDARD_BOARD_SIZE) revert InvalidBoardSize();
        if (turnDuration < MIN_TURN_DURATION || turnDuration > MAX_TURN_DURATION) revert InvalidTurnDuration();
        _requirePieceOwnership(msg.sender, pieceId);

        matchId = nextMatchId++;
        uint64 deadline = uint64(block.timestamp + turnDuration);
        _matches[matchId] = MatchData({
            creator: msg.sender,
            joiner: address(0),
            creatorPieceId: pieceId,
            joinerPieceId: 0,
            boardSize: boardSize,
            moveCount: 0,
            currentPlayer: msg.sender,
            turnDeadline: deadline,
            turnDuration: turnDuration,
            status: MatchStatus.Open,
            finishReason: FinishReason.None,
            winner: address(0)
        });

        emit MatchCreated(matchId, msg.sender, pieceId, boardSize, deadline);
    }

    /// @notice Joins an open match using a chess piece owned by the caller.
    function joinMatch(uint256 matchId, uint256 pieceId) external {
        MatchData storage game = _match(matchId);
        if (game.status != MatchStatus.Open) revert InvalidMatchStatus();
        if (msg.sender == game.creator) revert CannotJoinOwnMatch();
        _requirePieceOwnership(msg.sender, pieceId);

        game.joiner = msg.sender;
        game.joinerPieceId = pieceId;
        game.status = MatchStatus.Active;
        game.currentPlayer = game.creator;
        game.turnDeadline = uint64(block.timestamp + game.turnDuration);

        emit MatchJoined(matchId, msg.sender, pieceId);
    }

    /// @notice Cancels an open match before another player joins it.
    function cancelOpenMatch(uint256 matchId) external {
        MatchData storage game = _match(matchId);
        if (game.status != MatchStatus.Open) revert InvalidMatchStatus();
        if (msg.sender != game.creator) revert NotMatchCreator();
        _finish(matchId, game, address(0), FinishReason.Cancelled);
    }

    /// @notice Places a stone at an empty coordinate and resolves the resulting game state.
    function playMove(uint256 matchId, uint8 x, uint8 y) external {
        _playMove(matchId, x, y, msg.sender);
    }

    /// @notice Activates a short-lived session key from a signature by the player wallet.
    /// @dev Any relayer may submit this authorization, but the signature binds it to this contract and chain.
    function activateSessionKey(
        address player,
        address sessionKey,
        uint64 expiresAt,
        uint256 nonce,
        bytes calldata signature
    ) external {
        if (sessionKey == address(0) || expiresAt <= block.timestamp) revert InvalidSessionKey();
        if (nonce != sessionActivationNonces[player]) revert InvalidSessionNonce();

        bytes32 authorization = keccak256(abi.encodePacked(
            address(this), block.chainid, player, sessionKey, expiresAt, nonce
        ));
        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(authorization), signature);
        if (signer != player) revert InvalidSessionAuthorization();

        sessionActivationNonces[player] = nonce + 1;
        sessionKeys[player] = SessionKey({key: sessionKey, expiresAt: expiresAt});
        emit SessionKeyActivated(player, sessionKey, expiresAt);
    }

    /// @notice Revokes the caller's session key immediately.
    function revokeSessionKey() external {
        SessionKey memory session = sessionKeys[msg.sender];
        delete sessionKeys[msg.sender];
        emit SessionKeyRevoked(msg.sender, session.key);
    }

    /// @notice Plays a move signed by a player's active session key and submitted by any relayer.
    function playMoveWithSession(
        uint256 matchId,
        uint8 x,
        uint8 y,
        address player,
        uint64 signatureDeadline,
        bytes calldata signature
    ) external {
        if (signatureDeadline < block.timestamp) revert SessionMoveExpired();
        SessionKey memory session = sessionKeys[player];
        if (session.key == address(0)) revert InvalidSessionKey();
        if (session.expiresAt < block.timestamp) revert SessionKeyExpired();

        bytes32 moveAuthorization = keccak256(abi.encodePacked(
            address(this), block.chainid, matchId, x, y, player, signatureDeadline
        ));
        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(moveAuthorization), signature);
        if (signer != session.key) revert InvalidSessionAuthorization();

        _playMove(matchId, x, y, player);
    }

    function _playMove(uint256 matchId, uint8 x, uint8 y, address player) private {
        MatchData storage game = _match(matchId);
        if (game.status != MatchStatus.Active) revert InvalidMatchStatus();
        if (player != game.currentPlayer) revert NotCurrentPlayer();
        if (block.timestamp > game.turnDeadline) revert TurnExpired();
        if (x >= game.boardSize || y >= game.boardSize) revert CoordinateOutOfBounds();

        uint16 index = _cellIndex(game.boardSize, x, y);
        if (_cells[matchId][index] != 0) revert CellOccupied();

        uint8 stone = player == game.creator ? 1 : 2;
        _cells[matchId][index] = stone;
        game.moveCount += 1;
        emit MovePlayed(matchId, game.moveCount, player, x, y);

        if (_hasWinningLine(matchId, game.boardSize, x, y, stone)) {
            _finish(matchId, game, player, FinishReason.FiveInARow);
            return;
        }

        uint16 totalCells = uint16(game.boardSize) * uint16(game.boardSize);
        if (game.moveCount == totalCells) {
            _finish(matchId, game, address(0), FinishReason.Draw);
            return;
        }

        game.currentPlayer = player == game.creator ? game.joiner : game.creator;
        game.turnDeadline = uint64(block.timestamp + game.turnDuration);
    }

    /// @notice Lets a player concede an active match to the other player.
    function resign(uint256 matchId) external {
        MatchData storage game = _match(matchId);
        if (game.status != MatchStatus.Active) revert InvalidMatchStatus();
        if (msg.sender != game.creator && msg.sender != game.joiner) revert NotCurrentPlayer();
        address winner = msg.sender == game.creator ? game.joiner : game.creator;
        _finish(matchId, game, winner, FinishReason.Resignation);
    }

    /// @notice Finalizes an expired match. In an active match, the player whose turn expired loses.
    function expireMatch(uint256 matchId) external {
        MatchData storage game = _match(matchId);
        if (game.status != MatchStatus.Open && game.status != MatchStatus.Active) revert InvalidMatchStatus();
        if (block.timestamp <= game.turnDeadline) revert TurnNotExpired();

        if (game.status == MatchStatus.Open) {
            _finish(matchId, game, address(0), FinishReason.Expired);
            return;
        }

        address winner = game.currentPlayer == game.creator ? game.joiner : game.creator;
        _finish(matchId, game, winner, FinishReason.Expired);
    }

    function getMatch(uint256 matchId) external view returns (MatchData memory) {
        return _match(matchId);
    }

    /// @notice Returns 0 for empty, 1 for black, and 2 for white.
    function getCell(uint256 matchId, uint8 x, uint8 y) external view returns (uint8) {
        MatchData storage game = _match(matchId);
        if (x >= game.boardSize || y >= game.boardSize) revert CoordinateOutOfBounds();
        return _cells[matchId][_cellIndex(game.boardSize, x, y)];
    }

    function _match(uint256 matchId) private view returns (MatchData storage game) {
        game = _matches[matchId];
        if (game.creator == address(0)) revert MatchNotFound();
    }

    function _requirePieceOwnership(address player, uint256 pieceId) private view {
        try chessPiece.ownerOf(pieceId) returns (address owner) {
            if (owner != player) revert PieceNotOwned();
        } catch {
            revert PieceNotOwned();
        }
    }

    function _finish(uint256 matchId, MatchData storage game, address winner, FinishReason reason) private {
        game.status = MatchStatus.Finished;
        game.winner = winner;
        game.finishReason = reason;
        emit MatchFinished(matchId, winner, reason);
    }

    function _hasWinningLine(uint256 matchId, uint8 boardSize, uint8 x, uint8 y, uint8 stone) private view returns (bool) {
        return _lineLength(matchId, boardSize, x, y, stone, 1, 0) >= 5
            || _lineLength(matchId, boardSize, x, y, stone, 0, 1) >= 5
            || _lineLength(matchId, boardSize, x, y, stone, 1, 1) >= 5
            || _lineLength(matchId, boardSize, x, y, stone, 1, -1) >= 5;
    }

    function _lineLength(
        uint256 matchId,
        uint8 boardSize,
        uint8 x,
        uint8 y,
        uint8 stone,
        int8 dx,
        int8 dy
    ) private view returns (uint8) {
        return 1
            + _countDirection(matchId, boardSize, x, y, stone, dx, dy)
            + _countDirection(matchId, boardSize, x, y, stone, -dx, -dy);
    }

    function _countDirection(
        uint256 matchId,
        uint8 boardSize,
        uint8 x,
        uint8 y,
        uint8 stone,
        int8 dx,
        int8 dy
    ) private view returns (uint8 count) {
        int16 nextX = int16(uint16(x)) + int16(dx);
        int16 nextY = int16(uint16(y)) + int16(dy);
        while (nextX >= 0 && nextY >= 0 && nextX < int16(uint16(boardSize)) && nextY < int16(uint16(boardSize))) {
            uint16 index = uint16(nextY) * uint16(boardSize) + uint16(nextX);
            if (_cells[matchId][index] != stone) break;
            count++;
            nextX += int16(dx);
            nextY += int16(dy);
        }
    }

    function _cellIndex(uint8 boardSize, uint8 x, uint8 y) private pure returns (uint16) {
        return uint16(y) * uint16(boardSize) + uint16(x);
    }
}
