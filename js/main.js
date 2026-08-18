/* ============================================================
   Kamisado — main.js (entry point)
   ============================================================ */
(function (win) {
  "use strict";
  function boot() {
    if (win.KamisadoUI) {
      win.KamisadoUI.start();
    }
  }
  if (win.document && win.document.readyState === "loading") {
    win.document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(typeof window !== "undefined" ? window : this);
