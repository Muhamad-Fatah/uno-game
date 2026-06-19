/* cardRenderer.js — builds card DOM elements */

(function () {
  'use strict';

  const SYMBOLS = {
    skip:    { corner: '⊘', center: '⊘' },
    reverse: { corner: '↺', center: '↺' },
    draw2:   { corner: '+2', center: '+2' },
    wild:    { corner: 'W', center: '★' },
    wild4:   { corner: '+4', center: '+4' },
  };

  function getSymbol(value) {
    return SYMBOLS[value] || { corner: value, center: value };
  }

  /**
   * Build a face-up card element.
   * @param {Object} card  — { id, color, value }
   * @param {Object} opts  — { playable, pile, small }
   */
  function createCard(card, opts = {}) {
    const el = document.createElement('div');
    el.classList.add('card', `card-${card.color}`);
    if (opts.pile)  el.classList.add('pile-card');
    if (opts.small) el.classList.add('card-mini');
    if (opts.playable !== undefined) {
      el.classList.add(opts.playable ? 'playable' : 'not-playable');
    }
    if (card.id) el.dataset.cardId = card.id;

    const sym = getSymbol(card.value);
    const face = document.createElement('div');
    face.className = 'card-face';
    face.innerHTML = `
      <span class="card-corner tl">${sym.corner}</span>
      <span class="card-center">${sym.center}</span>
      <span class="card-corner br">${sym.corner}</span>
    `;
    el.appendChild(face);
    return el;
  }

  /**
   * Build a face-down (back) card element.
   */
  function createCardBack(opts = {}) {
    const el = document.createElement('div');
    el.classList.add('card', 'card-back');
    if (opts.pile)  el.classList.add('pile-card');
    if (opts.small) el.classList.add('card-mini');
    el.innerHTML = '<span class="uno-logo-sm">UNO</span>';
    return el;
  }

  window.CardRenderer = { createCard, createCardBack };
})();
