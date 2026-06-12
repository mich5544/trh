import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { characters } from "./characters";
import { clearLocalState, loadLocalState, saveLocalState } from "./storage";
import { INITIAL_BALANCE, createGameState, createLobby, createPlayer, demoNames } from "./models";
import circusMusicUrl from "../musica_Circo.mp3";
import "./styles.css";

const bets = [50, 100, 250, 500];
const winLines = [
  { label: "Tre del tuo personaggio", detail: "Jackpot personale", multiplier: "x14" },
  { label: "Tre uguali", detail: "Qualsiasi volto ripetuto tre volte", multiplier: "x8" },
  { label: "Due uguali", detail: "Coppia secca sui rulli", multiplier: "x2" },
];

function App() {
  const savedState = useMemo(() => loadLocalState(), []);
  const [message, setMessage] = useState(
    savedState.selectedCharacterId
      ? "Sessione locale ripristinata. Puoi continuare dalla lobby."
      : "Scegli un personaggio disponibile: sara la tua identita in lobby.",
  );
  const [takenCharacters, setTakenCharacters] = useState(() => {
    const savedCharacter = characters.find((character) => character.id === savedState.selectedCharacterId);
    if (!savedCharacter) {
      return new Map();
    }
    return new Map([[savedState.selectedCharacterId, savedState.currentPlayer ?? savedCharacter.nome]]);
  });
  const [selectedCharacterId, setSelectedCharacterId] = useState(savedState.selectedCharacterId);
  const [currentPlayer, setCurrentPlayer] = useState(() => {
    const savedCharacter = characters.find((character) => character.id === savedState.selectedCharacterId);
    return savedState.currentPlayer ?? savedCharacter?.nome ?? null;
  });
  const [view, setView] = useState("lobby");
  const [balance, setBalance] = useState(savedState.balance);
  const [history, setHistory] = useState(savedState.history);
  const [badges, setBadges] = useState(savedState.badges);
  const [soundEnabled, setSoundEnabled] = useState(savedState.soundEnabled);
  const [clientId] = useState(() => savedState.clientId ?? makeId());
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const gridRef = useRef(null);
  const socketRef = useRef(null);
  const selectedCharacterIdRef = useRef(selectedCharacterId);
  const currentPlayerRef = useRef(currentPlayer);
  const chatOpenRef = useRef(chatOpen);

  const selectedCharacter = characters.find((item) => item.id === selectedCharacterId);
  const takenCount = takenCharacters.size;
  const availableCount = characters.length - takenCount;
  const lobby = useMemo(
    () =>
      createLobby({
        players: currentPlayer && selectedCharacterId ? [createPlayer({ displayName: currentPlayer, characterId: selectedCharacterId })] : [],
      }),
    [currentPlayer, selectedCharacterId],
  );
  const slotState = useMemo(() => createGameState({ id: "slot-disastro", name: "Slot del disastro", history }), [history]);

  useEffect(() => {
    selectedCharacterIdRef.current = selectedCharacterId;
  }, [selectedCharacterId]);

  useEffect(() => {
    currentPlayerRef.current = currentPlayer;
  }, [currentPlayer]);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
    if (chatOpen) {
      setUnreadChatCount(0);
    }
  }, [chatOpen]);

  useEffect(() => {
    saveLocalState({
      selectedCharacterId,
      clientId,
      currentPlayer,
      balance,
      history,
      badges,
      soundEnabled,
    });
  }, [selectedCharacterId, clientId, currentPlayer, balance, history, badges, soundEnabled]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof WebSocket === "undefined") {
      setConnectionStatus("offline");
      return undefined;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socketUrl = import.meta.env.VITE_WS_URL || `${protocol}://${window.location.host}/ws`;
    const socket = new WebSocket(socketUrl);
    socketRef.current = socket;
    setConnectionStatus("connecting");

    socket.addEventListener("open", () => {
      setConnectionStatus("online");
      sendSocketMessage(socket, { type: "hello", clientId });

      if (selectedCharacterIdRef.current && currentPlayerRef.current) {
        sendSocketMessage(socket, { type: "claim", characterId: selectedCharacterIdRef.current, displayName: currentPlayerRef.current });
      }
    });

    socket.addEventListener("message", (event) => {
      const payload = parseSocketMessage(event.data);
      if (!payload) {
        return;
      }

      if (payload.type === "state") {
        const players = Array.isArray(payload.lobby?.players) ? payload.lobby.players : [];
        const nextTakenCharacters = new Map(players.map((player) => [player.characterId, player.displayName]));
        const ownPlayer = players.find((player) => player.id === clientId);

        setTakenCharacters(nextTakenCharacters);

        if (ownPlayer?.characterId) {
          const character = characters.find((item) => item.id === ownPlayer.characterId);
          setSelectedCharacterId(ownPlayer.characterId);
          setCurrentPlayer(ownPlayer.displayName ?? character?.nome ?? null);
        } else if (selectedCharacterIdRef.current && nextTakenCharacters.has(selectedCharacterIdRef.current)) {
          setSelectedCharacterId(null);
          setCurrentPlayer(null);
        }
        return;
      }

      if (payload.type === "claim-accepted") {
        const character = characters.find((item) => item.id === payload.characterId);
        setSelectedCharacterId(payload.characterId);
        setCurrentPlayer(payload.displayName ?? character?.nome ?? null);
        setMessage(`${character?.nome ?? "Personaggio"} e tuo nella lobby online.`);
        return;
      }

      if (payload.type === "claim-rejected" || payload.type === "error") {
        setMessage(payload.message ?? "Richiesta rifiutata dalla lobby online.");
        return;
      }

      if (payload.type === "chat-history") {
        setChatMessages(Array.isArray(payload.messages) ? payload.messages.slice(-80) : []);
        return;
      }

      if (payload.type === "chat-message" && payload.message) {
        setChatMessages((current) => [...current, payload.message].slice(-80));
        if (!chatOpenRef.current && payload.message.clientId !== clientId) {
          setUnreadChatCount((current) => Math.min(current + 1, 99));
        }
      }
    });

    socket.addEventListener("close", () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
        setConnectionStatus("offline");
      }
    });

    socket.addEventListener("error", () => {
      setConnectionStatus("offline");
    });

    return () => {
      socket.close();
    };
  }, [clientId]);

  useEffect(() => {
    if (!soundEnabled) {
      stopBackgroundMusic();
      return undefined;
    }

    const startMusic = () => startBackgroundMusic(true);

    window.addEventListener("pointerdown", startMusic, { once: true });
    window.addEventListener("keydown", startMusic, { once: true });

    return () => {
      window.removeEventListener("pointerdown", startMusic);
      window.removeEventListener("keydown", startMusic);
    };
  }, [soundEnabled]);

  function toggleSound() {
    setSoundEnabled((enabled) => {
      const nextEnabled = !enabled;

      if (nextEnabled) {
        startBackgroundMusic(true);
      } else {
        stopBackgroundMusic();
      }

      return nextEnabled;
    });
  }

  function selectCharacter(characterId) {
    const character = characters.find((item) => item.id === characterId);

    if (takenCharacters.has(characterId) && selectedCharacterId !== characterId) {
      setMessage(`${character.nome} e gia stato preso. Esaurimento scorte su questo scaffale.`);
      return;
    }

    if (connectionStatus === "online" && socketRef.current) {
      setMessage(`Sto reclamando ${character.nome} nella lobby online...`);
      sendSocketMessage(socketRef.current, { type: "claim", characterId, displayName: character.nome });
      return;
    }

    setTakenCharacters((current) => {
      const next = new Map(current);

      if (selectedCharacterId) {
        next.delete(selectedCharacterId);
      }

      next.set(characterId, character.nome);
      return next;
    });

    setCurrentPlayer(character.nome);
    setSelectedCharacterId(characterId);
    setMessage(`${character.nome} e pronto: puoi entrare nella Slot del disastro.`);
  }

  function resetLobby() {
    clearLocalState();
    sendSocketMessage(socketRef.current, { type: "release" });
    setCurrentPlayer(null);
    setSelectedCharacterId(null);
    setTakenCharacters(new Map());
    setView("lobby");
    setBalance(INITIAL_BALANCE);
    setHistory([]);
    setBadges([]);
    setSoundEnabled(true);
    stopBackgroundMusic();
    setMessage("Scegli un personaggio disponibile: sara la tua identita in lobby.");
  }

  function fillDemoLobby() {
    if (connectionStatus === "online") {
      setMessage("La simulazione lobby piena e disattivata online: qui i posti sono veri.");
      return;
    }

    setTakenCharacters(new Map(characters.map((character, index) => [character.id, demoNames[index]])));
    setCurrentPlayer(null);
    setSelectedCharacterId(null);
    setMessage("Lobby piena: esaurimento scorte. Si entra al prossimo giro.");
  }

  function sendChat(text) {
    const trimmedText = text.trim();

    if (!trimmedText) {
      return;
    }

    if (connectionStatus !== "online" || !socketRef.current) {
      setMessage("Chat offline: pubblica o avvia il server per parlare con gli altri.");
      return;
    }

    sendSocketMessage(socketRef.current, { type: "chat", text: trimmedText });
  }

  function scrollCharacters(direction) {
    const grid = gridRef.current;
    const card = grid?.querySelector(".character-card");

    if (!grid || !card) {
      return;
    }

    const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
    grid.scrollBy({
      left: direction * (card.getBoundingClientRect().width + gap),
      behavior: "smooth",
    });
  }

  function openSlot() {
    if (!selectedCharacter) {
      setMessage("Prima reclama un personaggio, poi puoi buttarti sulle slot.");
      return;
    }

    startBackgroundMusic(soundEnabled);
    setView("slot");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app-shell">
      <Header
        availableCount={availableCount}
        connectionStatus={connectionStatus}
        soundEnabled={soundEnabled}
        onToggleSound={toggleSound}
        onReset={resetLobby}
      />

      {view === "lobby" ? (
        <LobbyView
          message={message}
          selectedCharacter={selectedCharacter}
          currentPlayer={currentPlayer}
          takenCount={takenCount}
          balance={balance}
          gridRef={gridRef}
          scrollCharacters={scrollCharacters}
          fillDemoLobby={fillDemoLobby}
          takenCharacters={takenCharacters}
          selectedCharacterId={selectedCharacterId}
          selectCharacter={selectCharacter}
          openSlot={openSlot}
          lobby={lobby}
          badges={badges}
        />
      ) : (
        <SlotMachine
          balance={balance}
          setBalance={setBalance}
          history={history}
          setHistory={setHistory}
          badges={badges}
          setBadges={setBadges}
          selectedCharacter={selectedCharacter}
          currentPlayer={currentPlayer}
          soundEnabled={soundEnabled}
          setSoundEnabled={setSoundEnabled}
          gameState={slotState}
          onBack={() => {
            stopBackgroundMusic();
            setView("lobby");
          }}
        />
      )}

      <ChatWidget
        messages={chatMessages}
        open={chatOpen}
        unreadCount={unreadChatCount}
        connectionStatus={connectionStatus}
        currentPlayer={currentPlayer}
        onToggle={() => setChatOpen((open) => !open)}
        onSend={sendChat}
      />
    </div>
  );
}

function Header({ availableCount, connectionStatus, soundEnabled, onToggleSound, onReset }) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Sala giochi privata</p>
        <h1>Degradoland</h1>
      </div>
      <div className="topbar-actions">
        <div className="pill">
          <span>{availableCount}</span>
          <small>{connectionStatus === "online" ? "posti online" : "posti locali"}</small>
        </div>
        <button className="ghost-button audio-button" type="button" onClick={onToggleSound} aria-pressed={soundEnabled}>
          Musica {soundEnabled ? "on" : "off"}
        </button>
        <button className="ghost-button" type="button" onClick={onReset}>
          Reset
        </button>
      </div>
    </header>
  );
}

function ChatWidget({ messages, open, unreadCount, connectionStatus, currentPlayer, onToggle, onSend }) {
  const [draft, setDraft] = useState("");
  const listRef = useRef(null);
  const online = connectionStatus === "online";

  useEffect(() => {
    if (open) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, open]);

  function submitMessage(event) {
    event.preventDefault();
    const text = draft.trim();

    if (!text) {
      return;
    }

    onSend(text);
    setDraft("");
  }

  return (
    <aside className={`chat-widget ${open ? "open" : ""}`} aria-label="Chat gruppo">
      <button className="chat-launcher" type="button" onClick={onToggle} aria-expanded={open}>
        <span>Chat</span>
        {unreadCount > 0 ? <strong>{unreadCount}</strong> : null}
      </button>

      {open ? (
        <div className="chat-panel">
          <div className="chat-header">
            <div>
              <p className="eyebrow">Gruppo live</p>
              <strong>{online ? "Chat online" : "Chat offline"}</strong>
            </div>
            <button className="icon-button chat-close" type="button" onClick={onToggle} aria-label="Chiudi chat">
              x
            </button>
          </div>

          <div className="chat-messages" ref={listRef} aria-live="polite">
            {messages.length === 0 ? (
              <p className="chat-empty">Ancora nessun messaggio.</p>
            ) : (
              messages.map((message) => (
                <article className="chat-message" key={message.id}>
                  <div>
                    <strong>{message.author}</strong>
                    <time>{formatChatTime(message.createdAt)}</time>
                  </div>
                  <p>{message.text}</p>
                </article>
              ))
            )}
          </div>

          <form className="chat-form" onSubmit={submitMessage}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={320}
              placeholder={online ? `Scrivi come ${currentPlayer ?? "Ospite"}` : "Server offline"}
              disabled={!online}
              aria-label="Messaggio chat"
            />
            <button className="secondary-button" type="submit" disabled={!online || !draft.trim()}>
              Invia
            </button>
          </form>
        </div>
      ) : null}
    </aside>
  );
}

function LobbyView({
  message,
  selectedCharacter,
  currentPlayer,
  takenCount,
  balance,
  gridRef,
  scrollCharacters,
  fillDemoLobby,
  takenCharacters,
  selectedCharacterId,
  selectCharacter,
  openSlot,
  lobby,
  badges,
}) {
  return (
    <>
      <Hero
        message={message}
        selectedCharacter={selectedCharacter}
        currentPlayer={currentPlayer}
        takenCount={takenCount}
        balance={balance}
        lobby={lobby}
        badges={badges}
      />

      <section className="section-heading">
        <div>
          <p className="eyebrow">Roster ufficiale</p>
          <h2>14 personaggi, zero doppioni</h2>
        </div>
        <div className="roster-actions">
          <div className="carousel-controls" aria-label="Controlli carosello personaggi">
            <button className="icon-button" type="button" onClick={() => scrollCharacters(-1)} aria-label="Personaggio precedente">
              {"<"}
            </button>
            <button className="icon-button" type="button" onClick={() => scrollCharacters(1)} aria-label="Personaggio successivo">
              {">"}
            </button>
          </div>
          <button className="secondary-button" type="button" onClick={fillDemoLobby}>
            Simula lobby piena
          </button>
        </div>
      </section>

      <CharacterGrid
        gridRef={gridRef}
        takenCharacters={takenCharacters}
        selectedCharacterId={selectedCharacterId}
        onSelectCharacter={selectCharacter}
      />

      <Arcade onOpenSlot={openSlot} selectedCharacter={selectedCharacter} />
    </>
  );
}

function Hero({
  message,
  selectedCharacter,
  currentPlayer,
  takenCount,
  balance,
  lobby,
  badges,
}) {
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="label">Accesso anticipato</p>
        <h2>Scegli il tuo degrado ufficiale.</h2>
        <p>Scegli un personaggio unico. Poi entra nella sala giochi con monete finte, badge e sfide tra amici.</p>
        <div className="choice-panel">
          <strong>Seleziona una card personaggio</strong>
          <span>Ogni personaggio puo essere preso una sola volta nella lobby.</span>
          <span className="hint">{message}</span>
        </div>
      </div>

      <aside className="status-panel" aria-label="Stato lobby">
        <div className="meter">
          <span>Lobby {lobby.status}</span>
          <strong>{takenCount}/14</strong>
        </div>
        <div className="meter-track">
          <span style={{ width: `${(takenCount / characters.length) * 100}%` }} />
        </div>
        <div className="selected-preview">
          {selectedCharacter ? (
            <>
              <img src={selectedCharacter.immagine} alt={selectedCharacter.nome} />
              <div>
                <small>Personaggio scelto</small>
                <strong>{selectedCharacter.nome}</strong>
                <span>Identita locale</span>
              </div>
            </>
          ) : (
            <>
              <div className="empty-avatar">?</div>
              <div>
                <small>Personaggio scelto</small>
                <strong>Nessuno</strong>
              </div>
            </>
          )}
        </div>
        <div className="coin-box">
          <span>Saldo locale</span>
          <strong>{formatCoins(balance)} DC</strong>
        </div>
        <BadgeRail badges={badges} />
      </aside>
    </section>
  );
}

function BadgeRail({ badges }) {
  return (
    <div className="badge-rail" aria-label="Badge temporanei">
      <span>Badge</span>
      {badges.length === 0 ? (
        <strong>In attesa di gloria</strong>
      ) : (
        <div>
          {badges.slice(0, 4).map((badge) => (
            <mark key={badge.id}>{badge.label}</mark>
          ))}
        </div>
      )}
    </div>
  );
}

function CharacterGrid({ gridRef, takenCharacters, selectedCharacterId, onSelectCharacter }) {
  return (
    <section className="character-grid" ref={gridRef} aria-label="Scelta personaggio">
      {characters.map((character, index) => {
        const takenBy = takenCharacters.get(character.id);
        const isSelected = selectedCharacterId === character.id;

        return (
          <button
            key={character.id}
            className={`character-card ${takenBy ? "taken" : ""} ${isSelected ? "selected" : ""}`}
            type="button"
            style={{ "--accent": character.colore }}
            disabled={Boolean(takenBy && !isSelected)}
            onClick={() => onSelectCharacter(character.id)}
            aria-label={`${character.nome}, ${character.titolo}`}
          >
            <span className="card-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="availability">{takenBy ? "Occupato" : "Disponibile"}</span>
            <img src={character.immagine} alt={character.nome} />
            <span className="character-body">
              <strong>{character.nome}</strong>
              <small>{character.titolo}</small>
            </span>
            {takenBy ? <span className="taken-by">Scelto da {takenBy}</span> : null}
          </button>
        );
      })}
    </section>
  );
}

function Arcade({ onOpenSlot, selectedCharacter }) {
  return (
    <section className="arcade">
      <div className="section-heading arcade-heading">
        <div>
          <p className="eyebrow">Prima ala giocabile</p>
          <h2>Giochi previsti</h2>
        </div>
      </div>
      <div className="game-grid">
        <article className="game-card active">
          <span>01</span>
          <h3>Slot del disastro</h3>
          <p>Jackpot finto, simboli personalizzati e gloria temporanea.</p>
          <button className="play-button" type="button" onClick={onOpenSlot}>
            {selectedCharacter ? "Gioca" : "Scegli personaggio"}
          </button>
        </article>
        <article className="game-card">
          <span>02</span>
          <h3>Tavolo carte</h3>
          <p>Blackjack e sfide veloci con saldo rigorosamente fittizio.</p>
        </article>
        <article className="game-card">
          <span>03</span>
          <h3>Scacchi</h3>
          <p>Timer, ranking e partite 1v1 dentro la lobby.</p>
        </article>
        <article className="game-card">
          <span>04</span>
          <h3>Board Royale</h3>
          <p>Il tabellone stile Monopoli con pedine-faccia e caselle custom.</p>
        </article>
        <article className="game-card">
          <span>05</span>
          <h3>Ruota del degrado</h3>
          <p>Minigioco party per ribaltare classifica e dignita.</p>
        </article>
      </div>
    </section>
  );
}

function SlotMachine({
  balance,
  setBalance,
  history,
  setHistory,
  badges,
  setBadges,
  selectedCharacter,
  currentPlayer,
  soundEnabled,
  setSoundEnabled,
  gameState,
  onBack,
}) {
  const [bet, setBet] = useState(100);
  const [reels, setReels] = useState(() => randomReels());
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState("Punta, gira e spera nel miracolo contabile.");
  const [lastOutcome, setLastOutcome] = useState("idle");
  const [confettiBurst, setConfettiBurst] = useState(null);

  const jackpotSymbol = useMemo(() => selectedCharacter ?? characters[0], [selectedCharacter]);
  const canSpin = balance >= bet && !spinning;

  useEffect(() => {
    return () => {
      stopBackgroundMusic();
    };
  }, []);

  function spin() {
    if (!canSpin) {
      setResult(balance < bet ? "Saldo insufficiente: il bancomat finto ha detto no." : "Aspetta la fine dello spin.");
      playTone(soundEnabled, "error");
      return;
    }

    startBackgroundMusic(soundEnabled);
    setSpinning(true);
    setLastOutcome("idle");
    setResult(randomSpinMessage());
    setBalance((current) => current - bet);
    playTone(soundEnabled, "spin");

    window.setTimeout(() => {
      const nextReels = randomReels(jackpotSymbol);
      const payout = calculatePayout(nextReels, bet, jackpotSymbol.id);
      const outcome = getOutcome(nextReels, payout, jackpotSymbol.id);
      const entry = {
        id: makeId(),
        reels: nextReels,
        bet,
        payout,
        net: payout - bet,
        createdAt: new Date().toISOString(),
      };

      setReels(nextReels);
      setBalance((current) => current + payout);
      setSpinning(false);
      setLastOutcome(outcome);
      setResult(buildResultMessage(nextReels, payout, bet, jackpotSymbol.id));
      setHistory((current) => [entry, ...current].slice(0, 12));
      setBadges((current) => updateBadges(current, entry, nextReels, jackpotSymbol.id));
      if (outcome === "win" || outcome === "jackpot") {
        setConfettiBurst({ id: makeId(), jackpot: outcome === "jackpot" });
      }
      playTone(soundEnabled, outcome);
    }, 1200);
  }

  return (
    <main className="slot-page">
      <section className="slot-hero">
        <div>
          <p className="eyebrow">Gioco 01</p>
          <h2>Slot del disastro</h2>
          <p>
            {currentPlayer} gioca come {selectedCharacter.nome}. Tutto finto, salvato in locale e pronto per diventare multiplayer.
          </p>
        </div>
        <div className="slot-hero-actions">
          <label className="sound-toggle">
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(event) => {
                const enabled = event.target.checked;
                setSoundEnabled(enabled);
                if (enabled) {
                  startBackgroundMusic(true);
                } else {
                  stopBackgroundMusic();
                }
              }}
            />
            <span>Audio</span>
          </label>
          <button className="ghost-button" type="button" onClick={onBack}>
            Lobby
          </button>
        </div>
      </section>

      <section className="slot-layout">
        <div className={`slot-machine ${spinning ? "spinning" : ""} outcome-${lastOutcome}`}>
          {confettiBurst ? <Confetti key={confettiBurst.id} jackpot={confettiBurst.jackpot} /> : null}
          <div className="slot-topline">
            <span>{gameState.name}</span>
            <strong>{formatCoins(balance)} DC</strong>
          </div>
          <div className="reels" aria-live="polite">
            {reels.map((reel, index) => (
              <Reel key={`${reel.id}-${index}`} reel={reel} index={index} spinning={spinning} />
            ))}
          </div>
          <p className="slot-result">{result}</p>
          <div className="slot-controls">
            {bets.map((value) => (
              <button
                key={value}
                className={bet === value ? "bet-button active" : "bet-button"}
                type="button"
                onClick={() => setBet(value)}
                disabled={spinning}
              >
                {value}
              </button>
            ))}
            <button className="spin-button" type="button" onClick={spin} disabled={!canSpin}>
              {spinning ? "Gira..." : "Spin"}
            </button>
          </div>
        </div>

        <aside className="slot-sidebar">
          <Paytable jackpotSymbol={jackpotSymbol} />
          <History history={history} />
          <BadgeRail badges={badges} />
        </aside>
      </section>
    </main>
  );
}

function Confetti({ jackpot }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: jackpot ? 72 : 42 }, (_, index) => ({
        id: index,
        left: `${Math.random() * 100}%`,
        delay: `${Math.random() * 240}ms`,
        drift: `${Math.random() * 180 - 90}px`,
        rotate: `${Math.random() * 540 - 270}deg`,
        color: ["#ffc857", "#ff3864", "#3ee8ff", "#85ff9e", "#ff4fd8"][index % 5],
      })),
    [jackpot],
  );

  return (
    <div className="confetti-layer" aria-hidden="true">
      {pieces.map((piece) => (
        <span
          key={piece.id}
          style={{
            "--left": piece.left,
            "--delay": piece.delay,
            "--drift": piece.drift,
            "--rotate": piece.rotate,
            "--confetti": piece.color,
          }}
        />
      ))}
    </div>
  );
}

function Reel({ reel, index, spinning }) {
  const strip = useMemo(() => {
    const start = (index * 4) % characters.length;
    return Array.from({ length: 7 }, (_, itemIndex) => characters[(start + itemIndex) % characters.length]);
  }, [index]);

  return (
    <div className="reel" style={{ "--delay": `${index * 90}ms` }}>
      <div className="reel-window">
        <div className="reel-strip" aria-hidden={!spinning}>
          {strip.map((symbol, symbolIndex) => (
            <img key={`${symbol.id}-${symbolIndex}`} src={symbol.immagine} alt="" />
          ))}
        </div>
        <img className="reel-final" src={reel.immagine} alt={reel.nome} />
      </div>
      <strong>{reel.nome}</strong>
    </div>
  );
}

function Paytable({ jackpotSymbol }) {
  return (
    <div className="paytable">
      <p className="eyebrow">Tabella vincite</p>
      <div className="jackpot-row">
        <span>Simbolo jackpot</span>
        <strong>{jackpotSymbol.nome}</strong>
      </div>
      {winLines.map((line) => (
        <div key={line.label}>
          <span>
            {line.label}
            <small>{line.detail}</small>
          </span>
          <strong>{line.multiplier}</strong>
        </div>
      ))}
    </div>
  );
}

function History({ history }) {
  return (
    <div className="history">
      <p className="eyebrow">Ultimi giri</p>
      {history.length === 0 ? (
        <span className="empty-history">Ancora nessuno spin.</span>
      ) : (
        history.slice(0, 8).map((item) => (
          <div className="history-row" key={item.id}>
            <span>{item.reels.map((reel) => reel.nome).join(" - ")}</span>
            <strong className={item.payout > 0 ? "win" : ""}>{item.payout > 0 ? `+${formatCoins(item.payout)}` : "0"} DC</strong>
          </div>
        ))
      )}
    </div>
  );
}

function randomReels(jackpotSymbol) {
  const roll = Math.random();

  if (jackpotSymbol && roll < 0.035) {
    return [jackpotSymbol, jackpotSymbol, jackpotSymbol];
  }

  if (roll < 0.075) {
    const symbol = pickRandom(characters);
    return [symbol, symbol, symbol];
  }

  if (roll < 0.46) {
    const pairSymbol = jackpotSymbol && Math.random() < 0.24 ? jackpotSymbol : pickRandom(characters);
    const thirdSymbol = pickDifferentCharacter(pairSymbol.id);
    return shuffleReels([pairSymbol, pairSymbol, thirdSymbol]);
  }

  return randomLosingReels();
}

function calculatePayout(reels, bet, jackpotSymbolId) {
  const [first, second, third] = reels;

  if (first.id === second.id && second.id === third.id) {
    return first.id === jackpotSymbolId ? bet * 14 : bet * 8;
  }

  if (first.id === second.id || first.id === third.id || second.id === third.id) {
    return bet * 2;
  }

  return 0;
}

function getOutcome(reels, payout, jackpotSymbolId) {
  if (payout <= 0) {
    return "loss";
  }

  if (reels.every((item) => item.id === jackpotSymbolId)) {
    return "jackpot";
  }

  return "win";
}

function buildResultMessage(reels, payout, bet, jackpotSymbolId) {
  const names = reels.map((item) => item.nome).join(" / ");
  const triple = reels.every((item) => item.id === reels[0].id);

  if (triple && reels[0].id === jackpotSymbolId) {
    return `Jackpot personale: ${formatCoins(payout)} DC. ${names}. La lobby finge compostezza.`;
  }

  if (triple) {
    return `Triplo colpo: ${formatCoins(payout)} DC. ${names}. Il banco prende appunti.`;
  }

  if (payout > bet) {
    return `Coppia fortunata: ${formatCoins(payout)} DC. ${names}. Dignita in leggero rialzo.`;
  }

  return `Zero applausi: ${names}. Hai finanziato l'arredamento immaginario.`;
}

function randomSpinMessage() {
  const messages = [
    "Rulli in pieno degrado...",
    "La macchina sta consultando il commercialista finto...",
    "Volti in centrifuga, dignita in sospeso...",
    "Il jackpot ti guarda, ma non promette niente...",
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function pickDifferentCharacter(characterId) {
  const options = characters.filter((character) => character.id !== characterId);
  return pickRandom(options);
}

function randomLosingReels() {
  const first = pickRandom(characters);
  const second = pickDifferentCharacter(first.id);
  const third = pickRandom(characters.filter((character) => character.id !== first.id && character.id !== second.id));
  return shuffleReels([first, second, third]);
}

function shuffleReels(reels) {
  return [...reels].sort(() => Math.random() - 0.5);
}

function updateBadges(current, entry, reels, jackpotSymbolId) {
  const next = [...current];
  const addBadge = (id, label) => {
    if (!next.some((badge) => badge.id === id)) {
      next.unshift({ id, label, earnedAt: new Date().toISOString() });
    }
  };

  if (entry.payout > 0) {
    addBadge("first-win", "Prima botta");
  }

  if (reels.every((item) => item.id === jackpotSymbolId)) {
    addBadge("jackpot-face", "Faccia jackpot");
  }

  if (entry.net <= -500) {
    addBadge("accounting-drama", "Dramma contabile");
  }

  return next.slice(0, 8);
}

function sendSocketMessage(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function parseSocketMessage(rawMessage) {
  try {
    return JSON.parse(rawMessage);
  } catch {
    return null;
  }
}

let backgroundMusic;

function startBackgroundMusic(enabled) {
  if (!enabled || typeof window === "undefined") {
    return;
  }

  if (!backgroundMusic) {
    backgroundMusic = new Audio(circusMusicUrl);
    backgroundMusic.loop = true;
    backgroundMusic.volume = 0.28;
  }

  backgroundMusic.play().catch(() => {});
}

function stopBackgroundMusic() {
  if (backgroundMusic) {
    backgroundMusic.pause();
  }
}

function playTone(enabled, type) {
  if (!enabled || typeof window === "undefined") {
    return;
  }

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) {
    return;
  }

  const context = new AudioContext();
  const patterns = {
    spin: [392, 523],
    win: [523, 659, 784, 1046],
    jackpot: [523, 659, 784, 1046, 1318, 1568],
    loss: [196, 146],
    error: [110, 92],
  };

  patterns[type].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + index * (type === "jackpot" ? 0.075 : 0.065);
    const duration = type === "spin" ? 0.08 : type === "jackpot" ? 0.18 : 0.14;

    oscillator.type = type === "loss" || type === "error" ? "sawtooth" : "square";
    oscillator.frequency.setValueAtTime(frequency, start);
    if (type === "jackpot") {
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.015, start + duration);
    }
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(type === "jackpot" ? 0.11 : 0.075, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration);
  });
}

function makeId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatCoins(value) {
  return new Intl.NumberFormat("it-IT").format(value);
}

function formatChatTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(date);
}

createRoot(document.getElementById("root")).render(<App />);
