require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const sepoliaPrivateKey = process.env.SEPOLIA_PRIVATE_KEY;
const baseSepoliaPrivateKey = process.env.BASE_SEPOLIA_PRIVATE_KEY || sepoliaPrivateKey;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545"
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      accounts: sepoliaPrivateKey ? [sepoliaPrivateKey] : []
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      chainId: 84532,
      accounts: baseSepoliaPrivateKey ? [baseSepoliaPrivateKey] : []
    }
  }
};
