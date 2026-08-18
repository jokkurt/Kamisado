/* ============================================================
   Kamisado — core.js
   Pure game engine (no DOM). Loadable in Node (tests) + browser.
   Implements: T1/T2, Z1-Z8, S1-S11, B1-B4, scoring, deadlock.
   ============================================================ */
(function (global) {
  "use strict";

  var B = global.KamisadoBoard;
  if (!B && typeof require === "function") {
    try { B = require("./board.js"); } catch (e) { B = require("./board"); }
  }
  if (!B) throw new Error("KamisadoBoard not loaded — load board.js before core.js");
  var ROWS = 8, COLS = 8;

  // Rank 0 = normal, 1 = Sumo, 2 = Doppel, 3 = Dreifach, 4 = Vierfach.
  var RANK = {
    0: { range: Infinity, push: 0, points: 0, name: "Turm" },
    1: { range: 5, push: 1, points: 1, name: "Sumo" },
    2: { range: 3, push: 2, points: 3, name: "Doppel-Sumo" },
    3: { range: 1, push: 3, points: 7, name: "Dreifach-Sumo" },
    4: { range: 0, push: 0, points: 15, name: "Vierfach-Sumo" }
  };

  var CANON = B.COLORS; // [brown, green, red, yellow, pink, purple, blue, orange]
  var REVERSE = {};
  CANON.forEach(function (c, i) { REVERSE[c] = CANON[CANON.length - 1 - i]; });

  // ---------- helpers ----------
  function inBoard(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }
  function opp(o) { return o === "W" ? "B" : "W"; }
  function forward(o) { return o === "W" ? -1 : 1; }
  function oppHome(o) { return o === "W" ? 0 : 7; }
  function homeRow(o) { return o === "W" ? 7 : 0; }

  function cloneOwner(o) {
    var out = {};
    CANON.forEach(function (c) { out[c] = { r: o[c].r, c: o[c].c, rank: o[c].rank }; });
    return out;
  }
  function cloneState(s) {
    return {
      squares: s.squares.map(function (row) { return row.slice(); }),
      towers: { W: cloneOwner(s.towers.W), B: cloneOwner(s.towers.B) },
      player: s.player,
      forcedColor: s.forcedColor,
      isFirstMove: s.isFirstMove,
      phase: s.phase,
      roundWinner: s.roundWinner,
      roundLoser: s.roundLoser,
      gameWinner: s.gameWinner,
      points: { W: s.points.W, B: s.points.B },
      target: s.target,
      round: s.round,
      lastMove: s.lastMove ? Object.assign({}, s.lastMove) : null,
      lastRealMove: s.lastRealMove ? Object.assign({}, s.lastRealMove) : null,
      lastPass: s.lastPass ? Object.assign({}, s.lastPass) : null,
      direction: s.direction,
      roundEndInfo: s.roundEndInfo ? Object.assign({}, s.roundEndInfo) : null,
      moveNumber: s.moveNumber,
      rng: s.rng
    };
  }

  function towerAt(s, r, c) {
    if (!inBoard(r, c)) return null;
    for (var o in s.towers) {
      for (var col in s.towers[o]) {
        var t = s.towers[o][col];
        if (t.r === r && t.c === c) return { owner: o, color: col };
      }
    }
    return null;
  }

  // Tower of player o that is furthest toward the opponent's home row.
  function frontmostColor(s, o) {
    var best = null, bestAdv = -99;
    CANON.forEach(function (c) {
      var t = s.towers[o][c];
      var adv = o === "W" ? (7 - t.r) : t.r;
      if (adv > bestAdv) { bestAdv = adv; best = c; }
    });
    return best;
  }

  // ---------- creation ----------
  function newGame(opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var squares = opts.board ? B.cloneBoard(opts.board) : B.randomStartBoard(rng);
    var towers = { W: {}, B: {} };
    ["W", "B"].forEach(function (o) {
      var hr = homeRow(o);
      CANON.forEach(function (color) {
        var col = 0;
        for (var c = 0; c < COLS; c++) if (squares[hr][c] === color) { col = c; break; }
        towers[o][color] = { r: hr, c: col, rank: 0 };
      });
    });
    return {
      squares: squares, towers: towers,
      player: opts.firstMover || "W",
      forcedColor: null, isFirstMove: true,
      phase: "playing",
      roundWinner: null, roundLoser: null, gameWinner: null,
      points: { W: 0, B: 0 },
      target: opts.target || 3,
      round: 1,
      lastMove: null, lastRealMove: null, lastPass: null,
      direction: null, roundEndInfo: null,
      moveNumber: 0, rng: rng
    };
  }

  // ---------- move generation ----------
  // Diagonals slide exactly like straight moves (Z1/Z2): any number of
  // squares forward-diagonally, stopping when the next square holds a tower
  // (own or opponent) or the board edge is reached. Legal from the start
  // position too — no flanking condition.

  // Straight-forward + diagonal-forward destinations (Z1-Z5, range-limited for sumos).
  // Returns { toR, toC, pushCount }[] (empty if none).
  function normalMoves(s, o, color) {
    var t = s.towers[o][color];
    var range = RANK[t.rank].range;
    if (range <= 0) return [];
    var f = forward(o), res = [];
    for (var k = 1; k <= range; k++) {
      var rr = t.r + k * f;
      if (!inBoard(rr, t.c) || towerAt(s, rr, t.c)) break;
      res.push({ toR: rr, toC: t.c, pushCount: 0 });
    }
    [1, -1].forEach(function (d) {
      for (var k2 = 1; k2 <= range; k2++) {
        var dr = t.r + k2 * f, dc = t.c + k2 * d;
        if (!inBoard(dr, dc) || towerAt(s, dr, dc)) break;
        res.push({ toR: dr, toC: dc, pushCount: 0 });
      }
    });
    return res;
  }

  // Sumo-push destinations (S1-S11). Returns { toR,toC,pushCount }[].
  function pushMoves(s, o, color) {
    var t = s.towers[o][color];
    var cap = RANK[t.rank].push;
    if (cap <= 0) return [];
    var f = forward(o), blockLen = 0;
    for (var i = 1; i <= cap; i++) {
      var tr = t.r + i * f;
      var tw = towerAt(s, tr, t.c);
      if (!tw || tw.owner === o) break;
      if (s.towers[tw.owner][tw.color].rank >= t.rank) break; // S8
      blockLen++;
    }
    var res = [];
    for (var k = 1; k <= Math.min(cap, blockLen); k++) {
      var lr = t.r + (k + 1) * f;
      if (!inBoard(lr, t.c) || towerAt(s, lr, t.c)) break; // S5/S6
      res.push({ toR: t.r + f, toC: t.c, pushCount: k });
    }
    return res;
  }

  // All legal moves for one tower. S10: push optional if other moves exist;
  // S11: push mandatory if it's the only option. Returns { toR,toC,pushCount }[].
  function movesForColor(s, o, color) {
    var t = s.towers[o][color];
    if (!t) return [];
    var normal = normalMoves(s, o, color);
    var pushes = pushMoves(s, o, color);
    if (normal.length > 0) return normal.concat(pushes);
    return pushes;
  }

  // All legal moves for the current player, as a dict color -> [ {toR,toC,pushCount} ].
  // T1 (first move): all own towers; T2: only the forced color.
  function legalMovesByColor(s) {
    var out = {};
    if (s.phase !== "playing") return out;
    var o = s.player;
    if (s.isFirstMove) {
      CANON.forEach(function (color) {
        var ms = movesForColor(s, o, color);
        if (ms.length) out[color] = ms;
      });
    } else if (s.forcedColor) {
      var ms = movesForColor(s, o, s.forcedColor);
      if (ms.length) out[s.forcedColor] = ms;
    }
    return out;
  }

  // Flat list of all legal moves for the current player.
  function legalMoves(s) {
    var byColor = legalMovesByColor(s), moves = [], o = s.player;
    for (var color in byColor) {
      byColor[color].forEach(function (m) {
        moves.push({ owner: o, color: color, toR: m.toR, toC: m.toC, pushCount: m.pushCount });
      });
    }
    return moves;
  }

  function isBlocked(s) { return s.phase === "playing" && legalMoves(s).length === 0; }

  // ---------- mutation (operate in place on a pre-cloned state) ----------
  function applyMoveInner(s2, move) {
    var o = move.owner, t = s2.towers[o][move.color];
    var fromR = t.r, fromC = t.c;
    if (move.pushCount > 0) {
      var f = forward(o);
      for (var i = move.pushCount; i >= 1; i--) {
        var tw = towerAt(s2, t.r + i * f, t.c);
        s2.towers[tw.owner][tw.color].r = t.r + (i + 1) * f;
      }
    }
    t.r = move.toR; t.c = move.toC;
    s2.moveNumber++;
    s2.lastMove = { owner: o, color: move.color, fromR: fromR, fromC: fromC, toR: move.toR, toC: move.toC, pushCount: move.pushCount };
    if (move.pushCount === 0) {
      s2.lastRealMove = { owner: o, toColor: s2.squares[move.toR][move.toC] };
    } else {
      var lr = move.toR + move.pushCount * forward(o);
      s2.lastRealMove = { owner: o, toColor: s2.squares[lr][move.toC] };
    }
  }

  function passInner(s2) {
    var o = s2.player;
    var anchor = s2.isFirstMove ? frontmostColor(s2, o) : s2.forcedColor;
    var at = s2.towers[o][anchor];
    s2.lastPass = { owner: o, color: anchor };
    s2.player = opp(o);
    s2.forcedColor = s2.squares[at.r][at.c];
    s2.isFirstMove = false;
    s2.lastMove = { owner: o, color: anchor, fromR: at.r, fromC: at.c, toR: at.r, toC: at.c, pushCount: 0, pass: true };
  }

  function endRoundByReach(s2, winner) {
    var tw = s2.towers[winner][s2.lastMove.color];
    tw.rank = Math.min(tw.rank + 1, 4);
    var pts = RANK[tw.rank].points;
    s2.points[winner] += pts;
    s2.phase = "roundEnd";
    s2.roundWinner = winner; s2.roundLoser = opp(winner);
    s2.roundEndInfo = { type: "reach", winner: winner, towerColor: s2.lastMove.color, newRank: tw.rank, points: pts };
    if (s2.points[winner] >= s2.target) { s2.phase = "gameOver"; s2.gameWinner = winner; }
  }

  function endRoundByDeadlock(s2) {
    var loser = s2.lastRealMove.owner;
    var winner = opp(loser);
    var color = s2.lastRealMove.toColor;
    var tw = s2.towers[winner][color];
    tw.rank = Math.min(tw.rank + 1, 4);
    var pts = RANK[tw.rank].points;
    s2.points[winner] += pts;
    s2.phase = "roundEnd";
    s2.roundWinner = winner; s2.roundLoser = loser;
    s2.roundEndInfo = { type: "deadlock", winner: winner, towerColor: color, newRank: tw.rank, points: pts };
    if (s2.points[winner] >= s2.target) { s2.phase = "gameOver"; s2.gameWinner = winner; }
  }

  // Auto-passes while the current player's forced tower is blocked, until someone
  // can move (or a total standstill Z8 is detected). Mutates s2 in place.
  function resolve(s2) {
    var seen = {}, guard = 0;
    while (s2.phase === "playing" && guard++ < 200) {
      if (legalMoves(s2).length > 0) break;
      var key = s2.player + ":" + (s2.isFirstMove ? "T1" : s2.forcedColor);
      if (seen[key]) { endRoundByDeadlock(s2); break; }
      seen[key] = true;
      passInner(s2);
    }
    return s2;
  }

  // ---------- public API ----------
  function applyMove(s, move) {
    if (s.phase !== "playing") return s;
    var s2 = cloneState(s);
    applyMoveInner(s2, move);
    if (s2.lastMove.toR === oppHome(move.owner)) { endRoundByReach(s2, move.owner); return s2; }
    if (move.pushCount > 0) {
      s2.player = move.owner;
      s2.forcedColor = s2.squares[move.toR + move.pushCount * forward(move.owner)][move.toC];
    } else {
      s2.player = opp(move.owner);
      s2.forcedColor = s2.squares[move.toR][move.toC];
    }
    s2.isFirstMove = false;
    resolve(s2);
    return s2;
  }

  function applyPass(s) {
    if (s.phase !== "playing") return s;
    var s2 = cloneState(s);
    passInner(s2);
    resolve(s2);
    return s2;
  }

  function isDeadlock(s) {
    if (s.phase !== "playing") return false;
    var seen = {};
    var st = { player: s.player, forcedColor: s.forcedColor, isFirstMove: s.isFirstMove };
    var guard = 0;
    while (guard++ < 200) {
      var can = st.isFirstMove
        ? CANON.some(function (c) { return movesForColor(s, st.player, c).length > 0; })
        : movesForColor(s, st.player, st.forcedColor).length > 0;
      if (can) return false;
      var key = st.player + ":" + (st.isFirstMove ? "T1" : st.forcedColor);
      if (seen[key]) return true;
      seen[key] = true;
      var o = st.player, anchor = st.isFirstMove ? frontmostColor(s, o) : st.forcedColor;
      var at = s.towers[o][anchor];
      st = { player: opp(o), forcedColor: s.squares[at.r][at.c], isFirstMove: false };
    }
    return false;
  }

  function reForm(s, direction) {
    if (s.phase !== "roundEnd" && s.phase !== "gameOver") return s;
    var s2 = cloneState(s);
    direction = direction === "R" ? "R" : "L";
    s2.direction = direction;
    ["W", "B"].forEach(function (o) {
      var hr = homeRow(o), colOfColor = {};
      for (var c = 0; c < COLS; c++) colOfColor[s2.squares[hr][c]] = c;
      CANON.forEach(function (color) {
        var target = direction === "L" ? color : REVERSE[color];
        s2.towers[o][color].r = hr;
        s2.towers[o][color].c = colOfColor[target];
      });
    });
    s2.round++;
    s2.player = s2.roundLoser; // loser of previous round moves first
    s2.forcedColor = null; s2.isFirstMove = true;
    s2.lastMove = null; s2.lastRealMove = null; s2.lastPass = null;
    s2.roundWinner = null; s2.roundLoser = null; s2.roundEndInfo = null;
    s2.phase = "playing";
    return s2;
  }

  function allTowers(s) {
    var out = [];
    ["W", "B"].forEach(function (o) {
      CANON.forEach(function (c) {
        var t = s.towers[o][c];
        out.push({ owner: o, color: c, r: t.r, c: t.c, rank: t.rank });
      });
    });
    return out;
  }

  var api = {
    ROWS: ROWS, COLS: COLS, RANK: RANK, CANON: CANON, REVERSE: REVERSE,
    newGame: newGame, cloneState: cloneState,
    legalMoves: legalMoves, legalMovesByColor: legalMovesByColor, movesForColor: movesForColor,
    normalMoves: normalMoves, pushMoves: pushMoves,
    applyMove: applyMove, applyPass: applyPass,
    isDeadlock: isDeadlock, isBlocked: isBlocked,
    reForm: reForm, allTowers: allTowers, towerAt: towerAt,
    opp: opp, forward: forward, oppHome: oppHome, homeRow: homeRow, inBoard: inBoard,
    frontmostColor: frontmostColor,
    towerRankName: function (r) { return RANK[r].name; },
    colorHex: function (c) { return B.COLOR_HEX[c]; },
    colorDark: function (c) { return B.COLOR_DARK[c]; },
    colorLight: function (c) { return B.COLOR_LIGHT[c]; }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.Kamisado = api;
})(typeof window !== "undefined" ? window : globalThis);
