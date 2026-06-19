'use strict';

function buildDeck() {
  const colors = ['red', 'blue', 'green', 'yellow'];
  const cards = [];
  let idx = 0;

  for (const color of colors) {
    cards.push({ id: `${color}_0_${idx++}`, color, value: '0' });
    for (const value of ['1','2','3','4','5','6','7','8','9','skip','reverse','draw2']) {
      cards.push({ id: `${color}_${value}_${idx++}`, color, value });
      cards.push({ id: `${color}_${value}_${idx++}`, color, value });
    }
  }
  for (let i = 0; i < 4; i++) {
    cards.push({ id: `wild_${idx++}`, color: 'wild', value: 'wild' });
    cards.push({ id: `wild4_${idx++}`, color: 'wild', value: 'wild4' });
  }

  return cards; // 108 cards
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Draw `count` cards from room.deck, reshuffling discard if needed
function drawCards(room, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (room.deck.length === 0) reshuffleDeck(room);
    if (room.deck.length > 0) drawn.push(room.deck.pop());
  }
  return drawn;
}

function reshuffleDeck(room) {
  if (room.discardPile.length <= 1) return;
  const top = room.discardPile.pop();
  room.deck = shuffle(room.discardPile.splice(0));
  room.discardPile = [top];
}

module.exports = { buildDeck, shuffle, drawCards };
