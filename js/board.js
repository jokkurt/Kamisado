/* ============================================================
   Kamisado — board.js
   Fixed 8x8 board (a Latin square: each row & column contains
   all 8 colors exactly once), plus the 4 random orientations
   used for the "random start setup" rule.
   ============================================================ */
(function (global) {
  "use strict";

  // The 8 tower / square colors.
  var COLORS = ["brown","green","red","yellow","pink","purple","blue","orange"];
  var COLOR_INDEX = {};
  COLORS.forEach(function (c, i) { COLOR_INDEX[c] = i; });

  // Visual hex colors (warm, readable, distinct) for each color.
  var COLOR_HEX = {
    brown:  "#7a4a2b",
    green:  "#2e8b57",
    red:    "#d6453b",
    yellow: "#e8c22e",
    pink:   "#e58bb0",
    purple: "#8e5aa8",
    blue:   "#3a6fd0",
    orange: "#e8862e"
  };
  // A slightly darker shade for cell borders / depth.
  var COLOR_DARK = {
    brown:  "#5a3520",
    green:  "#1f6b40",
    red:    "#a93228",
    yellow: "#bd9a1f",
    pink:   "#bf6a90",
    purple: "#6b4480",
    blue:   "#2b53a3",
    orange: "#bd6420"
  };
  // A lighter highlight used for the cell top / gloss.
  var COLOR_LIGHT = {
    brown:  "#96603c",
    green:  "#48a872",
    red:    "#e86a60",
    yellow: "#f4d95a",
    pink:   "#f0a9c4",
    purple: "#a874c4",
    blue:   "#5b88dd",
    orange: "#f0a04a"
  };

  // Base 8x8 Latin square. row 0 = "top" (Black's home in the reference
  // diagram), row 7 = "bottom" (White's home). Each row and column is a
  // permutation of all 8 colors. Verified programmatically from the
  // official start-position artwork.
  var BASE = [
    ["orange","blue","purple","pink","yellow","red","green","brown"],
    ["red","orange","pink","green","blue","yellow","brown","purple"],
    ["green","pink","orange","red","purple","brown","yellow","blue"],
    ["pink","purple","blue","orange","brown","green","red","yellow"],
    ["yellow","red","green","brown","orange","blue","purple","pink"],
    ["blue","yellow","brown","purple","red","orange","pink","green"],
    ["purple","brown","yellow","blue","green","pink","orange","red"],
    ["brown","green","red","yellow","pink","purple","blue","orange"]
  ];

  function cloneBoard(b) {
    return b.map(function (row) { return row.slice(); });
  }

  // 90° clockwise rotation.
  function rotateCW(b) {
    var n = b.length, out = [];
    for (var r = 0; r < n; r++) {
      out[r] = [];
      for (var c = 0; c < n; c++) {
        out[r][c] = b[n - 1 - c][r];
      }
    }
    return out;
  }

  // Mirror left-right (reverse each row).
  function mirrorLR(b) {
    return b.map(function (row) { return row.slice().reverse(); });
  }

  // Flip top-bottom (reverse row order).
  function reverseRows(b) {
    return b.slice().reverse();
  }

  // The 4 possible start setups (the game's "4 mögliche Startaufstellungen").
  // A valid opening must keep the corner colors: row0 = orange…brown,
  // row7 = brown…orange. Any color permutation that fixes orange and brown and
  // re-shuffles the other six preserves the Latin-square property AND the
  // invariant, so we build 4 distinct such openings.
  function allOrientations() {
    var base = BASE;
    // Permutations that fix orange & brown (the two corner colors).
    var swaps = [
      { pink: "purple", purple: "pink" },
      { green: "blue", blue: "green" },
      { red: "yellow", yellow: "red" }
    ];
    var set = [ base.map(function (r) { return r.slice(); }) ]; // identity
    swaps.forEach(function (sw) {
      set.push(base.map(function (r) {
        return r.map(function (c) { return sw[c] || c; });
      }));
    });
    return set;
  }

  // Opening invariant: Latin square + correct corner colors.
  function isValidOpening(b) {
    if (b.length !== 8 || b.some(function (r) { return r.length !== 8; })) return false;
    for (var r = 0; r < 8; r++) if (new Set(b[r]).size !== 8) return false;
    for (var c = 0; c < 8; c++) {
      var s = new Set();
      for (var r2 = 0; r2 < 8; r2++) s.add(b[r2][c]);
      if (s.size !== 8) return false;
    }
    return b[7][0] === "brown" && b[7][7] === "orange" &&
           b[0][0] === "orange" && b[0][7] === "brown";
  }

  // Pick one of the 4 start setups at random.
  function randomStartBoard(rng) {
    var r = rng ? rng() : Math.random();
    var list = allOrientations();
    var idx = Math.floor(r * list.length) % list.length;
    return cloneBoard(list[idx]);
  }

  var api = {
    COLORS: COLORS,
    COLOR_INDEX: COLOR_INDEX,
    COLOR_HEX: COLOR_HEX,
    COLOR_DARK: COLOR_DARK,
    COLOR_LIGHT: COLOR_LIGHT,
    BASE: BASE,
    cloneBoard: cloneBoard,
    rotateCW: rotateCW,
    mirrorLR: mirrorLR,
    reverseRows: reverseRows,
    allOrientations: allOrientations,
    isValidOpening: isValidOpening,
    randomStartBoard: randomStartBoard
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.KamisadoBoard = api;
})(typeof window !== "undefined" ? window : globalThis);
