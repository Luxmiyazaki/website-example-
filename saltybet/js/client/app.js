/* Salty Brawl – page controller: wires the feed (solo or online) to the
 * stream canvas, the betting panel, the stats cards and the chat. */
(function () {
  'use strict';

  const SB = window.SB;
  const money = SB.League.money;
  const $ = function (s) { return document.querySelector(s); };
  const el = function (tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const state = { match: null, me: null, status: null, history: [], ranks: SB.League.RANKS };
  let feed, stream, audio;
  let lastBalance = null;
  let shownResult = null;
  let renderedMatchKey = null;

  // ----------------------------------------------------------------- boot
  function detectMode() {
    const q = new URLSearchParams(location.search);
    if (q.get('mode') === 'solo' || location.protocol === 'file:') return Promise.resolve('solo');
    return fetch('api/info', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.saltyBrawl ? 'online' : 'solo'; })
      .catch(function () { return 'solo'; });
  }

  function devOverrides() {
    const q = new URLSearchParams(location.search);
    const o = {};
    if (q.get('fast')) Object.assign(o, { betOpenMs: 6000, preFightMs: 1000, postFightMs: 1000, tps: 240 });
    if (q.get('tournamentIn')) o.matchmakingCount = Math.max(1, parseInt(q.get('tournamentIn'), 10) || 1);
    return o;
  }

  function boot() {
    audio = new SB.Audio();
    stream = new SB.Stream($('#stream'), { audio: audio });
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    setSound(readPref('sound') === '1', true);

    detectMode().then(function (mode) {
      feed = mode === 'online' ? new SB.RemoteFeed('') : new SB.LocalFeed({ overrides: devOverrides() });
      $('#modeBadge').textContent = mode === 'online' ? 'ONLINE' : 'SOLO';
      $('#modeBadge').classList.toggle('online', mode === 'online');
      $('#modeBadge').title = mode === 'online' ? 'Everyone connected shares the same fights, pots and chat.' : 'Everything runs in your browser. The other bettors are bots.';
      $('#soloSettings').classList.toggle('hidden', mode !== 'solo');
      $('#onlineSettings').classList.toggle('hidden', mode !== 'online');
      feed.on(onEvent);
      wireUI();
      feed.start();
      renderWallet();
      requestAnimationFrame(loop);
    });
  }

  function readPref(k) { try { return localStorage.getItem('saltybrawl.' + k); } catch (e) { return null; } }
  function writePref(k, v) { try { localStorage.setItem('saltybrawl.' + k, v); } catch (e) { /* ignore */ } }

  function resizeCanvas() {
    const c = $('#stream');
    const w = c.clientWidth || 960;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(w * dpr);
    if (c.width !== pw) {
      c.width = pw;
      c.height = Math.round(pw * 9 / 16);
    }
  }

  function loop() {
    const now = feed.now();
    stream.frame(now);
    tickTimer(now);
    requestAnimationFrame(loop);
  }

  // --------------------------------------------------------------- events
  function onEvent(type, d) {
    switch (type) {
      case 'snapshot':
        state.match = d.match;
        state.me = d.me;
        state.status = d.status;
        state.history = d.history || [];
        if (d.ranks) state.ranks = d.ranks;
        stream.setMatch(d.match);
        $('#chatLog').textContent = '';
        (d.chat || []).forEach(addChat);
        if (d.me && d.match && d.me.bet == null) shownResult = null;
        renderAll();
        if (feed.needsLogin() && !readPref('seenJoin')) { writePref('seenJoin', '1'); openDialog('register'); }
        break;
      case 'match': {
        const prev = state.match;
        state.match = d;
        state.status = d.status;
        stream.setMatch(d);
        if (d.phase === 'open' && (!prev || prev.id !== d.id)) {
          audio.play('open');
          if (state.me) state.me.bet = null;
        }
        if (d.phase === 'payout') {
          const last = state.history[state.history.length - 1];
          if (!last || last.id !== d.id) {
            state.history.push({
              id: d.id, redName: d.red.name, blueName: d.blue.name, winner: d.winner,
              odds: d.odds, upset: d.upset, pots: d.pots, mode: d.mode
            });
            if (state.history.length > 15) state.history.shift();
          }
        }
        renderAll();
        break;
      }
      case 'betcount':
        if (state.match && state.match.id === d.matchId) {
          state.match.bettors = d.count;
          renderBettors();
        }
        break;
      case 'chat': addChat(d); break;
      case 'me':
        state.me = d;
        renderWallet();
        renderBetPanel();
        renderBettors();
        if (d.result && d.result.matchId !== shownResult) {
          shownResult = d.result.matchId;
          if (d.result.won) { toast('You won ' + money(d.result.gain) + '!', 'win'); audio.play('win'); }
          else { toast('You lost ' + money(-d.result.gain) + '. SALT.', 'lose'); audio.play('lose'); }
        }
        break;
      case 'notice': toast(d.text, d.kind === 'bailout' ? 'lose' : ''); break;
      case 'online': $('#chatCount').textContent = d.count + ' watching'; break;
      case 'connection': $('#connLost').classList.toggle('hidden', d.ok); break;
    }
  }

  // --------------------------------------------------------------- render
  function renderAll() {
    renderWallet();
    renderBetPanel();
    renderCards();
    renderBettors();
    renderHistory();
    const m = state.match;
    document.title = m && m.phase === 'open' ? 'Bets OPEN – Salty Brawl' : 'Salty Brawl';
    if (feed && feed.mode === 'solo') {
      const n = Object.keys(feed.league.state.players).length;
      $('#chatCount').textContent = n + ' bettors';
    }
  }

  function currentBalance() {
    const me = state.me, m = state.match;
    if (!me) return 0;
    return m && m.mode === 'tournament' ? me.tbalance : me.balance;
  }

  function renderWallet() {
    const me = state.me;
    const login = feed && feed.needsLogin();
    $('#loginBtn').classList.toggle('hidden', !login);
    $('#wallet').classList.toggle('hidden', !!login);
    if (!me) return;
    $('#playerName').textContent = me.name;
    $('#rankBadge').textContent = me.rankName;
    $('#rankBadge').title = me.bets + ' bets placed' + (me.nextRank ? ' – next rank at ' + me.nextRank : '') + ' – bailout ' + money(me.bailout);
    const b = $('#balance');
    b.textContent = money(me.balance);
    if (lastBalance !== null && me.balance !== lastBalance) {
      b.classList.remove('up', 'down');
      void b.offsetWidth;
      b.classList.add(me.balance > lastBalance ? 'up' : 'down');
      setTimeout(function () { b.classList.remove('up', 'down'); }, 900);
    }
    lastBalance = me.balance;
    const tb = $('#tbalance');
    tb.classList.toggle('hidden', !me.tournament);
    tb.textContent = 'Tournament ' + money(me.tbalance || 0);
  }

  function myBet() {
    const me = state.me, m = state.match;
    return me && m && me.bet && me.bet.matchId === m.id ? me.bet : null;
  }

  function renderBetPanel() {
    const m = state.match;
    if (!m) return;
    const bet = myBet();
    const open = m.phase === 'open';
    $('#redName').textContent = m.red.name;
    $('#blueName').textContent = m.blue.name;
    $('#redSub').textContent = m.red.tier + ' tier • ' + m.red.record.w + '-' + m.red.record.l;
    $('#blueSub').textContent = m.blue.tier + ' tier • ' + m.blue.record.w + '-' + m.blue.record.l;
    const canBet = open && !bet;
    $('#betRed').disabled = !canBet;
    $('#betBlue').disabled = !canBet;
    $('#wager').disabled = !canBet;
    document.querySelectorAll('.quick button').forEach(function (b) { b.disabled = !canBet; });
    $('#betRed').classList.toggle('chosen', !!bet && bet.side === 'red');
    $('#betBlue').classList.toggle('chosen', !!bet && bet.side === 'blue');
    $('#betRed').classList.toggle('winner', m.phase === 'payout' && m.winner === 'red');
    $('#betBlue').classList.toggle('winner', m.phase === 'payout' && m.winner === 'blue');

    const st = $('#betStatus');
    const oddsBox = $('#oddsBox');
    st.className = 'bet-status';
    if (open) {
      st.textContent = 'Bets are OPEN!';
      st.classList.add('open');
      oddsBox.classList.add('hidden');
    } else {
      if (m.phase === 'locked') {
        st.textContent = 'Bets are locked. ' + m.red.name + ' - ' + money(m.pots.red) + ', ' + m.blue.name + ' - ' + money(m.pots.blue);
        st.classList.add('locked');
      } else {
        const w = m.winner;
        st.textContent = m[w].name + ' wins! Payouts to Team ' + (w === 'red' ? 'Red' : 'Blue') + '.' + (m.upset ? ' UPSET!' : '');
        st.classList.add(w === 'red' ? 'payout-red' : 'payout-blue');
      }
      oddsBox.classList.remove('hidden');
      oddsBox.textContent = '';
      if (m.odds) {
        oddsBox.append('Odds ');
        oddsBox.append(el('span', 'r', String(m.odds[0])));
        oddsBox.append(' : ');
        oddsBox.append(el('span', 'b', String(m.odds[1])));
      } else {
        oddsBox.textContent = 'No odds (one side has no bets)';
      }
    }

    const mb = $('#myBet');
    mb.textContent = '';
    const name = function (side) { return m[side].name; };
    if (feed && feed.needsLogin()) {
      mb.textContent = 'Sign up (just a name) to start betting.';
    } else if (bet) {
      if (m.phase === 'open') {
        mb.textContent = 'You bet ' + money(bet.amount) + ' on ' + name(bet.side) + '. Good luck!';
      } else if (m.phase === 'locked') {
        const own = m.pots[bet.side], other = m.pots[bet.side === 'red' ? 'blue' : 'red'];
        const gain = own > 0 ? Math.ceil(bet.amount * other / own) : 0;
        mb.textContent = 'Your ' + money(bet.amount) + ' on ' + name(bet.side) + ' pays ';
        mb.append(el('span', 'win', '+' + money(gain)));
        mb.append(' if it wins.');
      } else {
        const r = state.me && state.me.result && state.me.result.matchId === m.id ? state.me.result : null;
        if (r) mb.append(el('span', r.won ? 'win' : 'lose', r.won ? 'You won +' + money(r.gain) + '!' : 'You lost ' + money(-r.gain) + '.'));
      }
    } else if (open) {
      mb.textContent = 'Pick a side and enter a wager. ' + (m.mode === 'tournament' ? 'Tournament balance: ' + money(currentBalance()) + '.' : '');
    } else {
      mb.textContent = 'You did not bet on this match.';
    }

    const mt = $('#modeText');
    const status = m.status || state.status;
    mt.className = 'modetext ' + (status ? status.mode : '');
    let text = status ? status.text : '';
    if (m.mode === 'exhibition' && m.info && m.info.requestedBy) text += ' (requested by ' + m.info.requestedBy + ')';
    mt.textContent = text;
  }

  function tickTimer(now) {
    const m = state.match;
    const fill = $('#timerFill');
    if (!m || m.phase !== 'open') { fill.style.width = '0%'; return; }
    const k = Math.max(0, Math.min(1, (m.closesAt - now) / (m.closesAt - m.openedAt)));
    fill.style.width = (k * 100).toFixed(1) + '%';
    fill.style.background = k < 0.2 ? 'var(--red-hi)' : 'var(--gold)';
    const st = $('#betStatus');
    const txt = 'Bets are OPEN! (' + Math.ceil(Math.max(0, m.closesAt - now) / 1000) + 's)';
    if (st.textContent !== txt) st.textContent = txt;
  }

  const SPECIALS = SB.Roster.SPECIAL_NAMES, SUPERS = SB.Roster.SUPER_NAMES;
  function renderCards() {
    const m = state.match;
    if (!m) return;
    const key = m.id + ':' + m.phase;
    if (key === renderedMatchKey) return;
    renderedMatchKey = key;
    [['red', '#cardRed'], ['blue', '#cardBlue']].forEach(function (x) {
      const c = m[x[0]], box = $(x[1]);
      box.textContent = '';
      const head = el('div', 'fc-head');
      head.append(el('span', 'tier t-' + c.tier, c.tier));
      head.append(el('b', '', c.name));
      box.append(head);
      const r = c.record, games = r.w + r.l;
      const rec = el('div', 'fc-rec');
      rec.append('Record ');
      rec.append(el('b', '', r.w + '-' + r.l));
      rec.append(' • Win ');
      rec.append(el('b', '', games ? Math.round(100 * r.w / games) + '%' : '–'));
      rec.append(' • Streak ');
      rec.append(el('b', r.streak > 0 ? 'streak-pos' : r.streak < 0 ? 'streak-neg' : '', (r.streak > 0 ? '+' : '') + r.streak));
      rec.append(' • Elo ');
      rec.append(el('b', '', String(r.elo)));
      box.append(rec);
      const recent = el('div', 'recent');
      recent.title = 'Last ' + r.recent.length + ' matches (oldest first)';
      r.recent.forEach(function (v) { recent.append(el('i', v === 'W' ? 'w' : '')); });
      box.append(recent);
      const s = c.stats;
      const stats = el('div', 'stats');
      [['HP', s.hp, 1500, s.hp], ['ATK', s.atk, 1.7, s.atk.toFixed(2)], ['DEF', s.def, 1.7, s.def.toFixed(2)],
        ['SPD', s.spd, 5.6, s.spd.toFixed(1)], ['SKILL', s.skill, 1, Math.round(s.skill * 100)], ['REACH', s.reach * s.size, 1.5, (s.reach * s.size).toFixed(2)]]
        .forEach(function (row) {
          stats.append(el('span', '', row[0]));
          const bar = el('div', 'bar');
          const fillDiv = el('div');
          fillDiv.style.width = Math.min(100, row[1] / row[2] * 100) + '%';
          bar.append(fillDiv);
          stats.append(bar);
          stats.append(el('em', '', String(row[3])));
        });
      box.append(stats);
      const mv = el('div', 'fc-moves');
      mv.append('Special: ');
      mv.append(el('b', '', SPECIALS[c.special] || c.special));
      mv.append(' • Super: ');
      mv.append(el('b', '', SUPERS[c.superMove] || c.superMove));
      mv.append(' • Style: ' + c.arch);
      box.append(mv);
    });
  }

  function renderBettors() {
    const m = state.match;
    if (!m) return;
    const hidden = m.phase === 'open';
    const me = state.me;
    $('#bettorsHidden').textContent = hidden ? 'Bets stay secret until betting closes • ' + m.bettors + ' bettors so far' : m.bettors + ' bettors';
    ['red', 'blue'].forEach(function (side) {
      const list = $('#' + side + 'List');
      list.textContent = '';
      $('#' + side + 'Pot').textContent = hidden ? '' : money(m.pots[side]);
      if (hidden || !m.bettorList) return;
      m.bettorList[side].forEach(function (b) {
        const li = el('li', me && b.name === me.name ? 'me' : '');
        li.append(el('span', 'n', b.name));
        const a = el('span', 'a', money(b.amount));
        if (m.phase === 'payout' && typeof b.gain === 'number') {
          a.append(' ');
          a.append(el('span', b.gain >= 0 ? 'g' : 'l', b.gain >= 0 ? '+' + money(b.gain) : '−' + money(-b.gain)));
        }
        li.append(a);
        list.append(li);
      });
    });
  }

  function renderHistory() {
    const box = $('#history');
    box.textContent = '';
    state.history.slice().reverse().forEach(function (h) {
      const chip = el('div', 'hchip ' + h.winner);
      const w = h.winner === 'red' ? h.redName : h.blueName;
      const l = h.winner === 'red' ? h.blueName : h.redName;
      chip.append(el('b', '', w));
      chip.append(' beat ' + l);
      if (h.odds) chip.append(' (' + h.odds[0] + ':' + h.odds[1] + ')');
      if (h.upset) chip.append(el('span', 'up', 'UPSET'));
      box.append(chip);
    });
    if (!state.history.length) box.append(el('span', 'muted', 'No matches yet.'));
  }

  // ----------------------------------------------------------------- chat
  function addChat(msg) {
    const log = $('#chatLog');
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    const me = state.me;
    const div = el('div', 'msg ' + msg.kind + (me && msg.name === me.name && msg.kind === 'user' ? ' me' : ''));
    if (msg.kind !== 'system' && typeof msg.rank === 'number') {
      div.append(el('span', 'lv', msg.rank ? 'L' + msg.rank : 'R'));
    }
    const n = el('b', '', msg.name);
    if (msg.color) n.style.color = msg.color;
    div.append(n);
    div.append(': ' + msg.text);
    log.append(div);
    while (log.childNodes.length > 150) log.removeChild(log.firstChild);
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }

  // ---------------------------------------------------------------- toast
  function toast(text, kind) {
    const t = el('div', 'toast ' + (kind || ''), text);
    $('#toasts').append(t);
    setTimeout(function () { t.classList.add('out'); }, 4200);
    setTimeout(function () { t.remove(); }, 4600);
  }

  // ------------------------------------------------------------------- UI
  function parseAmount(v) {
    v = String(v || '').trim().toLowerCase().replace(/[$,\s]/g, '');
    const m = v.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
    if (!m) return NaN;
    let n = parseFloat(m[1]);
    if (m[2] === 'k') n *= 1000;
    if (m[2] === 'm') n *= 1000000;
    return Math.floor(n);
  }

  function placeBet(side) {
    if (feed.needsLogin()) { openDialog('register'); return; }
    const input = $('#wager');
    const amount = parseAmount(input.value);
    const box = input.parentElement;
    if (!amount || amount < 1) {
      box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
      toast('Enter a wager first (or use the % buttons).', 'error');
      input.focus();
      return;
    }
    feed.bet(side, amount).then(function (r) {
      if (!r.ok) { toast(r.error || 'Bet failed.', 'error'); return; }
      audio.play('bet');
      toast('Bet placed: ' + money(amount) + ' on ' + state.match[side].name + '.', '');
    });
  }

  function setSound(on, silent) {
    if (on) audio.setEnabled(true); else audio.setEnabled(false);
    $('#soundBtn').textContent = on ? '🔊' : '🔇';
    writePref('sound', on ? '1' : '0');
    if (!silent && on) audio.play('bet');
  }

  function openDialog(name) {
    const d = $('#dlg-' + name);
    if (!d) return;
    if (name === 'leaderboard') loadLeaderboard();
    if (name === 'compendium') loadCompendium();
    if (name === 'settings') {
      $('#renameInput').value = state.me ? state.me.name : '';
      if (feed.mode === 'solo') $('#turboToggle').checked = !!feed.settings.turbo;
    }
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
    if (name === 'register') setTimeout(function () { $('#registerName').focus(); }, 50);
  }
  function closeDialog(d) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }

  function loadLeaderboard() {
    const body = $('#lbBody');
    body.textContent = '';
    body.append(row(['Loading…']));
    feed.leaderboard().then(function (lb) {
      body.textContent = '';
      if (!lb || !lb.top) { body.append(row([lb && lb.error ? lb.error : 'Could not load the leaderboard.'])); return; }
      const me = state.me;
      lb.top.forEach(function (e) {
        const tr = row([String(e.place), e.name, e.rankName, money(e.balance), e.wins + '-' + e.losses], [null, null, null, 'num', 'num']);
        if (e.bot) tr.children[1].append(el('span', 'bot', 'bot'));
        if (me && e.name === me.name) tr.className = 'me';
        body.append(tr);
      });
      $('#lbMe').textContent = lb.me ? 'You are #' + lb.me.place + ' of ' + lb.total + ' with ' + money(lb.me.entry.balance) + '.' : lb.total + ' bettors.';
    });
  }

  let compendium = [];
  function loadCompendium() {
    feed.fighters().then(function (list) {
      compendium = Array.isArray(list) ? list : [];
      renderCompendium();
    });
  }
  function renderCompendium() {
    const q = $('#cmpSearch').value.trim().toLowerCase();
    const tier = $('#cmpTier').value;
    const order = SB.Roster.TIERS;
    const body = $('#cmpBody');
    body.textContent = '';
    compendium
      .filter(function (c) { return (!tier || c.tier === tier) && (!q || c.name.toLowerCase().indexOf(q) >= 0); })
      .sort(function (a, b) { return order.indexOf(a.tier) - order.indexOf(b.tier) || b.record.elo - a.record.elo; })
      .forEach(function (c) {
        const r = c.record, games = r.w + r.l;
        const tr = row(['', c.name, String(r.w), String(r.l), games ? Math.round(100 * r.w / games) + '%' : '–', String(r.elo), (r.streak > 0 ? '+' : '') + r.streak,
          (SPECIALS[c.special] || c.special) + ' / ' + (SUPERS[c.superMove] || c.superMove)], [null, null, 'num', 'num', 'num', 'num', 'num', null]);
        tr.children[0].append(el('span', 'tier t-' + c.tier, c.tier));
        body.append(tr);
      });
  }

  function row(cells, classes) {
    const tr = document.createElement('tr');
    cells.forEach(function (c, i) {
      const td = el('td', classes && classes[i] ? classes[i] : '', c);
      if (cells.length === 1) td.colSpan = 8;
      tr.append(td);
    });
    return tr;
  }

  function wireUI() {
    $('#betRed').addEventListener('click', function () { placeBet('red'); });
    $('#betBlue').addEventListener('click', function () { placeBet('blue'); });
    document.querySelectorAll('.quick button').forEach(function (b) {
      b.addEventListener('click', function () {
        const pct = parseFloat(b.dataset.pct);
        const bal = currentBalance();
        $('#wager').value = String(Math.max(1, pct >= 1 ? bal : Math.floor(bal * pct)));
      });
    });
    $('#wager').addEventListener('input', function (e) { e.target.value = e.target.value.replace(/[^\d$,.kKmM]/g, ''); });

    $('#chatForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const input = $('#chatInput');
      const text = input.value.trim();
      if (!text) return;
      if (feed.needsLogin()) { openDialog('register'); return; }
      feed.chat(text).then(function (r) {
        if (r.ok) input.value = ''; else toast(r.error || 'Could not send.', 'error');
      });
    });

    document.querySelectorAll('[data-dialog]').forEach(function (b) {
      b.addEventListener('click', function () { openDialog(b.dataset.dialog); });
    });
    document.querySelectorAll('.dlg').forEach(function (d) {
      d.querySelector('.dlg-x').addEventListener('click', function () { closeDialog(d); });
      d.addEventListener('click', function (e) { if (e.target === d) closeDialog(d); });
    });
    $('#settingsBtn').addEventListener('click', function () { openDialog(feed.needsLogin() ? 'register' : 'settings'); });
    $('#loginBtn').addEventListener('click', function () { openDialog('register'); });
    $('#soundBtn').addEventListener('click', function () { setSound(!audio.enabled); });
    $('#cmpSearch').addEventListener('input', renderCompendium);
    $('#cmpTier').addEventListener('change', renderCompendium);

    $('#renameForm').addEventListener('submit', function (e) {
      e.preventDefault();
      feed.rename($('#renameInput').value).then(function (r) {
        if (!r.ok) { toast(r.error, 'error'); return; }
        toast('Name changed.', '');
        closeDialog($('#dlg-settings'));
      });
    });
    $('#turboToggle').addEventListener('change', function (e) {
      feed.setTurbo(e.target.checked);
      toast(e.target.checked ? 'Turbo on – starts with the next match.' : 'Turbo off – starts with the next match.', '');
    });
    $('#resetBtn').addEventListener('click', function () {
      if (confirm('Reset your balance, all fighter records and the bots? This cannot be undone.')) feed.reset();
    });
    $('#logoutBtn').addEventListener('click', function () {
      if (confirm('Log out? Your account can only be recovered on this device.')) { feed.logout(); closeDialog($('#dlg-settings')); state.me = null; renderAll(); }
    });
    $('#registerForm').addEventListener('submit', function (e) {
      e.preventDefault();
      $('#registerError').textContent = '';
      feed.register($('#registerName').value.trim()).then(function (r) {
        if (!r.ok) { $('#registerError').textContent = r.error; return; }
        closeDialog($('#dlg-register'));
        toast('Welcome, ' + r.me.name + '! You have ' + money(r.me.balance) + ' to bet with.', 'win');
      });
    });
  }

  boot();
})();
