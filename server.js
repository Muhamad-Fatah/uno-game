'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { networkInterfaces } = require('os');
const path = require('path');
const QRCode = require('qrcode');
const rm = require('./game/roomManager');

const PORT = parseInt(process.env.PORT || '3000', 10);

function getLanIp() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const addr of ifaces) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return 'localhost';
}

const LAN_IP = process.env.BIND_IP || getLanIp();

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Socket handlers ──────────────────────────────────────────

io.on('connection', (socket) => {
  // ── Lobby ────────────────────────────────────────────────

  socket.on('room:create', async ({ playerName, gameType }) => {
    const name = playerName?.trim();
    if (!name) return socket.emit('room:error', { message: 'Nama tidak boleh kosong' });

    const room = rm.createRoom(socket, name, gameType || 'uno');
    socket.roomCode = room.code;

    const roomUrl = `http://${LAN_IP}:${PORT}/?join=${room.code}`;
    let qrDataUrl = '';
    try { qrDataUrl = await QRCode.toDataURL(roomUrl, { width: 220, margin: 1 }); } catch (_) {}

    socket.emit('room:created', {
      code: room.code, roomUrl, qrDataUrl,
      playerList: rm.getPlayerList(room),
      yourSeatIndex: 0, isHost: true,
      gameType: room.gameType,
    });
  });

  socket.on('room:join', async ({ code, playerName }) => {
    const name = playerName?.trim();
    const upperCode = code?.trim().toUpperCase();
    if (!name) return socket.emit('room:error', { message: 'Nama tidak boleh kosong' });
    if (!upperCode) return socket.emit('room:error', { message: 'Kode room tidak boleh kosong' });

    const result = rm.joinRoom(socket, upperCode, name);
    if (result.error) return socket.emit('room:error', { message: result.error });

    const { room } = result;
    socket.roomCode = room.code;

    const roomUrl = `http://${LAN_IP}:${PORT}/?join=${room.code}`;
    let qrDataUrl = '';
    try { qrDataUrl = await QRCode.toDataURL(roomUrl, { width: 220, margin: 1 }); } catch (_) {}

    const playerList = rm.getPlayerList(room);
    const me = room.players[room.players.length - 1];

    socket.emit('room:joined', {
      code: room.code, roomUrl, qrDataUrl,
      playerList, yourSeatIndex: me.seatIndex, isHost: false,
      gameType: room.gameType,
    });
    socket.to(room.code).emit('room:playerJoined', { playerList });
  });

  // ── Game lifecycle ───────────────────────────────────────

  socket.on('room:start', () => {
    const code = socket.roomCode;
    if (!code) return socket.emit('room:error', { message: 'Tidak ada room aktif' });

    const result = rm.startGame(code, socket.id);
    if (result.error) return socket.emit('room:error', { message: result.error });

    const { room } = result;

    // Send each player their private hand
    for (const player of room.players) {
      const pSocket = io.sockets.sockets.get(player.id);
      if (!pSocket) continue;
      pSocket.emit('game:started', {
        yourHand: player.hand,
        yourSeatIndex: player.seatIndex,
        topCard: room.discardPile[room.discardPile.length - 1],
        currentColor: room.currentColor,
        currentPlayerIndex: room.currentPlayerIndex,
        direction: room.direction,
        pendingDraw: room.pendingDraw,
        pendingDrawType: room.pendingDrawType,
        gameType: room.gameType,
        snakesPositions: room.snakesPositions,
        playerList: room.players.map(p => ({
          id: p.id, name: p.name, seatIndex: p.seatIndex,
          cardCount: p.hand.length, connected: p.connected,
        })),
      });
    }
  });

  // ── Game actions ─────────────────────────────────────────

  socket.on('game:playCard', ({ cardId, chosenColor }) => {
    const code = socket.roomCode;
    if (!code) return;

    const result = rm.playCard(code, socket.id, cardId, chosenColor);
    if (result.error) return socket.emit('game:error', { message: result.error });

    const { room, winner, scores, skippedPlayerName, finishedPlayer, rank, gameOver } = result;

    if (finishedPlayer) {
      // Player just emptied their hand — announce finish regardless of gameOver
      socket.emit('game:handUpdate', { hand: [], drawn: [], forced: false, canPlay: false, canPlayCard: null });
      io.to(room.code).emit('game:playerFinished', {
        playerId:   finishedPlayer.id,
        playerName: finishedPlayer.name,
        rank,
      });

      if (gameOver) {
        io.to(room.code).emit('game:won', {
          winnerName: winner.name,
          finalScores: scores,
          finishedPlayers: room.finishedPlayers,
        });
      } else {
        // Game continues — update state so others see the turn advance
        const pub = rm.getPublicState(room);
        io.to(room.code).emit('game:stateUpdate', {
          ...pub,
          lastAction: `🏆 ${finishedPlayer.name} selesai di #${rank}! Game lanjut...`,
          skippedPlayerName: null,
        });
      }
      return;
    }

    // Normal card play — send updated hand privately
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      socket.emit('game:handUpdate', { hand: player.hand, drawn: [], forced: false, canPlay: false, canPlayCard: null });
    }

    const playerName = player?.name ?? '?';
    const pub = rm.getPublicState(room);
    io.to(room.code).emit('game:stateUpdate', {
      ...pub,
      lastAction: `${playerName} memainkan kartu`,
      skippedPlayerName: skippedPlayerName || null,
    });
  });

  socket.on('game:drawCard', () => {
    const code = socket.roomCode;
    if (!code) return;

    const result = rm.drawCard(code, socket.id);
    if (result.error) return socket.emit('game:error', { message: result.error });

    const { room, drawn, forced, canPlay, canPlayCard } = result;
    const player = room.players.find(p => p.id === socket.id);

    // Private hand update to the drawing player
    socket.emit('game:handUpdate', {
      hand: player?.hand ?? [],
      drawn,
      forced: forced ?? false,
      canPlay: canPlay ?? false,
      canPlayCard: canPlayCard ?? null,
    });

    const playerName = player?.name ?? '?';
    const pub = rm.getPublicState(room);
    io.to(room.code).emit('game:stateUpdate', {
      ...pub,
      lastAction: forced
        ? `${playerName} mengambil ${drawn.length} kartu (penalti)`
        : `${playerName} mengambil kartu`,
    });
  });

  socket.on('game:rollDice', () => {
    const code = socket.roomCode;
    if (!code) return;

    const result = rm.rollDiceSnakes(code, socket.id);
    if (result.error) return socket.emit('game:error', { message: result.error });

    const { room, diceValue, oldPos, newPos, rawNew, event, overshot, won, player } = result;

    if (won) {
      io.to(room.code).emit('game:snakesMoved', {
        playerId: player.id, playerName: player.name,
        diceValue, oldPos, newPos, rawNew, event, overshot, won: true,
        currentPlayerIndex: room.currentPlayerIndex,
        snakesPositions: room.snakesPositions,
      });
      io.to(room.code).emit('game:won', { winnerName: player.name, finalScores: { [player.name]: 0 } });
      return;
    }

    io.to(room.code).emit('game:snakesMoved', {
      playerId: player.id, playerName: player.name,
      diceValue, oldPos, newPos, rawNew, event, overshot, won: false,
      currentPlayerIndex: room.currentPlayerIndex,
      snakesPositions: room.snakesPositions,
    });
  });

  socket.on('game:passAfterDraw', () => {
    const code = socket.roomCode;
    if (!code) return;

    const result = rm.passAfterDraw(code, socket.id);
    if (result.error) return socket.emit('game:error', { message: result.error });

    const { room } = result;
    const playerName = room.players.find(p => p.id === socket.id)?.name ?? '?';
    const pub = rm.getPublicState(room);
    io.to(room.code).emit('game:stateUpdate', {
      ...pub,
      lastAction: `${playerName} melewati giliran`,
    });
  });

  socket.on('game:callUno', () => {
    const code = socket.roomCode;
    if (!code) return;

    const result = rm.callUno(code, socket.id);
    if (result.error) return socket.emit('game:error', { message: result.error });

    io.to(result.room.code).emit('game:unoAlert', {
      playerName: result.player.name, playerId: result.player.id,
    });
  });

  socket.on('game:challengeUno', ({ targetId }) => {
    const code = socket.roomCode;
    if (!code) return;

    const result = rm.challengeUno(code, socket.id, targetId);
    if (result.error) return socket.emit('game:error', { message: result.error });

    const { room, target, drawn } = result;

    // Give penalty cards privately to the caught player
    const targetSocket = io.sockets.sockets.get(target.id);
    if (targetSocket) {
      targetSocket.emit('game:handUpdate', {
        hand: target.hand, drawn, forced: true, canPlay: false, canPlayCard: null,
      });
    }

    const challengerName = room.players.find(p => p.id === socket.id)?.name ?? '?';
    const pub = rm.getPublicState(room);
    io.to(room.code).emit('game:unoPenalty', { targetName: target.name, challengerName, penaltyCount: drawn.length });
    io.to(room.code).emit('game:stateUpdate', {
      ...pub,
      lastAction: `🚨 ${challengerName} menangkap ${target.name} tidak bilang UNO! +${drawn.length} kartu`,
    });
  });

  // ── Disconnect ───────────────────────────────────────────

  socket.on('disconnect', () => {
    const result = rm.removePlayer(socket.id);
    if (!result.removed || !result.room) return;

    const { code, room } = result;
    const playerList = rm.getPlayerList(room);
    io.to(code).emit('room:playerLeft', { playerList });

    if (room.state === 'playing') {
      const pub = rm.getPublicState(room);
      const left = room.players.find(p => p.id === socket.id)?.name ?? 'Pemain';
      io.to(code).emit('game:stateUpdate', { ...pub, lastAction: `${left} keluar dari game` });

      // If only 1 player remains, end game
      const active = room.players.filter(p => p.connected);
      if (active.length === 1) {
        io.to(code).emit('game:won', {
          winnerName: active[0].name,
          finalScores: { [active[0].name]: 0 },
        });
      }
    }
  });
});

// Cleanup stale rooms every 30 min
setInterval(() => rm.cleanupOldRooms(), 30 * 60 * 1000);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n=========================================');
  console.log('  UNO Online — Game Server');
  console.log('=========================================');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${LAN_IP}:${PORT}`);
  console.log('\n  Share the Network URL with players on');
  console.log('  the same WiFi, or scan the QR code!\n');
});
