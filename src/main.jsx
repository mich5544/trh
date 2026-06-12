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
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [clientId] = useState(() => savedState.clientId ?? makeId());
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [blackjackTable, setBlackjackTable] = useState(createEmptyBlackjackTable());
  const [boardState, setBoardState] = useState(createEmptyBoardState());
  const [boxingRings, setBoxingRings] = useState([]);
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
        return;
      }

      if (payload.type === "blackjack-state" && payload.table) {
        setBlackjackTable(payload.table);
        return;
      }

      if (payload.type === "board-state" && payload.board) {
        setBoardState(payload.board);
        return;
      }

      if (payload.type === "boxing-state" && Array.isArray(payload.rings)) {
        setBoxingRings(payload.rings);
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
      setMusicPlaying(false);
      return undefined;
    }

    attemptStartMusic();

    const startMusic = () => {
      attemptStartMusic();
    };

    window.addEventListener("pointerdown", startMusic, { once: true, capture: true });
    window.addEventListener("keydown", startMusic, { once: true, capture: true });

    return () => {
      window.removeEventListener("pointerdown", startMusic, { capture: true });
      window.removeEventListener("keydown", startMusic, { capture: true });
    };
  }, [soundEnabled]);

  function attemptStartMusic() {
    startBackgroundMusic(soundEnabled).then((started) => {
      setMusicPlaying(started);
    });
  }

  function toggleSound() {
    if (soundEnabled && !musicPlaying) {
      attemptStartMusic();
      return;
    }

    const nextEnabled = !soundEnabled;
    setSoundEnabled(nextEnabled);

    if (nextEnabled) {
      startBackgroundMusic(true).then((started) => {
        setMusicPlaying(started);
      });
    } else {
      stopBackgroundMusic();
      setMusicPlaying(false);
    }
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

  function sendBlackjackAction(type) {
    if (connectionStatus !== "online" || !socketRef.current) {
      setMessage("Tavolo carte offline: serve il server online per giocare in gruppo.");
      return;
    }

    sendSocketMessage(socketRef.current, { type });
  }

  function sendBoardAction(type) {
    if (connectionStatus !== "online" || !socketRef.current) {
      setMessage("Board Royale offline: serve il server online per giocare insieme.");
      return;
    }

    sendSocketMessage(socketRef.current, { type });
  }

  function sendBoxingAction(payload) {
    if (connectionStatus !== "online" || !socketRef.current) {
      setMessage("Arena Boxe offline: serve il server online per combattere.");
      return;
    }

    sendSocketMessage(socketRef.current, payload);
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

  function openBlackjack() {
    if (!selectedCharacter) {
      setMessage("Prima scegli un personaggio, poi puoi sederti al tavolo carte.");
      return;
    }

    if (connectionStatus !== "online") {
      setMessage("Il tavolo carte e multiplayer: aspetta la connessione online.");
      return;
    }

    startBackgroundMusic(soundEnabled);
    sendBlackjackAction("blackjack-join");
    setView("blackjack");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openBoard() {
    if (!selectedCharacter) {
      setMessage("Prima scegli un personaggio, poi puoi entrare nel Board Royale.");
      return;
    }

    if (connectionStatus !== "online") {
      setMessage("Board Royale e multiplayer: aspetta la connessione online.");
      return;
    }

    startBackgroundMusic(soundEnabled);
    sendBoardAction("board-join");
    setView("board");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openBoxing() {
    if (!selectedCharacter) {
      setMessage("Prima scegli un personaggio, poi puoi entrare nell'Arena Boxe.");
      return;
    }

    if (connectionStatus !== "online") {
      setMessage("Arena Boxe e multiplayer: aspetta la connessione online.");
      return;
    }

    startBackgroundMusic(soundEnabled);
    setView("boxing");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app-shell">
      <Header
        availableCount={availableCount}
        connectionStatus={connectionStatus}
        soundEnabled={soundEnabled}
        musicPlaying={musicPlaying}
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
          openBlackjack={openBlackjack}
          openBoard={openBoard}
          openBoxing={openBoxing}
          lobby={lobby}
          badges={badges}
        />
      ) : view === "slot" ? (
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
            setView("lobby");
          }}
        />
      ) : view === "blackjack" ? (
        <BlackjackTable
          table={blackjackTable}
          clientId={clientId}
          currentPlayer={currentPlayer}
          selectedCharacter={selectedCharacter}
          connectionStatus={connectionStatus}
          onJoin={() => sendBlackjackAction("blackjack-join")}
          onLeave={() => {
            sendBlackjackAction("blackjack-leave");
            setView("lobby");
          }}
          onStart={() => sendBlackjackAction("blackjack-start")}
          onHit={() => sendBlackjackAction("blackjack-hit")}
          onStand={() => sendBlackjackAction("blackjack-stand")}
          onBack={() => setView("lobby")}
        />
      ) : view === "board" ? (
        <BoardRoyale
          board={boardState}
          clientId={clientId}
          selectedCharacter={selectedCharacter}
          connectionStatus={connectionStatus}
          onJoin={() => sendBoardAction("board-join")}
          onLeave={() => {
            sendBoardAction("board-leave");
            setView("lobby");
          }}
          onStart={() => sendBoardAction("board-start")}
          onRoll={() => sendBoardAction("board-roll")}
          onBuy={() => sendBoardAction("board-buy")}
          onEndTurn={() => sendBoardAction("board-end-turn")}
          onBack={() => setView("lobby")}
        />
      ) : (
        <BoxingArena
          rings={boxingRings}
          clientId={clientId}
          selectedCharacter={selectedCharacter}
          connectionStatus={connectionStatus}
          onJoin={(ringId) => sendBoxingAction({ type: "boxing-join", ringId })}
          onLeave={() => sendBoxingAction({ type: "boxing-leave" })}
          onAttack={(attack, targetId) => sendBoxingAction({ type: "boxing-attack", attack, targetId })}
          onNewRound={(ringId) => sendBoxingAction({ type: "boxing-new-round", ringId })}
          onBack={() => setView("lobby")}
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

function Header({ availableCount, connectionStatus, soundEnabled, musicPlaying, onToggleSound, onReset }) {
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
          Musica {soundEnabled && musicPlaying ? "on" : soundEnabled ? "avvia" : "off"}
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
  openBlackjack,
  openBoard,
  openBoxing,
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

      <Arcade onOpenSlot={openSlot} onOpenBlackjack={openBlackjack} onOpenBoard={openBoard} onOpenBoxing={openBoxing} selectedCharacter={selectedCharacter} />
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

function Arcade({ onOpenSlot, onOpenBlackjack, onOpenBoard, onOpenBoxing, selectedCharacter }) {
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
        <article className="game-card active">
          <span>02</span>
          <h3>Tavolo carte</h3>
          <p>Blackjack e sfide veloci con saldo rigorosamente fittizio.</p>
          <button className="play-button" type="button" onClick={onOpenBlackjack}>
            {selectedCharacter ? "Siediti" : "Scegli personaggio"}
          </button>
        </article>
        <article className="game-card">
          <span>03</span>
          <h3>Scacchi</h3>
          <p>Timer, ranking e partite 1v1 dentro la lobby.</p>
        </article>
        <article className="game-card active">
          <span>04</span>
          <h3>Board Royale</h3>
          <p>Il tabellone stile Monopoli con pedine-faccia e caselle custom.</p>
          <button className="play-button" type="button" onClick={onOpenBoard}>
            {selectedCharacter ? "Entra" : "Scegli personaggio"}
          </button>
        </article>
        <article className="game-card active">
          <span>05</span>
          <h3>Arena Boxe</h3>
          <p>Sticker giganti, pugni, calci e ring guardabili live.</p>
          <button className="play-button" type="button" onClick={onOpenBoxing}>
            {selectedCharacter ? "Combatti" : "Scegli personaggio"}
          </button>
        </article>
      </div>
    </section>
  );
}

function BlackjackTable({
  table,
  clientId,
  currentPlayer,
  selectedCharacter,
  connectionStatus,
  onJoin,
  onLeave,
  onStart,
  onHit,
  onStand,
  onBack,
}) {
  const players = table.players ?? [];
  const ownSeat = players.find((player) => player.id === clientId);
  const canPlay = table.phase === "playing" && ownSeat?.status === "playing";
  const canStart = connectionStatus === "online" && players.length > 0 && table.phase !== "playing";

  return (
    <main className="blackjack-page">
      <section className="blackjack-hero">
        <div>
          <p className="eyebrow">Gioco 02</p>
          <h2>Tavolo carte</h2>
          <p>
            Blackjack di gruppo: ogni giocatore vede il tavolo live, pesca o resta, poi il banco chiude quando tutti hanno deciso.
          </p>
        </div>
        <div className="slot-hero-actions">
          <button className="ghost-button" type="button" onClick={onBack}>
            Lobby
          </button>
        </div>
      </section>

      <section className="blackjack-layout">
        <div className="blackjack-table">
          <div className="blackjack-topline">
            <span>{connectionStatus === "online" ? "Tavolo online" : "Offline"}</span>
            <strong>Round {table.round || 0}</strong>
          </div>

          <div className="dealer-panel">
            <div>
              <p className="eyebrow">Banco</p>
              <strong>{table.dealer?.total ? `${table.dealer.total}` : table.phase === "playing" ? "?" : "In attesa"}</strong>
            </div>
            <ChipStack amount={table.phase === "waiting" ? 3 : 6} />
            <CardRow cards={table.dealer?.cards ?? []} />
          </div>

          <div className="blackjack-message">
            <span>{table.message}</span>
            <ChipStack amount={4} compact />
          </div>

          <div className="blackjack-players">
            {players.length === 0 ? (
              <div className="empty-table">
                <strong>Nessuno al tavolo</strong>
                <span>Siediti e chiama gli altri nella chat.</span>
              </div>
            ) : (
              players.map((player) => (
                <article className={`blackjack-seat ${player.id === clientId ? "own-seat" : ""}`} key={player.id}>
                  <div className="seat-heading">
                    <div>
                      <strong>{player.displayName}</strong>
                      <span>{player.online ? "online" : "assente"}</span>
                    </div>
                    <mark>{player.result ?? blackjackStatusLabel(player.status)}</mark>
                  </div>
                  <CardRow cards={player.hand ?? []} />
                  <ChipStack amount={player.result === "Vinto" ? 6 : player.status === "playing" ? 4 : 2} compact />
                  <div className="seat-score">
                    <span>Totale</span>
                    <strong>{player.total || "-"}</strong>
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="blackjack-controls">
            {!ownSeat ? (
              <button className="secondary-button" type="button" onClick={onJoin} disabled={connectionStatus !== "online" || !selectedCharacter}>
                Siediti
              </button>
            ) : (
              <button className="ghost-button" type="button" onClick={onLeave}>
                Lascia
              </button>
            )}
            <button className="secondary-button" type="button" onClick={onStart} disabled={!canStart}>
              {table.phase === "finished" ? "Nuovo round" : "Avvia round"}
            </button>
            <button className="bet-button" type="button" onClick={onHit} disabled={!canPlay}>
              Carta
            </button>
            <button className="bet-button" type="button" onClick={onStand} disabled={!canPlay}>
              Sto
            </button>
          </div>
        </div>

        <aside className="blackjack-sidebar">
          <div className="paytable">
            <p className="eyebrow">Regole rapide</p>
            <div>
              <span>
                Obiettivo
                <small>Arriva piu vicino a 21 del banco senza sballare.</small>
              </span>
              <strong>21</strong>
            </div>
            <div>
              <span>
                Banco
                <small>Pesca automaticamente fino a 17.</small>
              </span>
              <strong>17</strong>
            </div>
            <div>
              <span>
                Gruppo
                <small>Il round si chiude quando tutti restano o sballano.</small>
              </span>
              <strong>{players.length}/14</strong>
            </div>
          </div>
          <div className="choice-panel blackjack-note">
            <strong>{currentPlayer ?? "Ospite"}</strong>
            <span>Il saldo non viene ancora modificato: questa prima versione serve per giocare insieme e testare il tavolo live.</span>
          </div>
        </aside>
      </section>
    </main>
  );
}

function CardRow({ cards }) {
  return (
    <div className="card-row">
      {cards.length === 0 ? (
        <span className="playing-card back">?</span>
      ) : (
        cards.map((card, index) =>
          card ? (
            <span className={`playing-card ${card.suit === "H" || card.suit === "D" ? "red-card" : ""}`} key={`${card.rank}-${card.suit}-${index}`}>
              <span className="card-corner">
                <strong>{card.rank}</strong>
                <small>{cardSuit(card.suit)}</small>
              </span>
              <span className="card-pip">{cardSuit(card.suit)}</span>
              <span className="card-corner bottom">
                <strong>{card.rank}</strong>
                <small>{cardSuit(card.suit)}</small>
              </span>
            </span>
          ) : (
            <span className="playing-card back" key={`hidden-${index}`}>
              <span>DC</span>
            </span>
          ),
        )
      )}
    </div>
  );
}

function ChipStack({ amount = 4, compact = false }) {
  return (
    <div className={`chip-stack ${compact ? "compact" : ""}`} aria-hidden="true">
      {Array.from({ length: amount }, (_, index) => (
        <span key={index} style={{ "--chip-index": index }} />
      ))}
    </div>
  );
}

function BoardRoyale({
  board,
  clientId,
  selectedCharacter,
  connectionStatus,
  onJoin,
  onLeave,
  onStart,
  onRoll,
  onBuy,
  onEndTurn,
  onBack,
}) {
  const spaces = board.spaces ?? [];
  const players = board.players ?? [];
  const [visualPositions, setVisualPositions] = useState({});
  const [movingPlayers, setMovingPlayers] = useState(new Set());
  const previousPositionsRef = useRef({});
  const moveTimersRef = useRef(new Map());
  const ownPlayer = players.find((player) => player.id === clientId);
  const turnPlayer = players.find((player) => player.id === board.turnPlayerId);
  const currentSpace = ownPlayer ? spaces[ownPlayer.position] : null;
  const canRoll = board.phase === "playing" && board.turnPlayerId === clientId && ownPlayer?.status === "turn";
  const canBuy = board.phase === "playing" && board.turnPlayerId === clientId && ownPlayer?.canBuy;
  const canEndTurn = board.phase === "playing" && board.turnPlayerId === clientId && ownPlayer?.status === "moved";
  const canStart = connectionStatus === "online" && players.length > 0 && board.phase !== "playing";
  const displayedPlayers = players.map((player) => ({
    ...player,
    displayPosition: visualPositions[player.id] ?? player.position,
    moving: movingPlayers.has(player.id),
  }));

  useEffect(() => {
    if (spaces.length === 0) {
      return undefined;
    }

    for (const player of players) {
      const previousPosition = previousPositionsRef.current[player.id];

      if (previousPosition === undefined) {
        previousPositionsRef.current[player.id] = player.position;
        setVisualPositions((current) => ({ ...current, [player.id]: player.position }));
        continue;
      }

      if (previousPosition !== player.position) {
        animateBoardMove(player.id, previousPosition, player.position, spaces.length, setVisualPositions, setMovingPlayers, moveTimersRef.current);
        previousPositionsRef.current[player.id] = player.position;
      }
    }

    const playerIds = new Set(players.map((player) => player.id));
    for (const playerId of Object.keys(previousPositionsRef.current)) {
      if (!playerIds.has(playerId)) {
        delete previousPositionsRef.current[playerId];
        moveTimersRef.current.get(playerId)?.forEach((timer) => window.clearTimeout(timer));
        moveTimersRef.current.delete(playerId);
      }
    }

    return undefined;
  }, [players, spaces.length]);

  useEffect(() => {
    return () => {
      for (const timers of moveTimersRef.current.values()) {
        timers.forEach((timer) => window.clearTimeout(timer));
      }
      moveTimersRef.current.clear();
    };
  }, []);

  return (
    <main className="board-page">
      <section className="board-hero">
        <div>
          <p className="eyebrow">Gioco 04</p>
          <h2>Board Royale</h2>
          <p>Monopoli rapido di gruppo: tira i dadi, compra caselle, paga affitti e prova a restare ricco di soldi finti.</p>
        </div>
        <div className="slot-hero-actions">
          <button className="ghost-button" type="button" onClick={onBack}>
            Lobby
          </button>
        </div>
      </section>

      <section className="board-layout">
        <div className="board-table">
          <div className="board-topline">
            <span>{connectionStatus === "online" ? "Board online" : "Offline"}</span>
            <strong>{turnPlayer ? `Turno: ${turnPlayer.displayName}` : "In attesa"}</strong>
          </div>

          <div className="monopoly-board">
            {spaces.map((space, index) => (
              <BoardSpace key={space.id} space={space} index={index} players={displayedPlayers.filter((player) => player.displayPosition === index)} />
            ))}

            <div className="board-center">
              <p className="eyebrow">Board Royale</p>
              <strong>{board.message}</strong>
              <DiceTray dice={board.lastRoll} />
            </div>
          </div>

          <div className="board-controls">
            {!ownPlayer ? (
              <button className="secondary-button" type="button" onClick={onJoin} disabled={connectionStatus !== "online" || !selectedCharacter}>
                Entra
              </button>
            ) : (
              <button className="ghost-button" type="button" onClick={onLeave}>
                Lascia
              </button>
            )}
            <button className="secondary-button" type="button" onClick={onStart} disabled={!canStart}>
              {board.phase === "playing" ? "In corso" : "Avvia"}
            </button>
            <button className="bet-button" type="button" onClick={onRoll} disabled={!canRoll}>
              Tira dadi
            </button>
            <button className="bet-button" type="button" onClick={onBuy} disabled={!canBuy}>
              Compra
            </button>
            <button className="spin-button" type="button" onClick={onEndTurn} disabled={!canEndTurn}>
              Fine turno
            </button>
          </div>
        </div>

        <aside className="board-sidebar">
          <div className="paytable">
            <p className="eyebrow">Giocatori</p>
            {players.length === 0 ? (
              <span className="empty-history">Ancora nessuno sul tabellone.</span>
            ) : (
              players.map((player) => (
                <div className="board-player-row" key={player.id}>
                  <span>
                    {player.displayName}
                    <small>{spaces[player.position]?.name ?? "Tabellone"}</small>
                  </span>
                  <strong>{formatCoins(player.balance)} DC</strong>
                </div>
              ))
            )}
          </div>

          <div className="paytable">
            <p className="eyebrow">Casella attuale</p>
            {currentSpace ? (
              <div>
                <span>
                  {currentSpace.name}
                  <small>{boardSpaceDescription(currentSpace)}</small>
                </span>
                <strong>{currentSpace.price ? `${currentSpace.price} DC` : "-"}</strong>
              </div>
            ) : (
              <span className="empty-history">Entra nel board per vedere la tua posizione.</span>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

function BoardSpace({ space, index, players }) {
  return (
    <article className={`board-space board-${space.type} ${isBoardCorner(index) ? "board-corner" : ""}`} style={{ "--space-color": space.color ?? "#ffffff" }}>
      <span className="board-index">{String(index + 1).padStart(2, "0")}</span>
      <strong>{space.name}</strong>
      <small>{boardSpaceShortLabel(space)}</small>
      <div className="board-tokens">
        {players.map((player) => (
          <span className={player.moving ? "moving" : ""} key={player.id} title={player.displayName}>
            {player.displayName.slice(0, 2)}
          </span>
        ))}
      </div>
      {space.ownerId ? <mark>Comprata</mark> : null}
    </article>
  );
}

function BoxingArena({ rings, clientId, selectedCharacter, connectionStatus, onJoin, onLeave, onAttack, onNewRound, onBack }) {
  const [selectedRingId, setSelectedRingId] = useState(null);
  const [selectedTargetId, setSelectedTargetId] = useState(null);
  const activeRing = rings.find((ring) => ring.fighters.some((fighter) => fighter.id === clientId) || ring.queue.some((fighter) => fighter.id === clientId));
  const visibleRing = activeRing ?? rings.find((ring) => ring.id === selectedRingId) ?? rings[0] ?? createEmptyBoxingRing();
  const ownFighter = visibleRing.fighters.find((fighter) => fighter.id === clientId);
  const opponents = ownFighter ? visibleRing.fighters.filter((fighter) => fighter.side !== ownFighter.side && fighter.status === "fighting") : [];
  const selectedTarget = opponents.find((fighter) => fighter.id === selectedTargetId) ?? opponents[0];
  const canAttack = visibleRing.phase === "fighting" && ownFighter?.status === "fighting" && selectedTarget;

  useEffect(() => {
    if (!selectedRingId && rings[0]) {
      setSelectedRingId(rings[0].id);
    }
  }, [rings, selectedRingId]);

  useEffect(() => {
    if (opponents.length > 0 && !opponents.some((fighter) => fighter.id === selectedTargetId)) {
      setSelectedTargetId(opponents[0].id);
    }
  }, [opponents, selectedTargetId]);

  return (
    <main className="boxing-page">
      <section className="boxing-hero">
        <div>
          <p className="eyebrow">Gioco 05</p>
          <h2>Arena Boxe</h2>
          <p>Entra in un ring libero, aspetta un avversario e combatti con sticker giganti dei personaggi.</p>
        </div>
        <div className="slot-hero-actions">
          <button className="ghost-button" type="button" onClick={onBack}>
            Lobby
          </button>
        </div>
      </section>

      <section className="boxing-layout">
        <aside className="boxing-ring-list">
          {rings.map((ring) => (
            <button
              className={`ring-select ${visibleRing.id === ring.id ? "active" : ""}`}
              type="button"
              key={ring.id}
              onClick={() => setSelectedRingId(ring.id)}
            >
              <strong>{ring.name}</strong>
              <span>{boxingModeLabel(ring)}</span>
            </button>
          ))}
        </aside>

        <div className="boxing-stage">
          <div className="boxing-topline">
            <span>{connectionStatus === "online" ? "Arena online" : "Offline"}</span>
            <strong>{visibleRing.message}</strong>
          </div>

          <div className="boxing-ring">
            <div className="rope rope-top" />
            <div className="rope rope-bottom" />
            <div className="boxing-side left-side">
              {visibleRing.fighters
                .filter((fighter) => fighter.side === "left")
                .map((fighter) => (
                  <BoxerSticker
                    key={boxingStickerKey(fighter, visibleRing.lastEvent)}
                    fighter={fighter}
                    active={fighter.id === clientId}
                    hit={visibleRing.lastEvent?.targetId === fighter.id}
                    attacking={visibleRing.lastEvent?.attackerId === fighter.id}
                    actionable={fighter.id === clientId && canAttack}
                    onAction={(attack) => onAttack(attack, selectedTarget?.id)}
                  />
                ))}
            </div>
            <div className="boxing-versus">VS</div>
            <div className="boxing-side right-side">
              {visibleRing.fighters
                .filter((fighter) => fighter.side === "right")
                .map((fighter) => (
                  <BoxerSticker
                    key={boxingStickerKey(fighter, visibleRing.lastEvent)}
                    fighter={fighter}
                    active={fighter.id === clientId}
                    hit={visibleRing.lastEvent?.targetId === fighter.id}
                    attacking={visibleRing.lastEvent?.attackerId === fighter.id}
                    actionable={fighter.id === clientId && canAttack}
                    onAction={(attack) => onAttack(attack, selectedTarget?.id)}
                  />
                ))}
            </div>
          </div>

          <div className="boxing-event">
            {visibleRing.lastEvent ? (
              <strong>
                {visibleRing.lastEvent.attack === "kick" ? "Calcio" : "Pugno"}: -{visibleRing.lastEvent.damage} HP
              </strong>
            ) : (
              <strong>In attesa del primo colpo.</strong>
            )}
            {visibleRing.queue.length > 0 ? <span>In attesa: {visibleRing.queue.map((fighter) => fighter.displayName).join(", ")}</span> : null}
          </div>

          <div className="boxing-controls">
            {!activeRing ? (
              <button className="secondary-button" type="button" onClick={() => onJoin(visibleRing.id)} disabled={!selectedCharacter || connectionStatus !== "online"}>
                Entra nel ring
              </button>
            ) : (
              <button className="ghost-button" type="button" onClick={onLeave}>
                Lascia arena
              </button>
            )}
            <select value={selectedTarget?.id ?? ""} onChange={(event) => setSelectedTargetId(event.target.value)} disabled={opponents.length <= 1}>
              {opponents.length === 0 ? (
                <option value="">Nessun bersaglio</option>
              ) : (
                opponents.map((fighter) => (
                  <option key={fighter.id} value={fighter.id}>
                    {fighter.displayName}
                  </option>
                ))
              )}
            </select>
            <button className="secondary-button" type="button" onClick={() => onNewRound(visibleRing.id)} disabled={visibleRing.phase === "fighting"}>
              Nuovo round
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function BoxerSticker({ fighter, active, hit, attacking, actionable, onAction }) {
  const character = characters.find((item) => item.id === fighter.characterId);
  const hpPercent = Math.max(0, Math.min(100, (fighter.hp / fighter.maxHp) * 100));

  function handleStickerPress(event) {
    if (!actionable) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - bounds.top;
    onAction(y < bounds.height * 0.58 ? "punch" : "kick");
  }

  return (
    <article
      className={`boxer-sticker ${active ? "active" : ""} ${actionable ? "actionable" : ""} ${hit ? "hit" : ""} ${attacking ? "attacking" : ""} status-${fighter.status}`}
      onClick={handleStickerPress}
      role={actionable ? "button" : undefined}
      tabIndex={actionable ? 0 : undefined}
      onKeyDown={(event) => {
        if (actionable && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onAction("punch");
        }
      }}
    >
      <div className="boxer-hp">
        <span style={{ width: `${hpPercent}%` }} />
      </div>
      {actionable ? (
        <div className="hit-zones" aria-hidden="true">
          <span>Pugno</span>
          <span>Calcio</span>
        </div>
      ) : null}
      <div className="boxer-figure" aria-hidden="true">
        <span className="figure-head" />
        <span className="figure-body" />
        <span className="figure-arm left" />
        <span className="figure-arm right" />
        <span className="figure-leg left" />
        <span className="figure-leg right" />
      </div>
      <img className="boxer-portrait" src={character?.immagine} alt={fighter.displayName} />
      <strong>{fighter.displayName}</strong>
      <small>{fighter.status === "ko" ? "KO" : `${fighter.hp} HP`}</small>
    </article>
  );
}

function DiceTray({ dice }) {
  return (
    <div className={`dice-tray ${dice ? "rolled" : ""}`} key={dice ? dice.join("-") : "idle"}>
      {dice ? (
        <>
          <DiceFace value={dice[0]} />
          <DiceFace value={dice[1]} />
          <strong>{dice[0] + dice[1]}</strong>
        </>
      ) : (
        <span>Dadi fermi</span>
      )}
    </div>
  );
}

function DiceFace({ value }) {
  return (
    <span className="dice-face" aria-label={`Dado ${value}`}>
      {Array.from({ length: 9 }, (_, index) => (
        <i key={index} className={dicePips[value].includes(index) ? "active" : ""} />
      ))}
    </span>
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

function createEmptyBlackjackTable() {
  return {
    phase: "waiting",
    round: 0,
    message: "Connessione al tavolo carte...",
    dealer: { cards: [], total: null },
    players: [],
  };
}

function createEmptyBoardState() {
  return {
    phase: "waiting",
    round: 0,
    turnPlayerId: null,
    lastRoll: null,
    message: "Connessione al Board Royale...",
    spaces: [],
    players: [],
  };
}

function createEmptyBoxingRing() {
  return {
    id: "ring-1",
    name: "Ring 1",
    phase: "waiting",
    round: 0,
    message: "Connessione all'arena...",
    fighters: [],
    queue: [],
    lastEvent: null,
  };
}

function boxingModeLabel(ring) {
  const left = ring.fighters.filter((fighter) => fighter.side === "left").length;
  const right = ring.fighters.filter((fighter) => fighter.side === "right").length;

  if (left === 0 && right === 0) {
    return ring.queue.length > 0 ? `${ring.queue.length} in attesa` : "Libero";
  }

  if (left === right) {
    return `${left} vs ${right}`;
  }

  return `${left} vs ${right} - manca qualcuno`;
}

function boxingStickerKey(fighter, lastEvent) {
  return lastEvent && (lastEvent.attackerId === fighter.id || lastEvent.targetId === fighter.id) ? `${fighter.id}-${lastEvent.id}` : fighter.id;
}

function boardSpaceShortLabel(space) {
  if (space.type === "property") {
    return `${space.price} DC / affitto ${space.rent}`;
  }

  if (space.type === "tax") {
    return `Paga ${space.amount} DC`;
  }

  if (space.type === "bonus") {
    return `Incassa ${space.amount} DC`;
  }

  if (space.type === "start") {
    return `Passa e prendi ${space.reward} DC`;
  }

  if (space.type === "chance") {
    return "Imprevisto";
  }

  return "Sosta";
}

function boardSpaceDescription(space) {
  const descriptions = {
    property: `Comprabile per ${space.price} DC. Chi ci capita paga ${space.rent} DC al proprietario.`,
    tax: `Casella tassa: perdi ${space.amount} DC.`,
    bonus: `Casella bonus: guadagni ${space.amount} DC.`,
    start: `Passando dal via prendi ${space.reward} DC.`,
    chance: "Imprevisto casuale: puo andare bene o malissimo.",
    rest: "Casella neutra: ti fermi e respiri.",
  };

  return descriptions[space.type] ?? "Casella speciale.";
}

function isBoardCorner(index) {
  return [0, 3, 6, 9].includes(index);
}

function animateBoardMove(playerId, fromPosition, toPosition, boardSize, setVisualPositions, setMovingPlayers, timersByPlayer) {
  timersByPlayer.get(playerId)?.forEach((timer) => window.clearTimeout(timer));
  timersByPlayer.delete(playerId);

  const steps = [];
  let position = fromPosition;

  while (position !== toPosition && steps.length <= boardSize) {
    position = (position + 1) % boardSize;
    steps.push(position);
  }

  if (steps.length === 0) {
    setVisualPositions((current) => ({ ...current, [playerId]: toPosition }));
    return;
  }

  setMovingPlayers((current) => new Set(current).add(playerId));

  const timers = steps.map((stepPosition, index) =>
    window.setTimeout(() => {
      setVisualPositions((current) => ({ ...current, [playerId]: stepPosition }));
      if (index === steps.length - 1) {
        setMovingPlayers((current) => {
          const next = new Set(current);
          next.delete(playerId);
          return next;
        });
        timersByPlayer.delete(playerId);
      }
    }, 360 * (index + 1)),
  );

  timersByPlayer.set(playerId, timers);
}

function blackjackStatusLabel(status) {
  const labels = {
    joined: "Seduto",
    playing: "Turno",
    standing: "Sto",
    bust: "Sballato",
    done: "Fine",
  };

  return labels[status] ?? "Tavolo";
}

function cardSuit(suit) {
  const suits = {
    S: "♠",
    H: "♥",
    D: "♦",
    C: "♣",
  };

  return suits[suit] ?? suit;
}

const dicePips = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

let backgroundMusic;

function startBackgroundMusic(enabled) {
  if (!enabled || typeof window === "undefined") {
    return Promise.resolve(false);
  }

  if (!backgroundMusic) {
    backgroundMusic = new Audio(circusMusicUrl);
    backgroundMusic.loop = true;
    backgroundMusic.volume = 0.28;
    backgroundMusic.preload = "auto";
  }

  if (!backgroundMusic.paused) {
    return Promise.resolve(true);
  }

  return backgroundMusic
    .play()
    .then(() => true)
    .catch(() => false);
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
