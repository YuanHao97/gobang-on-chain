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
const networkPath = path.join(__dirname, "..", "web", "public", "deployments", `${networkName}.json`);
fs.mkdirSync(path.dirname(networkPath), { recursive: true });
fs.copyFileSync(sourcePath, networkPath);
console.log(`Web client now uses ${networkName}.`);
