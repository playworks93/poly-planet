/* ------------------------------------------------------------------ *
 * Persistence layer
 *
 * The original prototype ran inside a Claude artifact and used the
 * sandbox-only `window.storage` key/value API. A real deployment has no
 * such thing, so this module provides the same async get/set/delete/list
 * interface backed by the browser's localStorage.
 *
 * Photos are stored as data URLs and can be large, so if you expect users
 * to save many high-res images you may want to migrate this to IndexedDB
 * (via a wrapper like `idb-keyval`). The interface below is intentionally
 * async so that swap is a drop-in change with no call-site edits.
 * ------------------------------------------------------------------ */

const PREFIX = "poly-planet:";

export async function stGet(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? null : raw;
  } catch {
    return null;
  }
}

export async function stSet(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value);
    return true;
  } catch {
    // Quota exceeded or storage disabled (private mode, etc.)
    return false;
  }
}

export async function stDel(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* no-op */
  }
}

export async function stList(prefix = "") {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX + prefix)) out.push(k.slice(PREFIX.length));
    }
  } catch {
    /* no-op */
  }
  return out;
}
