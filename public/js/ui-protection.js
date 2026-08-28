/*
 * JYY'R AMPREM — UI interaction protection
 * UI-only: does not touch API, auth, database, quota, provider or page data.
 */
(() => {
  "use strict";

  const protectedMedia = "img,video,svg,canvas,.asset-ui-icon,.ui-icon";

  document.addEventListener("contextmenu", (event) => {
    if (event.target instanceof Element && event.target.closest(protectedMedia)) {
      event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener("dragstart", (event) => {
    if (event.target instanceof Element && event.target.closest(protectedMedia)) {
      event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener("selectstart", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches("input,textarea,select,[contenteditable='true']") ||
        target.closest("input,textarea,select,[contenteditable='true']")) {
      return;
    }
    if (target.closest(protectedMedia)) {
      event.preventDefault();
    }
  }, { passive: false });
})();
