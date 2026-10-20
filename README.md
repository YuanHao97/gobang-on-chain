# Gobang On-Chain

Create a chess piece, mint it as an NFT, and take that identity into a fully on-chain game of Gobang.

Gobang On-Chain is a wallet-based, 15x15 five-in-a-row game built for EVM networks. Each player owns a cosmetic chess-piece NFT, chooses one when entering a match, and plays against another wallet while the smart contracts enforce turns, deadlines, legal moves, wins, resignations, and timeouts.

**[Play the live Ethereum Sepolia demo](https://yuanhao97.github.io/gobang-on-chain/)**

The live demo uses Ethereum Sepolia test ETH only. Do not send mainnet ETH to the game.

## What You Can Do

- Generate a random chess-piece name, visual style, color palette, and seed directly in the browser.
- Mint the generated design as an ERC-721 NFT with self-contained metadata.
- Create a multiplayer match or join an open match with an owned chess piece.
- Play standard freestyle Gobang on a 15x15 board.
- See each player's NFT skin rendered on every move.
- Watch an active opponent's moves appear through automatic three-second refreshes.
- View the top three winning wallet addresses in an on-chain victory leaderboard.
- Ask a Coinbase AgentKit-powered advisor to recommend a legal move without playing it automatically.
- Resign a match or settle an expired turn on-chain.
- Open any completed match to inspect its final board snapshot and finish reason.
- Run a local single-player match against a Hardhat computer account during development.

## How a Match Works

1. Connect an EVM wallet.
2. Randomize a chess-piece design and mint it.
3. Select an owned piece and create a match, or join another player's open match.
4. Black moves first. The two wallets alternate turns until a player forms five in a row.
5. The final result and board remain readable from the contract after the match ends.

Chess pieces are cosmetic identities. They do not change the rules or provide gameplay advantages.

## On-Chain Design

| Component | Responsibility |
| --- | --- |
| `ChessPieceNFT` | ERC-721 ownership, immutable display names, and metadata URIs for player-created piece designs. |
| `GameManager` | Match creation and joining, board state, turn order, deadlines, move validation, five-in-a-row detection, resignation, cancellation, and expiry. |
| Web client | Wallet connection, in-browser metadata generation, piece rendering, lobby navigation, live board refresh, and completed-match snapshots. |
| AgentKit service | Read-only move analysis through a custom AgentKit action, a DeepSeek model, and server-side validation of every recommendation. |

The contracts are the authoritative game engine. The client reads board cells and match data from the selected network instead of maintaining a separate off-chain result database.

## Game Modes

### Sepolia Multiplayer

The public demo runs against Ethereum Sepolia. Minting, creating or joining matches, and playing moves are testnet transactions, so a connected wallet needs Sepolia test ETH. Each move requires wallet confirmation because the public deployment does not run a trusted transaction relay.

### Local Multiplayer and Computer Match

The Hardhat setup supports two local wallet accounts playing against each other and a single-player mode against a local computer account. Local matches can automatically request a one-time, two-hour fast-move session; after authorization, moves use a temporary browser session key and the local relay instead of opening MetaMask for every turn.

## Sepolia Contracts

| Contract | Address |
| --- | --- |
| `ChessPieceNFT` | [`0x037eB04D95165F3642cF62049732D757AeF6cA2F`](https://sepolia.etherscan.io/address/0x037eB04D95165F3642cF62049732D757AeF6cA2F) |
| `GameManager` | [`0x42B9B91bbFaA6c48A91592B0730722DAc05f1Fd1`](https://sepolia.etherscan.io/address/0x42B9B91bbFaA6c48A91592B0730722DAc05f1Fd1) |

Network: **Ethereum Sepolia**, chain ID `11155111`.

## Technology

- Solidity smart contracts
- OpenZeppelin ERC-721
- Hardhat development and tests
- React and Vite web client
- ethers.js wallet and contract integration
- Coinbase AgentKit custom action for AI move advice
- DeepSeek Responses API with Structured Outputs

## Local Development

### Prerequisites

- Node.js 20 or later
- npm 10 or later
- MetaMask or another EVM wallet

The optional AgentKit recommendation service requires Node.js 22 or later. It runs separately from the contracts and web client.

Install dependencies, compile the contracts, and run the test suite:

```bash
npm install
npm run compile
npm test
```

### Run the Local Game

Use three terminals from the repository root:

```bash
# Terminal 1: start the local EVM node
npm run node
```

```bash
# Terminal 2: deploy both contracts to the local node
npm run deploy:local
```

```bash
# Terminal 3: start the web client
npm run web
```

For a single-player match against the local computer, start one additional local-only service before selecting **Play local computer**:

```bash
# Terminal 4: start the computer account and fast-move relay
npm run bot:local
```

Open `http://127.0.0.1:5173/` in a browser. Port `8545` is the JSON-RPC endpoint, not the web page.

Add the local network to the wallet:

| Setting | Value |
| --- | --- |
| Network name | Hardhat Local |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |

Import one of the private keys printed by `npm run node`. Those accounts are public development accounts and must never be used on a public network or receive real funds.

For the local player account, Hardhat account #2 stays separate from the deployer and computer accounts:

```text
Address:     0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
Private key: 5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
```

If MetaMask reports a local nonce or RPC error after the node has restarted, open **Settings -> Advanced -> Clear activity tab data**, then reconnect to Hardhat Local. This clears wallet activity history without changing the local chain.

## AI Move Recommendations

The optional recommendation service accepts the current 15x15 board, builds a short list of legal tactical moves, and exposes that analysis as a custom Coinbase AgentKit action. A DeepSeek model selects from those candidates using Structured Outputs, and the service verifies that the returned cell is both legal and empty before sending it to the browser. The recommendation is highlighted on the board, but the player must still click the cell and approve any required wallet transaction.

Use Node.js 22 or later, then install and configure the isolated service:

```bash
npm run ai:install
cp agent-service/.env.example agent-service/.env
```

Create an API key in the DeepSeek platform, set `DEEPSEEK_API_KEY` in `agent-service/.env`, and optionally change `DEEPSEEK_MODEL` from the default `deepseek-flash`. Then run:

```bash
npm run ai:server
```

The local web client automatically uses `http://127.0.0.1:8790`. The DeepSeek API key stays in the server-side service and must never be placed in a `VITE_` variable or shipped to the browser.

For a public deployment, host `agent-service` on an HTTPS-capable Node.js 22 service, set `AI_RECOMMENDER_HOST=0.0.0.0` and `AI_ALLOWED_ORIGINS=https://yuanhao97.github.io` there, and add the backend URL as a GitHub Actions repository variable named `VITE_AI_RECOMMENDER_URL`. The public AI button remains disabled until that backend URL is configured; the rest of the game continues to work normally.

For Vercel, import this repository, set the project root directory to `agent-service`, and add `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL=deepseek-flash`, and `AI_ALLOWED_ORIGINS=https://yuanhao97.github.io` as environment variables. The included Vercel Functions expose `/health` and `/recommend`; each push to the selected branch triggers a new deployment.

The recommendation provider is deliberately read-only: it uses no wallet private key, cannot send a transaction, and validates model output against the submitted board before returning it.

## Deploy to Ethereum Sepolia

Use a new test-only wallet with Sepolia test ETH. Do not reuse a wallet that holds mainnet assets. Copy `.env.example` to `.env`, then set `SEPOLIA_RPC_URL` and the private key for the test wallet. The `.env` file is ignored by Git.

```bash
cp .env.example .env
npm run deploy:sepolia
```

The contract addresses are saved to `deployments/sepolia.json`. Point the web client at that deployment and create a production build:

```bash
npm run use:sepolia
npm --prefix web run build
```

Switch the wallet to **Ethereum Sepolia** before opening the client. To return the web client to the local Hardhat deployment, run `npm run deploy:local` again.

## Repository Layout

```text
contracts/ChessPieceNFT.sol  Custom chess-piece NFT contract
contracts/GameManager.sol    Authoritative Gobang rules contract
deployments/                 Network-specific contract addresses
scripts/                     Deployment, network, relay, and computer scripts
agent-service/               Coinbase AgentKit move recommendation service
test/GameManager.js          Contract behavior tests
web/                         React and Vite web client
docs/design.md               Product and technical design
```

## Security Notice

The contracts have not been audited. This project is intended for learning and testnet use and must not be used for real-value staking or production funds.
