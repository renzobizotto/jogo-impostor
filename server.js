const path = require("path");
const os = require("os");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const wordPairs = require("./words");

const MIN_PLAYERS = 3;
const RECONNECT_GRACE_MS = 30_000;

function createGameServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  const players = new Map();
  const removalTimers = new Map();

  let hostId = null;
  let round = {
    active: false,
    number: 0,
    pairIndex: null,
    impostorId: null,
    assignments: new Map(),
    startedAt: null
  };

  app.use(express.static(path.join(__dirname, "public")));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, players: connectedPlayers().length, round: round.number });
  });

  io.on("connection", (socket) => {
    socket.on("joinGame", (payload, reply) => {
      handleJoin(socket, payload, reply, false);
    });

    socket.on("resumeGame", (payload, reply) => {
      handleJoin(socket, payload, reply, true);
    });

    socket.on("startRound", (reply) => {
      if (!socket.data.playerId) {
        return sendReply(reply, { ok: false, error: "Entre no jogo antes de iniciar uma rodada." });
      }

      if (socket.data.playerId !== hostId) {
        return sendReply(reply, { ok: false, error: "Somente o Host pode iniciar uma rodada." });
      }

      if (connectedPlayers().length < MIN_PLAYERS) {
        return sendReply(reply, {
          ok: false,
          error: `É necessário ter pelo menos ${MIN_PLAYERS} jogadores.`
        });
      }

      startRound();
      sendReply(reply, { ok: true });
      emitStateToAll();
    });

    socket.on("endRound", (reply) => {
      if (socket.data.playerId !== hostId) {
        return sendReply(reply, { ok: false, error: "Somente o Host pode encerrar a rodada." });
      }

      round.active = false;
      round.assignments.clear();
      round.impostorId = null;
      sendReply(reply, { ok: true });
      emitStateToAll();
    });

    socket.on("disconnect", () => {
      const playerId = socket.data.playerId;
      if (!playerId) return;

      const player = players.get(playerId);
      if (!player || player.socketId !== socket.id) return;

      player.connected = false;
      player.socketId = null;
      player.disconnectedAt = Date.now();

      if (hostId === playerId) {
        electHost();
      }

      scheduleRemoval(playerId);
      emitStateToAll();
    });
  });

  function handleJoin(socket, payload, reply, resumeOnly) {
    const playerId = sanitizeId(payload && payload.playerId);
    const rawName = typeof payload?.name === "string" ? payload.name : "";
    const name = sanitizeName(rawName);

    if (!playerId) {
      return sendReply(reply, { ok: false, error: "Sessão inválida. Entre novamente." });
    }

    if (resumeOnly && !players.has(playerId)) {
      return sendReply(reply, { ok: false, error: "Sessão expirada. Entre novamente." });
    }

    if (!resumeOnly) {
      const nameError = validateName(name);
      if (nameError) return sendReply(reply, { ok: false, error: nameError });

      if (isNameInUse(name, playerId)) {
        return sendReply(reply, { ok: false, error: "Esse nome ja esta em uso." });
      }
    }

    const existing = players.get(playerId);
    const finalName = existing ? existing.name : name;

    if (!finalName) {
      return sendReply(reply, { ok: false, error: "Sessão expirada. Entre novamente." });
    }

    if (isNameInUse(finalName, playerId)) {
      return sendReply(reply, { ok: false, error: "Esse nome ja esta em uso." });
    }

    attachPlayerSocket(socket, playerId, finalName, existing);
    electHost();

    sendReply(reply, { ok: true, playerId, name: finalName });
    emitStateToAll();
  }

  function attachPlayerSocket(socket, playerId, name, existing) {
    const now = Date.now();
    clearRemoval(playerId);

    if (existing?.connected && existing.socketId && existing.socketId !== socket.id) {
      const previousSocket = io.sockets.sockets.get(existing.socketId);
      if (previousSocket) previousSocket.disconnect(true);
    }

    const player = existing || {
      id: playerId,
      name,
      createdAt: now
    };

    player.name = name;
    player.socketId = socket.id;
    player.connected = true;
    player.connectedAt = existing?.connectedAt || now;
    player.disconnectedAt = null;
    players.set(playerId, player);
    socket.data.playerId = playerId;
  }

  function startRound() {
    const onlinePlayers = connectedPlayers();
    const pairIndex = pickWordPairIndex(round.pairIndex);
    const pair = wordPairs[pairIndex];
    const impostor = onlinePlayers[randomInt(onlinePlayers.length)];
    const assignments = new Map();

    for (const player of onlinePlayers) {
      assignments.set(player.id, player.id === impostor.id ? pair.impostor : pair.main);
    }

    round = {
      active: true,
      number: round.number + 1,
      pairIndex,
      impostorId: impostor.id,
      assignments,
      startedAt: Date.now()
    };
  }

  function buildStateFor(playerId) {
    const self = players.get(playerId);
    const word = round.active ? round.assignments.get(playerId) || null : null;

    return {
      self: self
        ? {
            id: self.id,
            name: self.name,
            isHost: self.id === hostId
          }
        : null,
      players: publicPlayers(),
      playerCount: connectedPlayers().length,
      minPlayers: MIN_PLAYERS,
      phase: round.active ? "round" : "lobby",
      roundNumber: round.number,
      hasPersonalWord: Boolean(word),
      personalWord: word
    };
  }

  function emitStateToAll() {
    for (const socket of io.sockets.sockets.values()) {
      const playerId = socket.data.playerId;
      if (playerId) socket.emit("state", buildStateFor(playerId));
    }
  }

  function publicPlayers() {
    return connectedPlayers().map((player) => ({
      id: player.id,
      name: player.name,
      isHost: player.id === hostId
    }));
  }

  function connectedPlayers() {
    return [...players.values()]
      .filter((player) => player.connected)
      .sort((a, b) => a.connectedAt - b.connectedAt);
  }

  function electHost() {
    const onlinePlayers = connectedPlayers();
    if (onlinePlayers.length === 0) {
      hostId = null;
      return;
    }

    if (!hostId || !players.get(hostId)?.connected) {
      hostId = onlinePlayers[0].id;
    }
  }

  function scheduleRemoval(playerId) {
    clearRemoval(playerId);
    const timer = setTimeout(() => {
      const player = players.get(playerId);
      if (!player || player.connected) return;

      players.delete(playerId);
      round.assignments.delete(playerId);
      if (hostId === playerId) electHost();
      emitStateToAll();
    }, RECONNECT_GRACE_MS);

    removalTimers.set(playerId, timer);
  }

  function clearRemoval(playerId) {
    const timer = removalTimers.get(playerId);
    if (timer) clearTimeout(timer);
    removalTimers.delete(playerId);
  }

  function isNameInUse(name, playerId) {
    const normalized = name.toLocaleLowerCase("pt-BR");
    return connectedPlayers().some((player) => {
      return player.id !== playerId && player.name.toLocaleLowerCase("pt-BR") === normalized;
    });
  }

  function pickWordPairIndex(previousIndex) {
    if (wordPairs.length === 1) return 0;

    let nextIndex = randomInt(wordPairs.length);
    while (nextIndex === previousIndex) {
      nextIndex = randomInt(wordPairs.length);
    }
    return nextIndex;
  }

  function close() {
    for (const timer of removalTimers.values()) clearTimeout(timer);
    io.close();
    server.close();
  }

  return { app, server, io, close };
}

function sanitizeId(value) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(id) ? id : "";
}

function sanitizeName(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 40);
}

function validateName(name) {
  if (!name) return "Digite seu nome.";
  if (name.length < 2) return "O nome precisa ter pelo menos 2 caracteres.";
  if (name.length > 20) return "O nome pode ter no máximo 20 caracteres.";
  return "";
}

function randomInt(max) {
  return crypto.randomInt(0, max);
}

function sendReply(reply, payload) {
  if (typeof reply === "function") reply(payload);
}

function getLanUrls(port) {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return urls;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createGameServer();

  server.listen(port, "0.0.0.0", () => {
    console.log(`IMPOSTOR rodando em http://localhost:${port}`);
    for (const url of getLanUrls(port)) {
      console.log(`LAN: ${url}`);
    }
  });
}

module.exports = { createGameServer, MIN_PLAYERS };
