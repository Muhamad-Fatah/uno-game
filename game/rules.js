'use strict';

function isPlayable(card, topCard, currentColor, pendingDraw, pendingDrawType) {
  // When there's an accumulated draw penalty, you can only stack the same type
  if (pendingDraw > 0) {
    if (pendingDrawType === 'draw2') return card.value === 'draw2';
    if (pendingDrawType === 'wild4') return card.value === 'wild4';
  }
  if (card.color === 'wild') return true;
  if (card.color === currentColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

function calculateScore(players, winner) {
  const scores = {};
  for (const p of players) {
    if (p.id === winner.id) { scores[p.name] = 0; continue; }
    let pts = 0;
    for (const card of p.hand) {
      if (card.value === 'wild' || card.value === 'wild4') pts += 50;
      else if (['skip','reverse','draw2'].includes(card.value)) pts += 20;
      else pts += parseInt(card.value, 10);
    }
    scores[p.name] = pts;
  }
  return scores;
}

module.exports = { isPlayable, calculateScore };
