const fs = require("fs");
const path = require("path");

const networkName = process.argv[2];

if (!networkName || !/^[a-z0-9_-]+$/i.test(networkName)) {
  throw new Error("Provide a valid deployment network name.");
}

const sourcePath = path.join(__dirname, "..", "deployments", `${networkName}.json`);
const targetPath = path.join(__dirname, "..", "web", "public", "contracts.json");

if (!fs.existsSync(sourcePath)) {
  throw new Error(`Deployment file not found: ${sourcePath}`);
}

fs.copyFileSync(sourcePath, targetPath);
console.log(`Web client now uses ${networkName}.`);
