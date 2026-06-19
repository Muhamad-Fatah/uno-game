/* snakesLadders.js — Ular Tangga client controller */
(function () {
  'use strict';

  const SNAKES  = { 99:78, 95:75, 93:73, 87:24, 64:60, 62:19, 54:34, 17:7  };
  const LADDERS = {  4:14,  9:31, 20:38, 28:84, 40:59, 51:67, 63:81, 71:91 };
  const COLORS  = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c'];

  let _socket = null;
  let diceTimer = null;

  const SL = {
    mySeatIndex:        0,
    playerList:         [],
    positions:          {},
    currentPlayerIndex: 0,
    isAnimating:        false,
  };

  // ── Board math ────────────────────────────────────────────

  function getCellPos(square) {
    const rowFromBottom = Math.floor((square - 1) / 10);
    const posInRow      = (square - 1) % 10;
    const col           = (rowFromBottom % 2 === 0) ? posInRow : (9 - posInRow);
    return { cssRow: 10 - rowFromBottom, cssCol: col + 1, col, rowFromBottom };
  }

  function getCellCenter(square) {
    const { col, rowFromBottom } = getCellPos(square);
    return { left: col * 10 + 5, top: (9 - rowFromBottom) * 10 + 5 };
  }

  // ── Board building ─────────────────────────────────────────

  function buildBoard() {
    const grid = document.getElementById('sl-board-grid');
    const svg  = document.getElementById('sl-svg');
    if (!grid || !svg) return;

    const snakeHeads = new Set(Object.keys(SNAKES).map(Number));
    const snakeTails = new Set(Object.values(SNAKES));
    const ladderBots = new Set(Object.keys(LADDERS).map(Number));
    const ladderTops = new Set(Object.values(LADDERS));

    grid.innerHTML = '';
    for (let sq = 1; sq <= 100; sq++) {
      const { cssRow, cssCol } = getCellPos(sq);
      const cell = document.createElement('div');
      cell.className = 'sl-cell';
      cell.dataset.square = sq;
      cell.style.gridRow    = cssRow;
      cell.style.gridColumn = cssCol;

      cell.classList.add((cssRow + cssCol) % 2 === 0 ? 'cell-a' : 'cell-b');

      if (sq === 1)   cell.classList.add('cell-start');
      if (sq === 100) cell.classList.add('cell-finish');
      if (snakeHeads.has(sq)) cell.classList.add('cell-snake-head');
      if (snakeTails.has(sq)) cell.classList.add('cell-snake-tail');
      if (ladderBots.has(sq)) cell.classList.add('cell-ladder-bot');
      if (ladderTops.has(sq)) cell.classList.add('cell-ladder-top');

      const num = document.createElement('span');
      num.className = 'cell-num';
      num.textContent = sq;
      cell.appendChild(num);
      grid.appendChild(cell);
    }

    drawSVGOverlay(svg);
  }

  function drawSVGOverlay(svg) {
    svg.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';

    // Ladders — two green rails + yellow rungs
    for (const [fromStr, to] of Object.entries(LADDERS)) {
      const from = Number(fromStr);
      const c1   = getCellCenter(from);
      const c2   = getCellCenter(to);
      const dx   = c2.left - c1.left;
      const dy   = c2.top  - c1.top;
      const len  = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx   = (-dy / len) * 1.5;
      const ny   = ( dx / len) * 1.5;

      const group = document.createElementNS(ns, 'g');

      [[nx, ny], [-nx, -ny]].forEach(([ox, oy]) => {
        const rail = document.createElementNS(ns, 'line');
        rail.setAttribute('x1', c1.left + ox); rail.setAttribute('y1', c1.top + oy);
        rail.setAttribute('x2', c2.left + ox); rail.setAttribute('y2', c2.top + oy);
        rail.setAttribute('stroke', '#2ecc71');
        rail.setAttribute('stroke-width', '0.9');
        rail.setAttribute('opacity', '0.85');
        group.appendChild(rail);
      });

      const steps = Math.max(2, Math.round(len / 8));
      for (let i = 1; i < steps; i++) {
        const t  = i / steps;
        const mx = c1.left + dx * t;
        const my = c1.top  + dy * t;
        const rung = document.createElementNS(ns, 'line');
        rung.setAttribute('x1', mx + nx * 2); rung.setAttribute('y1', my + ny * 2);
        rung.setAttribute('x2', mx - nx * 2); rung.setAttribute('y2', my - ny * 2);
        rung.setAttribute('stroke', '#f1c40f');
        rung.setAttribute('stroke-width', '0.7');
        rung.setAttribute('opacity', '0.7');
        group.appendChild(rung);
      }

      svg.appendChild(group);
    }

    // Snakes — red quadratic bezier curves
    let snakeIdx = 0;
    for (const [fromStr, to] of Object.entries(SNAKES)) {
      const from = Number(fromStr);
      const c1   = getCellCenter(from); // head
      const c2   = getCellCenter(to);   // tail
      const midX = (c1.left + c2.left) / 2 + (snakeIdx % 2 === 0 ? 9 : -9);
      const midY = (c1.top  + c2.top ) / 2;

      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', `M${c1.left},${c1.top} Q${midX},${midY} ${c2.left},${c2.top}`);
      path.setAttribute('stroke', '#e74c3c');
      path.setAttribute('stroke-width', '2.8');
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', '0.75');
      path.setAttribute('stroke-linecap', 'round');

      const head = document.createElementNS(ns, 'circle');
      head.setAttribute('cx', c1.left); head.setAttribute('cy', c1.top);
      head.setAttribute('r', '2.2');
      head.setAttribute('fill', '#e74c3c');
      head.setAttribute('opacity', '0.9');

      svg.appendChild(path);
      svg.appendChild(head);
      snakeIdx++;
    }
  }

  // ── Tokens ────────────────────────────────────────────────

  function tokenOffset(seatIndex) {
    const offsets = [
      {dx:0,dy:0},{dx:2,dy:-2},{dx:-2,dy:2},
      {dx:2,dy:2},{dx:-2,dy:-2},{dx:0,dy:-3},
    ];
    return offsets[seatIndex % offsets.length];
  }

  function buildTokens() {
    const container = document.getElementById('sl-tokens');
    if (!container) return;
    container.innerHTML = '';

    SL.playerList.forEach(player => {
      const el  = document.createElement('div');
      el.className = 'sl-token' + (player.seatIndex === SL.mySeatIndex ? ' my-token' : '');
      el.id        = 'sl-tok-' + player.id;
      el.style.background = COLORS[player.seatIndex % COLORS.length];
      el.textContent      = player.name.charAt(0).toUpperCase();

      const sq = SL.positions[player.id] || 1;
      const { left, top } = getCellCenter(sq);
      const off = tokenOffset(player.seatIndex);
      el.style.left = (left - 4 + off.dx) + '%';
      el.style.top  = (top  - 4 + off.dy) + '%';

      container.appendChild(el);
    });
  }

  function moveToken(playerId, sq, cb) {
    const el = document.getElementById('sl-tok-' + playerId);
    if (!el) { if (cb) cb(); return; }

    const { left, top } = getCellCenter(sq);
    const player = SL.playerList.find(p => p.id === playerId);
    const off    = tokenOffset(player ? player.seatIndex : 0);
    const lStr   = (left - 4 + off.dx) + '%';
    const tStr   = (top  - 4 + off.dy) + '%';

    if (window.gsap) {
      gsap.to(el, { left: lStr, top: tStr, duration: 0.45, ease: 'back.out(1.4)', onComplete: cb || null });
    } else {
      el.style.left = lStr;
      el.style.top  = tStr;
      setTimeout(cb || (() => {}), 450);
    }
  }

  // ── Dice ──────────────────────────────────────────────────

  function animateDice(finalValue, cb) {
    const dice = document.getElementById('sl-dice');
    if (!dice) { if (cb) cb(); return; }

    if (diceTimer) clearInterval(diceTimer);
    dice.classList.add('rolling');

    let ticks = 0;
    diceTimer = setInterval(() => {
      ticks++;
      dice.textContent = (ticks % 6) + 1;
      if (ticks >= 14) {
        clearInterval(diceTimer);
        diceTimer = null;
        dice.classList.remove('rolling');
        dice.textContent = finalValue;
        if (cb) cb();
      }
    }, 75);
  }

  // ── Sidebar ───────────────────────────────────────────────

  function renderPlayers() {
    const list = document.getElementById('sl-players-list');
    if (!list) return;
    list.innerHTML = '';

    SL.playerList.forEach(player => {
      const row = document.createElement('div');
      row.className = 'sl-player-row' +
        (player.seatIndex === SL.currentPlayerIndex ? ' current' : '') +
        (!player.connected ? ' disconnected' : '');

      const dot = document.createElement('div');
      dot.className     = 'sl-token-dot';
      dot.style.background = COLORS[player.seatIndex % COLORS.length];

      const name = document.createElement('span');
      name.className   = 'sl-player-name';
      name.textContent = player.name + (player.seatIndex === SL.mySeatIndex ? ' (kamu)' : '');

      const pos = document.createElement('span');
      pos.className   = 'sl-player-pos';
      pos.textContent = SL.positions[player.id] || 1;

      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(pos);
      list.appendChild(row);
    });
  }

  function renderTurnInfo() {
    const nameEl = document.getElementById('sl-turn-name');
    const btn    = document.getElementById('btn-roll');
    if (!nameEl || !btn) return;

    const current = SL.playerList.find(p => p.seatIndex === SL.currentPlayerIndex);
    nameEl.textContent = current ? current.name : '?';

    btn.disabled = (SL.currentPlayerIndex !== SL.mySeatIndex) || SL.isAnimating;
  }

  function addLog(text) {
    const log = document.getElementById('sl-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className  = 'log-entry';
    entry.textContent = text;
    log.prepend(entry);
    while (log.children.length > 14) log.removeChild(log.lastChild);
  }

  // ── Win overlay ───────────────────────────────────────────

  function showWinOverlay(winnerName) {
    let overlay = document.getElementById('sl-win-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sl-win-overlay';
      overlay.className = 'win-screen';
      overlay.innerHTML = `
        <div class="win-panel">
          <div class="trophy">🏆</div>
          <h2 id="sl-win-name" style="font-size:1.6rem;margin:8px 0"></h2>
          <div class="win-actions" style="margin-top:16px">
            <button class="btn btn-primary" onclick="location.reload()">Ke Lobby</button>
          </div>
        </div>`;
      const screen = document.getElementById('screen-snakegame');
      if (screen) screen.appendChild(overlay);
    }
    const nameEl = document.getElementById('sl-win-name');
    if (nameEl) nameEl.textContent = winnerName + ' Menang!';
    overlay.classList.remove('hidden');
    if (window.gsap) {
      const panel = overlay.querySelector('.win-panel');
      if (panel) gsap.fromTo(panel, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.55, ease: 'back.out(1.7)' });
    }
  }

  // ── Public API ────────────────────────────────────────────

  function init(data, socket) {
    _socket = socket;
    SL.mySeatIndex        = data.yourSeatIndex;
    SL.currentPlayerIndex = data.currentPlayerIndex;
    SL.playerList         = data.playerList;
    SL.isAnimating        = false;

    data.playerList.forEach(p => {
      SL.positions[p.id] = (data.snakesPositions && data.snakesPositions[p.id]) || 1;
    });

    buildBoard();
    buildTokens();
    renderPlayers();
    renderTurnInfo();

    const btn = document.getElementById('btn-roll');
    if (btn) {
      btn.onclick = () => {
        if (SL.isAnimating) return;
        socket.emit('game:rollDice');
      };
    }
  }

  function onSnakesMoved(data) {
    SL.positions[data.playerId] = data.newPos;
    SL.currentPlayerIndex       = data.currentPlayerIndex;

    const pname = (SL.playerList.find(p => p.id === data.playerId) || {}).name || data.playerName;

    SL.isAnimating = true;
    renderTurnInfo();

    animateDice(data.diceValue, () => {
      if (data.overshot) {
        addLog(`${pname} 🎲${data.diceValue} — kebanyakan, tidak bergerak`);
        SL.isAnimating = false;
        renderPlayers();
        renderTurnInfo();
        return;
      }

      // Step 1: move to landing square (rawNew if snake/ladder, newPos otherwise)
      const landSquare = data.event ? data.rawNew : data.newPos;
      moveToken(data.playerId, landSquare, () => {
        if (!data.event) {
          addLog(`${pname} 🎲${data.diceValue} → kotak ${data.newPos}`);
          SL.isAnimating = false;
          renderPlayers();
          renderTurnInfo();
          return;
        }

        // Step 2: slide down snake / climb ladder
        const isSnake = data.event.type === 'snake';
        addLog(isSnake
          ? `🐍 ${pname} kena ular! ${data.rawNew}→${data.newPos}`
          : `🪜 ${pname} naik tangga! ${data.rawNew}→${data.newPos}`
        );

        setTimeout(() => {
          moveToken(data.playerId, data.newPos, () => {
            SL.isAnimating = false;
            renderPlayers();
            renderTurnInfo();
          });
        }, 550);
      });
    });
  }

  function onWin(winnerName) {
    SL.isAnimating = false;
    showWinOverlay(winnerName);
  }

  window.SnakesLadders = { init, onSnakesMoved, onWin };
})();
