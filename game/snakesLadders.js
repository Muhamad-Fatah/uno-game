'use strict';

const SNAKES  = { 99:78, 95:75, 93:73, 87:24, 64:60, 62:19, 54:34, 17:7  };
const LADDERS = {  4:14,  9:31, 20:38, 28:84, 40:59, 51:67, 63:81, 71:91 };

// Compute new position from current square + dice roll.
// Returns { diceValue, oldPos, newPos, rawNew, event, overshot, won }
function processMove(pos, dice) {
  const rawNew = pos + dice;

  if (rawNew > 100) {
    return { diceValue: dice, oldPos: pos, newPos: pos, rawNew, event: null, overshot: true, won: false };
  }

  let finalPos = rawNew;
  let event    = null;

  if (SNAKES[rawNew]  !== undefined) { event = { type: 'snake',  from: rawNew, to: SNAKES[rawNew]  }; finalPos = SNAKES[rawNew];  }
  if (LADDERS[rawNew] !== undefined) { event = { type: 'ladder', from: rawNew, to: LADDERS[rawNew] }; finalPos = LADDERS[rawNew]; }

  return { diceValue: dice, oldPos: pos, newPos: finalPos, rawNew, event, overshot: false, won: finalPos === 100 };
}

module.exports = { SNAKES, LADDERS, processMove };
