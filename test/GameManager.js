const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("GameManager", function () {
  const boardSize = 15;
  const turnDuration = 3600;
  let owner;
  let alice;
  let bob;
  let carol;
  let pieces;
  let game;
  let nextPieceId;

  async function mintPiece(player, name) {
    const id = nextPieceId++;
    await pieces.connect(player).mint(name, `ipfs://${name}`);
    return id;
  }

  async function createActiveMatch() {
    const alicePiece = await mintPiece(alice, "Alice");
    const bobPiece = await mintPiece(bob, "Bob");
    const matchId = await game.nextMatchId();
    await game.connect(alice).createMatch(alicePiece, boardSize, turnDuration);
    await game.connect(bob).joinMatch(matchId, bobPiece);
    return { matchId, alicePiece, bobPiece };
  }

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const ChessPieceNFT = await ethers.getContractFactory("ChessPieceNFT");
    pieces = await ChessPieceNFT.deploy();
    nextPieceId = 1;
    const GameManager = await ethers.getContractFactory("GameManager");
    game = await GameManager.deploy(await pieces.getAddress());
  });

  it("mints a custom chess piece", async function () {
    await expect(pieces.connect(alice).mint("Aurora", "ipfs://aurora"))
      .to.emit(pieces, "ChessPieceCreated")
      .withArgs(1, alice.address, "Aurora", "ipfs://aurora");
    expect(await pieces.ownerOf(1)).to.equal(alice.address);
    expect(await pieces.displayNameOf(1)).to.equal("Aurora");
  });

  it("accepts generated data URIs for self-contained metadata", async function () {
    const metadataURI = `data:application/json;base64,${"a".repeat(300)}`;
    await pieces.connect(alice).mint("Generated Piece", metadataURI);
    expect(await pieces.tokenURI(1)).to.equal(metadataURI);
  });

  it("creates and joins a match only with owned pieces", async function () {
    const alicePiece = await mintPiece(alice, "Alice");
    const bobPiece = await mintPiece(bob, "Bob");
    await expect(game.connect(alice).createMatch(alicePiece, boardSize, turnDuration))
      .to.emit(game, "MatchCreated");
    await expect(game.connect(alice).joinMatch(1, alicePiece))
      .to.be.revertedWithCustomError(game, "CannotJoinOwnMatch");
    await expect(game.connect(carol).joinMatch(1, bobPiece))
      .to.be.revertedWithCustomError(game, "PieceNotOwned");
    await game.connect(bob).joinMatch(1, bobPiece);
    const match = await game.getMatch(1);
    expect(match.status).to.equal(1);
    expect(match.currentPlayer).to.equal(alice.address);
  });

  it("rejects invalid turns and occupied cells", async function () {
    const { matchId } = await createActiveMatch();
    await expect(game.connect(bob).playMove(matchId, 0, 0))
      .to.be.revertedWithCustomError(game, "NotCurrentPlayer");
    await game.connect(alice).playMove(matchId, 0, 0);
    await expect(game.connect(bob).playMove(matchId, 0, 0))
      .to.be.revertedWithCustomError(game, "CellOccupied");
    await expect(game.connect(bob).playMove(matchId, 15, 0))
      .to.be.revertedWithCustomError(game, "CoordinateOutOfBounds");
  });

  it("finishes when the creator makes five in a horizontal row", async function () {
    const { matchId } = await createActiveMatch();
    for (let x = 0; x < 5; x++) {
      await game.connect(alice).playMove(matchId, x, 0);
      if (x < 4) await game.connect(bob).playMove(matchId, x, 1);
    }
    const match = await game.getMatch(matchId);
    expect(match.status).to.equal(2);
    expect(match.winner).to.equal(alice.address);
    expect(match.finishReason).to.equal(1);
  });

  it("awards an expired active match to the player who was waiting", async function () {
    const { matchId } = await createActiveMatch();
    await ethers.provider.send("evm_increaseTime", [turnDuration + 1]);
    await ethers.provider.send("evm_mine");
    await game.connect(carol).expireMatch(matchId);
    const match = await game.getMatch(matchId);
    expect(match.winner).to.equal(bob.address);
    expect(match.finishReason).to.equal(4);
  });

  it("accepts a session-key move relayed by another account", async function () {
    const { matchId } = await createActiveMatch();
    const sessionWallet = ethers.Wallet.createRandom();
    const network = await ethers.provider.getNetwork();
    const latestBlock = await ethers.provider.getBlock("latest");
    const expiresAt = BigInt(latestBlock.timestamp + 3600);
    const activationNonce = await game.sessionActivationNonces(alice.address);
    const activationHash = ethers.solidityPackedKeccak256(
      ["address", "uint256", "address", "address", "uint64", "uint256"],
      [await game.getAddress(), network.chainId, alice.address, sessionWallet.address, expiresAt, activationNonce]
    );
    const activationSignature = await alice.signMessage(ethers.getBytes(activationHash));
    await game.connect(carol).activateSessionKey(
      alice.address, sessionWallet.address, expiresAt, activationNonce, activationSignature
    );

    const moveDeadline = BigInt(latestBlock.timestamp + 60);
    const moveHash = ethers.solidityPackedKeccak256(
      ["address", "uint256", "uint256", "uint8", "uint8", "address", "uint64"],
      [await game.getAddress(), network.chainId, matchId, 7, 7, alice.address, moveDeadline]
    );
    const moveSignature = await sessionWallet.signMessage(ethers.getBytes(moveHash));
    await game.connect(carol).playMoveWithSession(matchId, 7, 7, alice.address, moveDeadline, moveSignature);
    expect(await game.getCell(matchId, 7, 7)).to.equal(1);
  });
});
