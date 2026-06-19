'use strict';

const { buildDeck, shuffle, drawCards } = require('./deck');
const { isPlayable, calculateScore } = require('./rules');

const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function makePlayer(id, name, seatIndex) {
  return { id, name, hand: [], seatIndex, connected: true, calledUno: false, finished: false };
}

function makeRoom(code, hostId, firstPlayer, gameType) {
  return {
    code,
    hostId,
    players: [firstPlayer],
    state: 'waiting',
    gameType: gameType || 'uno',
    rules: { uno: false }, // optional UNO call/challenge rule; host sets it at room:start
    deck: [],
    discardPile: [],
    currentPlayerIndex: 0,
    direction: 1,
    pendingDraw: 0,
    pendingDrawType: null,
    currentColor: null,
    unoWindowOpen: false,
    unoVulnerableId: null,
    createdAt: Date.now(),
  };
}

// ── Public API ──────────────────────────────────────────────

function createRoom(socket, playerName, gameType) {
  const code = generateCode();
  const player = makePlayer(socket.id, playerName, 0);
  const room = makeRoom(code, socket.id, player, gameType);
  rooms.set(code, room);
  socket.join(code);
  return room;
}

function joinRoom(socket, code, playerName) {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room tidak ditemukan' };
  if (room.state !== 'waiting') return { error: 'Game sudah dimulai' };
  if (room.players.length >= 6) return { error: 'Room penuh (maks 6 pemain)' };
  const player = makePlayer(socket.id, playerName, room.players.length);
  room.players.push(player);
  socket.join(code.toUpperCase());
  return { room };
}

function startGame(code, requesterId, rules) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room tidak ditemukan' };
  if (room.hostId !== requesterId) return { error: 'Hanya host yang bisa memulai' };
  if (room.players.length < 2) return { error: 'Minimal 2 pemain' };
  if (room.state === 'playing') return { error: 'Game sudah berjalan' };

  // Lock in the host's rule choices for this game
  room.rules = { uno: !!(rules && rules.uno) };

  room.deck = shuffle(buildDeck());
  room.discardPile = [];
  room.state = 'playing';
  room.direction = 1;
  room.pendingDraw = 0;
  room.pendingDrawType = null;
  room.unoWindowOpen = false;
  room.unoVulnerableId = null;
  room.currentPlayerIndex = 0;

  room.finishedPlayers = [];
  for (const p of room.players) {
    p.hand = drawCards(room, 7);
    p.calledUno = false;
    p.finished  = false;
  }

  // First card — skip wilds to avoid edge cases at game start
  let startCard;
  let attempts = 0;
  do {
    startCard = room.deck.pop();
    if (startCard.color === 'wild') { room.deck.unshift(startCard); startCard = null; }
    attempts++;
  } while (!startCard && attempts < 200);

  if (!startCard) startCard = { id: 'fallback', color: 'red', value: '5' };
  room.discardPile.push(startCard);
  room.currentColor = startCard.color;

  // Handle action start cards
  if (startCard.value === 'skip') {
    advanceTurn(room); // first player is skipped
  } else if (startCard.value === 'reverse') {
    if (room.players.length === 2) advanceTurn(room);
    else { room.direction = -1; room.currentPlayerIndex = room.players.length - 1; }
  } else if (startCard.value === 'draw2') {
    room.pendingDraw = 2;
    room.pendingDrawType = 'draw2';
  }

  return { room };
}

function playCard(code, socketId, cardId, chosenColor) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room tidak ditemukan' };
  if (room.state !== 'playing') return { error: 'Game belum dimulai' };

  const pIdx = room.players.findIndex(p => p.id === socketId);
  if (pIdx === -1) return { error: 'Pemain tidak ditemukan' };
  if (pIdx !== room.currentPlayerIndex) return { error: 'Bukan giliranmu' };

  const player = room.players[pIdx];
  const cardIdx = player.hand.findIndex(c => c.id === cardId);
  if (cardIdx === -1) return { error: 'Kartu tidak ada di tanganmu' };

  const card = player.hand[cardIdx];
  const topCard = room.discardPile[room.discardPile.length - 1];

  if (!isPlayable(card, topCard, room.currentColor, room.pendingDraw, room.pendingDrawType)) {
    return { error: 'Kartu tidak bisa dimainkan' };
  }

  // Wild cards need a chosen color
  if (card.color === 'wild') {
    if (!chosenColor || !['red','blue','green','yellow'].includes(chosenColor)) {
      return { error: 'Pilih warna terlebih dahulu' };
    }
  }

  player.hand.splice(cardIdx, 1);
  room.discardPile.push(card);
  room.currentColor = card.color === 'wild' ? chosenColor : card.color;

  // Close any open UNO window
  room.unoWindowOpen = false;
  room.unoVulnerableId = null;
  for (const p of room.players) p.calledUno = false;

  // Finish check — player emptied their hand
  if (player.hand.length === 0) {
    player.finished = true;
    if (!room.finishedPlayers) room.finishedPlayers = [];
    const rank = room.finishedPlayers.length + 1;
    room.finishedPlayers.push({ id: player.id, name: player.name, rank });

    const unfinished = room.players.filter(p => p.connected && !p.finished);

    if (unfinished.length <= 1) {
      // Game over — award last place to the lone survivor
      if (unfinished.length === 1) {
        const loser = unfinished[0];
        loser.finished = true;
        room.finishedPlayers.push({ id: loser.id, name: loser.name, rank: rank + 1 });
      }
      room.state = 'finished';
      const firstWinner = room.players.find(p => p.id === room.finishedPlayers[0].id) || player;
      return { room, winner: player, scores: calculateScore(room.players, firstWinner), finishedPlayer: player, rank, gameOver: true };
    }

    // Game continues — skip past this player
    advanceTurn(room);
    return { room, card, skippedPlayerName, finishedPlayer: player, rank, gameOver: false };
  }

  // UNO vulnerability — only when the UNO rule is enabled for this room
  if (room.rules.uno && player.hand.length === 1) {
    room.unoWindowOpen = true;
    room.unoVulnerableId = player.id;
  }

  // Apply card effects — track who gets skipped for UI notification
  let extraSkip = false;
  let skippedPlayerName = null;
  const n = room.players.length;

  if (card.value === 'skip') {
    extraSkip = true;
    // Next player (in current direction) will be skipped
    const nextIdx = (pIdx + room.direction + n) % n;
    skippedPlayerName = room.players[nextIdx]?.name ?? null;
  } else if (card.value === 'reverse') {
    room.direction *= -1;
    if (room.players.filter(p => p.connected).length === 2) {
      extraSkip = true;
      // After direction flip, advance lands on the "other" player — they get skipped
      const nextIdx = (pIdx + room.direction + n) % n;
      skippedPlayerName = room.players[nextIdx]?.name ?? null;
    }
  } else if (card.value === 'draw2') {
    room.pendingDraw += 2;
    room.pendingDrawType = 'draw2';
  } else if (card.value === 'wild4') {
    room.pendingDraw += 4;
    room.pendingDrawType = 'wild4';
  } else {
    room.pendingDraw = 0;
    room.pendingDrawType = null;
  }

  advanceTurn(room);
  if (extraSkip) advanceTurn(room);

  return { room, card, skippedPlayerName };
}

function drawCard(code, socketId) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room tidak ditemukan' };
  if (room.state !== 'playing') return { error: 'Game belum dimulai' };

  const pIdx = room.players.findIndex(p => p.id === socketId);
  if (pIdx === -1) return { error: 'Pemain tidak ditemukan' };
  if (pIdx !== room.currentPlayerIndex) return { error: 'Bukan giliranmu' };

  const player = room.players[pIdx];

  // Close UNO window when a player takes their turn action
  room.unoWindowOpen = false;
  room.unoVulnerableId = null;
  for (const p of room.players) p.calledUno = false;

  // Forced draw from stacking
  if (room.pendingDraw > 0) {
    const drawn = drawCards(room, room.pendingDraw);
    player.hand.push(...drawn);
    room.pendingDraw = 0;
    room.pendingDrawType = null;
    advanceTurn(room);
    return { room, drawn, forced: true, canPlay: false, canPlayCard: null };
  }

  // Normal draw 1
  const drawn = drawCards(room, 1);
  player.hand.push(...drawn);

  const drawnCard = drawn[0];
  const topCard = room.discardPile[room.discardPile.length - 1];
  const canPlay = drawnCard ? isPlayable(drawnCard, topCard, room.currentColor, 0, null) : false;

  if (!canPlay) advanceTurn(room);

  return { room, drawn, forced: false, canPlay, canPlayCard: canPlay ? drawnCard : null };
}

function passAfterDraw(code, socketId) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room tidak ditemukan' };
  const pIdx = room.players.findIndex(p => p.id === socketId);
  if (pIdx === -1) return { error: 'Pemain tidak ditemukan' };
  if (pIdx !== room.currentPlayerIndex) return { error: 'Bukan giliranmu' };
  advanceTurn(room);
  return { room };
}

// Turn timer expired without action: draw the pending penalty (or 1 card) and
// ALWAYS advance — unlike drawCard, the player never keeps the turn here.
function timeoutDraw(code, socketId) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room tidak ditemukan' };
  if (room.state !== 'playing') return { error: 'Game belum dimulai' };

  const pIdx = room.players.findIndex(p => p.id === socketId);
  if (pIdx === -1) return { error: 'Pemain tidak ditemukan' };
  if (pIdx !== room.currentPlayerIndex) return { error: 'Bukan giliranmu' };

  const player = room.players[pIdx];

  // Close UNO window on a turn action
  room.unoWindowOpen = false;
  room.unoVulnerableId = null;
  for (const p of room.players) p.calledUno = false;

  const count = room.pendingDraw > 0 ? room.pendingDraw : 1;
  const drawn = drawCards(room, count);
  player.hand.push(...drawn);
  room.pendingDraw = 0;
  room.pendingDrawType = null;

  advanceTurn(room);
  return { room, drawn };
}

function callUno(code, socketId) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room tidak ditemukan' };
  if (!room.rules.uno) return { error: 'Aturan UNO tidak aktif' };
  const player = room.players.find(p => p.id === socketId);
  if (!player) return { error: 'Pemain tidak ditemukan' };
  if (player.hand.length !== 1) return { error: 'UNO hanya bisa dipanggil saat punya 1 kartu' };
  player.calledUno = true;
  // Protect them from challenge
  if (room.unoVulnerableId === socketId) {
    room.unoWindowOpen = false;
    room.unoVulnerableId = null;
  }
  return { room, player };
}

function challengeUno(code, challengerSocketId, targetSocketId) {
  const room = rooms.get(code);
  if (!room) return { error: 'Room tidak ditemukan' };
  if (!room.rules.uno) return { error: 'Aturan UNO tidak aktif' };
  if (!room.unoWindowOpen) return { error: 'Tidak ada yang bisa di-challenge' };
  if (room.unoVulnerableId !== targetSocketId) return { error: 'Pemain yang dipilih tidak bisa di-challenge' };

  const target = room.players.find(p => p.id === targetSocketId);
  if (!target) return { error: 'Pemain tidak ditemukan' };
  if (target.calledUno) return { error: `${target.name} sudah bilang UNO!` };

  const drawn = drawCards(room, 2);
  target.hand.push(...drawn);
  room.unoWindowOpen = false;
  room.unoVulnerableId = null;

  return { room, target, drawn };
}

function removePlayer(socketId) {
  for (const [code, room] of rooms.entries()) {
    const player = room.players.find(p => p.id === socketId);
    if (!player) continue;
    player.connected = false;

    const active = room.players.filter(p => p.connected);
    if (active.length === 0) { rooms.delete(code); return { removed: true, code, room: null }; }

    if (room.hostId === socketId) room.hostId = active[0].id;

    // If it was their turn, skip to next
    if (room.state === 'playing') {
      const pIdx = room.players.findIndex(p => p.id === socketId);
      if (pIdx === room.currentPlayerIndex) advanceTurn(room);
    }

    return { removed: true, code, room };
  }
  return { removed: false };
}

// ── Helpers ─────────────────────────────────────────────────

function advanceTurn(room) {
  const n = room.players.length;
  let next = (room.currentPlayerIndex + room.direction + n) % n;
  let guard = 0;
  while ((!room.players[next].connected || room.players[next].finished) && guard < n) {
    next = (next + room.direction + n) % n;
    guard++;
  }
  room.currentPlayerIndex = next;
}

function getRoom(code) {
  return rooms.get(code?.toUpperCase?.() ?? code);
}

function getPublicState(room) {
  return {
    code: room.code,
    gameType: room.gameType,
    unoEnabled: room.rules.uno,
    topCard: room.discardPile[room.discardPile.length - 1] || null,
    currentColor: room.currentColor,
    currentPlayerIndex: room.currentPlayerIndex,
    direction: room.direction,
    pendingDraw: room.pendingDraw,
    pendingDrawType: room.pendingDrawType,
    unoWindowOpen: room.unoWindowOpen,
    unoVulnerableId: room.unoVulnerableId,
    deckCount: room.deck.length,
    finishedPlayers: room.finishedPlayers || [],
    playerCardCounts: room.players.map(p => ({
      id: p.id, name: p.name, seatIndex: p.seatIndex,
      cardCount: p.hand.length, connected: p.connected, calledUno: p.calledUno,
    })),
  };
}

function getPlayerList(room) {
  return room.players.map(p => ({
    id: p.id, name: p.name, seatIndex: p.seatIndex,
    isHost: p.id === room.hostId, connected: p.connected,
  }));
}

function cleanupOldRooms() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [code, room] of rooms.entries()) {
    if (room.state !== 'playing' && room.createdAt < cutoff) rooms.delete(code);
  }
}

module.exports = {
  createRoom, joinRoom, startGame, playCard, drawCard, passAfterDraw, timeoutDraw,
  callUno, challengeUno, removePlayer, getRoom,
  getPublicState, getPlayerList, cleanupOldRooms,
};
