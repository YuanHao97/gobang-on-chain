// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title ChessPieceNFT
/// @notice A cosmetic player identity for Gobang matches.
contract ChessPieceNFT is ERC721URIStorage {
    uint256 private _nextTokenId = 1;

    mapping(uint256 tokenId => string displayName) private _displayNames;

    event ChessPieceCreated(
        uint256 indexed pieceId,
        address indexed owner,
        string displayName,
        string metadataURI
    );

    error EmptyDisplayName();
    error DisplayNameTooLong();
    error EmptyMetadataURI();
    error MetadataURITooLong();

    constructor() ERC721("Gobang Chess Piece", "GCP") {}

    /// @notice Mints a player-owned cosmetic chess piece.
    /// @param displayName A short immutable name shown by the game client.
    /// @param metadataURI A content-addressed URI for standard NFT metadata.
    function mint(string calldata displayName, string calldata metadataURI) external returns (uint256 pieceId) {
        uint256 nameLength = bytes(displayName).length;
        uint256 uriLength = bytes(metadataURI).length;
        if (nameLength == 0) revert EmptyDisplayName();
        if (nameLength > 64) revert DisplayNameTooLong();
        if (uriLength == 0) revert EmptyMetadataURI();
        if (uriLength > 512) revert MetadataURITooLong();

        pieceId = _nextTokenId++;
        _displayNames[pieceId] = displayName;
        _safeMint(msg.sender, pieceId);
        _setTokenURI(pieceId, metadataURI);

        emit ChessPieceCreated(pieceId, msg.sender, displayName, metadataURI);
    }

    /// @notice Returns the immutable display name assigned when the piece was minted.
    function displayNameOf(uint256 pieceId) external view returns (string memory) {
        _requireOwned(pieceId);
        return _displayNames[pieceId];
    }
}
