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
  player.lastSeenAt = Date.now();
  broadcastState();
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
    broadcastState();
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
