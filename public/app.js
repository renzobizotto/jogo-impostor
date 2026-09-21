(function () {
  const STORAGE_ID = "impostor.playerId";
  const STORAGE_NAME = "impostor.playerName";
  const REVEAL_MS = 5000;

  const socket = io();
  const els = {
    loginView: document.getElementById("loginView"),
    gameView: document.getElementById("gameView"),
    loginForm: document.getElementById("loginForm"),
    nameInput: document.getElementById("nameInput"),
    loginError: document.getElementById("loginError"),
    connectionPill: document.getElementById("connectionPill"),
    screenTitle: document.getElementById("screenTitle"),
    lobbyView: document.getElementById("lobbyView"),
    roundView: document.getElementById("roundView"),
    playerCount: document.getElementById("playerCount"),
    playerList: document.getElementById("playerList"),
    sidePlayerList: document.getElementById("sidePlayerList"),
    playersPanel: document.getElementById("playersPanel"),
    lobbyHostActions: document.getElementById("lobbyHostActions"),
    waitingHostMessage: document.getElementById("waitingHostMessage"),
    startRoundButton: document.getElementById("startRoundButton"),
    startHint: document.getElementById("startHint"),
    roundNumber: document.getElementById("roundNumber"),
    wordBox: document.getElementById("wordBox"),
    wordLabel: document.getElementById("wordLabel"),
    revealButton: document.getElementById("revealButton"),
    wordHint: document.getElementById("wordHint"),
    roundHostActions: document.getElementById("roundHostActions"),
    newRoundButton: document.getElementById("newRoundButton"),
    endRoundButton: document.getElementById("endRoundButton"),
    toast: document.getElementById("toast")
  };

  let joined = false;
  let gameState = null;
  let revealed = false;
  let revealTimer = null;
  let lastRoundNumber = 0;

  const savedName = localStorage.getItem(STORAGE_NAME);
  if (savedName) els.nameInput.value = savedName;

  socket.on("connect", () => {
    setConnection(true);
    const playerId = localStorage.getItem(STORAGE_ID);
    const name = localStorage.getItem(STORAGE_NAME);

    if (playerId && name && !joined) {
      socket.emit("resumeGame", { playerId, name }, (response) => {
        if (response?.ok) {
          joined = true;
          persistSession(response.playerId, response.name);
          showGame();
        } else {
          clearSession();
          joined = false;
          showLogin(response?.error || "Sessão expirada. Entre novamente.");
        }
      });
    }
  });

  socket.on("disconnect", () => {
    setConnection(false);
  });

  socket.on("state", (state) => {
    gameState = state;
    if (!joined && state.self) {
      joined = true;
      showGame();
    }

    if (state.roundNumber !== lastRoundNumber) {
      lastRoundNumber = state.roundNumber;
      hideWord();
    }

    render();
  });

  els.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = els.nameInput.value.trim().replace(/\s+/g, " ");
    const error = validateName(name);

    if (error) {
      els.loginError.textContent = error;
      return;
    }

    els.loginError.textContent = "";
    const playerId = localStorage.getItem(STORAGE_ID) || makePlayerId();
    socket.emit("joinGame", { playerId, name }, (response) => {
      if (!response?.ok) {
        els.loginError.textContent = response?.error || "Não foi possível entrar.";
        return;
      }

      joined = true;
      persistSession(response.playerId, response.name);
      showGame();
    });
  });

  els.startRoundButton.addEventListener("click", () => {
    requestRound("startRound");
  });

  els.newRoundButton.addEventListener("click", () => {
    requestRound("startRound");
  });

  els.endRoundButton.addEventListener("click", () => {
    socket.emit("endRound", (response) => {
      if (!response?.ok) showToast(response?.error || "Não foi possível encerrar.");
    });
  });

  els.revealButton.addEventListener("click", () => {
    if (!gameState?.hasPersonalWord) return;
    revealWord();
  });

  function requestRound(eventName) {
    socket.emit(eventName, (response) => {
      if (!response?.ok) showToast(response?.error || "Não foi possível iniciar.");
    });
  }

  function render() {
    if (!gameState || !gameState.self) return;

    showGame();
    renderPlayers(els.playerList, gameState.players);
    renderPlayers(els.sidePlayerList, gameState.players);

    const isHost = Boolean(gameState.self.isHost);
    const canStart = gameState.playerCount >= gameState.minPlayers;

    els.playerCount.textContent = String(gameState.playerCount);
    els.startRoundButton.disabled = !canStart;
    els.newRoundButton.disabled = !canStart;
    els.startHint.textContent = canStart
      ? "Todos receberão suas palavras ao mesmo tempo."
      : `Faltam ${gameState.minPlayers - gameState.playerCount} jogador(es).`;

    if (gameState.phase === "round") {
      els.screenTitle.textContent = `Rodada ${gameState.roundNumber}`;
      els.lobbyView.classList.add("hidden");
      els.roundView.classList.remove("hidden");
      els.playersPanel.classList.remove("hidden");
      els.roundNumber.textContent = `RODADA ${gameState.roundNumber}`;
      els.roundHostActions.classList.toggle("hidden", !isHost);
      renderWord();
    } else {
      els.screenTitle.textContent = "Lobby";
      els.lobbyView.classList.remove("hidden");
      els.roundView.classList.add("hidden");
      els.playersPanel.classList.add("hidden");
      els.lobbyHostActions.classList.toggle("hidden", !isHost);
      els.waitingHostMessage.classList.toggle("hidden", isHost);
      hideWord();
    }
  }

  function renderPlayers(list, players) {
    list.replaceChildren(
      ...players.map((player) => {
        const item = document.createElement("li");
        const name = document.createElement("span");
        name.className = "player-name";
        name.textContent = player.name;

        if (player.isHost) {
          const host = document.createElement("span");
          host.className = "host-mark";
          host.textContent = "👑";
          host.setAttribute("aria-label", "Host");
          name.prepend(host);
        }

        item.append(name);
        return item;
      })
    );
  }

  function revealWord() {
    clearTimeout(revealTimer);
    revealed = true;
    renderWord();
    revealTimer = setTimeout(() => {
      hideWord();
      renderWord();
    }, REVEAL_MS);
  }

  function hideWord() {
    clearTimeout(revealTimer);
    revealed = false;
  }

  function renderWord() {
    const hasWord = Boolean(gameState?.hasPersonalWord);

    els.revealButton.disabled = !hasWord;

    if (!hasWord) {
      els.wordBox.classList.add("hidden-word");
      els.wordLabel.textContent = "AGUARDE A PRÓXIMA RODADA";
      els.revealButton.textContent = "SEM PALAVRA NESTA RODADA";
      els.wordHint.textContent = "Entre na próxima rodada quando o Host gerar novas palavras.";
      return;
    }

    if (revealed) {
      els.wordBox.classList.remove("hidden-word");
      els.wordLabel.textContent = gameState.personalWord;
      els.revealButton.textContent = "VER NOVAMENTE";
      els.wordHint.textContent = "Memorize sua palavra.";
      return;
    }

    els.wordBox.classList.add("hidden-word");
    els.wordLabel.textContent = "PALAVRA ESCONDIDA";
    els.revealButton.textContent = "TOQUE PARA REVELAR";
    els.wordHint.textContent = "Pronto para a conversa.";
  }

  function showGame() {
    els.loginView.classList.add("hidden");
    els.gameView.classList.remove("hidden");
  }

  function showLogin(error) {
    els.gameView.classList.add("hidden");
    els.loginView.classList.remove("hidden");
    els.loginError.textContent = error || "";
  }

  function setConnection(isOnline) {
    els.connectionPill.textContent = isOnline ? "online" : "offline";
    els.connectionPill.classList.toggle("online", isOnline);
  }

  function validateName(name) {
    if (!name) return "Digite seu nome.";
    if (name.length < 2) return "O nome precisa ter pelo menos 2 caracteres.";
    if (name.length > 20) return "O nome pode ter no máximo 20 caracteres.";
    return "";
  }

  function makePlayerId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID().replaceAll("-", "");
    return `${Date.now()}${Math.random().toString(16).slice(2)}`;
  }

  function persistSession(playerId, name) {
    localStorage.setItem(STORAGE_ID, playerId);
    localStorage.setItem(STORAGE_NAME, name);
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_ID);
    localStorage.removeItem(STORAGE_NAME);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.add("hidden"), 3200);
  }
})();
