/* ------------------------------------------------------------------ *
 * WebGL capability probe.
 *
 * three.js `new WebGLRenderer()` throws if it cannot get a context, which
 * would take the whole React tree down and leave a blank page. Checking up
 * front lets us show an explanation instead of mounting the scene at all.
 *
 * Covers the common real-world causes: no WebGL support (older devices),
 * hardware acceleration disabled, and GPU blocklists / locked-down browsers.
 * ------------------------------------------------------------------ */

export function isWebGLAvailable() {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    if (!gl) return false;
    // Some environments hand back a context that is already lost.
    return typeof gl.getParameter === "function" && !gl.isContextLost?.();
  } catch {
    return false;
  }
}
