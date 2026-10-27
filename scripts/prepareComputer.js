const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const robotAddress = process.env.COMPUTER_ADDRESS;
  if (!ethers.isAddress(robotAddress)) throw new Error("Set COMPUTER_ADDRESS to the dedicated relay wallet address.");
  const deploymentPath = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const chain = await ethers.provider.getNetwork();
  if (Number(chain.chainId) !== deployment.chainId) throw new Error("Deployment chain ID does not match the RPC.");
  const [deployer] = await ethers.getSigners();
  const piece = await ethers.getContractAt("ChessPieceNFT", deployment.chessPieceNFT, deployer);
  if (deployment.computerPieceId) {
    const owner = await piece.ownerOf(deployment.computerPieceId);
    if (owner.toLowerCase() !== robotAddress.toLowerCase()) throw new Error("The saved computer NFT belongs to another account.");
    console.log(JSON.stringify({ chainId: deployment.chainId, robotAddress, computerPieceId: deployment.computerPieceId, created: false }));
    return;
  }
  const metadata = { name: "Gobang Computer", description: "The on-chain computer opponent operated by the Gobang relay." };
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString("base64")}`;
  const receipt = await (await piece.mint(metadata.name, uri)).wait(1);
  const created = receipt.logs.map((log) => {
    try { return piece.interface.parseLog(log); } catch { return null; }
  }).find((event) => event?.name === "ChessPieceCreated");
  if (!created) throw new Error("Computer NFT mint event was not found.");
  const pieceId = created.args.pieceId;
  await (await piece.safeTransferFrom(deployer.address, robotAddress, pieceId)).wait(1);
  if ((await piece.ownerOf(pieceId)).toLowerCase() !== robotAddress.toLowerCase()) throw new Error("Computer NFT ownership verification failed.");
  deployment.robotAddress = ethers.getAddress(robotAddress);
  deployment.computerPieceId = pieceId.toString();
  const outputPaths = [deploymentPath, path.join(__dirname, "..", "web", "public", "deployments", `${hre.network.name}.json`)];
  for (const outputPath of outputPaths) fs.writeFileSync(outputPath, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(JSON.stringify({ chainId: deployment.chainId, robotAddress: deployment.robotAddress, computerPieceId: deployment.computerPieceId, created: true }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
