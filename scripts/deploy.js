const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const LOCAL_COMPUTER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const LOCAL_PLAYER_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

async function deploymentFeeOverrides(ethers, provider, chainId) {
  if (Number(chainId) !== 11155111) {
    return {};
  }

  const latestBlock = await provider.getBlock("latest");
  const baseFeePerGas = latestBlock.baseFeePerGas ?? 0n;
  const maxPriorityFeePerGas = 1_000_000n;
  return {
    maxPriorityFeePerGas,
    maxFeePerGas: (baseFeePerGas * 3n) + maxPriorityFeePerGas
  };
}

async function main() {
  const { ethers } = hre;
  if (hre.network.name === "sepolia" && (!process.env.SEPOLIA_RPC_URL || !process.env.SEPOLIA_PRIVATE_KEY)) {
    throw new Error("Set SEPOLIA_RPC_URL and SEPOLIA_PRIVATE_KEY before deploying to Sepolia.");
  }
  if (hre.network.name === "baseSepolia" && !process.env.BASE_SEPOLIA_PRIVATE_KEY && !process.env.SEPOLIA_PRIVATE_KEY) {
    throw new Error("Set BASE_SEPOLIA_PRIVATE_KEY or SEPOLIA_PRIVATE_KEY before deploying to Base Sepolia.");
  }
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  if (hre.network.name === "baseSepolia" && Number(network.chainId) !== 84532) {
    throw new Error("The Base Sepolia RPC must use chain ID 84532.");
  }
  console.log(`Deploying on chain ${network.chainId} with ${deployer.address}`);
  const isLocalNetwork = Number(network.chainId) === 31337;
  const feeOverrides = await deploymentFeeOverrides(ethers, ethers.provider, network.chainId);

  let chessPieceAddress = process.env.CHESS_PIECE_NFT_ADDRESS;
  if (chessPieceAddress) {
    if (!ethers.isAddress(chessPieceAddress)) {
      throw new Error("CHESS_PIECE_NFT_ADDRESS must be a valid contract address.");
    }
    chessPieceAddress = ethers.getAddress(chessPieceAddress);
    const deployedCode = await ethers.provider.getCode(chessPieceAddress);
    if (deployedCode === "0x") {
      throw new Error("CHESS_PIECE_NFT_ADDRESS does not contain deployed contract code.");
    }
  } else {
    const ChessPieceNFT = await ethers.getContractFactory("ChessPieceNFT");
    const chessPieceNFT = await ChessPieceNFT.deploy(feeOverrides);
    await chessPieceNFT.waitForDeployment();
    chessPieceAddress = await chessPieceNFT.getAddress();
  }

  const GameManager = await ethers.getContractFactory("GameManager");
  const gameManager = await GameManager.deploy(chessPieceAddress, feeOverrides);
  await gameManager.waitForDeployment();

  const deploymentTransaction = gameManager.deploymentTransaction();
  const receipt = await deploymentTransaction.wait();
  const deployment = {
    chainId: Number(network.chainId),
    deployer: deployer.address,
    deploymentBlock: receipt.blockNumber,
    chessPieceNFT: chessPieceAddress,
    gameManager: await gameManager.getAddress()
  };
  if (isLocalNetwork) {
    deployment.localComputer = LOCAL_COMPUTER_ADDRESS;
    deployment.localPlayer = LOCAL_PLAYER_ADDRESS;
  }

  const outputPaths = [path.join(__dirname, "..", "deployments", `${hre.network.name}.json`)];
  if (!isLocalNetwork) {
    outputPaths.push(path.join(__dirname, "..", "web", "public", "deployments", `${hre.network.name}.json`));
  }
  if (isLocalNetwork || process.env.WRITE_WEB_CONTRACTS === "true") {
    outputPaths.push(path.join(__dirname, "..", "web", "public", "contracts.json"));
  }
  for (const outputPath of outputPaths) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(deployment, null, 2)}\n`);
  }

  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
