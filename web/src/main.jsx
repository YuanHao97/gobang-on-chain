import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserProvider, Contract, getBytes, solidityPackedKeccak256, Wallet } from "ethers";
import { chessPieceAbi, gameManagerAbi } from "./contracts";
import { BLACK_FALLBACK_SKIN, PALETTES, skinFromMetadataURI, WHITE_FALLBACK_SKIN } from "./pieceSkin";
import "./styles.css";

const EMPTY_ADDRESS = "0x0000000000000000000000000000000000000000";
const LOCAL_COMPUTER_URL = "http://127.0.0.1:8787";
const FAST_SESSION_SECONDS = 2 * 60 * 60;
const STYLES = ["Aurora", "Comet", "Ember", "Frost", "Nebula", "Orbit"];
const NOUNS = ["Stone", "Crown", "Echo", "Rune", "Spark", "Wave"];
function randomNumber(maximum) {
  if (window.crypto?.getRandomValues) {
    return window.crypto.getRandomValues(new Uint32Array(1))[0] % maximum;
  }
  return Math.floor(Math.random() * maximum);
}

function createRandomPiece() {
  const style = STYLES[randomNumber(STYLES.length)];
  const noun = NOUNS[randomNumber(NOUNS.length)];
  const palette = PALETTES[randomNumber(PALETTES.length)];
  const seed = randomNumber(1000000);
  return { name: `${style} ${noun} ${seed}`, style, palette: palette.name, seed, ...palette };
}

function createMetadataURI(name, design) {
  const metadata = {
    name,
    description: "A randomly generated custom Gobang chess piece.",
    attributes: [
      { trait_type: "Style", value: design.style },
      { trait_type: "Palette", value: design.palette },
      { trait_type: "Seed", value: String(design.seed) }
    ]
  };
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `data:application/json;base64,${btoa(binary)}`;
}

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function finishReasonLabel(reason) {
  return ["Not recorded", "Five in a row", "Resignation", "Draw", "Turn expired", "Cancelled"][reason] || "Unknown";
}

function displayError(error) {
  const details = [error?.reason, error?.info?.error?.message, error?.message]
    .filter(Boolean)
    .join(" ");
  if (details.includes("TurnExpired")) {
    return "This turn has expired. Settle the match to award the win to the other player.";
  }
  if (details.includes("NotCurrentPlayer")) {
    return "It is not your turn yet.";
  }
  if (details.includes("CellOccupied")) {
    return "That intersection is already occupied. The board has been refreshed.";
  }
  if (details.includes("SessionMoveExpired")) {
    return "The fast-move signature expired before it reached the relay. Try the move again.";
  }
  if (details.includes("SessionKeyExpired") || details.includes("InvalidSessionKey")) {
    return "Your fast-move session has expired. Enable fast moves again.";
  }
  const message = details || error?.shortMessage;
  if (message?.toLowerCase().includes("nonce")) {
    return "Your local wallet nonce is out of date. In MetaMask, clear activity data or switch to the recommended local player account.";
  }
  if (message?.includes("Internal JSON-RPC error")) {
    return "MetaMask rejected the local RPC request. Refresh the local account nonce, then try again.";
  }
  return message || "The transaction failed.";
}

function App() {
  const [config, setConfig] = useState(null);
  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState("");
  const [pieces, setPieces] = useState([]);
  const [matches, setMatches] = useState([]);
  const [selectedPiece, setSelectedPiece] = useState("");
  const [selectedMatch, setSelectedMatch] = useState("");
  const [board, setBoard] = useState([]);
  const [pieceName, setPieceName] = useState("");
  const [pieceDesign, setPieceDesign] = useState(() => createRandomPiece());
  const [computerMatchIds, setComputerMatchIds] = useState([]);
  const [matchSkins, setMatchSkins] = useState({ creator: BLACK_FALLBACK_SKIN, joiner: WHITE_FALLBACK_SKIN });
  const [fastSession, setFastSession] = useState(null);
  const fastSessionAttempts = useRef(new Set());
  const [turnMinutes, setTurnMinutes] = useState(10);
  const [notice, setNotice] = useState("Deploy contracts, then connect a wallet.");
  const [pending, setPending] = useState(false);

  const contractsReady = Boolean(config?.chessPieceNFT && config?.gameManager);
  const game = useMemo(
    () => provider && contractsReady ? new Contract(config.gameManager, gameManagerAbi, provider) : null,
    [provider, config, contractsReady]
  );
  const pieceContract = useMemo(
    () => provider && contractsReady ? new Contract(config.chessPieceNFT, chessPieceAbi, provider) : null,
    [provider, config, contractsReady]
  );
  const activeMatch = matches.find((match) => match.id === selectedMatch);
  const canJoinActiveMatch = activeMatch?.status === 0
    && activeMatch.creator.toLowerCase() !== account.toLowerCase();
  const localServicesEnabled = Number(config?.chainId) === 31337;
  const isComputerMatch = Boolean(localServicesEnabled && activeMatch && computerMatchIds.includes(activeMatch.id));
  const isParticipant = Boolean(activeMatch && (activeMatch.creator.toLowerCase() === account.toLowerCase()
    || activeMatch.joiner.toLowerCase() === account.toLowerCase()));
  const isTurnExpired = Boolean(activeMatch?.status === 1
    && activeMatch.deadline < Math.floor(Date.now() / 1000));
  const hasFastSession = Boolean(fastSession
    && fastSession.player === account.toLowerCase()
    && fastSession.expiresAt > Math.floor(Date.now() / 1000));

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}contracts.json`, { cache: "no-store" })
      .then((response) => response.json())
      .then(setConfig)
      .catch(() => setNotice("Unable to load deployment configuration."));
  }, []);

  useEffect(() => {
    if (!config?.gameManager) return;
    try {
      const savedIds = JSON.parse(localStorage.getItem(`gobang-computer-matches-${config.gameManager}`) || "[]");
      setComputerMatchIds(Array.isArray(savedIds) ? savedIds.map(String) : []);
    } catch {
      setComputerMatchIds([]);
    }
  }, [config?.gameManager]);

  useEffect(() => {
    if (!config?.gameManager || !account || !localServicesEnabled) {
      setFastSession(null);
      return;
    }
    try {
      const key = `gobang-fast-session-${config.gameManager}-${account.toLowerCase()}`;
      const savedSession = JSON.parse(sessionStorage.getItem(key) || "null");
      setFastSession(savedSession?.expiresAt > Math.floor(Date.now() / 1000)
        ? { ...savedSession, player: account.toLowerCase() }
        : null);
    } catch {
      setFastSession(null);
    }
  }, [config?.gameManager, account, localServicesEnabled]);

  useEffect(() => {
    setPieceName((currentName) => currentName || pieceDesign.name);
  }, []);

  useEffect(() => {
    if (provider && account && game && pieceContract) refresh();
  }, [provider, account, game, pieceContract]);

  useEffect(() => {
    if (activeMatch && game) loadBoard(activeMatch);
    else setBoard([]);
  }, [activeMatch?.id, activeMatch?.moveCount, activeMatch?.status, game]);

  useEffect(() => {
    if (!activeMatch || activeMatch.status !== 1 || !account) return undefined;
    const interval = window.setInterval(() => { refresh(); }, 3000);
    return () => window.clearInterval(interval);
  }, [activeMatch?.id, activeMatch?.status, account, game, pieceContract]);

  useEffect(() => {
    let cancelled = false;
    if (!activeMatch || !pieceContract) {
      setMatchSkins({ creator: BLACK_FALLBACK_SKIN, joiner: WHITE_FALLBACK_SKIN });
      return undefined;
    }
    async function loadMatchSkins() {
      try {
        const [creatorURI, joinerURI] = await Promise.all([
          pieceContract.tokenURI(activeMatch.creatorPieceId),
          activeMatch.joinerPieceId === "0" ? Promise.resolve("") : pieceContract.tokenURI(activeMatch.joinerPieceId)
        ]);
        if (!cancelled) {
          setMatchSkins({
            creator: skinFromMetadataURI(creatorURI, BLACK_FALLBACK_SKIN),
            joiner: skinFromMetadataURI(joinerURI, WHITE_FALLBACK_SKIN)
          });
        }
      } catch (error) {
        if (!cancelled) setNotice(`Piece skin load failed: ${displayError(error)}`);
      }
    }
    loadMatchSkins();
    return () => { cancelled = true; };
  }, [activeMatch?.id, activeMatch?.creatorPieceId, activeMatch?.joinerPieceId, pieceContract]);

  useEffect(() => {
    if (!localServicesEnabled || !activeMatch || activeMatch.status !== 1 || !isParticipant || hasFastSession
      || !game || !provider || !account) return;
    const attemptKey = `${config.gameManager}-${account.toLowerCase()}-${activeMatch.id}`;
    if (fastSessionAttempts.current.has(attemptKey)) return;
    fastSessionAttempts.current.add(attemptKey);
    void enableFastMoves();
  }, [activeMatch?.id, activeMatch?.status, isParticipant, hasFastSession, game, provider, account, config?.gameManager, localServicesEnabled]);

  async function connectWallet() {
    try {
      if (!window.ethereum) throw new Error("Install MetaMask or another injected EVM wallet first.");
      if (!contractsReady) throw new Error("Contracts have not been deployed for the selected network.");
      const nextProvider = new BrowserProvider(window.ethereum);
      const accounts = await nextProvider.send("eth_requestAccounts", []);
      const network = await nextProvider.getNetwork();
      if (Number(network.chainId) !== config.chainId) {
        throw new Error(`Switch your wallet to chain ID ${config.chainId}.`);
      }
      setProvider(nextProvider);
      setAccount(accounts[0]);
      if (config.localPlayer && accounts[0].toLowerCase() !== config.localPlayer.toLowerCase()) {
        setNotice(`Wallet connected. For a clean local test account, use ${shortAddress(config.localPlayer)}.`);
      } else {
        setNotice("Wallet connected.");
      }
    } catch (error) {
      setNotice(displayError(error));
    }
  }

  async function refresh() {
    if (!game || !pieceContract || !account) return;
    try {
      const fromBlock = config.deploymentBlock || 0;
      const pieceEvents = await pieceContract.queryFilter(pieceContract.filters.ChessPieceCreated(null, account), fromBlock, "latest");
      const loadedPieces = await Promise.all(pieceEvents.map(async (event) => {
        const pieceId = event.args.pieceId;
        const owner = await pieceContract.ownerOf(pieceId);
        return { id: pieceId.toString(), name: event.args.displayName, owner };
      }));
      const ownedPieces = loadedPieces.filter((piece) => piece.owner.toLowerCase() === account.toLowerCase());
      setPieces(ownedPieces);
      if (!selectedPiece && ownedPieces[0]) setSelectedPiece(ownedPieces[0].id);

      const matchEvents = await game.queryFilter(game.filters.MatchCreated(), fromBlock, "latest");
      const loadedMatches = await Promise.all(matchEvents.map(async (event) => {
        const id = event.args.matchId.toString();
        const data = await game.getMatch(event.args.matchId);
        return {
          id,
          creator: data.creator,
          joiner: data.joiner,
          creatorPieceId: data.creatorPieceId.toString(),
          joinerPieceId: data.joinerPieceId.toString(),
          boardSize: Number(data.boardSize),
          moveCount: Number(data.moveCount),
          currentPlayer: data.currentPlayer,
          deadline: Number(data.turnDeadline),
          status: Number(data.status),
          reason: Number(data.finishReason),
          winner: data.winner
        };
      }));
      setMatches(loadedMatches.reverse());
    } catch (error) {
      setNotice(`Refresh failed: ${displayError(error)}`);
    }
  }

  async function loadBoard(match) {
    try {
      const cells = await Promise.all(Array.from({ length: match.boardSize * match.boardSize }, async (_, index) => {
        const x = index % match.boardSize;
        const y = Math.floor(index / match.boardSize);
        return Number(await game.getCell(match.id, x, y));
      }));
      setBoard(cells);
    } catch (error) {
      setNotice(`Board load failed: ${displayError(error)}`);
    }
  }

  async function send(action, successMessage, afterSuccess) {
    try {
      setPending(true);
      const signer = await provider.getSigner();
      const transaction = await action(signer);
      setNotice("Transaction submitted. Waiting for confirmation…");
      const receipt = await transaction.wait(1, 30000);
      if (!receipt) throw new Error("Transaction confirmation timed out. Check the wallet activity and refresh the page.");
      setNotice(successMessage);
      await refresh();
      if (afterSuccess) await afterSuccess();
    } catch (error) {
      setNotice(displayError(error));
    } finally {
      setPending(false);
    }
  }

  function mintPiece(event) {
    event.preventDefault();
    if (!pieceName.trim()) return setNotice("Enter a chess-piece name.");
    const design = pieceDesign || createRandomPiece();
    const uri = createMetadataURI(pieceName.trim(), design);
    return send((signer) => pieceContract.connect(signer).mint(pieceName.trim(), uri), "Chess piece created.");
  }

  function randomizePiece() {
    const design = createRandomPiece();
    setPieceDesign(design);
    setPieceName(design.name);
    setNotice("A new random chess-piece design is ready to mint.");
  }

  function createMatch() {
    if (!selectedPiece) return setNotice("Create or select a chess piece first.");
    const duration = Number(turnMinutes) * 60;
    return send(
      (signer) => game.connect(signer).createMatch(selectedPiece, 15, duration),
      "Match created. Share the lobby with an opponent."
    );
  }

  async function callLocalService(endpoint, body, statusMessage) {
    setNotice(statusMessage);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${LOCAL_COMPUTER_URL}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The local computer did not respond.");
      await refresh();
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("The local computer did not reply within 15 seconds. Confirm that npm run bot:local is running.");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function callLocalComputer(endpoint, matchId) {
    return callLocalService(endpoint, { matchId }, "Local computer is preparing its move…");
  }

  async function enableFastMoves() {
    if (!game || !provider || !account) return;
    try {
      setPending(true);
      const signer = await provider.getSigner();
      const sessionWallet = Wallet.createRandom();
      const latestBlock = await provider.getBlock("latest");
      const expiresAt = Number(latestBlock.timestamp) + FAST_SESSION_SECONDS;
      const nonce = await game.sessionActivationNonces(account);
      const authorization = solidityPackedKeccak256(
        ["address", "uint256", "address", "address", "uint64", "uint256"],
        [config.gameManager, BigInt(config.chainId), account, sessionWallet.address, BigInt(expiresAt), nonce]
      );
      setNotice("Approve the one-time fast-move session in MetaMask…");
      const signature = await signer.signMessage(getBytes(authorization));
      await callLocalService("relay/activate", {
        player: account,
        sessionKey: sessionWallet.address,
        expiresAt: String(expiresAt),
        nonce: nonce.toString(),
        signature
      }, "Activating fast moves on the local relay…");
      const session = { privateKey: sessionWallet.privateKey, expiresAt, player: account.toLowerCase() };
      sessionStorage.setItem(`gobang-fast-session-${config.gameManager}-${account.toLowerCase()}`, JSON.stringify(session));
      setFastSession(session);
      setNotice("Fast moves enabled. Your future moves will not open MetaMask.");
    } catch (error) {
      setNotice(displayError(error));
    } finally {
      setPending(false);
    }
  }

  async function playFastMove(index, x, y) {
    try {
      setPending(true);
      const sessionWallet = new Wallet(fastSession.privateKey);
      const latestBlock = await provider.getBlock("latest");
      const signatureDeadline = Number(latestBlock.timestamp) + 60;
      const authorization = solidityPackedKeccak256(
        ["address", "uint256", "uint256", "uint8", "uint8", "address", "uint64"],
        [config.gameManager, BigInt(config.chainId), BigInt(activeMatch.id), x, y, account, BigInt(signatureDeadline)]
      );
      const signature = await sessionWallet.signMessage(getBytes(authorization));
      await callLocalService("relay/move", {
        matchId: activeMatch.id,
        x,
        y,
        player: account,
        signatureDeadline: String(signatureDeadline),
        signature
      }, "Submitting your fast move…");
      if (isComputerMatch) {
        await callLocalComputer("move", activeMatch.id);
        setNotice("Computer move confirmed. Your turn.");
      } else {
        setNotice("Move confirmed. The opponent board will update automatically.");
      }
    } catch (error) {
      setNotice(displayError(error));
    } finally {
      setPending(false);
    }
  }

  function createComputerMatch() {
    if (!localServicesEnabled) return setNotice("The local computer is available only on the local Hardhat network.");
    if (!selectedPiece) return setNotice("Create or select a chess piece first.");
    const duration = Number(turnMinutes) * 60;
    return (async () => {
      try {
        const matchId = (await game.nextMatchId()).toString();
        await send(
          (signer) => game.connect(signer).createMatch(selectedPiece, 15, duration),
          "Match created. Local computer is joining…",
          async () => {
            await callLocalComputer("join", matchId);
            setComputerMatchIds((currentIds) => {
              const nextIds = [...new Set([...currentIds, matchId])];
              localStorage.setItem(`gobang-computer-matches-${config.gameManager}`, JSON.stringify(nextIds));
              return nextIds;
            });
            setSelectedMatch(matchId);
            setNotice("Computer joined. You play black and move first.");
          }
        );
      } catch (error) {
        setNotice(displayError(error));
      }
    })();
  }

  function joinMatch(matchId) {
    if (!selectedPiece) return setNotice("Select a chess piece before joining.");
    return send((signer) => game.connect(signer).joinMatch(matchId, selectedPiece), "Match joined. Black moves first.");
  }

  function playMove(index) {
    if (!activeMatch || board[index] !== 0) return;
    const x = index % activeMatch.boardSize;
    const y = Math.floor(index / activeMatch.boardSize);
    if (hasFastSession) return playFastMove(index, x, y);
    return send(
      (signer) => game.connect(signer).playMove(activeMatch.id, x, y),
      "Move confirmed.",
      isComputerMatch ? async () => {
        await callLocalComputer("move", activeMatch.id);
        setNotice("Computer move confirmed. Your turn.");
      } : undefined
    );
  }

  function resign() {
    if (!activeMatch) return;
    return send((signer) => game.connect(signer).resign(activeMatch.id), "Match resigned.");
  }

  function settleExpiredMatch() {
    if (!activeMatch) return;
    return send((signer) => game.connect(signer).expireMatch(activeMatch.id), "Expired match settled.");
  }

  function selectMatch(matchId) {
    setBoard([]);
    setSelectedMatch(matchId);
  }

  function renderMatchBoard(readOnly = false) {
    if (!activeMatch || board.length !== activeMatch.boardSize * activeMatch.boardSize) {
      return <p className="field-help">Loading the on-chain board…</p>;
    }
    return <div className={`board ${readOnly ? "board-snapshot" : ""}`} style={{ gridTemplateColumns: `repeat(${activeMatch.boardSize}, 1fr)` }}>{board.map((stone, index) => <button aria-label={`Cell ${index}`} className={`cell stone-${stone}`} disabled={readOnly || !canPlay || stone !== 0 || pending || isTurnExpired} key={index} onClick={readOnly ? undefined : () => playMove(index)}><span style={stone === 0 ? undefined : { "--stone-primary": skinForStone(stone).primary, "--stone-secondary": skinForStone(stone).secondary }} /></button>)}</div>;
  }

  const statusLabel = (match) => ["Open", "Active", "Finished"][match.status] || "Unknown";
  const canPlay = activeMatch?.status === 1 && activeMatch.currentPlayer.toLowerCase() === account.toLowerCase();
  const skinForStone = (stone) => (stone === 1 ? matchSkins.creator : matchSkins.joiner);

  return <main>
    <header>
      <div><p className="eyebrow">ETHEREUM SEPOLIA TESTNET</p><h1>Gobang On-Chain</h1></div>
      <button onClick={connectWallet} disabled={pending}>{account ? shortAddress(account) : "Connect wallet"}</button>
    </header>
    <p className="network-note"><strong>Transactions use Ethereum Sepolia.</strong> Minting pieces, creating or joining matches, and playing moves require Sepolia test ETH. Do not send mainnet ETH to this game.</p>
    <p className="notice">{notice}</p>
    {!contractsReady && <p className="warning">Contracts are not deployed for this network. Deploy contracts, then update this client configuration.</p>}

    <section className="grid setup">
      <article><h2>Create a chess piece</h2><form onSubmit={mintPiece}>
        <div className="piece-preview" style={pieceDesign ? { "--primary": pieceDesign.primary, "--secondary": pieceDesign.secondary } : undefined}>
          <span>{pieceDesign.style[0]}</span><div><strong>{pieceDesign.style}</strong><small>{pieceDesign.palette} · seed {pieceDesign.seed}</small></div>
        </div>
        <label>Name<input maxLength="64" value={pieceName} onChange={(event) => setPieceName(event.target.value)} placeholder="Aurora Stone" /></label>
        <p className="field-help">Metadata is generated automatically in the browser and stored as a self-contained data URI.</p>
        <div className="actions"><button type="button" className="secondary" onClick={randomizePiece} disabled={pending}>Randomize</button><button disabled={!account || pending}>Mint piece</button></div>
      </form></article>
      <article><h2>Open a match</h2>
        <label>Chess piece<select value={selectedPiece} onChange={(event) => setSelectedPiece(event.target.value)}><option value="">Select a piece</option>{pieces.map((piece) => <option key={piece.id} value={piece.id}>#{piece.id} — {piece.name}</option>)}</select></label>
        <label>Turn length (minutes)<input type="number" min="1" max="10080" value={turnMinutes} onChange={(event) => setTurnMinutes(event.target.value)} /></label>
        <div className="actions"><button className="secondary" onClick={createMatch} disabled={!account || pending}>Create multiplayer match</button>{localServicesEnabled && <button onClick={createComputerMatch} disabled={!account || pending}>Play local computer</button>}</div>
      </article>
    </section>

    <section className="matches"><div className="section-title"><h2>Match lobby</h2><button className="secondary" onClick={refresh} disabled={!account || pending}>Refresh</button></div>
      {matches.length === 0 ? <p>No matches yet.</p> : <div className="match-list">{matches.map((match) => <button className={`match ${selectedMatch === match.id ? "selected" : ""}`} key={match.id} onClick={() => selectMatch(match.id)}>
        <strong>Match #{match.id}</strong><span>{statusLabel(match)} · {match.moveCount} moves</span><span>Black: {shortAddress(match.creator)}</span>
        {match.status === 0 && match.creator.toLowerCase() !== account.toLowerCase() && <span className="join">Available to join</span>}
        {match.status === 2 && <span className="snapshot-link">View final board snapshot</span>}
      </button>)}</div>}
    </section>

    {activeMatch && <section className="game"><div className="section-title"><div><p className="eyebrow">MATCH #{activeMatch.id}</p><h2>{statusLabel(activeMatch)}</h2></div>{canJoinActiveMatch && <button onClick={() => joinMatch(activeMatch.id)} disabled={!selectedPiece || pending}>Join with selected piece</button>}{activeMatch.status === 1 && <button className="secondary" onClick={resign} disabled={pending}>Resign</button>}{isTurnExpired && <button className="secondary" onClick={settleExpiredMatch} disabled={pending}>Settle expired match</button>}</div>
      {activeMatch.status === 0 && <p>This match is waiting for a second wallet to join. The creator will play black and make the first move after joining.</p>}
      {activeMatch.status === 1 && <><p>{isTurnExpired ? "This turn has expired. Settle the match to award the win to the other player." : (isComputerMatch ? (canPlay ? "Your turn — you play black." : "Local computer is thinking…") : `${shortAddress(activeMatch.currentPlayer)} to move${canPlay ? " — your turn" : ""}. Live updates run every 3 seconds.`)}</p>{localServicesEnabled && isParticipant && <div className="fast-moves">{hasFastSession ? <span>⚡ Fast moves are enabled for this browser session.</span> : <button className="secondary" onClick={enableFastMoves} disabled={pending}>Retry fast moves</button>} {!hasFastSession && <small>Fast-move authorization opens automatically once per active match. One MetaMask signature enables no-popup moves for two hours.</small>}</div>}<div className="skin-legend"><span><i style={{ "--stone-primary": matchSkins.creator.primary, "--stone-secondary": matchSkins.creator.secondary }} />Black: {matchSkins.creator.style}</span><span><i style={{ "--stone-primary": matchSkins.joiner.primary, "--stone-secondary": matchSkins.joiner.secondary }} />White: {matchSkins.joiner.style}</span></div>{renderMatchBoard()}</>}
      {activeMatch.status === 2 && <><p>{activeMatch.winner !== EMPTY_ADDRESS ? `${shortAddress(activeMatch.winner)} won.` : "This match ended without a winner."} Finish reason: {finishReasonLabel(activeMatch.reason)}.</p><p className="snapshot-title">Final board snapshot</p><div className="skin-legend"><span><i style={{ "--stone-primary": matchSkins.creator.primary, "--stone-secondary": matchSkins.creator.secondary }} />Black: {matchSkins.creator.style}</span><span><i style={{ "--stone-primary": matchSkins.joiner.primary, "--stone-secondary": matchSkins.joiner.secondary }} />White: {matchSkins.joiner.style}</span></div>{renderMatchBoard(true)}</>}
    </section>}
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);
