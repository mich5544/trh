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
  player.lastSeenAt = Date.now();
  broadcastState();
  broadcastBlackjackState();
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
    broadcastState();
    broadcastBlackjackState();
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
