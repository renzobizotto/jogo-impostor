const assert = require("assert");
const { io: Client } = require("socket.io-client");
const { createGameServer } = require("../server");

const { server, close } = createGameServer();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listen(port) {
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

function connectClient(baseUrl) {
  return new Promise((resolve, reject) => {
    const socket = Client(baseUrl, {
      reconnection: false,
      transports: ["websocket"]
    });

    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function emitAck(socket, eventName, payload) {
  return new Promise((resolve) => {
    if (payload === undefined) {
      socket.emit(eventName, resolve);
    } else {
      socket.emit(eventName, payload, resolve);
    }
  });
}

function nextState(socket) {
  return new Promise((resolve) => socket.once("state", resolve));
}

async function join(socket, id, name) {
  const statePromise = nextState(socket);
  const response = await emitAck(socket, "joinGame", { playerId: id, name });
  assert.equal(response.ok, true, response.error);
  return statePromise;
}

async function run() {
  const port = await listen(0);
  const baseUrl = `http://127.0.0.1:${port}`;

  const ana = await connectClient(baseUrl);
  const beto = await connectClient(baseUrl);
  const caio = await connectClient(baseUrl);

  await join(ana, "player_ana_123", "Ana");
  await join(beto, "player_beto_123", "Beto");
  const caioState = await join(caio, "player_caio_123", "Caio");

  assert.equal(caioState.players.length, 3);
  assert.equal(caioState.players[0].name, "Ana");
  assert.equal(caioState.players[0].isHost, true);

  const duplicate = await connectClient(baseUrl);
  const duplicateResponse = await emitAck(duplicate, "joinGame", {
    playerId: "player_dupe_123",
    name: "Ana"
  });
  assert.equal(duplicateResponse.ok, false);
  duplicate.disconnect();

  const nonHostStart = await emitAck(beto, "startRound");
  assert.equal(nonHostStart.ok, false);

  const states = [nextState(ana), nextState(beto), nextState(caio)];
  const startResponse = await emitAck(ana, "startRound");
  assert.equal(startResponse.ok, true, startResponse.error);

  const roundStates = await Promise.all(states);
  const words = roundStates.map((state) => state.personalWord);
  assert.equal(roundStates.every((state) => state.phase === "round"), true);
  assert.equal(roundStates.every((state) => state.hasPersonalWord), true);
  assert.equal(new Set(words).size, 2);

  const [wordA, wordB] = [...new Set(words)];
  const impostorWordCount = words.filter((word) => word === wordA).length === 1
    ? words.filter((word) => word === wordA).length
    : words.filter((word) => word === wordB).length;
  assert.equal(impostorWordCount, 1);

  for (const state of roundStates) {
    const serialized = JSON.stringify(state);
    assert.equal(serialized.includes("impostorId"), false);
    assert.equal(serialized.includes("assignments"), false);
    assert.equal(serialized.includes("pairIndex"), false);
    assert.equal(serialized.includes("main"), false);
    assert.equal(serialized.includes("impostor"), false);
  }

  const newRoundStates = [nextState(ana), nextState(beto), nextState(caio)];
  const newRoundResponse = await emitAck(ana, "startRound");
  assert.equal(newRoundResponse.ok, true, newRoundResponse.error);
  const roundTwoStates = await Promise.all(newRoundStates);
  assert.equal(roundTwoStates.every((state) => state.roundNumber === 2), true);

  const reconnectWait = nextState(caio);
  beto.disconnect();
  await reconnectWait;
  const resumedBeto = await connectClient(baseUrl);
  const resumeStatePromise = nextState(resumedBeto);
  const resumeResponse = await emitAck(resumedBeto, "resumeGame", {
    playerId: "player_beto_123",
    name: "Beto"
  });
  assert.equal(resumeResponse.ok, true, resumeResponse.error);
  const resumedState = await resumeStatePromise;
  assert.equal(resumedState.players.filter((player) => player.name === "Beto").length, 1);

  const hostChangeWait = nextState(caio);
  ana.disconnect();
  const hostChangedState = await hostChangeWait;
  assert.equal(hostChangedState.players.some((player) => player.name === "Beto" && player.isHost), true);

  const tooFewResponse = await emitAck(resumedBeto, "startRound");
  assert.equal(tooFewResponse.ok, false);

  caio.disconnect();
  resumedBeto.disconnect();
  await wait(20);
}

run()
  .then(() => {
    console.log("Smoke tests passed");
    close();
  })
  .catch((error) => {
    console.error(error);
    close();
    process.exitCode = 1;
  });
