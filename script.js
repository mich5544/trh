const characters = [
  {
    id: "belut",
    nome: "Belut",
    immagine: "personaggi/belut.jpeg",
    titolo: "Master in sensoristica olfattiva avanzata",
    colore: "#58d68d",
  },
  {
    id: "clari",
    nome: "Clari",
    immagine: "personaggi/clari.jpeg",
    titolo: "Master in sfondamento di cancelli",
    colore: "#ff4fd8",
  },
  {
    id: "conti",
    nome: "Conti",
    immagine: "personaggi/conti.jpeg",
    titolo: "Master in collezionismo di cagate alternative in autostrada",
    colore: "#ffb84d",
  },
  {
    id: "fede",
    nome: "Fede",
    immagine: "personaggi/fede.jpeg",
    titolo: "Master in gestione dell'ansia a carnevale",
    colore: "#7c7cff",
  },
  {
    id: "fra-nicoli",
    nome: "Fra Nicoli",
    immagine: "personaggi/fra nicoli.jpeg",
    titolo: "Master in gossip finding and reveal",
    colore: "#ef476f",
  },
  {
    id: "fra",
    nome: "Fra",
    immagine: "personaggi/fra.jpeg",
    titolo: "Master in cosa nostra e gestione dei pizzi del vicinato",
    colore: "#06d6a0",
  },
  {
    id: "gabri",
    nome: "Gabri",
    immagine: "personaggi/gabri.jpeg",
    titolo: "Master in invenzione di scuse per non uscire di casa",
    colore: "#4cc9f0",
  },
  {
    id: "ghila",
    nome: "Ghila",
    immagine: "personaggi/ghila.jpeg",
    titolo: "Master in drunkness management",
    colore: "#f72585",
  },
  {
    id: "greta",
    nome: "Greta",
    immagine: "personaggi/greta.jpeg",
    titolo: "Master nel trovarsi l'unica donna in mezzo a 3 cugini idioti",
    colore: "#ffd166",
  },
  {
    id: "loris",
    nome: "Loris",
    immagine: "personaggi/loris.jpeg",
    titolo: "Master nell'uscire di casa a orari improponibili",
    colore: "#00bbf9",
  },
  {
    id: "mickybi",
    nome: "Mickybi",
    immagine: "personaggi/mickybi.jpeg",
    titolo: "Master in collezionismo di sboccate alternative",
    colore: "#9b5de5",
  },
  {
    id: "vale",
    nome: "Vale",
    immagine: "personaggi/vale.jpeg",
    titolo: "Master in Pijama-driven outfit",
    colore: "#f15bb5",
  },
  {
    id: "vegio-michi",
    nome: "Vegio Michi",
    immagine: "personaggi/vegio michi.jpeg",
    titolo: "Master in joint rolling and quality check",
    colore: "#80ed99",
  },
  {
    id: "vegio",
    nome: "Vegio",
    immagine: "personaggi/vegio.jpeg",
    titolo: "Master nel mostrare il proprio deretano al pubblico",
    colore: "#f77f00",
  },
];

const grid = document.querySelector("#character-grid");
const nicknameInput = document.querySelector("#nickname");
const joinButton = document.querySelector("#join-button");
const resetButton = document.querySelector("#reset-button");
const fillDemoButton = document.querySelector("#fill-demo-button");
const prevCharacterButton = document.querySelector("#prev-character");
const nextCharacterButton = document.querySelector("#next-character");
const loginMessage = document.querySelector("#login-message");
const availableCount = document.querySelector("#available-count");
const lobbyStatus = document.querySelector("#lobby-status");
const meterFill = document.querySelector("#meter-fill");
const selectedPreview = document.querySelector("#selected-preview");

let currentPlayer = null;
let selectedCharacterId = null;
let takenCharacters = new Map();

function renderCharacters() {
  grid.innerHTML = "";

  characters.forEach((character, index) => {
    const takenBy = takenCharacters.get(character.id);
    const isSelected = selectedCharacterId === character.id;
    const card = document.createElement("button");
    card.className = `character-card ${takenBy ? "taken" : ""} ${isSelected ? "selected" : ""}`;
    card.type = "button";
    card.style.setProperty("--accent", character.colore);
    card.disabled = Boolean(takenBy && !isSelected);
    card.setAttribute("aria-label", `${character.nome}, ${character.titolo}`);

    card.innerHTML = `
      <span class="card-number">${String(index + 1).padStart(2, "0")}</span>
      <span class="availability">${takenBy ? "Occupato" : "Disponibile"}</span>
      <img src="${character.immagine}" alt="${character.nome}" />
      <span class="character-body">
        <strong>${character.nome}</strong>
        <small>${character.titolo}</small>
      </span>
      ${takenBy ? `<span class="taken-by">Scelto da ${takenBy}</span>` : ""}
    `;

    card.addEventListener("click", () => selectCharacter(character.id));
    grid.appendChild(card);
  });

  updateLobby();
}

function selectCharacter(characterId) {
  const nickname = nicknameInput.value.trim();
  const character = characters.find((item) => item.id === characterId);

  if (!nickname) {
    loginMessage.textContent = "Prima scegli un nickname, poi reclama il personaggio.";
    nicknameInput.focus();
    return;
  }

  if (takenCharacters.has(characterId) && selectedCharacterId !== characterId) {
    loginMessage.textContent = `${character.nome} e gia stato preso. Esaurimento scorte su questo scaffale.`;
    return;
  }

  if (selectedCharacterId) {
    takenCharacters.delete(selectedCharacterId);
  }

  currentPlayer = nickname;
  selectedCharacterId = characterId;
  takenCharacters.set(characterId, nickname);
  loginMessage.textContent = `${nickname} entra in Degradoland come ${character.nome}.`;
  renderCharacters();
}

function updateLobby() {
  const taken = takenCharacters.size;
  const total = characters.length;
  const available = total - taken;
  const selected = characters.find((character) => character.id === selectedCharacterId);

  availableCount.textContent = available;
  lobbyStatus.textContent = `${taken}/${total}`;
  meterFill.style.width = `${(taken / total) * 100}%`;

  if (selected) {
    selectedPreview.innerHTML = `
      <img src="${selected.immagine}" alt="${selected.nome}" />
      <div>
        <small>Personaggio scelto</small>
        <strong>${selected.nome}</strong>
        <span>${currentPlayer}</span>
      </div>
    `;
  } else {
    selectedPreview.innerHTML = `
      <div class="empty-avatar">?</div>
      <div>
        <small>Personaggio scelto</small>
        <strong>Nessuno</strong>
      </div>
    `;
  }

  if (available === 0) {
    loginMessage.textContent = "Lobby piena: esaurimento scorte. Si entra al prossimo giro.";
  }
}

function enterLobby() {
  const nickname = nicknameInput.value.trim();

  if (!nickname) {
    loginMessage.textContent = "Scrivi un nickname per iniziare.";
    nicknameInput.focus();
    return;
  }

  const firstAvailable = characters.find((character) => !takenCharacters.has(character.id));

  if (!firstAvailable) {
    loginMessage.textContent = "Degradoland e al completo: esaurimento scorte.";
    return;
  }

  loginMessage.textContent = `${nickname}, scegli una card disponibile qui sotto.`;
}

function resetLobby() {
  currentPlayer = null;
  selectedCharacterId = null;
  takenCharacters = new Map();
  nicknameInput.value = "";
  loginMessage.textContent = "Massimo 14 giocatori: ogni personaggio si sceglie una volta sola.";
  renderCharacters();
}

function fillDemoLobby() {
  const demoNames = [
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

  takenCharacters = new Map(characters.map((character, index) => [character.id, demoNames[index]]));
  selectedCharacterId = null;
  currentPlayer = null;
  renderCharacters();
}

function scrollCharacters(direction) {
  const card = grid.querySelector(".character-card");

  if (!card) {
    return;
  }

  const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
  grid.scrollBy({
    left: direction * (card.getBoundingClientRect().width + gap),
    behavior: "smooth",
  });
}

joinButton.addEventListener("click", enterLobby);
resetButton.addEventListener("click", resetLobby);
fillDemoButton.addEventListener("click", fillDemoLobby);
prevCharacterButton.addEventListener("click", () => scrollCharacters(-1));
nextCharacterButton.addEventListener("click", () => scrollCharacters(1));
nicknameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    enterLobby();
  }
});

renderCharacters();
