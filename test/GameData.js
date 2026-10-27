const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Frontend contract-state readers", function () {
  it("loads existing history and wallet pieces through the frontend ABI without event queries", async function () {
    const { loadMatchHistory, loadOwnedPieces } = await import("../web/src/gameData.js");
    const { chessPieceAbi, gameManagerAbi } = await import("../web/src/contracts.js");
    const [alice, bob, emptyWallet] = await ethers.getSigners();
    const pieces = await (await ethers.getContractFactory("ChessPieceNFT")).deploy();
    const game = await (await ethers.getContractFactory("GameManager")).deploy(await pieces.getAddress());

    await pieces.connect(bob).mint("Bob's piece", "ipfs://bob");
    await pieces.connect(alice).mint("Alice's first piece", "ipfs://alice-1");
    await pieces.connect(alice).mint("Alice's second piece", "ipfs://alice-2");
    await game.connect(alice).createMatch(2, 15, 6000);
    await game.connect(bob).joinMatch(1, 1);
    await game.connect(alice).resign(1);
    await game.connect(alice).createMatch(3, 15, 6000);

    const gameReader = new ethers.Contract(await game.getAddress(), gameManagerAbi, ethers.provider);
    const pieceReader = new ethers.Contract(await pieces.getAddress(), chessPieceAbi, ethers.provider);
    const matches = await loadMatchHistory(gameReader);
    const ownedPieces = await loadOwnedPieces(pieceReader, alice.address);

    expect(matches.map((match) => match.id)).to.deep.equal(["2", "1"]);
    expect(matches[1].status).to.equal(2);
    expect(matches[1].winner).to.equal(bob.address);
    expect(ownedPieces).to.deep.equal([
      { id: "2", name: "Alice's first piece" },
      { id: "3", name: "Alice's second piece" }
    ]);
    expect(await loadOwnedPieces(pieceReader, emptyWallet.address)).to.deep.equal([]);
  });
});
