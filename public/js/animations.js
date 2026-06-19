/* animations.js — GSAP animation helpers */

(function () {
  'use strict';

  // Guard: if GSAP isn't loaded, provide no-ops so the game still works
  const gsap = window.gsap || {
    from: () => {}, to: () => {}, set: () => {}, timeline: () => ({ from: () => {}, to: () => {} }),
    fromTo: () => {},
  };

  /** Card played — animate discard zone appearing */
  function playCard(cardEl) {
    if (!cardEl) return;
    gsap.from(cardEl, {
      scale: .4, rotation: -20, opacity: 0,
      duration: .35, ease: 'back.out(1.6)',
    });
  }

  /** Draw card — new cards fly in from top-left (deck position).
     Transform-only (no opacity fade) so a stalled tween can't hide drawn cards. */
  function drawCards(count, forced) {
    const cards = document.querySelectorAll('#my-hand .card');
    const newCards = Array.from(cards).slice(-count);
    gsap.from(newCards, {
      x: -120, y: -80, rotation: 20, scale: .6,
      duration: .4, stagger: .08, ease: 'back.out(1.2)',
    });
  }

  /** Shake my hand on invalid play */
  function shakeHand() {
    gsap.to('#my-hand', {
      x: [0, -10, 10, -8, 8, -4, 4, 0],
      duration: .5, ease: 'none',
    });
  }

  /** UNO shout — scale in, then fade */
  function unoAlert() {
    const overlay = document.getElementById('uno-overlay');
    overlay.classList.remove('hidden');
    gsap.fromTo(overlay,
      { opacity: 0 },
      {
        opacity: 1, duration: .25, ease: 'power2.out',
        onComplete: () => {
          gsap.to(overlay, { opacity: 0, delay: 1.4, duration: .4, ease: 'power2.in',
            onComplete: () => overlay.classList.add('hidden'),
          });
        },
      },
    );
    const shout = overlay.querySelector('.uno-shout');
    gsap.fromTo(shout,
      { scale: 3, opacity: 0 },
      { scale: 1, opacity: 1, duration: .35, ease: 'back.out(2)' },
    );
    // Screen shake
    gsap.to('.game-board', {
      x: [0, -8, 8, -5, 5, 0],
      duration: .4, ease: 'none',
    });
  }

  /** Reverse direction arrow spin */
  function spinDirection(direction) {
    const arrow = document.getElementById('dir-arrow');
    if (!arrow) return;
    arrow.textContent = direction === 1 ? '↻' : '↺';
    gsap.from(arrow, { rotation: 180, duration: .5, ease: 'back.out(1.2)' });
  }

  /** Color ring pulse on new color */
  function pulseColorRing() {
    const ring = document.getElementById('color-ring');
    if (!ring) return;
    gsap.from(ring, { scale: 0, duration: .4, ease: 'back.out(2)' });
  }

  /** Pop-in color picker buttons */
  function showColorPicker() {
    const btns = document.querySelectorAll('.color-btn');
    gsap.fromTo(btns,
      { scale: 0, opacity: 0 },
      { scale: 1, opacity: 1, duration: .3, stagger: .06, ease: 'back.out(1.8)' },
    );
  }

  /** Pending draw badge pulse-in */
  function showPendingBadge() {
    const badge = document.getElementById('pending-badge');
    if (!badge) return;
    gsap.from(badge, { scale: 0, duration: .35, ease: 'back.out(2)' });
  }

  /** Confetti win celebration */
  function celebrate() {
    const colors = ['#e74c3c','#3498db','#2ecc71','#f1c40f','#9b59b6','#e67e22','#1abc9c'];
    const frags = [];
    for (let i = 0; i < 90; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.width  = (6 + Math.random() * 8) + 'px';
      el.style.height = (6 + Math.random() * 8) + 'px';
      el.style.borderRadius = Math.random() > .5 ? '50%' : '2px';
      document.body.appendChild(el);
      frags.push(el);
    }
    gsap.fromTo(frags,
      { y: -20, opacity: 1, rotation: 0, x: (i) => (Math.random() - .5) * 60 },
      {
        y: '110vh',
        rotation: () => (Math.random() - .5) * 720,
        opacity: 0,
        duration: () => 1.8 + Math.random() * 1.5,
        delay:    () => Math.random() * .6,
        ease: 'power1.in',
        onComplete: () => frags.forEach(f => f.remove()),
        stagger: 0,
      },
    );
  }

  /** Win panel slide up */
  function showWinPanel() {
    const panel = document.querySelector('.win-panel');
    if (!panel) return;
    gsap.from(panel, { y: 60, opacity: 0, scale: .9, duration: .5, ease: 'back.out(1.4)' });
  }

  /** Turn banner pop */
  function popTurnBanner() {
    const banner = document.getElementById('my-turn-banner');
    if (!banner || banner.classList.contains('hidden')) return;
    gsap.from(banner, { scale: 1.5, opacity: 0, duration: .3, ease: 'back.out(2)' });
  }

  /** Opponent card count badge bump */
  function bumpOppCount(seatIndex) {
    const el = document.querySelector(`.opponent-card[data-seat="${seatIndex}"] .opp-count`);
    if (!el) return;
    gsap.from(el, { scale: 1.8, color: '#e74c3c', duration: .3, ease: 'back.out(2)' });
  }

  window.Anim = {
    playCard, drawCards, shakeHand, unoAlert,
    spinDirection, pulseColorRing, showColorPicker,
    showPendingBadge, celebrate, showWinPanel, popTurnBanner, bumpOppCount,
  };
})();
