# Gobang On-Chain

An EVM-based, turn-by-turn Gobang game. Players mint cosmetic chess-piece NFTs and use owned pieces to create or join matches.

## Current Scope

- `ChessPieceNFT`: ERC-721 chess-piece identity with immutable display name and metadata URI.
- `GameManager`: 15x15 freestyle Gobang matches with turn deadlines, five-in-a-row detection, resignation, cancellation, and expiry.
- Hardhat tests for core minting, ownership, move validation, win, and timeout behavior.

## Prerequisites

- Node.js 20 or later
- npm 10 or later

## Run Locally

```bash
npm install
npm run compile
npm test
```

## Run the Local Game

Use three terminals from the repository root.

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

For an on-chain single-player match against the local computer, start one additional local-only service before selecting **Play local computer** in the web client:

```bash
# Terminal 4: start the computer account service
npm run bot:local
```

The computer uses one publicly known Hardhat development account and is only safe for the local node at `127.0.0.1`. It must never be used with a public RPC endpoint or real funds.

During an active match, each player can select **Enable fast moves**. MetaMask asks for one signature to authorize a two-hour browser session; subsequent moves are signed by a temporary session key and relayed by the local service, so they do not open a MetaMask confirmation popup. This relay flow is local-development infrastructure only.

Open `http://127.0.0.1:5173/` in a browser. The page is not served from the RPC endpoint at port `8545`.

To use the client, add a local network in MetaMask or another EVM wallet:

| Setting | Value |
| --- | --- |
| Network name | Hardhat Local |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |

Import one of the private keys printed by `npm run node` into the wallet. Those accounts are only for local development and must never be used on a public network.

For the player account, use Hardhat account #2. It stays separate from the deployer and the local computer account:

```text
Address:     0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
Private key: 5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
```

If MetaMask reports a local RPC or nonce error after the node has been restarted or modified by scripts, open **Settings → Advanced → Clear activity tab data**, then reconnect to the Hardhat Local network. This only clears local wallet transaction history; it does not affect the Hardhat chain.

## Deploy to Ethereum Sepolia

Use a new test-only wallet with Sepolia ETH. Do not reuse a wallet that holds mainnet assets. Copy `.env.example` to `.env`, then set a Sepolia RPC URL and the private key for that test wallet. The `.env` file is ignored by Git.

```bash
cp .env.example .env
npm run deploy:sepolia
```

The contract addresses are saved to `deployments/sepolia.json`. The local web client remains pointed at Hardhat until you explicitly switch it:

```bash
npm run use:sepolia
npm --prefix web run build
```

Switch MetaMask to **Ethereum Sepolia** (chain ID `11155111`) before opening the web client. The public-testnet client supports multiplayer matches. The local computer and no-popup fast-move relay are intentionally disabled because they require a locally running trusted service.

To return the web client to the local Hardhat deployment, run `npm run deploy:local` again.

## Repository Layout

```text
contracts/ChessPieceNFT.sol  Custom chess-piece NFT contract
contracts/GameManager.sol    Authoritative Gobang rules contract
test/GameManager.js          Contract behavior tests
docs/design.md               Product and technical design
```

## Development Notes

The contracts have not been audited and must not be used with real-value staking or production funds. The first release intentionally limits games to standard 15x15 freestyle rules and treats chess pieces as cosmetic identities only.
