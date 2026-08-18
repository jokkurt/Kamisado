/* ============================================================
   Kamisado — ai.js
   CPU opponent: minimax + alpha-beta, iterative deepening bounded by
   BOTH a node budget and a time budget (predictable, responsive).
   The forced-color rule (T2) keeps branching low after the first
   move of each round, so the search stays fast.
   ============================================================ */
(function (global) {
  "use strict";

  var G = global.Kamisado;
  if (!G && typeof require === "function") G = require("./core.js");

  // nodes = max search positions explored; time = soft wall-clock cap (ms).
  var DIFF = {
    easy:   { maxDepth: 5,  nodes: 4000,   timeMs: 150,  noise: 0.5 },
    medium: { maxDepth: 11, nodes: 60000,  timeMs: 500,  noise: 0.12 },
    hard:   { maxDepth: 21, nodes: 400000, timeMs: 1200, noise: 0.0 }
  };

  function advancement(t) { return t.owner === "W" ? (7 - t.r) : t.r; }
  function distToHome(t) { return t.owner === "W" ? t.r : (7 - t.r); }

  // Static evaluation from aiOwner's perspective.
  function evaluate(state, aiOwner) {
    var score = 0;
    var towers = G.allTowers(state);
    for (var i = 0; i < towers.length; i++) {
      var t = towers[i];
      var val = advancement(t) + t.rank * 6;
      if (distToHome(t) === 1) {
        var f = G.forward(t.owner);
        if (!G.towerAt(state, t.r + f, t.c)) val += 45; // one step from winning the round
      }
      score += (t.owner === aiOwner) ? val : -val;
    }
    return score;
  }

  function terminalScore(state, aiOwner) {
    if (state.phase === "gameOver") return state.gameWinner === aiOwner ? 10000 : -10000;
    if (state.roundWinner === aiOwner) return 1000 + (state.roundEndInfo ? state.roundEndInfo.points * 20 : 0);
    return -(1000 + (state.roundEndInfo ? state.roundEndInfo.points * 20 : 0));
  }

  function orderMoves(mvs, aiOwner) {
    mvs.sort(function (a, b) {
      var aWin = (a.toR === G.oppHome(a.owner)) ? 1 : 0;
      var bWin = (b.toR === G.oppHome(b.owner)) ? 1 : 0;
      if (aWin !== bWin) return bWin - aWin;
      var aAdv = (a.owner === aiOwner) ? advancement({ owner: a.owner, r: a.toR }) : 0;
      var bAdv = (b.owner === aiOwner) ? advancement({ owner: b.owner, r: b.toR }) : 0;
      return bAdv - aAdv;
    });
  }

  function search(state, aiOwner, depth, alpha, beta, budget) {
    budget.tick();
    if (state.phase !== "playing") return terminalScore(state, aiOwner);
    if (depth <= 0) return evaluate(state, aiOwner);

    var mvs = G.legalMoves(state);
    if (mvs.length === 0) {
      // blocked -> forced pass (Z6)
      return search(G.applyPass(state), aiOwner, depth - 1, alpha, beta, budget);
    }
    orderMoves(mvs, aiOwner);

    var maximizing = (state.player === aiOwner);
    var best = maximizing ? -Infinity : Infinity;
    for (var i = 0; i < mvs.length; i++) {
      var v = search(G.applyMove(state, mvs[i]), aiOwner, depth - 1, alpha, beta, budget);
      if (maximizing) {
        if (v > best) best = v;
        if (best > alpha) alpha = best;
      } else {
        if (v < best) best = v;
        if (best < beta) beta = best;
      }
      if (budget.dead()) return best; // abort -> partial result (still usable)
      if (beta <= alpha) break;
    }
    return best;
  }

  function makeBudget(timeMs, nodeCap) {
    var start = Date.now();
    var nodes = 0;
    var s = ((Date.now() * 2654435761) % 2147483647) >>> 0;
    function rng() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    return {
      tick: function () { nodes++; },
      dead: function () { return nodes > nodeCap || (Date.now() - start) > timeMs; },
      nodes: function () { return nodes; },
      rng: rng
    };
  }

  // Choose the best move for the given player. Returns a move object (or null
  // if the player is blocked and must pass).
  function chooseMove(state, aiOwner, level) {
    var cfg = DIFF[level] || DIFF.medium;
    if (state.phase !== "playing") return null;

    var mvs = G.legalMoves(state);
    if (mvs.length === 0) return null; // blocked -> pass
    // Fast path: an immediate round-winning move.
    for (var i = 0; i < mvs.length; i++) {
      if (mvs[i].toR === G.oppHome(mvs[i].owner)) return mvs[i];
    }
    if (mvs.length === 1) return mvs[0];

    var bestMove = mvs[0];
    var budget = makeBudget(cfg.timeMs, cfg.nodes);
    for (var d = 2; d <= cfg.maxDepth; d += 2) {
      var alpha = -Infinity, beta = Infinity;
      var localBest = null, localVal = -Infinity;
      orderMoves(mvs, aiOwner);
      for (var k = 0; k < mvs.length; k++) {
        budget.tick();
        var v = search(G.applyMove(state, mvs[k]), aiOwner, d - 1, alpha, beta, budget);
        if (cfg.noise > 0) v += (budget.rng() - 0.5) * cfg.noise * 60;
        if (v > localVal) { localVal = v; localBest = mvs[k]; }
        if (localVal > alpha) alpha = localVal;
        if (budget.dead()) break;
      }
      if (localBest) bestMove = localBest;
      if (budget.dead() || localVal >= 950) break; // stop on time-out or forced round win
    }
    return bestMove;
  }

  // Choose the better re-forming direction ('L' or 'R') for `winner`, looking a
  // few moves ahead from the resulting position.
  function chooseDirection(state, winner, level) {
    var cfg = DIFF[level] || DIFF.medium;
    var budget = makeBudget(cfg.timeMs, cfg.nodes);
    function scoreDir(dir) {
      var ns = G.reForm(state, dir);
      var budget2 = makeBudget(200, 20000);
      // shallow search from the new position (loser to move)
      return search(ns, winner, Math.min(7, cfg.maxDepth), -Infinity, Infinity, budget2);
    }
    var sL = scoreDir("L"), sR = scoreDir("R");
    return sL >= sR ? "L" : "R";
  }

  var api = { DIFF: DIFF, chooseMove: chooseMove, chooseDirection: chooseDirection, evaluate: evaluate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.KamisadoAI = api;
})(typeof window !== "undefined" ? window : globalThis);
