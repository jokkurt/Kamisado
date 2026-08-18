/* ============================================================
   Kamisado — ui.js
   Rendering + interaction. SVG pagoda towers, board tiles,
   markers, animations, sound, DE/EN text, turn flow.
   ============================================================ */
(function (global) {
  "use strict";

  var B = global.KamisadoBoard;
  var G = global.Kamisado;
  var AI = global.KamisadoAI;

  var N = 8;
  var CELL = 100 / N; // percent per cell

  // ---------------- i18n ----------------
  var LANG = {
    en: {
      yourTurn: "Your turn", cpuTurn: "CPU is thinking…",
      chooseTower: "Choose a tower to move", forcedTower: "You must move the {c} tower",
      pushHint: "Gold ring = Sumo-push (S3)",
      round: "Round", firstTo: "First to {n}",
      white: "White", black: "Black", cpu: "CPU", you: "You",
      roundWon: "Round won by", promoted: "promoted to {r}! (+{p})",
      deadlock: "Total standstill — last mover loses the round",
      newRound: "New round — set the home line",
      setLineL: "From Left", setLineR: "From Right",
      gameWon: "{name} wins the game!",
      continue: "Next Round", menu: "Menu", playAgain: "Play Again",
      skip: "Skip turn",
      blocked: "Your {c} tower is blocked — you must skip (Z6).",
      sumoNames: ["Tower", "Sumo", "Doppel-Sumo", "Dreifach-Sumo", "Vierfach-Sumo"],
      tagline: "The game of strategy & the sumo towers",
      modeCPU: "CPU Opponent", mode2P: "2 Players",
      playAs: "Play as", cpuStrength: "CPU strength", gameLength: "Game length",
      easy: "Easy", medium: "Medium", hard: "Hard",
      start: "Start Game", rules: "Rules", soundOn: "Sound: On", soundOff: "Sound: Off",
      reformTitle: "Winning side — set the line",
      movesUp: "▲ moves up", movesDown: "▼ moves down",
      credit: "Original game by Huch & friends · This is a fan web implementation"
    },
    de: {
      yourTurn: "Dein Zug", cpuTurn: "CPU überlegt…",
      chooseTower: "Wähle einen Turm", forcedTower: "Du musst den {c} Turm ziehen",
      pushHint: "Goldener Ring = Sumo-Stoß (S3)",
      round: "Runde", firstTo: "Erster auf {n}",
      white: "Weiß", black: "Schwarz", cpu: "CPU", you: "Du",
      roundWon: "Runde geht an", promoted: "befördert zum {r}! (+{p})",
      deadlock: "Völliger Stillstand — letzter Züger verliert die Runde",
      newRound: "Neue Runde — setze die Grundlinie",
      setLineL: "Von Links", setLineR: "Von Rechts",
      gameWon: "{name} gewinnt das Spiel!",
      continue: "Nächste Runde", menu: "Menü", playAgain: "Nochmal",
      skip: "Zug aussetzen",
      blocked: "Dein {c} Turm ist blockiert — aussetzen (Z6).",
      sumoNames: ["Turm", "Sumo", "Doppel-Sumo", "Dreifach-Sumo", "Vierfach-Sumo"],
      tagline: "Das Strategiespiel mit den Sumo-Türmen",
      modeCPU: "Gegner CPU", mode2P: "2 Spieler",
      playAs: "Spielen als", cpuStrength: "CPU-Stärke", gameLength: "Spiel-Länge",
      easy: "Leicht", medium: "Mittel", hard: "Schwer",
      start: "Spiel starten", rules: "Regeln", soundOn: "Ton: An", soundOff: "Ton: Aus",
      reformTitle: "Gewinnende Seite — Linie setzen",
      movesUp: "▲ nach oben", movesDown: "▼ nach unten",
      credit: "Originalspiel von Huch & friends · Fan-Web-Implementierung"
    }
  };
  var lang = "de";
  function t(key, vars) {
    var s = (LANG[lang] && LANG[lang][key]) || (LANG.en[key]) || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace("{" + k + "}", vars[k]); });
    return s;
  }

  // ---------------- sound (WebAudio) ----------------
  var audioCtx = null, soundOn = true;
  function beep(freq, dur, type, gain) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (global.AudioContext || global.webkitAudioContext)();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      o.connect(g); g.connect(audioCtx.destination);
      var now = audioCtx.currentTime;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(gain || 0.18, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + (dur || 0.15));
      o.start(now); o.stop(now + (dur || 0.15) + 0.02);
    } catch (e) { /* ignore */ }
  }
  var sfx = {
    move: function () { beep(320, 0.1, "triangle", 0.16); },
    push: function () { beep(180, 0.16, "square", 0.16); beep(140, 0.2, "sawtooth", 0.1); },
    win: function () { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { beep(f, 0.18, "triangle", 0.16); }, i * 110); }); },
    click: function () { beep(440, 0.05, "sine", 0.1); }
  };

  // ---------------- state ----------------
  var ui = {
    state: null,
    mode: "cpu",          // 'cpu' | '2p'
    humanSide: "W",
    cpuSide: "B",
    diff: "medium",
    target: 3,
    selectedColor: null,  // T1 selected tower color
    towerEls: {},         // key "owner:color" -> el
    busy: false,
    firstMove: true,
    gen: 0
  };

  // ---------------- SVG pagoda tower ----------------
  var _uid = 0;
  function towerSVG(color, owner, rank) {
    _uid++;
    var id = "tg" + _uid;
    var bodyHi = owner === "W" ? "#ffffff" : "#4a4356";
    var bodyLo = owner === "W" ? "#c9c2b4" : "#161220";
    var roofHi = owner === "W" ? "#f4f1ea" : "#3a3542";
    var roofLo = owner === "W" ? "#a99f8d" : "#100d18";
    var topC = B.COLOR_HEX[color], topL = B.COLOR_LIGHT[color], topD = B.COLOR_DARK[color];
    var roof = function (y, w) {
      var l = 50 - w / 2, r = 50 + w / 2;
      return '<path d="M' + l + ',' + y + ' Q50,' + (y - 13) + ' ' + r + ',' + y +
        ' L' + (r - 5) + ',' + (y + 7) + ' Q50,' + (y - 3) + ' ' + (l + 5) + ',' + (y + 7) + ' Z" ' +
        'fill="url(#' + id + 'r)" stroke="rgba(0,0,0,.35)" stroke-width="1"/>';
    };
    var svg =
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
        '<defs>' +
          '<linearGradient id="' + id + 'b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + bodyHi + '"/><stop offset="1" stop-color="' + bodyLo + '"/></linearGradient>' +
          '<linearGradient id="' + id + 'r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + roofHi + '"/><stop offset="1" stop-color="' + roofLo + '"/></linearGradient>' +
          '<radialGradient id="' + id + 't" cx="0.35" cy="0.28" r="0.85"><stop offset="0" stop-color="' + topL + '"/><stop offset="0.55" stop-color="' + topC + '"/><stop offset="1" stop-color="' + topD + '"/></radialGradient>' +
        '</defs>' +
        // shadow
        '<ellipse cx="50" cy="92" rx="33" ry="6.5" fill="rgba(0,0,0,.42)"/>' +
        // base platform
        '<path d="M22,86 L78,86 L74,75 L26,75 Z" fill="url(#' + id + 'r)" stroke="rgba(0,0,0,.4)" stroke-width="1"/>' +
        // body 1
        '<rect x="35" y="60" width="30" height="15" rx="2.5" fill="url(#' + id + 'b)"/>' +
        // roof 1
        roof(58, 72) +
        // body 2
        '<rect x="40" y="43" width="20" height="10" rx="2" fill="url(#' + id + 'b)"/>' +
        // roof 2
        roof(41, 52) +
        // body 3
        '<rect x="44" y="30" width="12" height="7" rx="2" fill="url(#' + id + 'b)"/>' +
        // roof 3
        roof(28, 36) +
        // colored top disc + spire
        '<circle cx="50" cy="16" r="13.5" fill="url(#' + id + 't)" stroke="rgba(0,0,0,.4)" stroke-width="1"/>' +
        '<path d="M50,10 L56,16 L50,22 L44,16 Z" fill="rgba(255,255,255,.85)"/>' +
        '<line x1="50" y1="16" x2="50" y2="3" stroke="var(--gold,#e8b45a)" stroke-width="2"/>' +
        '<circle cx="50" cy="3" r="2.6" fill="#ffe9bd"/>' +
      '</svg>';
    return svg;
  }

  // ---------------- board rendering ----------------
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function cellPos(r, c) {
    return { left: (c + 0.5) * CELL + "%", top: (r + 0.5) * CELL + "%" };
  }

  function renderBoard() {
    var svg = document.getElementById("board-svg");
    var s = ui.state;
    var out = "";
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var color = s.squares[r][c];
        var x = c * CELL, y = r * CELL;
        var isHome = (r === 0 || r === 7);
        out += '<rect x="' + x + '" y="' + y + '" width="' + CELL + '" height="' + CELL + '" ' +
          'fill="' + B.COLOR_HEX[color] + '"/>';
        // subtle top gloss
        out += '<rect x="' + x + '" y="' + y + '" width="' + CELL + '" height="' + (CELL * 0.5) + '" fill="rgba(255,255,255,.10)"/>';
        // grid line
        out += '<rect x="' + x + '" y="' + y + '" width="' + CELL + '" height="' + CELL + '" fill="none" stroke="rgba(0,0,0,.4)" stroke-width="0.35"/>';
        if (isHome) {
          out += '<rect x="' + x + '" y="' + (r === 0 ? 0 : y + CELL - 2.2) + '" width="' + CELL + '" height="2.2" fill="rgba(255,255,255,.25)"/>';
        }
      }
    }
    svg.innerHTML = out;
  }

  function renderTowers(animate) {
    var layer = document.getElementById("towers");
    var s = ui.state;
    // Build desired map
    var desired = {};
    G.allTowers(s).forEach(function (t) {
      desired[t.owner + ":" + t.color] = t;
    });
    // Remove stale, create new, update existing
    Object.keys(ui.towerEls).forEach(function (k) {
      if (!desired[k]) { layer.removeChild(ui.towerEls[k]); delete ui.towerEls[k]; }
    });
    var towers = G.allTowers(s);
    // sort by rank so higher sumos render on top
    towers.sort(function (a, b) { return a.rank - b.rank; });
    towers.forEach(function (t) {
      var key = t.owner + ":" + t.color;
      var pos = cellPos(t.r, t.c);
      var existing = ui.towerEls[key];
      if (!existing) {
        existing = el("div", "tower r" + t.rank);
        existing.innerHTML = towerSVG(t.color, t.owner, t.rank) + '<div class="rank-rings"></div>';
        existing.dataset.key = key;
        existing.addEventListener("click", function () { onTowerClick(t.owner, t.color); });
        layer.appendChild(existing);
        ui.towerEls[key] = existing;
        existing.style.left = pos.left; existing.style.top = pos.top;
        if (!animate) { existing.style.transition = "none"; existing.offsetHeight; existing.style.transition = ""; }
      } else {
        existing.className = "tower r" + t.rank;
        if (!animate) existing.style.transition = "none";
        existing.style.left = pos.left; existing.style.top = pos.top;
        if (!animate) { existing.offsetHeight; existing.style.transition = ""; }
      }
      // update classes
      existing.classList.remove("forced", "selectable");
      existing.dataset.owner = t.owner;
      existing.dataset.color = t.color;
    });
  }

  function clearMarkers() {
    var fx = document.getElementById("fx");
    fx.innerHTML = "";
  }

  function showMarkers(moves, owner, color) {
    clearMarkers();
    var fx = document.getElementById("fx");
    moves.forEach(function (m) {
      var pos = cellPos(m.toR, m.toC);
      var mk = el("div", "marker" + (m.pushCount > 0 ? " push" : ""), '<div class="dot"></div>');
      mk.style.left = pos.left; mk.style.top = pos.top;
      mk.addEventListener("click", function () {
        onMarkerClick({ owner: owner, color: color, toR: m.toR, toC: m.toC, pushCount: m.pushCount });
      });
      fx.appendChild(mk);
    });
  }

  // ---------------- panels ----------------
  function playerMeta(owner) {
    if (ui.mode === "2p") return owner === "W" ? t("white") : t("black");
    return owner === ui.humanSide ? t("you") : t("cpu");
  }

  function renderPanels() {
    var s = ui.state;
    var topOwner = "B", bottomOwner = "W";
    [["top", topOwner], ["bottom", bottomOwner]].forEach(function (pair) {
      var pos = pair[0], o = pair[1];
      var bar = document.getElementById("bar-" + pos);
      bar.innerHTML = "";
      bar.classList.toggle("active", s.phase === "playing" && s.player === o);
      var av = el("div", "avatar", o === "W" ? "⚪" : "⚫");
      var info = el("div");
      info.innerHTML = '<div class="pname">' + playerMeta(o) + '</div>' +
        '<div class="pmeta">' + (ui.mode === "cpu"
          ? (o === ui.humanSide ? t("you") : "CPU · " + t(ui.diff))
          : (o === "W" ? t("movesUp") : t("movesDown"))) + '</div>';
      bar.appendChild(av); bar.appendChild(info);
      var dots = el("div", "points");
      // sumo badges
      var badges = "";
      G.allTowers(s).forEach(function (tw) {
        if (tw.owner === o && tw.rank > 0) badges += '<span class="sumo-badge" title="' + tw.color + '">' + t("sumoNames")[tw.rank] + '</span> ';
      });
      dots.innerHTML = (s.player === o && s.phase === "playing" ? '<span class="turn-dot"></span>' : '') +
        '<span>' + s.points[o] + '</span>';
      bar.appendChild(dots);
      if (badges) { var bd = el("div", "pmeta", badges); info.appendChild(bd); }
    });
    // labels
    document.getElementById("label-top").textContent = playerMeta("B");
    document.getElementById("label-bottom").textContent = playerMeta("W");
    // round
    document.getElementById("round-num").textContent = t("round") + " " + s.round;
    document.getElementById("target-num").textContent = t("firstTo", { n: s.target });

    // ---- round-end: show result + the left/right choice in THIS panel,
    //      so the board stays fully visible for the winner to judge ----
    var reform = document.getElementById("reform");
    var reformBtns = document.getElementById("reform-btns");
    var roundEnd = (s.phase === "roundEnd");
    if (roundEnd) {
      var info = s.roundEndInfo;
      var winnerName = playerMeta(s.roundWinner);
      var res;
      if (info.type === "deadlock") {
        res = t("deadlock") + " — <b>" + winnerName + "</b> " + t("roundWon") + ".";
      } else {
        res = "<b>" + winnerName + "</b> " + t("roundWon") + " — <span class='tower-chip' style='background:" + B.COLOR_HEX[info.towerColor] + "'></span> " +
          t("promoted", { r: t("sumoNames")[info.newRank], p: info.points });
      }
      document.getElementById("turn-title").innerHTML =
        (s.roundWinner === "W" ? "⚪" : "⚫") + " 🏯 " + t("round") + " " + s.round;
      document.getElementById("hint").innerHTML = res +
        "<div class='re-score'>⚪ " + s.points.W + " · " + s.points.B + " ⚫</div>";
      document.getElementById("btn-pass").hidden = true;
      reform.hidden = false;
      var cpuDecides = (ui.mode === "cpu" && s.roundWinner === ui.cpuSide);
      reformBtns.style.visibility = cpuDecides ? "hidden" : "visible";
    } else {
      reform.hidden = true;
      reformBtns.style.visibility = "visible";
    }
  }

  function setTurn(title, sub) {
    document.getElementById("turn-title").innerHTML = title;
    document.getElementById("turn-sub").innerHTML = sub;
  }
  function setHint(html) { document.getElementById("hint").innerHTML = html; }

  // ---------------- interaction ----------------
  function onTowerClick(owner, color) {
    var s = ui.state;
    if (ui.busy || s.phase !== "playing") return;
    if (s.player !== owner) return;
    if (!s.isFirstMove) return; // T2: tower forced, no choosing
    // T1: select this tower if it has moves
    var mvs = G.movesForColor(s, owner, color);
    if (!mvs || mvs.length === 0) { beep(200, 0.1, "square", 0.1); return; }
    sfx.click();
    ui.selectedColor = color;
    renderTowers(false);
    // mark forced
    var e = ui.towerEls[owner + ":" + color];
    if (e) e.classList.add("forced");
    showMarkers(mvs, owner, color);
    setHint(t("pushHint") + " — " + color);
  }

  function onMarkerClick(move) {
    if (ui.busy) return;
    doMove(move);
  }

  // ---------------- move execution ----------------
  function doMove(move) {
    var s = ui.state;
    if (!s) return;
    if (ui.busy || s.phase !== "playing") return;
    if (move.owner !== s.player) return;
    var owner = move.owner;

    // mark moving tower
    var key = owner + ":" + move.color;
    var tEl = ui.towerEls[key];
    if (tEl) tEl.classList.add("moving");

    // capture pushed towers for animation
    var pushed = [];
    if (move.pushCount > 0) {
      var f = G.forward(owner);
      for (var i = move.pushCount; i >= 1; i--) {
        var tw = G.towerAt(s, s.towers[owner][move.color].r + i * f, s.towers[owner][move.color].c);
        if (tw) pushed.push(tw);
      }
    }

    if (move.pushCount > 0) sfx.push(); else sfx.move();

    ui.busy = true;
    clearMarkers();
    document.querySelectorAll(".tower.forced, .tower.selectable").forEach(function (e) { e.classList.remove("forced", "selectable"); });

    // apply (clones)
    var next = G.applyMove(s, move);
    ui.state = next;
    ui.selectedColor = null;

    renderTowers(true);
    renderPanels();

    var g = ui.gen;
    setTimeout(function () {
      if (g !== ui.gen || !ui.state) return;
      if (tEl) tEl.classList.remove("moving");
      ui.busy = false;
      afterTurn();
    }, 430);
  }

  function doPass() {
    var s = ui.state;
    if (ui.busy || s.phase !== "playing") return;
    sfx.click();
    var next = G.applyPass(s);
    ui.state = next;
    ui.selectedColor = null;
    renderTowers(true);
    renderPanels();
    afterTurn();
  }

  // ---------------- turn driver ----------------
  function isHumanTurn() {
    var s = ui.state;
    if (s.phase !== "playing") return false;
    if (ui.mode === "2p") return true;
    return s.player === ui.humanSide;
  }

  function afterTurn() {
    var s = ui.state;
    if (s.phase === "roundEnd" || s.phase === "gameOver") {
      handleRoundEnd();
      return;
    }
    handleTurn();
  }

  function handleTurn() {
    var s = ui.state;
    if (s.phase !== "playing") return;
    clearMarkers();
    renderTowers(false);
    renderPanels();

    if (!isHumanTurn()) {
      // CPU
      setTurn(t("cpuTurn"), "");
      setHint("…");
      document.getElementById("btn-pass").hidden = true;
      var cpuSide = s.player;
      var g = ui.gen;
      setTimeout(function () {
        if (g !== ui.gen || !ui.state) return; // game changed/left
        var mv = AI.chooseMove(s, cpuSide, ui.diff);
        if (!mv) { ui.state = G.applyPass(s); afterTurn(); }
        else { doMove(mv); }
      }, 520);
      return;
    }

    // Human turn
    setTurn(t("yourTurn"), "");
    var mvs = G.legalMoves(s);
    if (mvs.length === 0) {
      // blocked -> pass
      setHint(t("blocked", { c: s.forcedColor || "" }));
      document.getElementById("btn-pass").hidden = false;
      return;
    }
    document.getElementById("btn-pass").hidden = true;

    if (s.isFirstMove) {
      // T1: choose any tower with moves
      setHint(t("chooseTower"));
      var colors = {};
      mvs.forEach(function (m) { colors[m.color] = true; });
      Object.keys(colors).forEach(function (col) {
        var e = ui.towerEls[s.player + ":" + col];
        if (e) e.classList.add("selectable");
      });
    } else {
      // T2: forced color -> auto show its markers
      setHint(t("forcedTower", { c: s.forcedColor }));
      var forcedEl = ui.towerEls[s.player + ":" + s.forcedColor];
      if (forcedEl) forcedEl.classList.add("forced");
      var fmoves = G.movesForColor(s, s.player, s.forcedColor);
      showMarkers(fmoves, s.player, s.forcedColor);
    }
  }

  // ---------------- round end / re-form / game over ----------------
  function handleRoundEnd() {
    var s = ui.state;
    clearMarkers();
    document.querySelectorAll(".tower.forced, .tower.selectable").forEach(function (e) { e.classList.remove("forced", "selectable"); });

    // Game over is the only full-screen celebration (board no longer matters).
    if (s.phase === "gameOver") {
      renderPanels();
      renderTowers(false);
      sfx.win();
      showGameOver();
      return;
    }

    // Round end: keep the BOARD fully visible so the winner can judge the
    // position, and show the result + the From Left / From Right choice in
    // the side panel (the #reform block), which never covers the board.
    sfx.win();
    renderPanels();
    renderTowers(false);

    var winner = s.roundWinner;
    var cpuDecides = (ui.mode === "cpu" && winner === ui.cpuSide);

    // CPU winner picks the line on its own; a human winner taps a button.
    if (cpuDecides) {
      var g = ui.gen;
      setTimeout(function () {
        if (g !== ui.gen || !ui.state || ui.state.phase !== "roundEnd") return;
        var dir = AI.chooseDirection(ui.state, ui.state.roundWinner, ui.diff);
        var st = ui.state;
        ui.state = G.reForm(st, dir);
        ui.firstMove = true;
        sfx.click();
        handleTurn();
      }, 900);
    }
  }

  function showGameOver() {
    var s = ui.state;
    var winnerName = playerMeta(s.gameWinner);
    var overlay = document.getElementById("overlay");
    var card = document.getElementById("overlay-card");
    card.innerHTML =
      '<div class="ov-sumo">🏆 ' + (s.gameWinner === "W" ? "⚪" : "⚫") + "</div>" +
      '<h2 class="ov-title">' + t("gameWon", { name: winnerName }) + "</h2>" +
      '<div class="ov-sub" style="font-size:26px; margin:12px 0">⚪ ' + s.points.W + "  ·  " + s.points.B + " ⚫</div>" +
      '<div class="ov-btns">' +
        '<button class="action-btn" id="ov-again">' + t("playAgain") + "</button>" +
        '<button class="action-btn ghost" id="ov-menu">' + t("menu") + "</button>" +
      "</div>";
    overlay.hidden = false;
    document.getElementById("ov-again").addEventListener("click", function () {
      overlay.hidden = true;
      startGame();
    });
    document.getElementById("ov-menu").addEventListener("click", function () {
      overlay.hidden = true;
      goMenu();
    });
  }

  // ---------------- game control ----------------
  function startGame() {
    var opts = { target: ui.target, firstMover: "W", rng: Math.random };
    ui.state = G.newGame(opts);
    ui.selectedColor = null;
    ui.firstMove = true;
    ui.busy = false;
    ui.gen++; // invalidate any pending timers from a previous game
    // clear tower elements
    var layer = document.getElementById("towers");
    layer.innerHTML = "";
    ui.towerEls = {};
    renderBoard();
    renderTowers(false);
    document.getElementById("menu").hidden = true;
    document.getElementById("game").hidden = false;
    document.getElementById("overlay").hidden = true;
    renderPanels();
    handleTurn();
  }

  function goMenu() {
    ui.gen++; // invalidate any pending timers (e.g. a CPU thinking)
    ui.state = null;
    document.getElementById("game").hidden = true;
    document.getElementById("menu").hidden = false;
    document.getElementById("overlay").hidden = true;
  }

  // ---------------- rules ----------------
  function rulesHTML() {
    return '<h2 class="ov-title">KAMISADO — ' + (lang === "de" ? "Regeln" : "Rules") + "</h2>" +
      '<div class="rules-body">' +
        (lang === "de"
          ? "<p>Goal: bring one of your towers to the opponent's home line. It is promoted to <b>Sumo</b> (1 pt); reaching it again promotes it further (Doppel 3, Dreifach 7, Vierfach 15). First to the target points wins.</p>" +
            "<h3>Setup</h3><p>Each of the 8 towers starts on its own color's square on its home row. One of 4 random board layouts is chosen. White moves up, Black moves down.</p>" +
            "<h3>Which tower?</h3>" +
            "<div class='rule'><span class='tag'>T1</span><span>Only on the first move of a round the starter may choose any tower.</span></div>" +
            "<div class='rule'><span class='tag'>T2</span><span>All other moves: you must move the tower matching the color of the square your opponent's last move ended on.</span></div>" +
            "<h3>Moving</h3>" +
            "<div class='rule'><span class='tag'>Z1</span><span>Only straight forward or diagonally forward. Never sideways/back (unless a Sumo-push).</span></div>" +
            "<div class='rule'><span class='tag'>Z2</span><span>Any distance, but cannot pass over a tower.</span></div>" +
            "<div class='rule'><span class='tag'>Z4</span><span>Diagonals move like straight moves: any number of squares, stopping at another tower or the opponent's home row — legal from the start position too.</span></div>" +
            "<div class='rule'><span class='tag'>Z5</span><span>Must move if possible.</span></div>" +
            "<div class='rule'><span class='tag'>Z6</span><span>If fully blocked, you skip. The opponent then moves with the tower of the color your blocked tower stands on.</span></div>" +
            "<div class='rule'><span class='tag'>Z7</span><span>The round ends when a tower reaches the opponent's home line.</span></div>" +
            "<div class='rule'><span class='tag'>Z8</span><span>Total standstill: the player who caused it (last mover) loses the round.</span></div>" +
            "<h3>Sumo abilities</h3>" +
            "<p>Sumos move less far (5/3/1 squares) but can <b>Sumo-push</b>:</p>" +
            "<div class='rule'><span class='tag'>S1</span><span>Range: Sumo 5, Doppel 3, Dreifach 1.</span></div>" +
            "<div class='rule'><span class='tag'>S2</span><span>Push lower-rank opponent towers straight ahead one square each.</span></div>" +
            "<div class='rule'><span class='tag'>S3</span><span>After a push you move again with the tower matching the color of the last pushed square.</span></div>" +
            "<div class='rule'><span class='tag'>S4</span><span>No diagonal push; the free square behind the pushed towers must be on the board.</span></div>" +
            "<div class='rule'><span class='tag'>S7</span><span>Push 1/2/3 towers respectively; cannot push equal/higher rank (S8).</span></div>" +
            "<div class='rule'><span class='tag'>S11</span><span>If the push is the only legal move, it is mandatory.</span></div>" +
            "<h3>New round</h3>" +
            "<p>The winner sets whether both sides line up from the left (natural order) or from the right (reversed). The loser starts the next round.</p>"
          :
          "<p>Goal: bring one of your towers to the opponent's home line. It is promoted to <b>Sumo</b> (1 pt); reaching it again promotes it further (Doppel 3, Dreifach 7, Vierfach 15). First to the target points wins.</p>" +
            "<h3>Setup</h3><p>Each of the 8 towers starts on its own color's square on its home row. One of 4 random board layouts is chosen. White moves up, Black moves down.</p>" +
            "<h3>Which tower?</h3>" +
            "<div class='rule'><span class='tag'>T1</span><span>Only on the first move of a round the starter may choose any tower.</span></div>" +
            "<div class='rule'><span class='tag'>T2</span><span>All other moves: you must move the tower matching the color of the square your opponent's last move ended on.</span></div>" +
            "<h3>Moving</h3>" +
            "<div class='rule'><span class='tag'>Z1</span><span>Only straight forward or diagonally forward. Never sideways/back (unless a Sumo-push).</span></div>" +
            "<div class='rule'><span class='tag'>Z2</span><span>Any distance, but cannot pass over a tower.</span></div>" +
            "<div class='rule'><span class='tag'>Z4</span><span>Diagonals move like straight moves: any number of squares, stopping at another tower or the opponent's home row — legal from the start position too.</span></div>" +
            "<div class='rule'><span class='tag'>Z5</span><span>Must move if possible.</span></div>" +
            "<div class='rule'><span class='tag'>Z6</span><span>If fully blocked, you skip. The opponent then moves with the tower of the color your blocked tower stands on.</span></div>" +
            "<div class='rule'><span class='tag'>Z7</span><span>The round ends when a tower reaches the opponent's home line.</span></div>" +
            "<div class='rule'><span class='tag'>Z8</span><span>Total standstill: the player who caused it (last mover) loses the round.</span></div>" +
            "<h3>Sumo abilities</h3>" +
            "<p>Sumos move less far (5/3/1 squares) but can <b>Sumo-push</b>:</p>" +
            "<div class='rule'><span class='tag'>S1</span><span>Range: Sumo 5, Doppel 3, Dreifach 1.</span></div>" +
            "<div class='rule'><span class='tag'>S2</span><span>Push lower-rank opponent towers straight ahead one square each.</span></div>" +
            "<div class='rule'><span class='tag'>S3</span><span>After a push you move again with the tower matching the color of the last pushed square.</span></div>" +
            "<div class='rule'><span class='tag'>S4</span><span>No diagonal push; the free square behind the pushed towers must be on the board.</span></div>" +
            "<div class='rule'><span class='tag'>S7</span><span>Push 1/2/3 towers respectively; cannot push equal/higher rank (S8).</span></div>" +
            "<div class='rule'><span class='tag'>S11</span><span>If the push is the only legal move, it is mandatory.</span></div>" +
            "<h3>New round</h3>" +
            "<p>The winner sets whether both sides line up from the left (natural order) or from the right (reversed). The loser starts the next round.</p>") +
        '<div class="ov-btns"><button class="action-btn" id="ov-close">' + (lang === "de" ? "Schließen" : "Close") + "</button></div>" +
      "</div>";
  }

  function showRules() {
    var overlay = document.getElementById("overlay");
    var card = document.getElementById("overlay-card");
    card.innerHTML = rulesHTML();
    overlay.hidden = false;
    document.getElementById("ov-close").addEventListener("click", function () { overlay.hidden = true; });
  }

 // ---------------- localization (static menu/panel labels) ----------------
  function $(id) { return document.getElementById(id); }
  function localizeMenu() {
    var d = LANG[lang];
    var tagEl = document.querySelector("#tagline, .tagline");
    if (tagEl) tagEl.textContent = d.tagline;
    var cpuLabel = document.querySelector("#btn-cpu .mode-label");
    var twoLabel = document.querySelector("#btn-2p .mode-label");
    if (cpuLabel) cpuLabel.textContent = d.modeCPU;
    if (twoLabel) twoLabel.textContent = d.mode2P;
    // Map each opt-group label to its sibling .seg control (robust to nesting)
    function labelFor(segId) {
      var seg = document.getElementById(segId);
      if (!seg) return null;
      var group = seg.closest(".opt-group");
      return group ? group.querySelector("label") : null;
    }
    var lPlayAs = labelFor("seg-side");
    var lStrength = labelFor("seg-diff");
    var lLength = labelFor("seg-target");
    if (lPlayAs) lPlayAs.textContent = d.playAs;
    if (lStrength) lStrength.textContent = d.cpuStrength;
    if (lLength) lLength.textContent = d.gameLength;
    var diffBtns = document.querySelectorAll("#seg-diff .seg-btn");
    if (diffBtns[0]) diffBtns[0].textContent = d.easy;
    if (diffBtns[1]) diffBtns[1].textContent = d.medium;
    if (diffBtns[2]) diffBtns[2].textContent = d.hard;
    if ($("btn-start")) $("btn-start").textContent = d.start;
    if ($("btn-rules")) $("btn-rules").textContent = "📖 " + d.rules;
    var sideBtns = document.querySelectorAll("#seg-side .seg-btn");
    if (sideBtns[0]) sideBtns[0].textContent = "⚪ " + d.white;
    if (sideBtns[1]) sideBtns[1].textContent = "⚫ " + d.black;
    var rt = document.querySelector("#reform .reform-title");
    if (rt) rt.textContent = d.reformTitle;
    var rl = document.querySelector('#reform .reform-btns button[data-dir="L"]');
    var rr = document.querySelector('#reform .reform-btns button[data-dir="R"]');
    if (rl) rl.textContent = "◀ " + d.setLineL;
    if (rr) rr.textContent = d.setLineR + " ▶";
    if ($("btn-menu")) $("btn-menu").textContent = "↩ " + d.menu;
    var sb = $("btn-sound");
    if (sb) sb.textContent = (soundOn ? "🔊 " + d.soundOn : "🔇 " + d.soundOff);
    var cr = document.querySelector("#menu .credit");
    if (cr) cr.textContent = d.credit;
    // board home labels (in-game)
    if ($("label-top")) $("label-top").textContent = t("black");
    if ($("label-bottom")) $("label-bottom").textContent = t("white");
  }

  // ---------------- menu wiring ----------------
  function wireMenu() {
    var modeBtns = { cpu: document.getElementById("btn-cpu"), two: document.getElementById("btn-2p") };
    function selectMode(m) {
      ui.mode = m;
      modeBtns.cpu.classList.toggle("selected", m === "cpu");
      modeBtns.two.classList.toggle("selected", m === "2p");
      document.getElementById("cpu-options").hidden = (m !== "cpu");
    }
    modeBtns.cpu.addEventListener("click", function () { sfx.click(); selectMode("cpu"); });
    modeBtns.two.addEventListener("click", function () { sfx.click(); selectMode("2p"); });

    // segmented controls
    function wireSeg(id, attr, setter) {
      var seg = document.getElementById(id);
      seg.addEventListener("click", function (e) {
        var btn = e.target.closest(".seg-btn");
        if (!btn) return;
        sfx.click();
        seg.querySelectorAll(".seg-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        setter(btn.dataset[attr]);
      });
    }
    wireSeg("seg-side", "side", function (v) { ui.humanSide = v; ui.cpuSide = v === "W" ? "B" : "W"; });
    wireSeg("seg-diff", "diff", function (v) { ui.diff = v; });
    wireSeg("seg-target", "target", function (v) { ui.target = parseInt(v, 10); });

    document.getElementById("btn-start").addEventListener("click", function () { sfx.click(); startGame(); });
    document.getElementById("btn-rules").addEventListener("click", function () { sfx.click(); showRules(); });
    document.getElementById("btn-sound").addEventListener("click", function () {
      soundOn = !soundOn;
      this.textContent = soundOn ? "🔊 " + t("soundOn") : "🔇 " + t("soundOff");
      if (soundOn) sfx.click();
    });
    document.getElementById("btn-pass").addEventListener("click", doPass);
    document.getElementById("btn-menu").addEventListener("click", function () { sfx.click(); goMenu(); });

    // Round-end "From Left / From Right" (in the side panel, board stays visible)
    var reformBtns = document.getElementById("reform-btns");
    reformBtns.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-dir]");
      if (!b) return;
      var s = ui.state;
      if (!s || s.phase !== "roundEnd") return;
      sfx.click();
      ui.state = G.reForm(s, b.dataset.dir);
      ui.firstMove = true;
      handleTurn();
    });

    // menu decorative squares
    var ms = document.getElementById("menu-squares");
    B.BASE.forEach(function (row, r) {
      row.forEach(function (c, cx) {
        var d = el("div", "sq");
        d.style.background = B.COLOR_HEX[c];
        d.style.animationDelay = ((r * 8 + cx) * 0.012) + "s";
        ms.appendChild(d);
      });
    });

    selectMode("cpu");
  }

  // language toggle (added to menu dynamically)
  function addLangToggle() {
    var foot = document.querySelector(".menu-foot");
    var btn = el("button", "ghost-btn", "🌐 " + (lang === "en" ? "DE" : "EN"));
    btn.addEventListener("click", function () {
      lang = lang === "en" ? "de" : "en";
      btn.textContent = "🌐 " + (lang === "en" ? "DE" : "EN");
      document.documentElement.lang = lang;
      localizeMenu();
      if (ui.state) { renderPanels(); handleTurn(); }
    });
    foot.appendChild(btn);
  }

  var api = {
    start: function () { wireMenu(); addLangToggle(); document.documentElement.lang = lang; localizeMenu(); },
    startGame: startGame,
    goMenu: goMenu,
    setLang: function (l) { lang = l; },
    _state: function () { return ui; }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.KamisadoUI = api;
})(typeof window !== "undefined" ? window : globalThis);
