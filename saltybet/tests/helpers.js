// Loads the shared core scripts into globalThis.SB (same files the browser uses).
const path = require('path');
for (const f of ['rng.js', 'roster.js', 'fight.js', 'league.js']) {
  require(path.join(__dirname, '..', 'js', 'core', f));
}
module.exports = globalThis.SB;
