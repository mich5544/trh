import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 14;

const characters = new Set([
  "belut",
  "clari",
  "conti",
  "fede",
  "fra-nicoli",
  "fra",
  "gabri",
  "ghila",
  "greta",
  "loris",
  "mickybi",
  "vale",
  "vegio-michi",
  "vegio",
]);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const clients = new Map();
const chatMessages = [];
const MAX_CHAT_MESSAGES = 80;
const blackjackTable = {
  phase: "waiting",
  round: 0,
  deck: [],
  dealer: [],
  players: new Map(),
  message: "Entra al tavolo e avvia un round quando siete pronti.",
};
const boardGame = {
  phase: "waiting",
  round: 0,
  turnIndex: 0,
  lastRoll: null,
  message: "Entra nel Board Royale e avvia la partita quando siete pronti.",
  players: new Map(),
  properties: new Map(),
};

const boardSpaces = [
  { id: "start", name: "Via del degrado", type: "start", reward: 200 },
  { id: "bar", name: "Bar sospetto", type: "property", price: 120, rent: 20, color: "#ffc857" },
  { id: "tax", name: "Multa morale", type: "tax", amount: 90 },
  { id: "slot", name: "Sala slot", type: "property", price: 180, rent: 32, color: "#ff3864" },
  { id: "bonus", name: "Colpo di fortuna", type: "bonus", amount: 140 },
  { id: "kebab", name: "Kebab imperiale", type: "property", price: 160, rent: 28, color: "#85ff9e" },
  { id: "jail", name: "Pausa vergogna", type: "rest" },
  { id: "disco", name: "Disco triste", type: "property", price: 220, rent: 42, color: "#3ee8ff" },
  { id: "chance", name: "Imprevisto", type: "chance" },
  { id: "hotel", name: "Hotel discutibile", type: "property", price: 260, rent: 55, color: "#9b5de5" },
  { id: "fine", name: "Cena da pagare", type: "tax", amount: 130 },
  { id: "arena", name: "Arena del caos", type: "property", price: 300, rent: 70, color: "#ff4fd8" },
];
const boxingRings = Array.from({ length: 3 }, (_, index) => ({
  id: `ring-${index + 1}`,
  name: `Ring ${index + 1}`,
  phase: "waiting",
  round: 0,
  fighters: [],
  queue: [],
  lastEvent: null,
  message: "Ring libero. Entra e aspetta qualcuno da menare.",
}));
const boxingCooldowns = {
  punch: 900,
  kick: 1600,
};

app.use(express.static(path.join(__dirname, "dist")));

app.get("/health", (_request, response) => {
  response.json({ ok: true, players: clients.size });
});

app.use((_request, response) => {
  response.sendFile(path.join(__dirname, "dist", "index.html"));
});

wss.on("connection", (socket) => {
  let clientId = null;

  socket.on("message", (rawMessage) => {
    const message = parseMessage(rawMessage);
    if (!message) {
      return;
    }

    if (message.type === "hello") {
      clientId = normalizeText(message.clientId, 80);
      if (!clientId) {
        return;
      }

      const existing = clients.get(clientId);
      clients.set(clientId, {
        id: clientId,
        socket,
        characterId: existing?.characterId ?? null,
        displayName: existing?.displayName ?? null,
        connectedAt: existing?.connectedAt ?? Date.now(),
        lastSeenAt: Date.now(),
      });
      send(socket, { type: "hello", clientId });
      send(socket, { type: "chat-history", messages: chatMessages });
      broadcastState();
      sendBlackjackState(socket);
      send(socket, buildBoardState());
      send(socket, buildBoxingState());
      return;
    }

    if (!clientId || !clients.has(clientId)) {
      send(socket, { type: "error", message: "Sessione non riconosciuta. Ricarica la pagina." });
      return;
    }

    if (message.type === "claim") {
      claimCharacter(clientId, message.characterId, message.displayName);
      return;
    }

    if (message.type === "release") {
      releaseCharacter(clientId);
      return;
    }

    if (message.type === "reset") {
      releaseCharacter(clientId);
      return;
    }

    if (message.type === "chat") {
      sendChatMessage(clientId, message.text);
      return;
    }

    if (message.type === "blackjack-join") {
      joinBlackjack(clientId);
      return;
    }

    if (message.type === "blackjack-leave") {
      leaveBlackjack(clientId);
      return;
    }

    if (message.type === "blackjack-start") {
      startBlackjackRound(clientId);
      return;
    }

    if (message.type === "blackjack-hit") {
      hitBlackjack(clientId);
      return;
    }

    if (message.type === "blackjack-stand") {
      standBlackjack(clientId);
      return;
    }

    if (message.type === "board-join") {
      joinBoard(clientId);
      return;
    }

    if (message.type === "board-leave") {
      leaveBoard(clientId);
      return;
    }

    if (message.type === "board-start") {
      startBoardGame(clientId);
      return;
    }

    if (message.type === "board-roll") {
      rollBoardDice(clientId);
      return;
    }

    if (message.type === "board-buy") {
      buyBoardProperty(clientId);
      return;
    }

    if (message.type === "board-end-turn") {
      endBoardTurn(clientId);
      return;
    }

    if (message.type === "boxing-join") {
      joinBoxingRing(clientId, message.ringId);
      return;
    }

    if (message.type === "boxing-leave") {
      leaveBoxing(clientId);
      return;
    }

    if (message.type === "boxing-attack") {
      attackBoxing(clientId, message.attack, message.targetId);
      return;
    }

    if (message.type === "boxing-new-round") {
      startBoxingRound(message.ringId);
      return;
    }

    if (message.type === "ping") {
      clients.get(clientId).lastSeenAt = Date.now();
      send(socket, { type: "pong" });
    }
  });

  socket.on("close", () => {
    if (!clientId) {
      return;
    }

    const player = clients.get(clientId);
    if (player?.socket === socket) {
      player.socket = null;
      player.lastSeenAt = Date.now();
      setTimeout(() => pruneDisconnectedPlayer(clientId), 30000);
    }
  });
});

function claimCharacter(clientId, rawCharacterId, rawDisplayName) {
  const characterId = normalizeText(rawCharacterId, 80);
  const displayName = normalizeText(rawDisplayName, 80);
  const player = clients.get(clientId);

  if (!player || !characters.has(characterId)) {
    send(player?.socket, { type: "claim-rejected", message: "Personaggio non valido." });
    return;
  }

  const takenBy = findPlayerByCharacter(characterId);
  if (takenBy && takenBy.id !== clientId) {
    send(player.socket, { type: "claim-rejected", message: "Questo personaggio e gia stato preso." });
    broadcastState();
    return;
  }

  const claimedCount = Array.from(clients.values()).filter((item) => item.characterId).length;
  if (!player.characterId && claimedCount >= MAX_PLAYERS) {
    send(player.socket, { type: "claim-rejected", message: "Lobby piena: massimo 14 giocatori." });
    broadcastState();
    return;
  }

  player.characterId = characterId;
  player.displayName = displayName || characterId;
  player.lastSeenAt = Date.now();
  send(player.socket, { type: "claim-accepted", characterId, displayName: player.displayName });
  broadcastState();
}

function releaseCharacter(clientId) {
  const player = clients.get(clientId);
  if (!player) {
    return;
  }

  player.characterId = null;
  player.displayName = null;
  blackjackTable.players.delete(clientId);
  boardGame.players.delete(clientId);
  removeBoxer(clientId);
  player.lastSeenAt = Date.now();
  broadcastState();
  broadcastBlackjackState();
  broadcastBoardState();
  broadcastBoxingState();
}

function sendChatMessage(clientId, rawText) {
  const player = clients.get(clientId);
  const text = normalizeText(rawText, 320);

  if (!player || !text) {
    return;
  }

  const chatMessage = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    clientId,
    author: player.displayName || "Ospite",
    characterId: player.characterId,
    text,
    createdAt: new Date().toISOString(),
  };

  chatMessages.push(chatMessage);
  if (chatMessages.length > MAX_CHAT_MESSAGES) {
    chatMessages.splice(0, chatMessages.length - MAX_CHAT_MESSAGES);
  }

  broadcast({ type: "chat-message", message: chatMessage });
}

function pruneDisconnectedPlayer(clientId) {
  const player = clients.get(clientId);
  if (!player || player.socket) {
    return;
  }

  if (Date.now() - player.lastSeenAt >= 30000) {
    clients.delete(clientId);
    blackjackTable.players.delete(clientId);
    boardGame.players.delete(clientId);
    removeBoxer(clientId);
    broadcastState();
    broadcastBlackjackState();
    broadcastBoardState();
    broadcastBoxingState();
  }
}

function findPlayerByCharacter(characterId) {
  return Array.from(clients.values()).find((player) => player.characterId === characterId);
}

function broadcastState() {
  const state = {
    type: "state",
    lobby: {
      maxPlayers: MAX_PLAYERS,
      players: Array.from(clients.values())
        .filter((player) => player.characterId)
        .map((player) => ({
          id: player.id,
          characterId: player.characterId,
          displayName: player.displayName,
          online: Boolean(player.socket),
        })),
    },
  };

  broadcast(state);
}

function broadcast(payload) {
  for (const player of clients.values()) {
    send(player.socket, payload);
  }
}

function joinBlackjack(clientId) {
  const player = clients.get(clientId);

  if (!player?.characterId) {
    send(player?.socket, { type: "error", message: "Prima scegli un personaggio, poi entra al tavolo." });
    return;
  }

  const existing = blackjackTable.players.get(clientId);
  blackjackTable.players.set(clientId, {
    id: clientId,
    displayName: player.displayName || player.characterId,
    characterId: player.characterId,
    hand: existing?.hand ?? [],
    status: existing?.status ?? "joined",
    result: existing?.result ?? null,
  });
  blackjackTable.message = `${player.displayName || "Giocatore"} si e seduto al tavolo.`;
  broadcastBlackjackState();
}

function leaveBlackjack(clientId) {
  blackjackTable.players.delete(clientId);
  if (blackjackTable.players.size === 0) {
    resetBlackjackTable("Tavolo vuoto. Nuovo giro quando arriva qualcuno.");
  }
  broadcastBlackjackState();
}

function startBlackjackRound(clientId) {
  const starter = blackjackTable.players.get(clientId);

  if (!starter) {
    joinBlackjack(clientId);
  }

  if (blackjackTable.players.size === 0) {
    return;
  }

  blackjackTable.phase = "playing";
  blackjackTable.round += 1;
  blackjackTable.deck = shuffleDeck(createDeck());
  blackjackTable.dealer = [drawCard(), drawCard()];
  blackjackTable.message = "Round aperto: carta o sto.";

  for (const player of blackjackTable.players.values()) {
    player.hand = [drawCard(), drawCard()];
    player.status = handValue(player.hand).total === 21 ? "standing" : "playing";
    player.result = null;
  }

  maybeFinishBlackjackRound();
  broadcastBlackjackState();
}

function hitBlackjack(clientId) {
  if (blackjackTable.phase !== "playing") {
    return;
  }

  const player = blackjackTable.players.get(clientId);
  if (!player || player.status !== "playing") {
    return;
  }

  player.hand.push(drawCard());
  if (handValue(player.hand).total > 21) {
    player.status = "bust";
    player.result = "Sballato";
  }
  blackjackTable.message = `${player.displayName} pesca una carta.`;
  maybeFinishBlackjackRound();
  broadcastBlackjackState();
}

function standBlackjack(clientId) {
  if (blackjackTable.phase !== "playing") {
    return;
  }

  const player = blackjackTable.players.get(clientId);
  if (!player || player.status !== "playing") {
    return;
  }

  player.status = "standing";
  blackjackTable.message = `${player.displayName} resta.`;
  maybeFinishBlackjackRound();
  broadcastBlackjackState();
}

function maybeFinishBlackjackRound() {
  const activePlayers = Array.from(blackjackTable.players.values()).filter((player) => player.status === "playing");

  if (blackjackTable.phase !== "playing" || activePlayers.length > 0) {
    return;
  }

  while (handValue(blackjackTable.dealer).total < 17) {
    blackjackTable.dealer.push(drawCard());
  }

  const dealerTotal = handValue(blackjackTable.dealer).total;
  const dealerBust = dealerTotal > 21;

  for (const player of blackjackTable.players.values()) {
    const playerTotal = handValue(player.hand).total;

    if (playerTotal > 21) {
      player.result = "Perso";
    } else if (dealerBust || playerTotal > dealerTotal) {
      player.result = "Vinto";
    } else if (playerTotal === dealerTotal) {
      player.result = "Pari";
    } else {
      player.result = "Perso";
    }
    player.status = "done";
  }

  blackjackTable.phase = "finished";
  blackjackTable.message = dealerBust ? "Il banco sballa. Pagate la dignita al tavolo." : `Banco a ${dealerTotal}. Round chiuso.`;
}

function resetBlackjackTable(message) {
  blackjackTable.phase = "waiting";
  blackjackTable.deck = [];
  blackjackTable.dealer = [];
  blackjackTable.message = message;
  for (const player of blackjackTable.players.values()) {
    player.hand = [];
    player.status = "joined";
    player.result = null;
  }
}

function broadcastBlackjackState() {
  const payload = buildBlackjackState();
  broadcast(payload);
}

function sendBlackjackState(socket) {
  send(socket, buildBlackjackState());
}

function buildBlackjackState() {
  const revealDealer = blackjackTable.phase !== "playing";
  return {
    type: "blackjack-state",
    table: {
      phase: blackjackTable.phase,
      round: blackjackTable.round,
      message: blackjackTable.message,
      dealer: {
        cards: blackjackTable.dealer.map((card, index) => (revealDealer || index === 0 ? card : null)),
        total: revealDealer ? handValue(blackjackTable.dealer).total : null,
      },
      players: Array.from(blackjackTable.players.values()).map((player) => ({
        id: player.id,
        displayName: player.displayName,
        characterId: player.characterId,
        hand: player.hand,
        total: handValue(player.hand).total,
        status: player.status,
        result: player.result,
        online: Boolean(clients.get(player.id)?.socket),
      })),
    },
  };
}

function createDeck() {
  const suits = ["S", "H", "D", "C"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  return suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
}

function shuffleDeck(deck) {
  const nextDeck = [...deck];
  for (let index = nextDeck.length - 1; index > 0; index -= 1) {
    const targetIndex = Math.floor(Math.random() * (index + 1));
    [nextDeck[index], nextDeck[targetIndex]] = [nextDeck[targetIndex], nextDeck[index]];
  }
  return nextDeck;
}

function drawCard() {
  if (blackjackTable.deck.length === 0) {
    blackjackTable.deck = shuffleDeck(createDeck());
  }
  return blackjackTable.deck.pop();
}

function handValue(cards) {
  let total = 0;
  let aces = 0;

  for (const card of cards) {
    if (!card) {
      continue;
    }

    if (card.rank === "A") {
      total += 11;
      aces += 1;
    } else if (["K", "Q", "J"].includes(card.rank)) {
      total += 10;
    } else {
      total += Number(card.rank);
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return { total };
}

function joinBoard(clientId) {
  const player = clients.get(clientId);

  if (!player?.characterId) {
    send(player?.socket, { type: "error", message: "Prima scegli un personaggio, poi entra nel Board Royale." });
    return;
  }

  const existing = boardGame.players.get(clientId);
  boardGame.players.set(clientId, {
    id: clientId,
    displayName: player.displayName || player.characterId,
    characterId: player.characterId,
    position: existing?.position ?? 0,
    balance: existing?.balance ?? 1500,
    status: existing?.status ?? "joined",
    canBuy: false,
    lastMove: existing?.lastMove ?? null,
  });
  boardGame.message = `${player.displayName || "Giocatore"} entra nel Board Royale.`;
  broadcastBoardState();
}

function leaveBoard(clientId) {
  boardGame.players.delete(clientId);
  if (boardGame.players.size === 0) {
    resetBoardGame("Board Royale vuoto. Nuova partita quando arrivano i player.");
  } else if (getBoardCurrentPlayer()?.id === clientId) {
    normalizeBoardTurn();
  }
  broadcastBoardState();
}

function startBoardGame(clientId) {
  if (!boardGame.players.has(clientId)) {
    joinBoard(clientId);
  }

  const players = Array.from(boardGame.players.values());
  if (players.length === 0) {
    return;
  }

  boardGame.phase = "playing";
  boardGame.round += 1;
  boardGame.turnIndex = 0;
  boardGame.lastRoll = null;
  boardGame.properties.clear();
  boardGame.message = `Partita avviata. Tocca a ${players[0].displayName}.`;

  for (const player of players) {
    player.position = 0;
    player.balance = 1500;
    player.status = "waiting";
    player.canBuy = false;
    player.lastMove = null;
  }
  players[0].status = "turn";
  broadcastBoardState();
}

function rollBoardDice(clientId) {
  if (boardGame.phase !== "playing") {
    return;
  }

  const player = getBoardCurrentPlayer();
  if (!player || player.id !== clientId || player.status !== "turn") {
    return;
  }

  const dice = [rollDie(), rollDie()];
  const steps = dice[0] + dice[1];
  const previousPosition = player.position;
  player.position = (player.position + steps) % boardSpaces.length;
  player.lastMove = steps;
  player.status = "moved";
  player.canBuy = false;
  boardGame.lastRoll = dice;

  if (previousPosition + steps >= boardSpaces.length) {
    player.balance += boardSpaces[0].reward;
  }

  resolveBoardSpace(player);
  broadcastBoardState();
}

function buyBoardProperty(clientId) {
  const player = boardGame.players.get(clientId);
  if (!player || boardGame.phase !== "playing" || !player.canBuy) {
    return;
  }

  const space = boardSpaces[player.position];
  if (space?.type !== "property" || boardGame.properties.has(space.id) || player.balance < space.price) {
    return;
  }

  player.balance -= space.price;
  player.canBuy = false;
  boardGame.properties.set(space.id, clientId);
  boardGame.message = `${player.displayName} compra ${space.name} per ${space.price} DC.`;
  broadcastBoardState();
}

function endBoardTurn(clientId) {
  const player = getBoardCurrentPlayer();
  if (!player || player.id !== clientId || boardGame.phase !== "playing") {
    return;
  }

  player.status = "waiting";
  player.canBuy = false;
  const players = Array.from(boardGame.players.values()).filter((item) => item.balance > -500);
  if (players.length === 0) {
    resetBoardGame("Tutti in bancarotta morale. Board resettato.");
    broadcastBoardState();
    return;
  }

  boardGame.turnIndex = (boardGame.turnIndex + 1) % players.length;
  players[boardGame.turnIndex].status = "turn";
  boardGame.message = `Tocca a ${players[boardGame.turnIndex].displayName}.`;
  broadcastBoardState();
}

function resolveBoardSpace(player) {
  const space = boardSpaces[player.position];
  if (!space) {
    return;
  }

  if (space.type === "start") {
    boardGame.message = `${player.displayName} passa dal via e respira aria di cash finto.`;
    return;
  }

  if (space.type === "tax") {
    player.balance -= space.amount;
    boardGame.message = `${player.displayName} paga ${space.amount} DC: ${space.name}.`;
    return;
  }

  if (space.type === "bonus") {
    player.balance += space.amount;
    boardGame.message = `${player.displayName} incassa ${space.amount} DC: ${space.name}.`;
    return;
  }

  if (space.type === "chance") {
    const amount = Math.random() > 0.5 ? 180 : -120;
    player.balance += amount;
    boardGame.message =
      amount > 0
        ? `${player.displayName} pesca imprevisto buono: +${amount} DC.`
        : `${player.displayName} pesca imprevisto marcio: ${amount} DC.`;
    return;
  }

  if (space.type === "rest") {
    boardGame.message = `${player.displayName} si ferma in pausa vergogna. Nessun danno, per ora.`;
    return;
  }

  if (space.type === "property") {
    const ownerId = boardGame.properties.get(space.id);

    if (!ownerId) {
      player.canBuy = player.balance >= space.price;
      boardGame.message = player.canBuy
        ? `${player.displayName} puo comprare ${space.name} per ${space.price} DC.`
        : `${player.displayName} non ha abbastanza DC per ${space.name}.`;
      return;
    }

    if (ownerId === player.id) {
      boardGame.message = `${player.displayName} torna nella sua proprieta: ${space.name}.`;
      return;
    }

    const owner = boardGame.players.get(ownerId);
    player.balance -= space.rent;
    if (owner) {
      owner.balance += space.rent;
      boardGame.message = `${player.displayName} paga ${space.rent} DC di affitto a ${owner.displayName}.`;
    } else {
      boardGame.properties.delete(space.id);
      boardGame.message = `${space.name} torna libero: proprietario sparito.`;
    }
  }
}

function normalizeBoardTurn() {
  const players = Array.from(boardGame.players.values());
  if (players.length === 0) {
    resetBoardGame("Board Royale vuoto. Nuova partita quando arrivano i player.");
    return;
  }

  boardGame.turnIndex %= players.length;
  for (const player of players) {
    player.status = "waiting";
    player.canBuy = false;
  }
  players[boardGame.turnIndex].status = boardGame.phase === "playing" ? "turn" : "joined";
}

function resetBoardGame(message) {
  boardGame.phase = "waiting";
  boardGame.turnIndex = 0;
  boardGame.lastRoll = null;
  boardGame.message = message;
  boardGame.properties.clear();
  for (const player of boardGame.players.values()) {
    player.position = 0;
    player.balance = 1500;
    player.status = "joined";
    player.canBuy = false;
    player.lastMove = null;
  }
}

function getBoardCurrentPlayer() {
  const players = Array.from(boardGame.players.values());
  return players[boardGame.turnIndex] ?? null;
}

function broadcastBoardState() {
  broadcast(buildBoardState());
}

function buildBoardState() {
  const currentPlayer = getBoardCurrentPlayer();
  return {
    type: "board-state",
    board: {
      phase: boardGame.phase,
      round: boardGame.round,
      turnPlayerId: boardGame.phase === "playing" ? currentPlayer?.id ?? null : null,
      lastRoll: boardGame.lastRoll,
      message: boardGame.message,
      spaces: boardSpaces.map((space, index) => ({
        ...space,
        index,
        ownerId: boardGame.properties.get(space.id) ?? null,
      })),
      players: Array.from(boardGame.players.values()).map((player) => ({
        ...player,
        online: Boolean(clients.get(player.id)?.socket),
      })),
    },
  };
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function joinBoxingRing(clientId, rawRingId) {
  const player = clients.get(clientId);
  const ring = boxingRings.find((item) => item.id === rawRingId) ?? boxingRings[0];

  if (!player?.characterId) {
    send(player?.socket, { type: "error", message: "Prima scegli un personaggio, poi entra nell'arena." });
    return;
  }

  removeBoxer(clientId);

  const boxer = {
    id: clientId,
    displayName: player.displayName || player.characterId,
    characterId: player.characterId,
    side: null,
    hp: 100,
    maxHp: 100,
    status: "queued",
    lastAttackAt: 0,
  };

  ring.queue.push(boxer);
  ring.message = `${boxer.displayName} entra nel ${ring.name}.`;
  seedBoxingRing(ring);
  broadcastBoxingState();
}

function leaveBoxing(clientId) {
  removeBoxer(clientId);
  broadcastBoxingState();
}

function removeBoxer(clientId) {
  for (const ring of boxingRings) {
    ring.fighters = ring.fighters.filter((fighter) => fighter.id !== clientId);
    ring.queue = ring.queue.filter((fighter) => fighter.id !== clientId);
    if (ring.fighters.length === 0 && ring.queue.length === 0) {
      resetBoxingRing(ring, "Ring libero. Entra e aspetta qualcuno da menare.");
    } else {
      seedBoxingRing(ring);
    }
  }
}

function seedBoxingRing(ring) {
  const activeLeft = ring.fighters.filter((fighter) => fighter.side === "left" && fighter.status !== "ko").length;
  const activeRight = ring.fighters.filter((fighter) => fighter.side === "right" && fighter.status !== "ko").length;
  const ringIsFull = activeLeft >= 2 && activeRight >= 2;

  while (!ringIsFull && ring.queue.length > 0 && ring.fighters.length < 4) {
    const boxer = ring.queue.shift();
    const leftCount = ring.fighters.filter((fighter) => fighter.side === "left").length;
    const rightCount = ring.fighters.filter((fighter) => fighter.side === "right").length;
    boxer.side = leftCount <= rightCount ? "left" : "right";
    boxer.status = "ready";
    boxer.hp = boxer.maxHp;
    boxer.lastAttackAt = 0;
    ring.fighters.push(boxer);
  }

  const left = ring.fighters.filter((fighter) => fighter.side === "left");
  const right = ring.fighters.filter((fighter) => fighter.side === "right");

  if (left.length > 0 && left.length === right.length && ring.phase !== "fighting") {
    startBoxingRound(ring.id);
    return;
  }

  if (ring.phase === "waiting") {
    ring.message =
      ring.fighters.length === 0
        ? "Ring libero. Entra e aspetta qualcuno da menare."
        : "In attesa di un avversario per pareggiare il ring.";
  }
}

function startBoxingRound(rawRingId) {
  const ring = boxingRings.find((item) => item.id === rawRingId);
  if (!ring) {
    return;
  }

  const left = ring.fighters.filter((fighter) => fighter.side === "left");
  const right = ring.fighters.filter((fighter) => fighter.side === "right");
  if (left.length === 0 || left.length !== right.length) {
    ring.phase = "waiting";
    ring.message = "Servono avversari pari per iniziare.";
    broadcastBoxingState();
    return;
  }

  ring.phase = "fighting";
  ring.round += 1;
  ring.lastEvent = null;
  for (const fighter of ring.fighters) {
    fighter.hp = fighter.maxHp;
    fighter.status = "fighting";
    fighter.lastAttackAt = 0;
  }
  ring.message = `${left.length} vs ${right.length}. Round ${ring.round}: botte autorizzate.`;
  broadcastBoxingState();
}

function attackBoxing(clientId, rawAttack, rawTargetId) {
  const ring = boxingRings.find((item) => item.fighters.some((fighter) => fighter.id === clientId));
  if (!ring || ring.phase !== "fighting") {
    return;
  }

  const attacker = ring.fighters.find((fighter) => fighter.id === clientId);
  if (!attacker || attacker.status !== "fighting") {
    return;
  }

  const attack = rawAttack === "kick" ? "kick" : "punch";
  const now = Date.now();
  if (now - attacker.lastAttackAt < boxingCooldowns[attack]) {
    return;
  }

  const opponents = ring.fighters.filter((fighter) => fighter.side !== attacker.side && fighter.status === "fighting");
  const target = opponents.find((fighter) => fighter.id === rawTargetId) ?? opponents[0];
  if (!target) {
    return;
  }

  const baseDamage = attack === "kick" ? 18 : 10;
  const variance = attack === "kick" ? Math.floor(Math.random() * 7) : Math.floor(Math.random() * 5);
  const damage = baseDamage + variance;
  attacker.lastAttackAt = now;
  target.hp = Math.max(0, target.hp - damage);
  if (target.hp <= 0) {
    target.status = "ko";
  }

  ring.lastEvent = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    attackerId: attacker.id,
    targetId: target.id,
    attack,
    damage,
    createdAt: new Date().toISOString(),
  };
  ring.message = `${attacker.displayName} ${attack === "kick" ? "tira un calcio" : "piazza un pugno"} a ${target.displayName}: -${damage} HP.`;
  maybeFinishBoxingRound(ring);
  broadcastBoxingState();
}

function maybeFinishBoxingRound(ring) {
  const leftAlive = ring.fighters.some((fighter) => fighter.side === "left" && fighter.status === "fighting");
  const rightAlive = ring.fighters.some((fighter) => fighter.side === "right" && fighter.status === "fighting");

  if (leftAlive && rightAlive) {
    return;
  }

  ring.phase = "finished";
  const winners = ring.fighters.filter((fighter) => fighter.status === "fighting");
  ring.message = winners.length > 0 ? `${winners.map((fighter) => fighter.displayName).join(" + ")} vincono il round.` : "Doppio KO. Vergogna condivisa.";
  for (const fighter of ring.fighters) {
    if (fighter.status !== "ko") {
      fighter.status = "winner";
    }
  }
}

function resetBoxingRing(ring, message) {
  ring.phase = "waiting";
  ring.round = 0;
  ring.fighters = [];
  ring.queue = [];
  ring.lastEvent = null;
  ring.message = message;
}

function broadcastBoxingState() {
  broadcast(buildBoxingState());
}

function buildBoxingState() {
  return {
    type: "boxing-state",
    rings: boxingRings.map((ring) => ({
      id: ring.id,
      name: ring.name,
      phase: ring.phase,
      round: ring.round,
      message: ring.message,
      lastEvent: ring.lastEvent,
      fighters: ring.fighters.map((fighter) => ({
        ...fighter,
        online: Boolean(clients.get(fighter.id)?.socket),
      })),
      queue: ring.queue.map((fighter) => ({
        ...fighter,
        online: Boolean(clients.get(fighter.id)?.socket),
      })),
    })),
  };
}

function send(socket, payload) {
  if (!socket || socket.readyState !== socket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function parseMessage(rawMessage) {
  try {
    return JSON.parse(rawMessage.toString());
  } catch {
    return null;
  }
}

function normalizeText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

server.listen(PORT, () => {
  console.log(`Degradoland online on http://localhost:${PORT}`);
});
