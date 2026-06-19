/* app.js — Main UNO game controller (SPA) */

(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────
  const TURN_SECONDS = 15; // seconds per turn before auto-draw (change as needed)

  // ── Global state ───────────────────────────────────────────
  let selectedGame       = 'uno'; // set by game select screen
  let turnTimerInterval  = null;
  let turnTimeLeft       = 0;
  let lastTurnIndex      = -1; // tracks when turn changes to avoid re-starting timer

  const S = {
    myId:               null,
    mySeatIndex:        null,
    myHand:             [],
    roomCode:           null,
    isHost:             false,
    topCard:            null,
    currentColor:       null,
    currentPlayerIndex: null,
    direction:          1,
    pendingDraw:        0,
    pendingDrawType:    null,
    playerList:         [],   // [{id, name, seatIndex, cardCount, connected, calledUno}]
    unoWindowOpen:      false,
    unoVulnerableId:    null,
    pendingWildCard:    null,  // card waiting for color pick
    drawnCardId:        null,  // card drawn this turn (if playable)
    canPlayDrawn:       false,
    isMyTurn:           false,
    gameType:           'uno',
    isFinished:         false,
    myRank:             null,
  };

  // ── Socket ─────────────────────────────────────────────────
  const socket = io();

  // ── Helpers ────────────────────────────────────────────────
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    const sc = document.getElementById(`screen-${name}`);
    if (sc) sc.classList.add('active');
  }

  function setError(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; }
  }

  function showToast(msg, duration = 2500) {
    const t = document.getElementById('game-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), duration);
  }

  function showSkipNotification(playerName) {
    const banner = document.getElementById('skip-banner');
    const txt    = document.getElementById('skip-text');
    if (!banner || !txt) return;
    txt.textContent = `${playerName} terkena SKIP!`;
    banner.classList.remove('hidden');
    clearTimeout(banner._timer);
    banner._timer = setTimeout(() => banner.classList.add('hidden'), 2200);
    // Animate with GSAP if available
    if (window.gsap) {
      gsap.fromTo(banner,
        { scale: 0.5, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.8)',
          onComplete: () => gsap.to(banner, { opacity: 0, delay: 1.5, duration: 0.4,
            onComplete: () => banner.classList.add('hidden') }) });
    }
  }

  function addLog(text) {
    const log = document.getElementById('activity-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = text;
    log.prepend(entry);
    // Keep max 8 entries
    while (log.children.length > 8) log.removeChild(log.lastChild);
  }

  // ── Screen: Lobby ──────────────────────────────────────────
  function initLobby() {
    // Pre-fill join code from URL ?join=XXXX
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    if (joinCode) {
      const codeInp = document.getElementById('inp-code');
      if (codeInp) { codeInp.value = joinCode.toUpperCase(); codeInp.disabled = true; }
    }

    document.getElementById('btn-create').addEventListener('click', () => {
      const name = document.getElementById('inp-name').value.trim();
      if (!name) { setError('lobby-error', 'Masukkan namamu dulu!'); return; }
      setError('lobby-error', '');
      socket.emit('room:create', { playerName: name, gameType: selectedGame });
    });

    document.getElementById('btn-join').addEventListener('click', () => {
      const name = document.getElementById('inp-name').value.trim();
      const code = document.getElementById('inp-code').value.trim().toUpperCase();
      if (!name) { setError('lobby-error', 'Masukkan namamu dulu!'); return; }
      if (!code)  { setError('lobby-error', 'Masukkan kode room!'); return; }
      setError('lobby-error', '');
      socket.emit('room:join', { playerName: name, code });
    });

    // Allow Enter key
    document.getElementById('inp-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-create').click();
    });
    document.getElementById('inp-code').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-join').click();
    });
    document.getElementById('inp-code').addEventListener('input', e => {
      e.target.value = e.target.value.toUpperCase();
    });
  }

  // ── Screen: Waiting Room ───────────────────────────────────
  function enterRoom(data) {
    S.roomCode      = data.code;
    S.mySeatIndex   = data.yourSeatIndex;
    S.isHost        = data.isHost;
    S.playerList    = data.playerList;
    S.gameType      = data.gameType || 'uno';

    document.getElementById('room-code-disp').textContent = data.code;

    const urlEl = document.getElementById('room-url-link');
    if (urlEl) { urlEl.textContent = data.roomUrl; urlEl.href = data.roomUrl; }

    const qrEl = document.getElementById('qr-img');
    if (qrEl && data.qrDataUrl) qrEl.src = data.qrDataUrl;

    renderPlayerList(data.playerList);
    showScreen('room');

    // Copy code button
    document.getElementById('btn-copy').onclick = () => {
      navigator.clipboard.writeText(data.code).catch(() => {});
      document.getElementById('btn-copy').textContent = 'Tersalin!';
      setTimeout(() => { document.getElementById('btn-copy').textContent = 'Salin Kode'; }, 1500);
    };

    // Start button (host only)
    const btnStart = document.getElementById('btn-start');
    btnStart.style.display = data.isHost ? 'block' : 'none';
    btnStart.onclick = () => {
      setError('room-error', '');
      socket.emit('room:start');
    };
  }

  function renderPlayerList(list) {
    S.playerList = list;
    const ul = document.getElementById('player-list-ul');
    if (!ul) return;
    ul.innerHTML = '';
    list.forEach(p => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="player-icon">${p.isHost ? '👑' : '🎮'}</span>
        <span>${escHtml(p.name)}</span>
        ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
        ${!p.connected ? '<span class="host-badge" style="color:#ff7675">DC</span>' : ''}
      `;
      ul.appendChild(li);
    });
    const cnt = document.getElementById('player-count');
    if (cnt) cnt.textContent = list.filter(p => p.connected !== false).length;

    const btnStart = document.getElementById('btn-start');
    if (btnStart && S.isHost) btnStart.disabled = list.length < 2;
  }

  // ── Screen: Game ───────────────────────────────────────────
  function startGame(data) {
    S.myHand             = data.yourHand;
    S.mySeatIndex        = data.yourSeatIndex;
    S.topCard            = data.topCard;
    S.currentColor       = data.currentColor;
    S.currentPlayerIndex = data.currentPlayerIndex;
    S.direction          = data.direction;
    S.pendingDraw        = data.pendingDraw || 0;
    S.pendingDrawType    = data.pendingDrawType || null;
    S.playerList         = data.playerList;
    S.drawnCardId        = null;
    S.canPlayDrawn       = false;

    showScreen('game');

    // Reset overlays for play-again scenario
    document.getElementById('win-screen')?.classList.add('hidden');
    document.getElementById('color-picker')?.classList.add('hidden');
    document.getElementById('uno-overlay')?.classList.add('hidden');
    const log = document.getElementById('activity-log');
    if (log) log.innerHTML = '';
    S.pendingWildCard = null;
    S.drawnCardId = null;
    S.canPlayDrawn = false;

    S.isFinished = false;
    S.myRank     = null;
    document.getElementById('finished-banner')?.remove();

    lastTurnIndex = -1; // reset so timer starts fresh on first turn
    clearTurnTimer();
    spawnBgParticles();

    renderBoard();
    Anim.dealCards(S.myHand.length);
    Anim.spinDirection(S.direction);

    // Wire up static buttons (use onclick so play-again doesn't stack listeners)
    document.getElementById('btn-draw').onclick   = onDrawClick;
    document.getElementById('btn-pass').onclick   = onPassClick;
    document.getElementById('btn-uno').onclick    = onUnoClick;
    document.getElementById('btn-again').onclick  = () => socket.emit('room:start');
    document.getElementById('btn-lobby').onclick  = () => location.reload();
    document.getElementById('draw-pile-card').onclick = onDrawClick;

    document.querySelectorAll('.color-btn').forEach(btn => {
      btn.addEventListener('click', () => onColorPick(btn.dataset.color));
    });
  }

  // ── Background floating particles ──────────────────────────
  function spawnBgParticles() {
    // Remove previous particles if play-again
    document.querySelectorAll('.bg-float').forEach(el => el.remove());
    const container = document.getElementById('screen-game');
    if (!container) return;
    for (let i = 0; i < 18; i++) {
      const el = document.createElement('div');
      el.className = 'bg-float';
      const size = 18 + Math.random() * 26;
      el.style.cssText = [
        `left:${4 + Math.random() * 92}%`,
        `width:${size}px`,
        `height:${size * 1.5}px`,
        `animation-delay:${-(Math.random() * 30)}s`,
        `animation-duration:${20 + Math.random() * 20}s`,
        `opacity:${0.03 + Math.random() * 0.055}`,
        `transform:rotate(${(Math.random() - 0.5) * 30}deg)`,
      ].join(';');
      container.appendChild(el);
    }
  }

  function applyStateUpdate(data) {
    const prevTopId = S.topCard?.id;

    S.topCard            = data.topCard;
    S.currentColor       = data.currentColor;
    S.currentPlayerIndex = data.currentPlayerIndex;
    S.direction          = data.direction;
    S.pendingDraw        = data.pendingDraw || 0;
    S.pendingDrawType    = data.pendingDrawType || null;
    S.playerList         = data.playerCardCounts;
    S.unoWindowOpen      = data.unoWindowOpen;
    S.unoVulnerableId    = data.unoVulnerableId;

    if (data.lastAction) addLog(data.lastAction);

    const topChanged = data.topCard && prevTopId !== data.topCard.id;
    renderBoard(topChanged);
  }

  function renderBoard(animateTop = false) {
    S.isMyTurn = S.currentPlayerIndex === S.mySeatIndex;

    renderDiscardPile(animateTop);
    renderColorRing();
    renderPendingBadge();
    renderDirection();
    renderDeckCount();
    renderOpponents();
    renderMyHand();
    renderTurnControls();
  }

  function renderDiscardPile(animate) {
    const zone = document.getElementById('discard-zone');
    if (!zone || !S.topCard) return;
    zone.innerHTML = '';
    const cardEl = CardRenderer.createCard(S.topCard, { pile: true });
    zone.appendChild(cardEl);
    if (animate) Anim.playCard(cardEl);
  }

  function renderColorRing() {
    const ring = document.getElementById('color-ring');
    if (!ring) return;
    ring.className = 'color-ring' + (S.currentColor && S.currentColor !== 'wild' ? ` ${S.currentColor}` : '');
  }

  function renderPendingBadge() {
    const badge  = document.getElementById('pending-badge');
    const countEl = document.getElementById('pending-count');
    if (!badge || !countEl) return;
    if (S.pendingDraw > 0) {
      countEl.textContent = `+${S.pendingDraw}`;
      badge.classList.remove('hidden');
      Anim.showPendingBadge();
    } else {
      badge.classList.add('hidden');
    }
  }

  function renderDirection() {
    const arrow = document.getElementById('dir-arrow');
    if (!arrow) return;
    const newSymbol = S.direction === 1 ? '↻' : '↺';
    if (arrow.textContent !== newSymbol) {
      arrow.textContent = newSymbol;
      Anim.spinDirection(S.direction);
    }
  }

  function renderDeckCount() {
    // We don't get exact deck count in stateUpdate — use playerList to infer if needed
    // Server sends deckCount in publicState
    const lbl = document.getElementById('deck-count-lbl');
    if (lbl && S.deckCount !== undefined) lbl.textContent = `${S.deckCount} kartu`;
  }

  function renderOpponents() {
    const bar = document.getElementById('opponents-bar');
    if (!bar) return;
    bar.innerHTML = '';

    const others = S.playerList
      .filter(p => p.seatIndex !== S.mySeatIndex)
      .sort((a, b) => {
        const n = S.playerList.length;
        const ra = (a.seatIndex - S.mySeatIndex + n) % n;
        const rb = (b.seatIndex - S.mySeatIndex + n) % n;
        return ra - rb;
      });

    others.forEach(p => {
      const isTurn = p.seatIndex === S.currentPlayerIndex;
      const card = document.createElement('div');
      card.className = 'opponent-card' +
        (isTurn ? ' current-turn' : '') +
        (!p.connected ? ' disconnected' : '');
      card.dataset.seat = p.seatIndex;

      // Mini card backs
      const miniCount = Math.min(p.cardCount, 7);
      const miniFan = [];
      for (let i = 0; i < miniCount; i++) {
        const m = CardRenderer.createCardBack({ small: true });
        miniFan.push(m.outerHTML);
      }

      card.innerHTML = `
        <div class="opp-name">${escHtml(p.name)}</div>
        <div class="opp-mini-cards">${miniFan.join('')}</div>
        <div class="opp-count">${p.cardCount} 🃏</div>
        ${p.calledUno ? '<div class="opp-uno-badge">UNO</div>' : ''}
      `;

      // Challenge button
      if (S.unoWindowOpen && S.unoVulnerableId === p.id) {
        const chalBtn = document.createElement('button');
        chalBtn.className = 'challenge-btn';
        chalBtn.textContent = 'TANGKAP!';
        chalBtn.onclick = () => socket.emit('game:challengeUno', { targetId: p.id });
        card.appendChild(chalBtn);
      }

      bar.appendChild(card);
    });
  }

  function renderMyHand() {
    const hand = document.getElementById('my-hand');
    if (!hand) return;

    const prevScroll = hand.scrollLeft;
    hand.innerHTML = '';

    S.myHand.forEach(card => {
      const playable = S.isMyTurn && canPlayCard(card);
      const el = CardRenderer.createCard(card, { playable });
      if (card.id === S.drawnCardId && S.canPlayDrawn) {
        el.classList.add('drawn-highlight');
      }
      if (playable) el.addEventListener('click', () => onCardClick(card));
      hand.appendChild(el);
    });

    hand.scrollLeft = prevScroll;
  }

  // ── Turn timer ─────────────────────────────────────────────
  function startTurnTimer() {
    clearTurnTimer();
    turnTimeLeft = TURN_SECONDS;

    const bar  = document.getElementById('turn-timer-bar');
    const fill = document.getElementById('turn-timer-fill');
    const cnt  = document.getElementById('turn-timer-count');
    if (!bar) return;

    bar.classList.remove('hidden');
    if (cnt) cnt.textContent = turnTimeLeft;

    // CSS transition drives the shrink; JS only updates the color + count
    if (fill) {
      fill.style.transition = 'none';
      fill.style.width = '100%';
      fill.getBoundingClientRect(); // force reflow
      fill.style.transition = `width ${TURN_SECONDS}s linear`;
      fill.style.width = '0%';
      fill.style.background = '#2ecc71';
    }

    turnTimerInterval = setInterval(() => {
      turnTimeLeft--;
      if (cnt) cnt.textContent = Math.max(0, turnTimeLeft);

      // Colour shift: green → yellow → red
      if (fill) {
        if (turnTimeLeft > TURN_SECONDS * 0.5)       fill.style.background = '#2ecc71';
        else if (turnTimeLeft > TURN_SECONDS * 0.25) fill.style.background = '#f39c12';
        else                                          fill.style.background = '#e74c3c';
      }

      if (turnTimeLeft <= 0) {
        clearTurnTimer();
        // Auto-action when timer runs out
        if (S.canPlayDrawn) onPassClick();
        else onDrawClick();
      }
    }, 1000);
  }

  function clearTurnTimer() {
    if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
    document.getElementById('turn-timer-bar')?.classList.add('hidden');
  }

  function renderTurnControls() {
    const banner  = document.getElementById('my-turn-banner');
    const btnDraw = document.getElementById('btn-draw');
    const btnPass = document.getElementById('btn-pass');
    const drawPile = document.getElementById('draw-pile-card');

    const turnChanged = S.currentPlayerIndex !== lastTurnIndex;
    if (turnChanged) lastTurnIndex = S.currentPlayerIndex;

    if (S.isMyTurn && !S.isFinished) {
      banner?.classList.remove('hidden');
      if (turnChanged) { Anim.popTurnBanner(); startTurnTimer(); }
      if (btnDraw) btnDraw.disabled = false;
      drawPile?.classList.remove('disabled');
    } else {
      banner?.classList.add('hidden');
      if (turnChanged) clearTurnTimer();
      if (btnDraw) btnDraw.disabled = true;
      drawPile?.classList.add('disabled');
    }

    // Pass button only after drawing a non-playable card
    if (!S.isMyTurn || !S.canPlayDrawn) btnPass?.classList.add('hidden');
  }

  function canPlayCard(card) {
    if (S.pendingDraw > 0) {
      if (S.pendingDrawType === 'draw2') return card.value === 'draw2';
      if (S.pendingDrawType === 'wild4') return card.value === 'wild4';
    }
    if (card.color === 'wild') return true;
    if (card.color === S.currentColor) return true;
    if (S.topCard && card.value === S.topCard.value) return true;
    return false;
  }

  // ── Actions ────────────────────────────────────────────────
  function onCardClick(card) {
    if (!S.isMyTurn) return;
    if (!canPlayCard(card)) { showToast('Kartu ini tidak bisa dimainkan'); Anim.shakeHand(); return; }

    if (card.color === 'wild') {
      // Show color picker
      S.pendingWildCard = card;
      const picker = document.getElementById('color-picker');
      picker.classList.remove('hidden');
      Anim.showColorPicker();
    } else {
      socket.emit('game:playCard', { cardId: card.id });
    }
  }

  function onColorPick(color) {
    document.getElementById('color-picker').classList.add('hidden');
    if (!S.pendingWildCard) return;
    socket.emit('game:playCard', { cardId: S.pendingWildCard.id, chosenColor: color });
    S.pendingWildCard = null;
  }

  function onDrawClick() {
    if (!S.isMyTurn) { showToast('Bukan giliranmu!'); return; }
    socket.emit('game:drawCard');
  }

  function onPassClick() {
    socket.emit('game:passAfterDraw');
    S.drawnCardId  = null;
    S.canPlayDrawn = false;
    document.getElementById('btn-pass')?.classList.add('hidden');
  }

  function onUnoClick() {
    socket.emit('game:callUno');
  }

  // ── Finished / spectator banner ────────────────────────────
  function showFinishedBanner(rank) {
    document.getElementById('finished-banner')?.remove();
    const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣'];
    const banner = document.createElement('div');
    banner.id = 'finished-banner';
    banner.className = 'finished-banner';
    banner.innerHTML = `
      <span>${medals[rank - 1] || '🏅'} Kamu selesai di posisi #${rank}!</span>
      <span class="finished-sub">Tonton sisa pertandingan...</span>
    `;
    document.getElementById('screen-game')?.appendChild(banner);
  }

  // ── Win screen ─────────────────────────────────────────────
  function showWin(winnerName, scores, finishedPlayers) {
    document.getElementById('finished-banner')?.remove();
    document.getElementById('win-name').textContent = winnerName;

    const table = document.getElementById('score-table');
    table.innerHTML = '';

    if (finishedPlayers && finishedPlayers.length > 0) {
      const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣'];
      finishedPlayers.forEach(({ name, rank }) => {
        const row = document.createElement('div');
        row.className = 'score-row' + (rank === 1 ? ' winner' : '');
        row.innerHTML = `
          <span>${medals[rank - 1] || rank} ${escHtml(name)}</span>
          <span class="score-pts">${rank === 1 ? '🏆 Menang' : `#${rank}`}</span>
        `;
        table.appendChild(row);
      });
    } else {
      const entries = Object.entries(scores || {}).sort((a, b) => a[1] - b[1]);
      entries.forEach(([name, pts]) => {
        const row = document.createElement('div');
        row.className = 'score-row' + (pts === 0 ? ' winner' : '');
        row.innerHTML = `<span>${escHtml(name)}</span><span class="score-pts">${pts === 0 ? '🏆 Menang' : pts + ' poin'}</span>`;
        table.appendChild(row);
      });
    }

    document.getElementById('win-screen').classList.remove('hidden');
    Anim.showWinPanel();
    Anim.celebrate();
  }

  // ── Socket events ──────────────────────────────────────────
  socket.on('connect', () => { S.myId = socket.id; });

  socket.on('room:created', (data) => enterRoom(data));
  socket.on('room:joined',  (data) => enterRoom(data));

  socket.on('room:playerJoined', ({ playerList }) => renderPlayerList(playerList));
  socket.on('room:playerLeft',   ({ playerList }) => renderPlayerList(playerList));

  socket.on('room:error', ({ message }) => {
    // Show error in whichever screen is active
    const active = document.querySelector('.screen.active');
    if (active?.id === 'screen-lobby') setError('lobby-error', message);
    else if (active?.id === 'screen-room') setError('room-error', message);
    else showToast(message);
  });

  socket.on('game:started', (data) => {
    S.gameType = data.gameType || 'uno';
    startGame(data);
  });

  socket.on('game:stateUpdate', (data) => {
    if (data.deckCount !== undefined) S.deckCount = data.deckCount;
    applyStateUpdate(data);
    if (data.skippedPlayerName) showSkipNotification(data.skippedPlayerName);
  });

  socket.on('game:handUpdate', (data) => {
    S.myHand       = data.hand;
    S.drawnCardId  = data.canPlayCard ? data.canPlayCard.id : null;
    S.canPlayDrawn = data.canPlay;

    renderMyHand();

    // Only animate and show prompt when cards were actually drawn (not when playing)
    if (data.drawn && data.drawn.length > 0) {
      Anim.drawCards(data.drawn.length, data.forced);
      if (data.canPlay && data.canPlayCard) {
        document.getElementById('btn-pass')?.classList.remove('hidden');
        showToast('Kartu yang diambil bisa dimainkan!', 2000);
      }
    }
  });

  socket.on('game:unoAlert', ({ playerName }) => {
    const whoEl = document.getElementById('uno-who');
    if (whoEl) whoEl.textContent = playerName + ' bilang UNO!';
    Anim.unoAlert();
  });

  socket.on('game:unoPenalty', ({ targetName, challengerName, penaltyCount }) => {
    showToast(`${challengerName} menangkap ${targetName}! +${penaltyCount} kartu`, 3000);
  });

  socket.on('game:playerFinished', ({ playerId, playerName, rank }) => {
    if (playerId === socket.id) {
      S.isFinished = true;
      S.myRank     = rank;
      clearTurnTimer();
      showFinishedBanner(rank);
    } else {
      addLog(`🏆 ${playerName} selesai di #${rank}!`);
      showToast(`🏆 ${playerName} selesai di posisi #${rank}!`, 3000);
    }
  });

  socket.on('game:won', ({ winnerName, finalScores, finishedPlayers }) => {
    showWin(winnerName, finalScores, finishedPlayers);
  });

  socket.on('game:error', ({ message }) => {
    showToast(message);
    Anim.shakeHand();
  });

  // ── Init ───────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLobby();

    // ── Keyboard shortcuts ────────────────────────────────────
    document.addEventListener('keydown', (e) => {
      // Only active during game screen
      if (!document.getElementById('screen-game')?.classList.contains('active')) return;

      // Space → UNO button
      if (e.code === 'Space' && !e.target.matches('input, button')) {
        e.preventDefault();
        document.getElementById('btn-uno')?.click();
      }
    });
  });
})();
