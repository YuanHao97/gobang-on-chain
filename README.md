# Gobang On-Chain

Create a chess piece, mint it as an NFT, and take that identity into a fully on-chain game of Gobang.

Gobang On-Chain is a wallet-based, 15x15 five-in-a-row game built for EVM networks. Each player owns a cosmetic chess-piece NFT, chooses one when entering a match, and plays against another wallet while the smart contracts enforce turns, deadlines, legal moves, wins, resignations, and timeouts.

**[Play the live Base Sepolia / Ethereum Sepolia demo](https://yuanhao97.github.io/gobang-on-chain/)**

The live demo supports Base Sepolia and Ethereum Sepolia test ETH. Use the network button
to switch; each network has its own NFTs, matches, and leaderboard. New visitors start on
Base Sepolia. Do not send mainnet ETH to the game.

## What You Can Do

- Generate a random chess-piece name, visual style, color palette, and seed directly in the browser.
- Mint the generated design as an ERC-721 NFT with self-contained metadata.
- Create a multiplayer match or join an open match with an owned chess piece.
- Play standard freestyle Gobang on a 15x15 board.
- See each player's NFT skin rendered on every move.
- Refresh the lobby and board on demand to see an opponent's latest move. Your own transactions and computer moves trigger a refresh after confirmation; the client does not poll match data on a timer.
- View the top three winning wallet addresses in an on-chain victory leaderboard.
- Ask a Coinbase AgentKit-powered advisor to recommend a legal move without playing it automatically.
- Resign a match or settle an expired turn on-chain.
- Open any completed match to inspect its final board snapshot and finish reason.
- Play a fully on-chain single-player match against the Sepolia relay account, or use the local Hardhat computer during development.

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
| Web client | Wallet connection, in-browser metadata generation, piece rendering, lobby navigation, on-demand board refresh, and completed-match snapshots. |
| AgentKit service | Read-only move analysis through a custom AgentKit action, a DeepSeek model, and server-side validation of every recommendation. |

The contracts are the authoritative game engine. The client reads board cells and match data from the selected network instead of maintaining a separate off-chain result database.

The lobby reads `nextMatchId` and `getMatch` directly, and chess-piece inventory uses current ERC-721 balances and ownership. Neither list depends on archived event logs. Match history and inventory load independently, with separate loading and error messages; a slow or failed inventory request does not hide existing matches. These reads happen on connection, after transactions, or when the player selects Refresh, without periodic match polling.

On both public testnets, the client and computer relay read all 225 cells through a single
read-only Multicall3 request. This avoids the Base public RPC's per-second request limit;
local Hardhat games retain direct cell reads.

## Game Modes

### Base Sepolia and Ethereum Sepolia Multiplayer and Computer Match

The public demo supports Base Sepolia and Ethereum Sepolia. Minting and creating or joining matches are testnet transactions, so a connected wallet needs test ETH on the selected network. The public relay supports short-lived fast-move sessions and also acts as the white-stone computer account in single-player matches. The computer mints its own chess-piece NFT, joins the match, and submits every move as a real transaction on that network.

### Local Multiplayer and Computer Match

The Hardhat setup supports two local wallet accounts playing against each other and a single-player mode against a local computer account. Local matches can automatically request a one-time, two-hour fast-move session; after authorization, moves use a temporary browser session key and the local relay instead of opening MetaMask for every turn.

## Public Testnet Contracts

| Network | Contract | Address |
| --- | --- | --- |
| Base Sepolia | `ChessPieceNFT` | [`0x037eB04D95165F3642cF62049732D757AeF6cA2F`](https://sepolia.basescan.org/address/0x037eB04D95165F3642cF62049732D757AeF6cA2F) |
| Base Sepolia | `GameManager` | [`0x42B9B91bbFaA6c48A91592B0730722DAc05f1Fd1`](https://sepolia.basescan.org/address/0x42B9B91bbFaA6c48A91592B0730722DAc05f1Fd1) |
| Ethereum Sepolia | `ChessPieceNFT` | [`0x037eB04D95165F3642cF62049732D757AeF6cA2F`](https://sepolia.etherscan.io/address/0x037eB04D95165F3642cF62049732D757AeF6cA2F) |
| Ethereum Sepolia | `GameManager` | [`0x42B9B91bbFaA6c48A91592B0730722DAc05f1Fd1`](https://sepolia.etherscan.io/address/0x42B9B91bbFaA6c48A91592B0730722DAc05f1Fd1) |

Chain IDs: **Base Sepolia `84532`**, **Ethereum Sepolia `11155111`**. The addresses
coincide across the two chains, but their contracts, balances, and game state are independent.

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

For Vercel, import this repository, set the project root directory to `agent-service`, and add `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL=deepseek-flash`, and `AI_ALLOWED_ORIGINS=https://yuanhao97.github.io` as environment variables. Use origins only (`https://yuanhao97.github.io`), not page paths. The handler also normalizes a mistakenly configured URL that includes `/gobang-on-chain/`. The included Vercel Functions expose `/health` and `/recommend`; each push to the selected branch triggers a new deployment.

The recommendation endpoint is read-only: it uses no wallet private key, cannot send a transaction, and validates model output against the submitted board before returning it.

### Sepolia fast moves

The deployed game contract supports a short-lived session key for moves. The player approves one session signature in MetaMask, then a relay submits signed moves and pays their Sepolia gas for up to two hours. The session key is stored only in that browser tab and can call only the contract's move path; it cannot transfer wallet assets.

To enable the relay in the existing Vercel project, add these server-side environment variables and redeploy:

```text
SEPOLIA_RPC_URL=https://your-sepolia-rpc.example/v1/your-key
RELAYER_PRIVATE_KEY=0xyour_dedicated_sepolia_relayer_private_key
GAME_MANAGER_ADDRESS=0x42B9B91bbFaA6c48A91592B0730722DAc05f1Fd1
ROBOT_PIECE_ID=the_relay_owned_piece_id
RELAY_CHAIN_ID=11155111
RELAY_ALLOWED_ORIGINS=https://yuanhao97.github.io
```

Use a separate test-only relay wallet with a small Sepolia ETH balance. Never use the deployer key or a wallet that holds real assets. The same relay wallet pays for signed fast moves and acts as the Sepolia computer opponent, so its wins are recorded under the relay wallet address. Set the GitHub Actions repository variable `VITE_RELAY_URL` to the Vercel service URL; the workflow falls back to `https://gobang-on-chain.vercel.app`. The frontend checks `/health` and enables fast moves and the Sepolia computer only when all relay settings are present.

During first-time setup, leave `ROBOT_PIECE_ID` empty, deploy once, and call `POST /relay/computer/prepare` from an allowed origin. Save the returned `computerPieceId` as `ROBOT_PIECE_ID` in the hosting environment and redeploy. Later instances verify that fixed NFT belongs to the relay account instead of scanning historical logs.

Minting, creating a match, and joining a match still use normal wallet transactions because the currently deployed contracts authorize those operations with `msg.sender`. Removing those confirmations requires a new contract deployment with scoped meta-transactions or a smart-account/session-key design.

## Deploy to Base Sepolia

Base Sepolia uses chain ID `84532`, RPC `https://sepolia.base.org`, and explorer `https://sepolia.basescan.org`.
Fund the deployer with Base Sepolia test ETH. Set `BASE_SEPOLIA_RPC_URL` and optionally
`BASE_SEPOLIA_PRIVATE_KEY` in `.env`; if the key is omitted, deployment reuses the dedicated
test wallet in `SEPOLIA_PRIVATE_KEY`.

```bash
npm run deploy:base-sepolia
npm --prefix web run build
```

Deployment writes `deployments/baseSepolia.json` and `web/public/deployments/baseSepolia.json`.
The page's network button switches between Ethereum Sepolia and Base Sepolia and asks
MetaMask to switch with it (adding the network if needed). The selected network is remembered
in this browser. The original Ethereum deployment remains in `web/public/deployments/sepolia.json`.
Both contracts must be deployed on the new network. Existing Ethereum Sepolia NFTs, games,
and leaderboard entries remain accessible by switching back to Ethereum Sepolia.

For the hosted relay and computer opponent, fund its separate wallet on Base Sepolia and
update the hosting environment before publishing the frontend:

```text
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_SEPOLIA_GAME_MANAGER_ADDRESS=the_new_base_sepolia_game_manager_address
BASE_SEPOLIA_ROBOT_PIECE_ID=
```

Keep the original `SEPOLIA_RPC_URL`, `GAME_MANAGER_ADDRESS`, `ROBOT_PIECE_ID`,
`RELAY_CHAIN_ID=11155111`, `RELAYER_PRIVATE_KEY`, and allowed origins so existing clients
continue to work. Both networks may share the dedicated test relay key; optionally set
`BASE_SEPOLIA_RELAYER_PRIVATE_KEY` to use a separate Base wallet. Fund the chosen wallet
on each chain it serves.

Redeploy, call `POST /relay/computer/prepare` with JSON body `{"chainId":84532}`, then save
the returned piece ID as `BASE_SEPOLIA_ROBOT_PIECE_ID` and redeploy again. Do not reuse the
Ethereum computer NFT ID on Base. The backend routes requests by the body's `chainId`;
old clients without that field still use `RELAY_CHAIN_ID`. Health checks accept the query
`/health?chainId=84532`, and the frontend validates both chain and game-contract address.

Alternatively, initialize the computer NFT from the deployer without downloading the hosted
relay key: run `COMPUTER_ADDRESS=the_relay_wallet_address npx hardhat run scripts/prepareComputer.js --network baseSepolia`.
This mints a piece, transfers it to the relay wallet, verifies ownership, and saves the piece
ID to the deployment files. Set that ID as `BASE_SEPOLIA_ROBOT_PIECE_ID` before deploying the
backend. Re-running the script verifies the saved piece instead of minting another one.

Sessions, computer-match IDs, and retries are isolated by chain and contract. Rejecting a
MetaMask network-switch request leaves the current game network selected. Until Base
contracts are deployed, choosing Base displays a pending-deployment notice.

To change the default network for new visitors, run `npm run use:base-sepolia` or
`npm run use:sepolia`. These commands preserve the other network's deployment file.

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
