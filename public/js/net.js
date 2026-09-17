/* JYY'R AMPREM — bounded browser requests. */
(() => {
  "use strict";

  const DEFAULT_TIMEOUT_MS = 8000;

  function fetchWithTimeout(resource, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const sourceSignal = options?.signal;
    let timedOut = false;
    let timer = 0;

    const abortFromSource = () => controller.abort(sourceSignal?.reason);
    if (sourceSignal) {
      if (sourceSignal.aborted) controller.abort(sourceSignal.reason);
      else sourceSignal.addEventListener("abort", abortFromSource, { once: true });
    }

    timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);

    return fetch(resource, { ...options, signal: controller.signal }).catch((error) => {
      if (timedOut) {
        const timeoutError = new Error("Permintaan terlalu lama. Periksa koneksi lalu coba lagi.");
        timeoutError.code = "REQUEST_TIMEOUT";
        timeoutError.cause = error;
        throw timeoutError;
      }
      throw error;
    }).finally(() => {
      window.clearTimeout(timer);
      sourceSignal?.removeEventListener?.("abort", abortFromSource);
    });
  }

  window.JYYRNet = Object.freeze({
    fetchWithTimeout,
  });
})();
