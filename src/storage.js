import { INITIAL_BALANCE } from "./models";

const STORAGE_KEY = "degradoland.local.v1";

const defaultState = {
  clientId: null,
  selectedCharacterId: null,
  currentPlayer: null,
  balance: INITIAL_BALANCE,
  history: [],
  badges: [],
  soundEnabled: true,
};

export function loadLocalState() {
  if (typeof window === "undefined") {
    return defaultState;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultState;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return defaultState;
    }
    return {
      ...defaultState,
      ...parsed,
      clientId: typeof parsed.clientId === "string" ? parsed.clientId : defaultState.clientId,
      balance: Number.isFinite(parsed.balance) ? parsed.balance : defaultState.balance,
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, 12) : [],
      badges: Array.isArray(parsed.badges) ? parsed.badges : [],
      soundEnabled: parsed.soundEnabled ?? defaultState.soundEnabled,
    };
  } catch {
    return defaultState;
  }
}

export function saveLocalState(state) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      selectedCharacterId: state.selectedCharacterId,
      clientId: state.clientId,
      currentPlayer: state.currentPlayer,
      balance: state.balance,
      history: state.history.slice(0, 12),
      badges: state.badges,
      soundEnabled: state.soundEnabled,
    }),
  );
}

export function clearLocalState() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
