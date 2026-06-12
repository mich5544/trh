export const INITIAL_BALANCE = 10000;
export const MAX_PLAYERS = 14;

export const demoNames = [
  "Banca Rotta",
  "Pigiama King",
  "Scusa Beta",
  "Pedina Uno",
  "Quota Pizzo",
  "Ritardo Max",
  "Gossip HQ",
  "Ansia Turbo",
  "Autogrill",
  "Deretano FC",
  "Qualita Check",
  "Carnival CEO",
  "Cancelletto",
  "Ultimo Posto",
];

export function createPlayer({ displayName = "", characterId = null } = {}) {
  return {
    id: "local-player",
    displayName,
    characterId,
    balance: INITIAL_BALANCE,
    badges: [],
  };
}

export function createLobby({ players = [] } = {}) {
  return {
    id: "private-lobby",
    maxPlayers: MAX_PLAYERS,
    players,
    status: players.length >= MAX_PLAYERS ? "full" : "open",
  };
}

export function createGameState({ id, name, status = "idle", history = [] }) {
  return {
    id,
    name,
    status,
    history,
  };
}
