import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserProvider, Contract, getBytes, id, solidityPackedKeccak256, Wallet } from "ethers";
import { chessPieceAbi, gameManagerAbi } from "./contracts";
import { queryFilterInChunks } from "./eventLogs";
import { buildVictoryLeaderboard } from "./leaderboard";
import { BLACK_FALLBACK_SKIN, PALETTES, skinFromMetadataURI, WHITE_FALLBACK_SKIN } from "./pieceSkin";
import "./styles.css";

const EMPTY_ADDRESS = "0x0000000000000000000000000000000000000000";
const LOCAL_COMPUTER_URL = "http://127.0.0.1:8787";
const LOCAL_AI_RECOMMENDER_URL = ["127.0.0.1", "localhost"].includes(window.location.hostname)
  ? "http://127.0.0.1:8790"
  : "";
const AI_RECOMMENDER_URL = (import.meta.env.VITE_AI_RECOMMENDER_URL || LOCAL_AI_RECOMMENDER_URL).replace(/\/$/, "");
const RELAY_SERVICE_URL = (import.meta.env.VITE_RELAY_URL || "").replace(/\/$/, "");
const FAST_SESSION_SECONDS = 2 * 60 * 60;
const DEFAULT_TURN_MINUTES = 100;
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

function boardCoordinate(x, y) {
  return `${String.fromCharCode(65 + x)}${y + 1}`;
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
  const [turnMinutes, setTurnMinutes] = useState(DEFAULT_TURN_MINUTES);
  const [notice, setNotice] = useState("Deploy contracts, then connect a wallet.");
  const [pending, setPending] = useState(false);
  const [aiPending, setAiPending] = useState(false);
  const [aiRecommendation, setAiRecommendation] = useState(null);
  const [publicRelayAvailable, setPublicRelayAvailable] = useState(false);
  const [robotAddress, setRobotAddress] = useState("");

  const contractsReady = Boolean(config?.chessPieceNFT && config?.gameManager);
  const game = useMemo(
    () => provider && contractsReady ? new Contract(config.gameManager, gameManagerAbi, provider) : null,
    [provider, config, contractsReady]
  );
  const pieceContract = useMemo(
    () => provider && contractsReady ? new Contract(config.chessPieceNFT, chessPieceAbi, provider) : null,
    [provider, config, contractsReady]
  );
  const leaderboard = useMemo(() => buildVictoryLeaderboard(matches), [matches]);
  const activeMatch = matches.find((match) => match.id === selectedMatch);
  const canJoinActiveMatch = activeMatch?.status === 0
    && activeMatch.creator.toLowerCase() !== account.toLowerCase();
  const localServicesEnabled = Number(config?.chainId) === 31337;
  const relayEnabled = localServicesEnabled || publicRelayAvailable;
  const computerEnabled = localServicesEnabled || Boolean(publicRelayAvailable && robotAddress);
  const isComputerMatch = Boolean(activeMatch && (
    (localServicesEnabled && computerMatchIds.includes(activeMatch.id))
    || (!localServicesEnabled && robotAddress
      && activeMatch.joiner.toLowerCase() === robotAddress.toLowerCase())
  ));
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
    if (!config?.gameManager || !account || !relayEnabled) {
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
  }, [config?.gameManager, account, relayEnabled]);

  useEffect(() => {
    if (!config?.chainId || localServicesEnabled || !RELAY_SERVICE_URL) {
      setPublicRelayAvailable(false);
      setRobotAddress("");
      return undefined;
    }
    let cancelled = false;
    fetch(`${RELAY_SERVICE_URL}/health`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Relay health check failed.")))
      .then((payload) => {
        if (!cancelled) {
          setPublicRelayAvailable(Boolean(payload.relayerConfigured && Number(payload.relayChainId) === Number(config.chainId)));
          setRobotAddress(payload.robotAddress || "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPublicRelayAvailable(false);
          setRobotAddress("");
        }
      });
    return () => { cancelled = true; };
  }, [config?.chainId, localServicesEnabled]);

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
    setAiRecommendation(null);
  }, [activeMatch?.id, activeMatch?.moveCount, activeMatch?.status]);

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
    if (!relayEnabled || !activeMatch || activeMatch.status !== 1 || !isParticipant || hasFastSession
      || !game || !provider || !account) return;
    const attemptKey = `${config.gameManager}-${account.toLowerCase()}-${activeMatch.id}`;
    if (fastSessionAttempts.current.has(attemptKey)) return;
    fastSessionAttempts.current.add(attemptKey);
    void enableFastMoves();
  }, [activeMatch?.id, activeMatch?.status, isParticipant, hasFastSession, game, provider, account, config?.gameManager, relayEnabled]);

  useEffect(() => {
    if (!window.ethereum?.on) return undefined;
    const handleAccountsChanged = (accounts) => {
      const nextAccount = accounts[0] || "";
      setAccount(nextAccount);
      setNotice(nextAccount ? `Wallet account switched to ${shortAddress(nextAccount)}.` : "Wallet disconnected.");
    };
    window.ethereum.on("accountsChanged", handleAccountsChanged);
    return () => window.ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
  }, []);

  async function connectWallet() {
    try {
      if (!window.ethereum) throw new Error("Install MetaMask or another injected EVM wallet first.");
      if (!contractsReady) throw new Error("Contracts have not been deployed for the selected network.");
      const nextProvider = new BrowserProvider(window.ethereum);
      // Requesting the eth_accounts permission makes MetaMask show its account selector,
      // including when this site has already been connected before.
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }]
      });
      const accounts = await nextProvider.send("eth_requestAccounts", []);
      if (!accounts[0]) throw new Error("Choose an account in MetaMask to continue.");
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
      const [pieceEvents, matchEvents] = await Promise.all([
        queryFilterInChunks(pieceContract, pieceContract.filters.ChessPieceCreated(null, account), fromBlock),
        queryFilterInChunks(game, game.filters.MatchCreated(), fromBlock)
      ]);
      const loadedPieces = await Promise.all(pieceEvents.map(async (event) => {
        const pieceId = event.args.pieceId;
        const owner = await pieceContract.ownerOf(pieceId);
        return { id: pieceId.toString(), name: event.args.displayName, owner };
      }));
      const ownedPieces = loadedPieces.filter((piece) => piece.owner.toLowerCase() === account.toLowerCase());
      setPieces(ownedPieces);
      if (!selectedPiece && ownedPieces[0]) setSelectedPiece(ownedPieces[0].id);

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
      const payload = await response.json().catch(() => ({}));
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

  function callComputer(endpoint, body, statusMessage) {
    if (localServicesEnabled) {
      return callLocalService(endpoint, body, statusMessage || "Local computer is preparing its move…");
    }
    return callRelayService(`computer/${endpoint}`, body, statusMessage || "Sepolia computer is preparing its move…");
  }

  async function callRelayService(endpoint, body, statusMessage) {
    if (localServicesEnabled) return callLocalService(`relay/${endpoint}`, body, statusMessage);
    if (!publicRelayAvailable || !RELAY_SERVICE_URL) throw new Error("The Sepolia fast-move relay is unavailable.");
    setNotice(statusMessage);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(`${RELAY_SERVICE_URL}/relay/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The Sepolia fast-move relay did not respond.");
      await refresh();
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("The Sepolia fast-move relay timed out.");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
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
      await callRelayService("activate", {
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
      await callRelayService("move", {
        matchId: activeMatch.id,
        x,
        y,
        player: account,
        signatureDeadline: String(signatureDeadline),
        signature
      }, "Submitting your fast move…");
      if (isComputerMatch) {
        const computerMove = await callComputer("move", { matchId: activeMatch.id }, "Computer is submitting its on-chain move…");
        showComputerMove(computerMove);
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

  async function joinComputerToMatch(matchId, signer) {
    let joinBody = { matchId };
    if (!localServicesEnabled) {
      const latestBlock = await provider.getBlock("latest");
      const authorizationDeadline = Number(latestBlock.timestamp) + 300;
      const authorization = solidityPackedKeccak256(
        ["bytes32", "address", "uint256", "uint256", "address", "uint64"],
        [
          id("GOBANG_SOLO_JOIN_V1"),
          config.gameManager,
          BigInt(config.chainId),
          BigInt(matchId),
          account,
          BigInt(authorizationDeadline)
        ]
      );
      setNotice("Approve the one-time invitation for the Sepolia computer…");
      const signature = await signer.signMessage(getBytes(authorization));
      joinBody = {
        matchId,
        player: account,
        authorizationDeadline: String(authorizationDeadline),
        signature
      };
    }

    await callComputer(
      "join",
      joinBody,
      localServicesEnabled
        ? "Local computer is joining the match…"
        : "Sepolia computer is minting or selecting its piece and joining on-chain…"
    );
    setComputerMatchIds((currentIds) => {
      const nextIds = [...new Set([...currentIds, String(matchId)])];
      localStorage.setItem(`gobang-computer-matches-${config.gameManager}`, JSON.stringify(nextIds));
      return nextIds;
    });
    setSelectedMatch(String(matchId));
    await refresh();
    setNotice("Computer joined on-chain. You play black and move first.");
  }

  async function inviteComputer(matchId) {
    try {
      setPending(true);
      const signer = await provider.getSigner();
      await joinComputerToMatch(matchId, signer);
    } catch (error) {
      setNotice(displayError(error));
    } finally {
      setPending(false);
    }
  }

  async function createComputerMatch() {
    if (!computerEnabled) return setNotice("The computer opponent service is unavailable.");
    if (!selectedPiece) return setNotice("Create or select a chess piece first.");
    const duration = Number(turnMinutes) * 60;
    try {
      setPending(true);
      const signer = await provider.getSigner();
      const transaction = await game.connect(signer).createMatch(selectedPiece, 15, duration);
      setNotice("Creating the on-chain computer match…");
      const receipt = await transaction.wait(1, 30000);
      if (!receipt) throw new Error("Match creation timed out. Check the wallet activity and refresh the page.");
      const created = receipt.logs.map((log) => {
        try { return game.interface.parseLog(log); } catch { return null; }
      }).find((event) => event?.name === "MatchCreated");
      if (!created) throw new Error("The match creation event was not found.");
      const matchId = created.args.matchId.toString();
      await joinComputerToMatch(matchId, signer);
    } catch (error) {
      setNotice(displayError(error));
    } finally {
      setPending(false);
    }
  }

  function joinMatch(matchId) {
    if (!selectedPiece) return setNotice("Select a chess piece before joining.");
    return send((signer) => game.connect(signer).joinMatch(matchId, selectedPiece), "Match joined. Black moves first.");
  }

  function showComputerMove(result) {
    if (result?.skipped || !activeMatch) return;
    const index = Number(result?.index);
    const cellCount = activeMatch.boardSize * activeMatch.boardSize;
    if (!Number.isInteger(index) || index < 0 || index >= cellCount) return;
    setBoard((currentBoard) => {
      if (currentBoard.length !== cellCount) return currentBoard;
      const nextBoard = [...currentBoard];
      nextBoard[index] = 2;
      return nextBoard;
    });
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
        const computerMove = await callComputer("move", { matchId: activeMatch.id }, "Computer is submitting its on-chain move…");
        showComputerMove(computerMove);
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

  async function requestAiRecommendation() {
    if (!AI_RECOMMENDER_URL) {
      setNotice("The AgentKit recommendation service is not configured for this deployment.");
      return;
    }
    if (!activeMatch || !canPlay || board.length !== activeMatch.boardSize * activeMatch.boardSize) {
      setNotice("AI move advice is available when the on-chain board is loaded and it is your turn.");
      return;
    }

    const playerStone = activeMatch.currentPlayer.toLowerCase() === activeMatch.creator.toLowerCase() ? 1 : 2;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      setAiPending(true);
      setAiRecommendation(null);
      setNotice("AgentKit and DeepSeek are analyzing the current board…");
      const response = await fetch(`${AI_RECOMMENDER_URL}/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board, boardSize: activeMatch.boardSize, playerStone }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "The AI recommender did not respond.");

      const index = Number(payload.y) * activeMatch.boardSize + Number(payload.x);
      if (!Number.isInteger(index) || index < 0 || index >= board.length || board[index] !== 0) {
        throw new Error("The AI recommender returned an invalid move.");
      }
      setAiRecommendation(payload);
      setNotice(`DeepSeek recommends ${boardCoordinate(payload.x, payload.y)}. Review the suggestion before playing.`);
    } catch (error) {
      const message = error?.name === "AbortError" ? "The recommendation service timed out." : displayError(error);
      setNotice(`AI recommendation failed: ${message}`);
    } finally {
      window.clearTimeout(timeout);
      setAiPending(false);
    }
  }

  function selectMatch(matchId) {
    setBoard([]);
    setSelectedMatch(matchId);
  }

  function renderMatchBoard(readOnly = false) {
    if (!activeMatch || board.length !== activeMatch.boardSize * activeMatch.boardSize) {
      return <p className="field-help">Loading the on-chain board…</p>;
    }
    const suggestedIndex = aiRecommendation
      ? Number(aiRecommendation.y) * activeMatch.boardSize + Number(aiRecommendation.x)
      : -1;
    return <div className={`board ${readOnly ? "board-snapshot" : ""}`} style={{ gridTemplateColumns: `repeat(${activeMatch.boardSize}, 1fr)` }}>{board.map((stone, index) => <button aria-label={`Cell ${index}`} className={`cell stone-${stone} ${!readOnly && index === suggestedIndex ? "recommended" : ""}`} disabled={readOnly || !canPlay || stone !== 0 || pending || aiPending || isTurnExpired} key={index} onClick={readOnly ? undefined : () => playMove(index)}><span style={stone === 0 ? undefined : { "--stone-primary": skinForStone(stone).primary, "--stone-secondary": skinForStone(stone).secondary }} /></button>)}</div>;
  }

  const statusLabel = (match) => ["Open", "Active", "Finished"][match.status] || "Unknown";
  const canPlay = activeMatch?.status === 1 && activeMatch.currentPlayer.toLowerCase() === account.toLowerCase();
  const skinForStone = (stone) => (stone === 1 ? matchSkins.creator : matchSkins.joiner);

  return <main>
    <header>
      <div><p className="eyebrow">ETHEREUM SEPOLIA TESTNET</p><h1>Gobang On-Chain</h1></div>
      <button onClick={connectWallet} disabled={pending}>{account ? `Switch account (${shortAddress(account)})` : "Connect wallet"}</button>
    </header>
    <p className="network-note"><strong>Transactions use Ethereum Sepolia.</strong> Minting pieces and creating or joining matches require a MetaMask confirmation. Sepolia computer matches use the relay wallet as the on-chain opponent, and every computer move is a real transaction. When the relay is available, one session signature enables no-popup player moves for two hours. Do not send mainnet ETH to this game.</p>
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
        <div className="actions"><button className="secondary" onClick={createMatch} disabled={!account || pending}>Create multiplayer match</button>{computerEnabled && <button onClick={createComputerMatch} disabled={!account || pending}>{localServicesEnabled ? "Play local computer" : "Play Sepolia computer"}</button>}</div>
      </article>
    </section>

    <section className="leaderboard">
      <div className="section-title"><div><p className="eyebrow">ON-CHAIN RECORDS</p><h2>Victory leaderboard</h2></div></div>
      <p className="field-help">Top three wallet addresses ranked by wins across finished matches on the connected network.</p>
      {leaderboard.length === 0 ? <p className="leaderboard-empty">No winners yet. Finish a match to enter the leaderboard.</p> : <ol className="leaderboard-list">{leaderboard.map((entry, index) => <li className="leaderboard-entry" key={entry.address}>
        <span className="leaderboard-rank">#{index + 1}</span>
        {Number(config?.chainId) === 11155111
          ? <a className="leaderboard-address" href={`https://sepolia.etherscan.io/address/${entry.address}`} target="_blank" rel="noreferrer">{entry.address}</a>
          : <code className="leaderboard-address">{entry.address}</code>}
        <strong className="leaderboard-wins">{entry.wins} {entry.wins === 1 ? "win" : "wins"}</strong>
      </li>)}</ol>}
    </section>

    <section className="matches"><div className="section-title"><h2>Match lobby</h2><button className="secondary" onClick={refresh} disabled={!account || pending}>Refresh</button></div>
      {matches.length === 0 ? <p>No matches yet.</p> : <div className="match-list">{matches.map((match) => <button className={`match ${selectedMatch === match.id ? "selected" : ""}`} key={match.id} onClick={() => selectMatch(match.id)}>
        <strong>Match #{match.id}</strong><span>{statusLabel(match)} · {match.moveCount} moves</span><span>Black: {shortAddress(match.creator)}</span>
        {!localServicesEnabled && robotAddress && match.joiner.toLowerCase() === robotAddress.toLowerCase() && <span>Computer opponent · fully on-chain</span>}
        {match.status === 0 && match.creator.toLowerCase() !== account.toLowerCase() && <span className="join">Available to join</span>}
        {match.status === 2 && <span className="snapshot-link">View final board snapshot</span>}
      </button>)}</div>}
    </section>

    {activeMatch && <section className="game"><div className="section-title"><div><p className="eyebrow">MATCH #{activeMatch.id}</p><h2>{statusLabel(activeMatch)}</h2></div>{canJoinActiveMatch && <button onClick={() => joinMatch(activeMatch.id)} disabled={!selectedPiece || pending}>Join with selected piece</button>}{computerEnabled && activeMatch.status === 0 && activeMatch.creator.toLowerCase() === account.toLowerCase() && <button onClick={() => inviteComputer(activeMatch.id)} disabled={pending}>Invite computer</button>}{activeMatch.status === 1 && <button className="secondary" onClick={resign} disabled={pending}>Resign</button>}{isTurnExpired && <button className="secondary" onClick={settleExpiredMatch} disabled={pending}>Settle expired match</button>}</div>
      {activeMatch.status === 0 && <p>This match is waiting for a second wallet to join. The creator will play black and make the first move after joining.</p>}
      {activeMatch.status === 1 && <><p>{isTurnExpired ? "This turn has expired. Settle the match to award the win to the other player." : (isComputerMatch ? (canPlay ? "Your turn — you play black." : "Computer is preparing an on-chain move…") : `${shortAddress(activeMatch.currentPlayer)} to move${canPlay ? " — your turn" : ""}. Live updates run every 3 seconds.`)}</p>{relayEnabled && isParticipant && <div className="fast-moves">{hasFastSession ? <span>⚡ Fast moves are enabled for this browser session.</span> : <button className="secondary" onClick={enableFastMoves} disabled={pending}>Retry fast moves</button>} {!hasFastSession && <small>Fast-move authorization opens automatically once per active match. One MetaMask signature enables no-popup moves for two hours.</small>}</div>}{isParticipant && <div className="ai-advisor"><div><p className="eyebrow">AGENTKIT + DEEPSEEK</p><strong>AI move advisor</strong></div><button className="secondary" onClick={requestAiRecommendation} disabled={!canPlay || aiPending || pending || isTurnExpired || !AI_RECOMMENDER_URL}>{aiPending ? "Analyzing…" : "Recommend a move"}</button>{aiRecommendation ? <p><b>{boardCoordinate(aiRecommendation.x, aiRecommendation.y)}</b> — {aiRecommendation.reason} <small>{Math.round(Number(aiRecommendation.confidence) * 100)}% confidence</small></p> : <small>{AI_RECOMMENDER_URL ? (canPlay ? "Suggestions highlight a legal empty intersection but never play it automatically." : "A recommendation is available on your turn.") : "Configure VITE_AI_RECOMMENDER_URL to enable recommendations."}</small>}</div>}<div className="skin-legend"><span><i style={{ "--stone-primary": matchSkins.creator.primary, "--stone-secondary": matchSkins.creator.secondary }} />Black: {matchSkins.creator.style}</span><span><i style={{ "--stone-primary": matchSkins.joiner.primary, "--stone-secondary": matchSkins.joiner.secondary }} />White: {matchSkins.joiner.style}</span></div>{renderMatchBoard()}</>}
      {activeMatch.status === 2 && <><p>{activeMatch.winner !== EMPTY_ADDRESS ? `${shortAddress(activeMatch.winner)} won.` : "This match ended without a winner."} Finish reason: {finishReasonLabel(activeMatch.reason)}.</p><p className="snapshot-title">Final board snapshot</p><div className="skin-legend"><span><i style={{ "--stone-primary": matchSkins.creator.primary, "--stone-secondary": matchSkins.creator.secondary }} />Black: {matchSkins.creator.style}</span><span><i style={{ "--stone-primary": matchSkins.joiner.primary, "--stone-secondary": matchSkins.joiner.secondary }} />White: {matchSkins.joiner.style}</span></div>{renderMatchBoard(true)}</>}
    </section>}
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);
