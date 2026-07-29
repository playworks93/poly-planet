import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { CITIES } from "../lib/atlas.js";
import { stGet, stSet, stDel } from "../lib/storage.js";
import { geoSearch, fetchWeather, fetchWiki, localTimeAt } from "../lib/api.js";

/* ------------------------------------------------------------------ */
/*  Poly Planet — super-chunky globe (~500 faces), oversized props     */
/*  grounded to real terrain, and springy LBP-style animation.         */
/* ------------------------------------------------------------------ */

const D2R = Math.PI / 180;
const EARTH_KM = 6371;

/* ---------- Atlas ---------- */

/* ---------- Coarse world map: 72x36 grid (5 deg cells) ---------- */
const MAP_SPANS = {
  1: [[16, 22, "l"], [24, 30, "i"]],
  2: [[14, 20, "l"], [22, 32, "i"], [39, 41, "i"]],
  3: [[10, 22, "l"], [25, 31, "i"], [49, 71, "l"]],
  4: [[0, 1, "l"], [3, 23, "l"], [26, 29, "i"], [31, 33, "l"], [37, 71, "l"]],
  5: [[0, 1, "l"], [3, 23, "l"], [27, 27, "i"], [31, 32, "l"], [37, 71, "l"]],
  6: [[3, 25, "l"], [35, 35, "l"], [37, 64, "l"], [67, 68, "l"]],
  7: [[10, 25, "l"], [34, 64, "l"], [67, 67, "l"]],
  8: [[11, 25, "l"], [35, 62, "l"], [64, 64, "l"]],
  9: [[11, 22, "l"], [34, 41, "l"], [43, 61, "l"], [64, 64, "l"]],
  10: [[11, 21, "l"], [34, 35, "l"], [40, 61, "l"], [63, 63, "l"]],
  11: [[12, 20, "l"], [34, 60, "l"], [62, 62, "l"]],
  12: [[13, 16, "l"], [19, 20, "l"], [33, 60, "l"]],
  13: [[14, 16, "l"], [19, 21, "l"], [32, 47, "l"], [50, 53, "l"], [54, 58, "l"]],
  14: [[15, 18, "l"], [32, 46, "l"], [50, 52, "l"], [55, 57, "l"], [60, 60, "l"]],
  15: [[17, 19, "l"], [33, 45, "l"], [51, 51, "l"], [56, 57, "l"], [60, 60, "l"]],
  16: [[20, 24, "l"], [34, 45, "l"], [52, 52, "l"], [56, 56, "l"], [60, 61, "l"]],
  17: [[20, 26, "l"], [37, 44, "l"], [55, 60, "l"]],
  18: [[20, 29, "l"], [38, 44, "l"], [56, 59, "l"], [62, 66, "l"]],
  19: [[20, 29, "l"], [38, 44, "l"], [57, 58, "l"], [63, 65, "l"]],
  20: [[20, 28, "l"], [38, 45, "l"], [60, 64, "l"]],
  21: [[21, 28, "l"], [38, 43, "l"], [45, 45, "l"], [60, 65, "l"]],
  22: [[22, 27, "l"], [38, 43, "l"], [45, 45, "l"], [58, 66, "l"]],
  23: [[22, 26, "l"], [39, 42, "l"], [58, 66, "l"]],
  24: [[21, 25, "l"], [39, 42, "l"], [59, 66, "l"]],
  25: [[21, 24, "l"], [64, 66, "l"], [70, 71, "l"]],
  26: [[21, 23, "l"], [65, 65, "l"], [69, 70, "l"]],
  27: [[21, 22, "l"], [69, 69, "l"]],
  28: [[21, 22, "l"]],
  30: [[24, 24, "i"]],
  31: [[24, 25, "i"], [36, 68, "i"]],
  32: [[20, 70, "i"]],
  33: [[0, 71, "i"]],
  34: [[0, 71, "i"]],
  35: [[0, 71, "i"]],
};

function sampleMap(lat, lng) {
  let col = Math.floor((lng + 180) / 5);
  col = ((col % 72) + 72) % 72;
  const row = Math.max(0, Math.min(35, Math.floor((90 - lat) / 5)));
  const spans = MAP_SPANS[row];
  if (!spans) return 0;
  for (const [a, b, t] of spans) if (col >= a && col <= b) return t === "i" ? 2 : 1;
  return 0;
}

function latLngToVec(lat, lng, r) {
  const p = lat * D2R, l = lng * D2R;
  return new THREE.Vector3(r * Math.cos(p) * Math.cos(l), r * Math.sin(p), -r * Math.cos(p) * Math.sin(l));
}
function vecToLatLng(v) {
  const n = v.clone().normalize();
  return { lat: Math.asin(n.y) / D2R, lng: Math.atan2(-n.z, n.x) / D2R };
}
function hashJit(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
function slerpVec(a, b, t, out) {
  const d = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const om = Math.acos(d);
  if (om < 1e-5) return out.copy(a);
  const so = Math.sin(om);
  return out.set(
    a.x * (Math.sin((1 - t) * om) / so) + b.x * (Math.sin(t * om) / so),
    a.y * (Math.sin((1 - t) * om) / so) + b.y * (Math.sin(t * om) / so),
    a.z * (Math.sin((1 - t) * om) / so) + b.z * (Math.sin(t * om) / so)
  );
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));
/* ---------- Elevation field ----------
   Flat two-tier terrain like a paper cut-out globe: ocean is one clean shell,
   land is a raised flat plateau, with a sharp cliff step at every coastline.
   Only a whisper of jitter so facets read, no rolling hills. */
function elevationAt(uUnit) {
  const { lat, lng } = vecToLatLng(uUnit);
  const t = sampleMap(lat, lng);
  const j = hashJit(uUnit.x * 4.3, uUnit.y * 4.3, uUnit.z * 4.3) - 0.5; // tiny facet wobble
  if (t === 0) return { r: 1.0 + j * 0.004, kind: 0, h01: 0 };          // flat ocean
  if (t === 2) return { r: 1.022 + j * 0.005, kind: 2, h01: 0.3 };      // flat ice shelf
  return { r: 1.035 + j * 0.006, kind: 1, h01: 0.5 };                   // flat land, subtly raised
}
/* fallback estimate when raycast misses */
function surfaceREstimate(v) {
  return elevationAt(v.clone().normalize()).r;
}
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutElastic = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function haversineKm(a, b) {
  const dLat = (b.lat - a.lat) * D2R, dLng = (b.lng - a.lng) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(s));
}

/* ---------- Palette ---------- */
const C = {
  seaDeep: 0x6fa9dc, seaLite: 0x92c3ec,
  landA: 0x8fd25f, landB: 0xaadd75, sand: 0xdccd90, ice: 0xf3f7fb,
  cherry: 0xe0523f, cream: 0xfdfbf6, ink: 0x22395b, wheel: 0x2b3a52, wood: 0xb98a5a,
  rock: 0x9a6b4a, rockDark: 0x84573c,
};

/* ---------- Day/night sky ---------- */
const SKY_STOPS = [
  [0.0, "#f2d5c4", "#c9d6ea", "#b9c8e2"],
  [0.08, "#dcebf8", "#bcd7ee", "#a8c9e6"],
  [0.42, "#dcebf8", "#bcd7ee", "#a8c9e6"],
  [0.52, "#f7cfae", "#e6a092", "#c898ab"],
  [0.62, "#1c2b4c", "#101a33", "#0a1224"],
  [0.88, "#1c2b4c", "#101a33", "#0a1224"],
  [1.0, "#f2d5c4", "#c9d6ea", "#b9c8e2"],
];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
function skyAt(t) {
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while (i < SKY_STOPS.length - 2 && t > SKY_STOPS[i + 1][0]) i++;
  const A = SKY_STOPS[i], B = SKY_STOPS[i + 1];
  const f = (t - A[0]) / Math.max(1e-6, B[0] - A[0]);
  const mix = (a, b) => _c1.set(a).lerp(_c2.set(b), f).getStyle();
  return [mix(A[1], B[1]), mix(A[2], B[2]), mix(A[3], B[3])];
}
function nightness(t) {
  const elev = Math.cos((t - 0.25) * Math.PI * 2);
  return clamp01(-elev * 1.1 + 0.12);
}

/* ---------- Correct right-handed surface orientation ----------
   Local +Y points out of the globe (up), +Z along travel (fwd).
   right = up x fwd gives a proper right-handed rotation basis.   */
function orientOnSphere(obj, posUnit, forward, radius) {
  const up = posUnit.clone().normalize();
  let fwd = forward.clone().sub(up.clone().multiplyScalar(forward.dot(up)));
  if (fwd.lengthSq() < 1e-8) fwd = new THREE.Vector3(0, 1, 0).cross(up);
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
  obj.position.copy(up).multiplyScalar(radius);
}
function eastTangent(unit) {
  const t = new THREE.Vector3(0, 1, 0).cross(unit);
  return t.lengthSq() < 1e-8 ? new THREE.Vector3(1, 0, 0) : t.normalize();
}
function sphereBasis(unit) {
  const up = unit.clone().normalize();
  const fwd = eastTangent(up);
  const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
  return { up, fwd, right };
}

/* ================= 3D builders ================= */
/* Flat, paper-cutout palette — greens for land, blues for ocean.
   The darker tone of each pair goes on the steep cliff faces at coastlines. */
const COL = {
  seaTop: new THREE.Color(0x53c0d9),     // flat ocean top (teal)
  seaCliff: new THREE.Color(0x2f8fb0),   // ocean seen on steep steps
  landTop: new THREE.Color(0x86cf4e),    // meadow green
  landTop2: new THREE.Color(0x6fbf46),   // slightly deeper green for gentle patches
  landCliff: new THREE.Color(0x4f9a34),  // land cliff / coastal bank (deep green)
  iceTop: new THREE.Color(0xeef5fb),
  iceCliff: new THREE.Color(0xcbdcea),
};
/* Smooth, low-frequency scalar on the sphere (−1..1) for natural-looking
   terrain patches — no harsh per-face randomness. */
function smoothField(u) {
  return (
    Math.sin(u.x * 3.1 + 0.7) * 0.5 +
    Math.sin(u.y * 2.3 - 1.2) * 0.3 +
    Math.sin(u.z * 4.7 + 2.1) * 0.2
  );
}
function buildGlobe() {
  const geo = new THREE.IcosahedronGeometry(1, 5).toNonIndexed(); // ~720 faces — chunkier, still tidy after cleanup
  const srcPos = geo.attributes.position;
  const nFace = srcPos.count / 3;

  // ---- pass 1: decide each face's tier from its centroid, lift its verts ----
  const cenU = [];   // unit centroid per face
  const kindOf = []; // 0 sea / 1 land / 2 ice per face
  const rOf = [];    // tier radius per face
  const topPos = new Float32Array(srcPos.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cn = new THREE.Vector3();
  for (let f = 0; f < nFace; f++) {
    const i = f * 3;
    a.fromBufferAttribute(srcPos, i);
    b.fromBufferAttribute(srcPos, i + 1);
    c.fromBufferAttribute(srcPos, i + 2);
    cn.copy(a).add(b).add(c).multiplyScalar(1 / 3).normalize();
    const ev = elevationAt(cn);
    cenU.push(cn.clone()); kindOf.push(ev.kind); rOf.push(ev.r);
    const verts = [a, b, c];
    for (let k = 0; k < 3; k++) {
      const vv = verts[k].clone().normalize().multiplyScalar(ev.r);
      topPos[(i + k) * 3] = vv.x; topPos[(i + k) * 3 + 1] = vv.y; topPos[(i + k) * 3 + 2] = vv.z;
    }
  }

  // ---- pass 1b: build face adjacency (shared edges) so we can tidy coastlines ----
  const ekey = (u, v) => {
    const q = (x) => Math.round(x * 4096);
    const ka = `${q(u.x)},${q(u.y)},${q(u.z)}`, kb = `${q(v.x)},${q(v.y)},${q(v.z)}`;
    return ka < kb ? ka + "|" + kb : kb + "|" + ka;
  };
  const edgeOwner = new Map();  // edgeKey -> first face index
  const neighbours = Array.from({ length: nFace }, () => []);
  {
    const vv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let f = 0; f < nFace; f++) {
      const i = f * 3;
      vv[0].fromBufferAttribute(srcPos, i);
      vv[1].fromBufferAttribute(srcPos, i + 1);
      vv[2].fromBufferAttribute(srcPos, i + 2);
      for (let k = 0; k < 3; k++) {
        const ek = ekey(vv[k], vv[(k + 1) % 3]);
        const owner = edgeOwner.get(ek);
        if (owner === undefined) edgeOwner.set(ek, f);
        else { neighbours[f].push(owner); neighbours[owner].push(f); }
      }
    }
  }

  // ---- pass 1b2: grow the land ----
  //   Turn any ocean face touching enough land into land, expanding coastlines
  //   outward. More rounds / a looser threshold = more land. Ice is left alone.
  const isLand = (k) => k === 1;
  const LAND_GROW_ROUNDS = 1;      // how many rings of coast to add
  const LAND_GROW_MIN_NB = 1;      // sea face needs ≥ this many land neighbours to convert
  for (let iter = 0; iter < LAND_GROW_ROUNDS; iter++) {
    const next = kindOf.slice();
    for (let f = 0; f < nFace; f++) {
      if (kindOf[f] !== 0) continue; // only oceans convert
      const nb = neighbours[f];
      const landN = nb.reduce((s, n) => s + (isLand(kindOf[n]) ? 1 : 0), 0);
      if (landN >= LAND_GROW_MIN_NB) next[f] = 1;
    }
    for (let f = 0; f < nFace; f++) kindOf[f] = next[f];
  }

  // ---- pass 1c: tidy the map ----
  //   • drop lone land specks (a land face with too few land neighbours)
  //   • fill landlocked water (a sea face mostly ringed by land)
  //   Repeat a few times so changes settle, then re-lift affected faces.
  for (let iter = 0; iter < 8; iter++) {
    let changed = 0;
    const next = kindOf.slice();
    for (let f = 0; f < nFace; f++) {
      if (kindOf[f] === 2) continue; // leave ice caps alone
      const nb = neighbours[f];
      const landN = nb.reduce((s, n) => s + (isLand(kindOf[n]) ? 1 : 0), 0);
      if (isLand(kindOf[f])) {
        if (landN <= 1) { next[f] = 0; changed++; }          // speck island → sea
      } else {
        if (landN >= nb.length && nb.length >= 2) { next[f] = 1; changed++; } // fully enclosed water → land
      }
    }
    for (let f = 0; f < nFace; f++) kindOf[f] = next[f];
    if (!changed) break;
  }
  // re-lift vertices for faces whose tier may have changed (clean flat tiers)
  for (let f = 0; f < nFace; f++) {
    const i = f * 3;
    const kind = kindOf[f];
    const r = kind === 1 ? 1.035 : kind === 2 ? 1.022 : 1.0;
    rOf[f] = r;
    for (let k = 0; k < 3; k++) {
      const vx = srcPos.getX(i + k), vy = srcPos.getY(i + k), vz = srcPos.getZ(i + k);
      const inv = r / Math.hypot(vx, vy, vz);
      topPos[(i + k) * 3] = vx * inv; topPos[(i + k) * 3 + 1] = vy * inv; topPos[(i + k) * 3 + 2] = vz * inv;
    }
  }

  // ---- pass 2: find shared edges; where two faces sit at different tiers,
  //      build a vertical wall quad so the step is solid, not a gap ----
  const key = (u, v) => {
    // stable key for an undirected edge between two ORIGINAL (undisplaced) verts
    const q = (x) => Math.round(x * 4096);
    const ka = `${q(u.x)},${q(u.y)},${q(u.z)}`, kb = `${q(v.x)},${q(v.y)},${q(v.z)}`;
    return ka < kb ? ka + "|" + kb : kb + "|" + ka;
  };
  const edgeMap = new Map(); // edgeKey -> { face, dirs:[unitA, unitB] }
  const wallTris = []; // flat list of Vector3 (3 per tri)
  const wallKindArr = []; // one kind per wall triangle (colour by raised side)
  const uA = new THREE.Vector3(), uB = new THREE.Vector3();
  for (let f = 0; f < nFace; f++) {
    const i = f * 3;
    const vs = [
      new THREE.Vector3().fromBufferAttribute(srcPos, i),
      new THREE.Vector3().fromBufferAttribute(srcPos, i + 1),
      new THREE.Vector3().fromBufferAttribute(srcPos, i + 2),
    ];
    for (let k = 0; k < 3; k++) {
      const p = vs[k], q = vs[(k + 1) % 3];
      const ek = key(p, q);
      const prev = edgeMap.get(ek);
      if (!prev) { edgeMap.set(ek, { face: f, p: p.clone(), q: q.clone() }); continue; }
      const f2 = prev.face;
      if (rOf[f] === rOf[f2]) continue;             // same tier → no wall
      // higher tier face owns the top edge; wall drops to the lower radius
      const hiFace = rOf[f] > rOf[f2] ? f : f2;
      const hi = rOf[hiFace], lo = rOf[f] > rOf[f2] ? rOf[f2] : rOf[f];
      const wallKind = kindOf[hiFace]; // colour by the raised side (cleaned tiers)
      uA.copy(prev.p).normalize(); uB.copy(prev.q).normalize();
      const topA = uA.clone().multiplyScalar(hi), topB = uB.clone().multiplyScalar(hi);
      const botA = uA.clone().multiplyScalar(lo), botB = uB.clone().multiplyScalar(lo);
      // choose winding so the wall normal points radially OUTWARD (single-sided safe)
      const t1 = [topA, botA, topB], t2 = [topB, botA, botB];
      for (const tri of [t1, t2]) {
        const n = tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0]));
        const radial = tri[0].clone().add(tri[1]).add(tri[2]);
        if (n.dot(radial) < 0) { const tmp = tri[1]; tri[1] = tri[2]; tri[2] = tmp; }
        wallTris.push(tri[0], tri[1], tri[2]);
        wallKindArr.push(wallKind);
      }
    }
  }

  // ---- assemble final geometry: tops + walls ----
  const wallStart = srcPos.count;
  const total = wallStart + wallTris.length;
  const posArr = new Float32Array(total * 3);
  posArr.set(topPos, 0);
  for (let w = 0; w < wallTris.length; w++) {
    posArr[(wallStart + w) * 3] = wallTris[w].x;
    posArr[(wallStart + w) * 3 + 1] = wallTris[w].y;
    posArr[(wallStart + w) * 3 + 2] = wallTris[w].z;
  }

  // ---- colors ----
  const colors = new Float32Array(total * 3);
  const face = new THREE.Color();
  const P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), P2 = new THREE.Vector3();
  const NRM = new THREE.Vector3(), E1 = new THREE.Vector3(), E2 = new THREE.Vector3();
  const setTri = (base, col) => {
    for (let k = 0; k < 3; k++) {
      colors[(base + k) * 3] = col.r; colors[(base + k) * 3 + 1] = col.g; colors[(base + k) * 3 + 2] = col.b;
    }
  };
  // top faces: cliff-shade steep ones, flat tone for tops
  for (let f = 0; f < nFace; f++) {
    const i = f * 3;
    P0.set(posArr[i * 3], posArr[i * 3 + 1], posArr[i * 3 + 2]);
    P1.set(posArr[(i + 1) * 3], posArr[(i + 1) * 3 + 1], posArr[(i + 1) * 3 + 2]);
    P2.set(posArr[(i + 2) * 3], posArr[(i + 2) * 3 + 1], posArr[(i + 2) * 3 + 2]);
    E1.subVectors(P1, P0); E2.subVectors(P2, P0); NRM.crossVectors(E1, E2).normalize();
    const cliff = Math.abs(NRM.dot(cenU[f])) < 0.55;
    const kind = kindOf[f];
    const cu = cenU[f];
    if (kind === 0) {
      face.copy(cliff ? COL.seaCliff : COL.seaTop);
      face.offsetHSL(0, 0, (hashJit(cu.x * 5.7, cu.y * 5.7, cu.z * 5.7) - 0.5) * 0.03);
    } else if (kind === 2) {
      face.copy(cliff ? COL.iceCliff : COL.iceTop);
    } else if (cliff) {
      face.copy(COL.landCliff);
    } else {
      // smooth meadow patches: blend between two greens by a low-freq field
      const t01 = clamp01(smoothField(cu) * 0.5 + 0.5);
      face.copy(COL.landTop).lerp(COL.landTop2, t01 * t01); // bias toward the lighter green
    }
    setTri(i, face);
  }
  // wall faces: darker cliff tone of the RAISED side (uses cleaned tiers)
  for (let w = 0; w < wallTris.length; w += 3) {
    const base = wallStart + w;
    const kind = wallKindArr[w / 3];
    face.copy(kind === 2 ? COL.iceCliff : COL.landCliff);
    setTri(base, face);
  }

  const g2 = new THREE.BufferGeometry();
  g2.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
  g2.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g2.computeVertexNormals();
  return new THREE.Mesh(
    g2,
    new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0,
      side: THREE.DoubleSide, // cliff walls stay solid from any grazing angle
    })
  );
}

/* Big, proud pines like the reference — clustered forests. */
function buildTrees(ground) {
  const g = new THREE.Group();
  const sway = [];
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a5a3b, flatShading: true });
  const greens = [0x2f8f45, 0x3e9e4f, 0x57b05a].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.9 })
  );
  const clusters = [];
  let guard = 0;
  while (clusters.length < 11 && guard++ < 500) {
    const lat = -55 + Math.random() * 110;
    const lng = -180 + Math.random() * 360;
    if (sampleMap(lat, lng) !== 1) continue;
    if (lat > 12 && lat < 34 && lng > -16 && lng < 62) continue;
    clusters.push([lat, lng]);
  }
  let count = 0;
  for (const [clat, clng] of clusters) {
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n && count < 60; i++) {
      const lat = clat + (Math.random() - 0.5) * 14;
      const lng = clng + (Math.random() - 0.5) * 14;
      const u = latLngToVec(lat, lng, 1);
      const gr = ground(u);
      if (gr < 1.028) continue; // on the raised land only, not ice or sea
      const t = new THREE.Group();
      const h = 0.09 + Math.random() * 0.07; // BIG trees
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.028 + Math.random() * 0.016, h, 5),
        greens[count % 3]
      );
      cone.position.y = h * 0.62;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.035, 5), trunkMat);
      trunk.position.y = 0.01;
      t.add(trunk); t.add(cone);
      t.scale.setScalar(1.45); // larger, more prominent trees
      orientOnSphere(t, u, eastTangent(u), gr - 0.008);
      g.add(t);
      sway.push({ node: cone, phase: Math.random() * Math.PI * 2, amp: 0.04 + Math.random() * 0.04 });
      count++;
    }
  }
  return { trees: g, sway };
}

/* Low-poly mountain massifs with snow caps. */
function buildMountains(ground) {
  const g = new THREE.Group();
  const mRock = new THREE.MeshStandardMaterial({ color: C.rock, flatShading: true, roughness: 1 });
  const mRock2 = new THREE.MeshStandardMaterial({ color: C.rockDark, flatShading: true, roughness: 1 });
  const mSnow = new THREE.MeshStandardMaterial({ color: 0xf6f9fc, flatShading: true });
  let placed = 0, guard = 0;
  while (placed < 7 && guard++ < 400) {
    const lat = -50 + Math.random() * 100;
    const lng = -180 + Math.random() * 360;
    if (sampleMap(lat, lng) !== 1) continue;
    const u = latLngToVec(lat, lng, 1);
    const gr = ground(u);
    if (gr < 1.028) continue; // on the raised land only, not ice or sea
    const m = new THREE.Group();
    const h = 0.12 + Math.random() * 0.07;
    const peak = new THREE.Mesh(new THREE.ConeGeometry(0.05 + Math.random() * 0.02, h, 5), mRock);
    peak.position.y = h * 0.5; m.add(peak);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.02, h * 0.3, 5), mSnow);
    cap.position.y = h * 0.88; m.add(cap);
    const side = new THREE.Mesh(new THREE.ConeGeometry(0.035, h * 0.6, 5), mRock2);
    side.position.set(0.04, h * 0.28, 0.015); m.add(side);
    m.rotation.y = Math.random() * Math.PI;
    const keep = m.rotation.y; // orientOnSphere overwrites quaternion; bake spin into children
    m.rotation.y = 0;
    m.children.forEach((c) => c.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), keep));
    m.scale.setScalar(1.4); // taller, bolder massifs
    orientOnSphere(m, u, eastTangent(u), gr - 0.01);
    g.add(m);
    placed++;
  }
  return g;
}

/* ---------- Landmarks (approximate coordinates, exaggerated scale) ---------- */
function lmMat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, ...extra });
}
function buildLandmarkModel(kind) {
  const g = new THREE.Group();
  const white = lmMat(0xf6f3ec), red = lmMat(0xd8402e), sand = lmMat(0xd9c07e),
    bronze = lmMat(0x9a6a4a), teal = lmMat(0x5fb8a5), gold = lmMat(0xe8c766), grey = lmMat(0xb9c2cc);
  const box = (w, h, d, m, x, y, z) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z); g.add(b); return b;
  };
  const cone = (r, h, seg, m, x, y, z, rz = 0, rx = 0) => {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), m);
    c.position.set(x, y, z); c.rotation.z = rz; c.rotation.x = rx; g.add(c); return c;
  };
  const cyl = (r1, r2, h, seg, m, x, y, z) => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m);
    c.position.set(x, y, z); g.add(c); return c;
  };
  switch (kind) {
    case "eiffel":
      cone(0.026, 0.07, 4, bronze, 0, 0.035, 0);
      box(0.03, 0.006, 0.03, bronze, 0, 0.03, 0);
      cone(0.006, 0.02, 4, bronze, 0, 0.078, 0);
      break;
    case "opera":
      box(0.05, 0.008, 0.03, white, 0, 0.004, 0);
      cone(0.014, 0.026, 4, white, -0.014, 0.02, 0, 0, -0.5);
      cone(0.016, 0.03, 4, white, 0.004, 0.022, 0, 0, -0.5);
      cone(0.012, 0.022, 4, white, 0.02, 0.018, 0, 0, -0.5);
      break;
    case "liberty":
      cyl(0.012, 0.016, 0.016, 6, grey, 0, 0.008, 0);
      cone(0.009, 0.04, 6, teal, 0, 0.04, 0);
      cyl(0.002, 0.002, 0.024, 5, teal, 0.008, 0.062, 0);
      cone(0.005, 0.008, 5, gold, 0.008, 0.078, 0);
      break;
    case "bigben":
      box(0.014, 0.055, 0.014, sand, 0, 0.028, 0);
      box(0.016, 0.01, 0.016, white, 0, 0.048, 0);
      cone(0.011, 0.02, 4, gold, 0, 0.066, 0);
      break;
    case "pyramids":
      cone(0.024, 0.028, 4, sand, -0.014, 0.014, 0);
      cone(0.017, 0.02, 4, sand, 0.016, 0.01, 0.008);
      cone(0.011, 0.013, 4, sand, 0.002, 0.007, -0.02);
      break;
    case "torii":
      cyl(0.003, 0.003, 0.04, 5, red, -0.014, 0.02, 0);
      cyl(0.003, 0.003, 0.04, 5, red, 0.014, 0.02, 0);
      box(0.05, 0.006, 0.008, red, 0, 0.042, 0);
      box(0.036, 0.005, 0.006, red, 0, 0.032, 0);
      break;
    case "christ":
      cone(0.014, 0.02, 5, grey, 0, 0.01, 0);
      box(0.006, 0.034, 0.006, white, 0, 0.036, 0);
      box(0.034, 0.005, 0.006, white, 0, 0.046, 0);
      break;
    case "mbs":
      box(0.009, 0.045, 0.012, white, -0.016, 0.022, 0);
      box(0.009, 0.045, 0.012, white, 0, 0.022, 0);
      box(0.009, 0.045, 0.012, white, 0.016, 0.022, 0);
      box(0.052, 0.006, 0.016, teal, 0, 0.048, 0);
      break;
    case "goldengate":
      box(0.006, 0.05, 0.006, red, -0.02, 0.025, 0);
      box(0.006, 0.05, 0.006, red, 0.02, 0.025, 0);
      box(0.062, 0.004, 0.008, red, 0, 0.024, 0);
      break;
    case "burj":
      cyl(0.011, 0.014, 0.024, 6, grey, 0, 0.012, 0);
      cyl(0.007, 0.01, 0.026, 6, grey, 0, 0.036, 0);
      cyl(0.0016, 0.004, 0.03, 6, grey, 0, 0.062, 0);
      break;
    case "taj": {
      box(0.036, 0.016, 0.024, white, 0, 0.008, 0);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 5), white);
      dome.position.set(0, 0.024, 0); g.add(dome);
      cone(0.004, 0.008, 5, gold, 0, 0.038, 0);
      [[-0.022, 0.016], [0.022, 0.016], [-0.022, -0.016], [0.022, -0.016]].forEach(([x, z]) =>
        cyl(0.0025, 0.0025, 0.03, 5, white, x, 0.015, z));
      break;
    }
    default:
      break;
  }
  return g;
}
const LANDMARKS = [
  ["Eiffel Tower", "eiffel", 48.858, 2.294],
  ["Sydney Opera House", "opera", -33.857, 151.215],
  ["Statue of Liberty", "liberty", 40.689, -74.045],
  ["Big Ben", "bigben", 51.5, -0.125],
  ["Pyramids of Giza", "pyramids", 29.979, 31.134],
  ["Itsukushima Torii", "torii", 34.296, 132.32],
  ["Christ the Redeemer", "christ", -22.952, -43.21],
  ["Marina Bay Sands", "mbs", 1.283, 103.86],
  ["Golden Gate Bridge", "goldengate", 37.82, -122.478],
  ["Burj Khalifa", "burj", 25.197, 55.274],
  ["Taj Mahal", "taj", 27.175, 78.042],
];
function buildLandmarks(ground) {
  const g = new THREE.Group();
  for (const [name, kind, lat, lng] of LANDMARKS) {
    const m = buildLandmarkModel(kind);
    m.scale.setScalar(3.4); // exaggerated, they should be seen from orbit
    const u = latLngToVec(lat, lng, 1);
    orientOnSphere(m, u, eastTangent(u), ground(u) - 0.012);
    m.userData.label = name;
    m.userData.baseScale = 3.4;
    m.traverse((o) => (o.userData.rootLm = m));
    g.add(m);
  }
  return g;
}

function buildCar() {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const S = 0.085;
  const mBody = new THREE.MeshStandardMaterial({ color: C.cherry, flatShading: true, roughness: 0.6 });
  const mCream = new THREE.MeshStandardMaterial({ color: C.cream, flatShading: true, roughness: 0.7 });
  const mGlass = new THREE.MeshStandardMaterial({ color: 0x9cc8e8, flatShading: true, roughness: 0.3 });
  const mDark = new THREE.MeshStandardMaterial({ color: C.wheel, flatShading: true, roughness: 0.8 });
  const mWood = new THREE.MeshStandardMaterial({ color: C.wood, flatShading: true, roughness: 0.8 });
  const mLight = new THREE.MeshStandardMaterial({ color: 0xffe8a3, emissive: 0xffd766, emissiveIntensity: 0.5 });

  const mk = (geo, mat, x, y, z, parent = body) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m;
  };
  mk(new THREE.BoxGeometry(1.5, 0.55, 2.6), mBody, 0, 0.62, 0);
  mk(new THREE.BoxGeometry(1.44, 0.16, 0.7), mBody, 0, 0.97, 0.92);
  mk(new THREE.BoxGeometry(1.3, 0.62, 1.35), mCream, 0, 1.18, -0.25);
  mk(new THREE.BoxGeometry(1.2, 0.4, 1.42), mGlass, 0, 1.16, -0.25);
  mk(new THREE.BoxGeometry(0.9, 0.28, 0.9), mWood, 0, 1.62, -0.3);
  mk(new THREE.BoxGeometry(0.94, 0.3, 0.16), mDark, 0, 1.62, -0.3);
  mk(new THREE.BoxGeometry(0.22, 0.18, 0.1), mLight, -0.5, 0.66, 1.32);
  mk(new THREE.BoxGeometry(0.22, 0.18, 0.1), mLight, 0.5, 0.66, 1.32);
  mk(new THREE.BoxGeometry(0.1, 0.08, 0.14), mDark, -0.45, 0.32, -1.34);
  const wheels = [];
  const wGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 8);
  const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.26, 8);
  const spokeGeo = new THREE.BoxGeometry(0.5, 0.27, 0.08);
  [[-0.72, 0.86], [0.72, 0.86], [-0.72, -0.86], [0.72, -0.86]].forEach(([x, z]) => {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(wGeo, mDark));
    w.add(new THREE.Mesh(hubGeo, mCream));
    w.add(new THREE.Mesh(spokeGeo, mCream));
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.34, z);
    g.add(w); wheels.push(w);
  });
  g.scale.setScalar(S);
  return { car: g, carBody: body, wheels, headlightMat: mLight, carScale: S };
}

/* ---- 2D map-pin marker: flat, camera-facing, with a pulsing glow halo ---- */
let _pinTex = null, _glowTex = null;
function pinTexture() {
  if (_pinTex) return _pinTex;
  const S = 256, cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d");
  const cx = S / 2, r = S * 0.26, ty = S * 0.36;
  const teardrop = () => {
    ctx.beginPath();
    ctx.arc(cx, ty, r, Math.PI * 0.86, Math.PI * 0.14, false);
    ctx.lineTo(cx, S * 0.92);
    ctx.closePath();
  };
  // 1) bold white keyline around the whole silhouette → reads on any background
  ctx.lineJoin = "round";
  teardrop();
  ctx.lineWidth = S * 0.09;
  ctx.strokeStyle = "#fdfbf6";
  ctx.shadowColor = "rgba(20,32,54,0.45)";
  ctx.shadowBlur = S * 0.05; ctx.shadowOffsetY = S * 0.02;
  ctx.stroke();
  ctx.shadowColor = "transparent";
  // 2) red body
  teardrop();
  ctx.fillStyle = "#e0523f";
  ctx.fill();
  // 3) inner white hole
  ctx.beginPath(); ctx.arc(cx, ty, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = "#fdfbf6"; ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  _pinTex = tex;
  return tex;
}
function glowTexture() {
  if (_glowTex) return _glowTex;
  const S = 128, cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d");
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.3, "rgba(255,208,140,0.7)");
  g.addColorStop(0.6, "rgba(224,82,63,0.4)");
  g.addColorStop(1, "rgba(224,82,63,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  _glowTex = tex;
  return tex;
}
function buildMarker() {
  const g = new THREE.Group();

  // Glow disc lies flat ON the surface (local XZ plane), radiating outward.
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({
      map: glowTexture(), transparent: true, opacity: 0.7,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
  );
  glow.rotation.x = -Math.PI / 2; // lay it down on the ground plane
  glow.position.y = 0.004;
  g.add(glow);

  // Pin stands UP along the local +Y (surface normal). Crossed planes keep it
  // visible from every horizontal angle while staying perpendicular to the globe.
  const pinMat = new THREE.MeshBasicMaterial({
    map: pinTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const geoA = new THREE.PlaneGeometry(0.19, 0.19);
  geoA.translate(0, 0.095, 0); // tip at the origin (surface), body above
  const planeA = new THREE.Mesh(geoA, pinMat);
  const planeB = new THREE.Mesh(geoA.clone(), pinMat);
  planeB.rotation.y = Math.PI / 2;
  const pin = new THREE.Group();
  pin.add(planeA); pin.add(planeB);
  g.add(pin);

  g.userData.glow = glow;
  g.userData.pin = pin;
  g.renderOrder = 10;
  return g;
}

function buildCloud() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.92, roughness: 1 });
  const n = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) {
    const s = 0.06 + Math.random() * 0.06;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), m);
    b.scale.y = 0.55;
    b.position.set((i - n / 2) * s * 1.4, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.04);
    g.add(b);
  }
  return g;
}

/* ---------- Polaroid texture ---------- */
function makePolaroidTexture(dataUrl, label) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = 256; cv.height = 300;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#fdfbf6";
      ctx.fillRect(0, 0, 256, 300);
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 14, 14, 228, 228);
      ctx.fillStyle = "#22395b";
      ctx.font = "600 22px 'Fredoka', 'Nunito', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label.length > 18 ? label.slice(0, 17) + "…" : label, 128, 278);
      const tex = new THREE.CanvasTexture(cv);
      tex.anisotropy = 4;
      resolve(tex);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function compressImage(file, maxDim = 720, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const sc = Math.min(1, maxDim / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * sc);
        cv.height = Math.round(img.height * sc);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}



/* ================================================================== */

export default function PolyPlanet() {
  const rootRef = useRef(null);
  const mountRef = useRef(null);
  const glowRef = useRef(null);
  const three = useRef({});
  const driveRef = useRef(null);
  const followRef = useRef(true);
  const lastTouchRef = useRef(Date.now());
  const reducedMotion = useRef(false);
  const timeRef = useRef(0.2);
  const popoutRef = useRef(null);
  const photosRef = useRef({});
  const hopRef = useRef(0); // squash-and-stretch timer for the car

  const [trips, setTrips] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [sugs, setSugs] = useState([]);
  const [driving, setDriving] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [photos, setPhotos] = useState({});
  const [popTrip, setPopTrip] = useState(null);
  const [toast, setToast] = useState(null);
  const [persistErr, setPersistErr] = useState(false);
  const [placeInfo, setPlaceInfo] = useState({}); // tripId -> {wx, wiki, loading, status}
  const fileRef = useRef(null);
  const toastTimer = useRef(null);
  const tripsRef = useRef(trips);
  tripsRef.current = trips;

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const saveTrips = useCallback(async (next) => {
    setTrips(next);
    const ok = await stSet("trips", JSON.stringify(next));
    if (!ok) setPersistErr(true);
  }, []);

  const cachePhoto = useCallback((pid, data) => {
    photosRef.current = { ...photosRef.current, [pid]: data };
    setPhotos(photosRef.current);
  }, []);

  const loadPhoto = useCallback(async (pid) => {
    if (photosRef.current[pid]) return photosRef.current[pid];
    const v = await stGet(`photo:${pid}`);
    if (v) cachePhoto(pid, v);
    return v;
  }, [cachePhoto]);

  /* ---------- popout polaroids ---------- */
  const closePopout = useCallback(() => {
    const p = popoutRef.current;
    if (!p) return;
    p.items.forEach((it) => {
      if (it.mesh.material.map) it.mesh.material.map.dispose();
      it.mesh.material.dispose(); it.mesh.geometry.dispose();
      if (it.line) { it.line.geometry.dispose(); it.line.material.dispose(); }
    });
    p.group.parent && p.group.parent.remove(p.group);
    popoutRef.current = null;
    setPopTrip(null);
  }, []);

  const openPopout = useCallback(async (trip) => {
    closePopout();
    const { globe, ground } = three.current;
    if (!globe) return;
    const pids = trip.photoIds.slice(0, 8);
    if (!pids.length) {
      setSelectedId(trip.id); setPanelOpen(true);
      return;
    }
    setPopTrip({ id: trip.id, name: trip.name, ts: trip.ts, count: trip.photoIds.length });
    const datas = [];
    for (const pid of pids) {
      const d = await loadPhoto(pid);
      if (d) datas.push(d);
    }
    if (popoutRef.current || !datas.length) return;
    const group = new THREE.Group();
    globe.add(group);
    const u = latLngToVec(trip.lat, trip.lng, 1);
    const { up, fwd, right } = sphereBasis(u);
    const baseR = ground(u);
    const anchor = up.clone().multiplyScalar(baseR + 0.06);
    const items = [];
    const now = performance.now();
    for (let i = 0; i < datas.length; i++) {
      const tex = await makePolaroidTexture(datas[i], trip.name);
      if (!tex) continue;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.14, 0.164),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
      );
      const theta = (i / datas.length) * Math.PI * 2 + 0.5;
      const dist = 0.16 + (i % 2) * 0.07;
      const h = 0.18 + (i % 3) * 0.035;
      const pos = up.clone().multiplyScalar(baseR + h)
        .add(right.clone().multiplyScalar(Math.cos(theta) * dist))
        .add(fwd.clone().multiplyScalar(Math.sin(theta) * dist));
      mesh.position.copy(pos);
      mesh.scale.setScalar(0.001);
      mesh.userData.popTripId = trip.id;
      group.add(mesh);
      const lineGeo = new THREE.BufferGeometry().setFromPoints([anchor, pos]);
      const line = new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({ color: 0xfdfbf6, transparent: true, opacity: 0.7 })
      );
      group.add(line);
      items.push({
        mesh, line, spawn: now + i * 110,
        basePos: pos.clone(), upDir: up.clone(),
        phase: Math.random() * Math.PI * 2,
      });
    }
    popoutRef.current = { tripId: trip.id, group, items };
  }, [closePopout, loadPhoto]);

  /* ---------- three.js scene ---------- */
  useEffect(() => {
    reducedMotion.current =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const mount = mountRef.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.55, 3.3);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xeaf4ff, 0xcfe0d0, 0.95);
    scene.add(hemi);
    const sunLight = new THREE.DirectionalLight(0xfff6e8, 1.0);
    sunLight.position.set(4, 6, 5);
    scene.add(sunLight);

    const globe = new THREE.Group();
    scene.add(globe);
    const globeMesh = buildGlobe();
    globe.add(globeMesh);
    globe.updateMatrixWorld(true);

    /* ground(): raycast the actual chunky terrain so props sit ON it */
    const gRay = new THREE.Raycaster();
    const ground = (uLocal) => {
      globe.updateMatrixWorld(true);
      const o = uLocal.clone().normalize();
      const originW = o.clone().multiplyScalar(2).applyQuaternion(globe.quaternion);
      const dirW = o.clone().negate().applyQuaternion(globe.quaternion);
      gRay.set(originW, dirW);
      const hit = gRay.intersectObject(globeMesh, false);
      return hit.length ? 2 - hit[0].distance : surfaceREstimate(o);
    };

    const { trees, sway } = buildTrees(ground);
    globe.add(trees);
    globe.add(buildMountains(ground));
    const landmarks = buildLandmarks(ground);
    globe.add(landmarks);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.12, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, side: THREE.BackSide })
    );
    globe.add(halo);

    const { car, carBody, wheels, headlightMat, carScale } = buildCar();
    globe.add(car);

    const markers = new THREE.Group();
    const routes = new THREE.Group();
    globe.add(markers); globe.add(routes);

    const clouds = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const c = buildCloud();
      const u = latLngToVec(-60 + Math.random() * 120, -180 + Math.random() * 360, 1);
      orientOnSphere(c, u, eastTangent(u), 1.42 + Math.random() * 0.14);
      c.userData.axis = new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize();
      c.userData.speed = 0.02 + Math.random() * 0.03;
      clouds.add(c);
    }
    globe.add(clouds); // ride along with the planet, plus their own gentle drift

    // Sky group rides with the globe, so sun / moon / stars keep their
    // relative positions when the planet is turned. Day/night is layered on
    // top as the sun & moon's own animated orbit within this group.
    const sky = new THREE.Group();
    globe.add(sky);

    const sunMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18, 1),
      new THREE.MeshStandardMaterial({ color: 0xf7ef82, emissive: 0xf5e96b, emissiveIntensity: 0.7, flatShading: true })
    );
    const moonMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.12, 1),
      new THREE.MeshStandardMaterial({ color: 0xdfe7f2, emissive: 0xaebfd8, emissiveIntensity: 0.35, flatShading: true })
    );
    sky.add(sunMesh); sky.add(moonMesh);

    const starPts = [];
    for (let i = 0; i < 260; i++) {
      const uu = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(1 - uu * uu);
      const v = new THREE.Vector3(rr * Math.cos(th), uu, rr * Math.sin(th)).multiplyScalar(8);
      starPts.push(v.x, v.y, v.z);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPts, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0, depthWrite: false })
    );
    sky.add(stars);

    const puffGeo = new THREE.IcosahedronGeometry(1, 0);
    const puffs = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(
        puffGeo,
        new THREE.MeshBasicMaterial({ color: 0xf4f2ee, transparent: true, opacity: 0 })
      );
      m.visible = false;
      globe.add(m);
      puffs.push({ mesh: m, born: 0, active: false, dir: new THREE.Vector3() });
    }
    let lastPuff = 0;

    Object.assign(three.current, {
      scene, camera, renderer, globe, globeMesh, ground, car, carBody, wheels,
      markers, routes, mount, landmarks, carScale,
    });

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    /* --- interaction --- */
    const pointers = new Map();
    let dragDist = 0, pinchD0 = 0;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const clampZoom = () => {
      const len = camera.position.length();
      const cl = THREE.MathUtils.clamp(len, 2.0, 5.6);
      camera.position.multiplyScalar(cl / len);
    };
    const onDown = (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragDist = 0;
      lastTouchRef.current = Date.now();
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchD0 = Math.hypot(a.x - b.x, a.y - b.y);
      }
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e) => {
      if (!pointers.has(e.pointerId)) return;
      const p = pointers.get(e.pointerId);
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastTouchRef.current = Date.now();
      if (pointers.size === 1) {
        dragDist += Math.abs(dx) + Math.abs(dy);
        if (dragDist > 6) followRef.current = false;
        const s = 0.0055;
        globe.quaternion
          .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * s))
          .premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * s));
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchD0 > 0) {
          camera.position.multiplyScalar(THREE.MathUtils.clamp(pinchD0 / d, 0.97, 1.03));
          clampZoom();
        }
        pinchD0 = d;
      }
    };
    const onUp = (e) => {
      pointers.delete(e.pointerId);
      if (dragDist >= 6) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (popoutRef.current) {
        const hitP = ray.intersectObjects(popoutRef.current.items.map((i) => i.mesh), false);
        if (hitP.length) {
          const id = hitP[0].object.userData.popTripId;
          setSelectedId(id); setPanelOpen(true);
          return;
        }
      }
      const hitM = ray.intersectObjects(markers.children, true);
      if (hitM.length) {
        let o = hitM[0].object;
        while (o && !o.userData.tripId) o = o.parent;
        if (o && o.userData.tripId) {
          o.userData.bounce = performance.now();
          const trip = tripsRef.current.find((t) => t.id === o.userData.tripId);
          if (trip) {
            if (popoutRef.current && popoutRef.current.tripId === trip.id) {
              setSelectedId(trip.id); setPanelOpen(true);
            } else {
              openPopout(trip);
            }
          }
          return;
        }
      }
      const hitL = ray.intersectObjects(landmarks.children, true);
      if (hitL.length && hitL[0].object.userData.rootLm) {
        const lm = hitL[0].object.userData.rootLm;
        lm.userData.bounce = performance.now();
        showToast(lm.userData.label);
        return;
      }
      closePopout();
    };
    const onWheel = (e) => {
      e.preventDefault();
      camera.position.multiplyScalar(1 + Math.sign(e.deltaY) * 0.06);
      clampZoom();
      lastTouchRef.current = Date.now();
    };
    const el = renderer.domElement;
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    /* --- animation loop --- */
    const clock = new THREE.Clock();
    let raf;
    const front = new THREE.Vector3(0, 0.3, 1).normalize();
    const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
    const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), rollQ = new THREE.Quaternion();
    const wobX = new THREE.Vector3(1, 0, 0), wobZ = new THREE.Vector3(0, 0, 1);
    const camQ = new THREE.Quaternion(), invQ = new THREE.Quaternion();
    const skyEase = { a: "", b: "" };

    const emitPuff = (now) => {
      const p = puffs.find((x) => !x.active);
      if (!p) return;
      const tail = new THREE.Vector3(-0.45, 0.35, -1.5);
      car.localToWorld(tail);
      globe.worldToLocal(tail);
      p.mesh.position.copy(tail);
      p.dir.copy(tail).normalize().multiplyScalar(0.012);
      p.born = now; p.active = true;
      p.mesh.visible = true;
      p.mesh.scale.setScalar(0.006);
      p.mesh.material.opacity = 0.55;
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      const now = performance.now();
      const isDriving = !!driveRef.current;

      if (!reducedMotion.current) {
        timeRef.current = (timeRef.current + dt * (isDriving ? 0.045 : 0.0015)) % 1;
      }
      const t = timeRef.current;
      const n = nightness(t);
      const [ca, cb, cc] = skyAt(t);
      if (rootRef.current && (skyEase.a !== ca || skyEase.b !== cb)) {
        skyEase.a = ca; skyEase.b = cb;
        rootRef.current.style.setProperty("--sky-a", ca);
        rootRef.current.style.setProperty("--sky-b", cb);
        rootRef.current.style.setProperty("--sky-c", cc);
        rootRef.current.style.setProperty("--title-ink", n > 0.5 ? "#edf2fa" : "#22395b");
      }
      if (glowRef.current) glowRef.current.style.opacity = String(1 - n * 0.75);
      hemi.intensity = 0.95 - 0.68 * n;
      sunLight.intensity = 1.0 - 0.7 * n;
      sunLight.color.setHex(0xfff6e8).lerp(new THREE.Color(0x9fb4dd), n);
      stars.material.opacity = n * 0.9;
      halo.material.opacity = 0.02 + 0.06 * (1 - n);
      headlightMat.emissiveIntensity = 0.3 + 1.5 * n;
      const sunA = (t - 0.25) * Math.PI * 2;
      sunMesh.position.set(Math.sin(sunA) * 2.8, Math.cos(sunA) * 2.0, -1.2);
      moonMesh.position.set(-Math.sin(sunA) * 2.8, -Math.cos(sunA) * 2.0, -1.2);
      // directional light must follow the light source in WORLD space
      const activeLight = Math.cos(sunA) > -0.15 ? sunMesh : moonMesh;
      activeLight.getWorldPosition(sunLight.position);

      // clouds drift on their own axis, but in the globe's local frame so the
      // drift stays steady while the whole planet is turned by the user
      clouds.children.forEach((c) => c.rotateOnAxis(c.userData.axis, c.userData.speed * dt));

      /* trees sway gently — the whole planet feels alive */
      if (!reducedMotion.current) {
        for (const s of sway) s.node.rotation.z = Math.sin(now * 0.0018 + s.phase) * s.amp;
      }

      /* pins: elastic spawn / tap-bounce, plus a continuous pulsing glow */
      markers.children.forEach((m) => {
        let s = 1;
        if (m.userData.spawn) {
          const tt = Math.min(1, (now - m.userData.spawn) / 800);
          s = Math.max(0.02, easeOutElastic(tt));
          if (tt === 1) delete m.userData.spawn;
        } else if (m.userData.bounce) {
          const tt = Math.min(1, (now - m.userData.bounce) / 600);
          s = 1 + Math.sin(tt * Math.PI * 3) * (1 - tt) * 0.3;
          if (tt === 1) delete m.userData.bounce;
        }
        m.scale.setScalar(s);
        const glow = m.userData.glow;
        if (glow) {
          const ph = m.userData.pulse ?? (m.userData.pulse = Math.random() * Math.PI * 2);
          const p = reducedMotion.current ? 0.5 : 0.5 + 0.5 * Math.sin(now * 0.004 + ph); // breathe 0..1
          const daylight = 1 - n;                    // 1 = midday, 0 = midnight
          glow.scale.setScalar(1.0 + p * 0.55 + daylight * 0.25); // bigger halo by day
          glow.material.opacity = 0.5 + p * 0.4 + daylight * 0.35; // and stronger by day
        }
      });
      /* landmarks jiggle when tapped */
      landmarks.children.forEach((lm) => {
        if (lm.userData.bounce) {
          const tt = Math.min(1, (now - lm.userData.bounce) / 700);
          const b = lm.userData.baseScale;
          lm.scale.setScalar(b * (1 + Math.sin(tt * Math.PI * 3) * (1 - tt) * 0.3));
          if (tt === 1) { lm.scale.setScalar(b); delete lm.userData.bounce; }
        }
      });

      /* popout polaroids: elastic pop-in, bob + roll, billboard */
      if (popoutRef.current) {
        globe.getWorldQuaternion(invQ).invert();
        camera.getWorldQuaternion(camQ);
        tmpQ2.copy(invQ).multiply(camQ);
        popoutRef.current.items.forEach((it) => {
          const tt = clamp01((now - it.spawn) / 900);
          it.mesh.scale.setScalar(Math.max(0.001, easeOutElastic(tt)));
          it.mesh.position.copy(it.basePos)
            .addScaledVector(it.upDir, Math.sin(now * 0.0024 + it.phase) * 0.01);
          rollQ.setFromAxisAngle(wobZ, Math.sin(now * 0.0016 + it.phase) * 0.07);
          it.mesh.quaternion.copy(tmpQ2).multiply(rollQ);
        });
      }

      /* exhaust puffs */
      puffs.forEach((p) => {
        if (!p.active) return;
        const age = (now - p.born) / 1000;
        if (age > 1.1) { p.active = false; p.mesh.visible = false; return; }
        const k = age / 1.1;
        p.mesh.scale.setScalar(0.007 + k * 0.028);
        p.mesh.material.opacity = 0.55 * (1 - k);
        p.mesh.position.addScaledVector(p.dir, dt);
      });

      /* car squash-and-stretch hop (drive start + arrival) */
      const S = carScale;
      if (hopRef.current) {
        const tt = (now - hopRef.current) / 650;
        if (tt >= 1) { hopRef.current = 0; car.scale.setScalar(S); }
        else {
          const q = Math.sin(tt * Math.PI * 2.5) * (1 - tt) * 0.22;
          car.scale.set(S * (1 - q * 0.7), S * (1 + q), S * (1 - q * 0.7));
        }
      }

      const d = driveRef.current;
      if (d) {
        d.t += dt / d.dur;
        const tt = Math.min(1, d.t);
        const e = easeInOut(tt);
        slerpVec(d.a, d.b, e, tmpA).normalize();
        slerpVec(d.a, d.b, Math.min(1, e + 0.004), tmpB).normalize();
        const fwdV = tmpB.clone().sub(tmpA);
        const rad = ground(tmpA) + 0.028;
        orientOnSphere(car, tmpA, fwdV.lengthSq() > 1e-10 ? fwdV : eastTangent(tmpA), rad);
        const b = Math.abs(Math.sin(now * 0.02));
        carBody.position.y = b * 0.14;
        carBody.scale.set(1 + b * 0.05, 1 - b * 0.1, 1 + b * 0.05);
        tmpQ.setFromAxisAngle(wobX, Math.sin(now * 0.017) * 0.06);
        carBody.quaternion.copy(tmpQ);
        tmpQ.setFromAxisAngle(wobZ, Math.sin(now * 0.013 + 1) * 0.05);
        carBody.quaternion.multiply(tmpQ);
        wheels.forEach((w) => w.children.forEach((c) => (c.rotation.y -= dt * 16)));
        if (now - lastPuff > 110) { emitPuff(now); lastPuff = now; }
        if (followRef.current) {
          tmpQ.setFromUnitVectors(tmpA, front);
          globe.quaternion.slerp(tmpQ, 0.07);
        }
        if (tt >= 1) {
          driveRef.current = null;
          orientOnSphere(car, d.b, eastTangent(d.b), ground(d.b) + 0.028);
          carBody.position.y = 0;
          carBody.scale.set(1, 1, 1);
          carBody.quaternion.identity();
          hopRef.current = now; // landing bounce!
          d.done && d.done();
        }
      } else {
        const u = tmpA.copy(car.position).normalize();
        car.position.copy(u).multiplyScalar(ground(u) + 0.028);
        carBody.position.y = Math.sin(now * 0.0016) * 0.03 + 0.03;
        if (!reducedMotion.current && Date.now() - lastTouchRef.current > 5000 && !popoutRef.current) {
          globe.rotateY(dt * 0.05);
        }
      }

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      renderer.dispose();
      mount.removeChild(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- load saved trips ---------- */
  useEffect(() => {
    (async () => {
      const raw = await stGet("trips");
      let list = [];
      if (raw) { try { list = JSON.parse(raw) || []; } catch {} }
      setTrips(list);
      setLoaded(true);
      const { car, globe, ground } = three.current;
      list.forEach((t) => addMarkerFor(t, false));
      for (let i = 1; i < list.length; i++) addRouteArc(list[i - 1], list[i]);
      const home = list[list.length - 1] || { lat: 1.35, lng: 103.82 };
      const u = latLngToVec(home.lat, home.lng, 1);
      orientOnSphere(car, u, eastTangent(u), ground(u) + 0.028);
      globe.quaternion.copy(
        new THREE.Quaternion().setFromUnitVectors(u.normalize(), new THREE.Vector3(0, 0.3, 1).normalize())
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addMarkerFor = useCallback((trip, pop = true) => {
    const { markers, ground } = three.current;
    if (!markers) return;
    const m = buildMarker();
    const u = latLngToVec(trip.lat, trip.lng, 1);
    orientOnSphere(m, u, eastTangent(u), ground(u) - 0.006);
    m.userData.tripId = trip.id;
    if (pop) m.userData.spawn = performance.now();
    markers.add(m);
  }, []);

  const addRouteArc = useCallback((from, to) => {
    const { routes, ground } = three.current;
    if (!routes) return;
    const a = latLngToVec(from.lat, from.lng, 1), b = latLngToVec(to.lat, to.lng, 1);
    const pts = [];
    const tmp = new THREE.Vector3();
    for (let i = 0; i <= 48; i++) {
      slerpVec(a, b, i / 48, tmp).normalize();
      pts.push(tmp.clone().multiplyScalar(ground(tmp) + 0.012));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(
      geo,
      new THREE.LineDashedMaterial({ color: 0xfdfbf6, dashSize: 0.02, gapSize: 0.016, transparent: true, opacity: 0.85 })
    );
    line.computeLineDistances();
    routes.add(line);
    while (routes.children.length > 40) routes.remove(routes.children[0]);
  }, []);

  /* ---------- search ---------- */
  useEffect(() => {
    const q = input.trim();
    if (!q) { setSugs([]); return; }
    let cancelled = false;
    const localMatches = () => {
      const ql = q.toLowerCase(), starts = [], within = [];
      for (const c of CITIES) {
        const nm = c[0].toLowerCase();
        if (nm.startsWith(ql)) starts.push({ name: c[0], lat: c[1], lng: c[2], label: c[0] });
        else if (nm.includes(ql)) within.push({ name: c[0], lat: c[1], lng: c[2], label: c[0] });
      }
      return [...starts, ...within].slice(0, 6);
    };
    // show instant local hits first, then upgrade with live results
    setSugs(localMatches());
    const t = setTimeout(async () => {
      const results = await geoSearch(q, 6);
      if (cancelled) return;
      if (results && results.length) setSugs(results);
      else if (results === null) setSugs(localMatches()); // API down → keep local
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [input]);

  const resolveDestination = async (text) => {
    const q = text.trim();
    if (!q) return null;
    // raw coordinates
    const coord = q.match(/^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$/);
    if (coord) {
      const lat = parseFloat(coord[1]), lng = parseFloat(coord[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180)
        return { name: `${lat.toFixed(2)}, ${lng.toFixed(2)}`, lat, lng };
    }
    // live geocoding first
    const results = await geoSearch(q, 1);
    if (results && results.length) return results[0];
    // fallback to bundled atlas (covers offline / API-down)
    const ql = q.toLowerCase();
    const pick =
      CITIES.find((c) => c[0].toLowerCase() === ql) ||
      CITIES.find((c) => c[0].toLowerCase().startsWith(ql)) ||
      CITIES.find((c) => c[0].toLowerCase().includes(ql));
    return pick ? { name: pick[0], lat: pick[1], lng: pick[2], label: pick[0] } : null;
  };

  const goTo = useCallback((dest) => {
    if (!dest || driveRef.current) return;
    const { car } = three.current;
    setSugs([]); setInput(""); setPanelOpen(false); setSelectedId(null);
    closePopout();
    followRef.current = true;

    const a = car.position.clone().normalize();
    const b = latLngToVec(dest.lat, dest.lng, 1);
    const angle = a.angleTo(b);
    if (angle < 0.004) {
      const existing = tripsRef.current.find((t) => t.name === dest.name);
      if (existing) { setSelectedId(existing.id); setPanelOpen(true); }
      return;
    }
    const from = vecToLatLng(a);
    const dur = reducedMotion.current ? 0.01 : THREE.MathUtils.clamp(1.4 + (angle / Math.PI) * 6.5, 1.6, 8);
    setDriving(dest.name);
    hopRef.current = performance.now(); // launch bounce!
    driveRef.current = {
      a, b, t: 0, dur,
      done: () => {
        setDriving(null);
        const cur = tripsRef.current;
        const existing = cur.find((t) => t.name === dest.name);
        const kmLeg = haversineKm(from, dest);
        addRouteArc(from, dest);
        if (existing) {
          setSelectedId(existing.id); setPanelOpen(true);
          showToast(`Back in ${dest.name}.`);
          saveTrips(cur.map((t) => t.id === existing.id
            ? { ...t, revisits: (t.revisits || 0) + 1, km: (t.km || 0) + kmLeg } : t));
          return;
        }
        const trip = {
          id: uid(), name: dest.name, lat: dest.lat, lng: dest.lng,
          ts: Date.now(), note: "", photoIds: [], km: kmLeg,
          country: dest.country || "", region: dest.region || "",
          label: dest.label || dest.name,
        };
        saveTrips([...cur, trip]);
        addMarkerFor(trip);
        setSelectedId(trip.id);
        setPanelOpen(true);
        showToast(`Arrived in ${dest.name} — pin it with a snapshot.`);
      },
    };
  }, [saveTrips, addMarkerFor, addRouteArc, showToast, closePopout]);

  const handleGo = async () => {
    if (!input.trim() || driving) return;
    setDriving("…"); // brief resolving indicator
    const dest = await resolveDestination(input);
    if (!dest) {
      setDriving(null);
      showToast("Couldn't find that place — try another spelling, or paste coordinates like 48.85, 2.35");
      return;
    }
    setDriving(null);
    goTo(dest);
  };

  /* ---------- selected trip + photos ---------- */
  const selected = trips.find((t) => t.id === selectedId) || null;

  useEffect(() => {
    if (!selected) return;
    selected.photoIds.forEach((pid) => { loadPhoto(pid); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, trips]);

  // Live "context card": current weather + a Wikipedia blurb for the place.
  useEffect(() => {
    if (!selected) return;
    const id = selected.id;
    if (placeInfo[id] && (placeInfo[id].wx || placeInfo[id].status === "done")) return; // cached
    let cancelled = false;
    setPlaceInfo((p) => ({ ...p, [id]: { ...(p[id] || {}), loading: true } }));
    (async () => {
      const [wx, wiki] = await Promise.all([
        fetchWeather(selected.lat, selected.lng),
        fetchWiki(selected.label || selected.name),
      ]);
      if (cancelled) return;
      setPlaceInfo((p) => ({
        ...p,
        [id]: { wx, wiki, loading: false, status: "done" },
      }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const addSnapshots = async (files) => {
    if (!selected || !files || !files.length) return;
    const room = 12 - selected.photoIds.length;
    const list = [...files].slice(0, Math.max(0, room));
    if (!list.length) { showToast("This trip already holds 12 snapshots."); return; }
    closePopout();
    const newIds = [];
    for (const f of list) {
      try {
        const data = await compressImage(f);
        const pid = uid();
        const ok = await stSet(`photo:${pid}`, data);
        if (!ok) setPersistErr(true);
        cachePhoto(pid, data);
        newIds.push(pid);
      } catch {}
    }
    if (newIds.length) {
      saveTrips(trips.map((t) => t.id === selected.id
        ? { ...t, photoIds: [...t.photoIds, ...newIds] } : t));
    }
  };

  const removePhoto = (pid) => {
    if (!selected) return;
    stDel(`photo:${pid}`);
    closePopout();
    saveTrips(trips.map((t) => t.id === selected.id
      ? { ...t, photoIds: t.photoIds.filter((x) => x !== pid) } : t));
  };

  const saveNote = (val) => {
    if (!selected) return;
    saveTrips(trips.map((t) => (t.id === selected.id ? { ...t, note: val } : t)));
  };

  const deleteTrip = (trip) => {
    if (!window.confirm(`Remove ${trip.name} and its snapshots?`)) return;
    trip.photoIds.forEach((pid) => stDel(`photo:${pid}`));
    closePopout();
    const next = trips.filter((t) => t.id !== trip.id);
    saveTrips(next);
    setSelectedId(null);
    const { markers, routes } = three.current;
    [...markers.children].forEach((m) => markers.remove(m));
    [...routes.children].forEach((r) => routes.remove(r));
    next.forEach((t) => addMarkerFor(t, false));
    for (let i = 1; i < next.length; i++) addRouteArc(next[i - 1], next[i]);
  };

  const totalKm = Math.round(trips.reduce((s, t) => s + (t.km || 0), 0));
  const fmtDate = (ts) =>
    new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  /* ================================================================ */
  return (
    <div className="pp-root" ref={rootRef}>
      <style>{`
        /* Fonts are loaded via <link> in index.html so the request starts
           during HTML parse rather than waiting on React to inject this tag. */
        .pp-root {
          --sky-a:#dcebf8; --sky-b:#bcd7ee; --sky-c:#a8c9e6; --title-ink:#22395b;
          --ink:#22395b; --paper:#fdfbf6; --cherry:#e0523f; --cherry-dk:#c74331; --sea:#4c8ac4;
          --spring: cubic-bezier(.34,1.56,.64,1);
          --shadow: 0 10px 30px rgba(20,32,54,.16);
          position:relative; width:100%; height:100vh; min-height:560px; overflow:hidden;
          background: radial-gradient(120% 90% at 50% 30%, var(--sky-a) 0%, var(--sky-b) 70%, var(--sky-c) 100%);
          transition: background 1.2s linear;
          font-family:'Nunito', ui-rounded, 'Segoe UI', system-ui, sans-serif; color:var(--ink);
        }
        .pp-glow { position:absolute; left:50%; top:46%; width:min(76vmin,640px); height:min(76vmin,640px);
          transform:translate(-50%,-50%); border-radius:50%; pointer-events:none; transition:opacity 1.2s linear;
          background: radial-gradient(circle, rgba(255,255,255,.55) 0%, rgba(255,255,255,0) 62%); }
        .pp-canvas { position:absolute; inset:0; }
        .pp-canvas canvas { display:block; width:100%; height:100%; touch-action:none; cursor:grab; }
        .pp-canvas canvas:active { cursor:grabbing; }

        .pp-title { position:absolute; top:20px; left:24px; pointer-events:none; color:var(--title-ink);
          transition:color 1.2s linear; }
        .pp-title h1 { margin:0; font-family:'Fredoka', 'Nunito', ui-rounded, sans-serif; font-weight:600;
          font-size:clamp(24px,3.4vw,34px); letter-spacing:.5px; }
        .pp-title h1 .dot { color:var(--cherry); }
        .pp-title p { margin:2px 0 0; font-size:13px; font-weight:600; opacity:.7; }

        .pp-odo { position:absolute; top:24px; right:24px; background:var(--paper); border-radius:14px;
          padding:8px 14px; box-shadow:var(--shadow); font-weight:800; font-size:13px; display:flex; gap:14px; }
        .pp-odo span b { font-family:'Fredoka', sans-serif; font-weight:600; font-size:16px; display:block; line-height:1.1; }
        .pp-odo button { border:none; background:none; font:inherit; color:var(--ink); cursor:pointer; padding:0;
          font-weight:800; text-decoration:underline; text-underline-offset:3px; }

        .pp-ticket { position:absolute; left:50%; bottom:26px; transform:translateX(-50%);
          width:min(480px, calc(100% - 32px)); }
        .pp-ticket .bar { display:flex; gap:8px; background:var(--paper); border-radius:18px;
          padding:10px; box-shadow:var(--shadow); border:2px dashed rgba(34,57,91,.18); }
        .pp-ticket input { flex:1; min-width:0; border:none; outline:none; background:transparent;
          font:inherit; font-weight:700; font-size:16px; color:var(--ink); padding:6px 8px; }
        .pp-ticket input::placeholder { color:rgba(34,57,91,.4); }
        .pp-ticket button.go { border:none; border-radius:12px; background:var(--cherry); color:#fff;
          font-family:'Fredoka', sans-serif; font-weight:600; font-size:15px; padding:10px 18px; cursor:pointer;
          transition:transform .25s var(--spring), background .12s ease; }
        .pp-ticket button.go:hover { background:var(--cherry-dk); transform:translateY(-2px) scale(1.04); }
        .pp-ticket button.go:active { transform:translateY(0) scale(.96); }
        .pp-ticket button.go:disabled { opacity:.55; cursor:default; transform:none; }
        .pp-sugs { position:absolute; bottom:calc(100% + 8px); left:0; right:0; background:var(--paper);
          border-radius:14px; box-shadow:var(--shadow); overflow:hidden; animation:pp-pop2 .3s var(--spring); }
        .pp-sugs button { display:block; width:100%; text-align:left; border:none; background:none;
          padding:10px 16px; font:inherit; font-weight:700; color:var(--ink); cursor:pointer; }
        .pp-sugs button:hover { background:rgba(76,138,196,.12); }
        .pp-sugs small { font-weight:600; opacity:.5; margin-left:8px; }

        .pp-chip { position:absolute; left:20px; bottom:96px; background:var(--paper); border-radius:16px;
          box-shadow:var(--shadow); padding:12px 14px; max-width:240px; animation:pp-pop2 .4s var(--spring); }
        .pp-chip b { font-family:'Fredoka', sans-serif; font-weight:600; font-size:16px; display:block; }
        .pp-chip small { font-weight:700; opacity:.55; display:block; margin-bottom:8px; }
        .pp-chip .row { display:flex; gap:8px; }
        .pp-chip button { border:none; border-radius:10px; font:inherit; font-weight:800; font-size:12px;
          padding:7px 12px; cursor:pointer; transition:transform .25s var(--spring); }
        .pp-chip button:hover { transform:scale(1.06); }
        .pp-chip button:active { transform:scale(.94); }
        .pp-chip .open { background:var(--sea); color:#fff; }
        .pp-chip .dismiss { background:rgba(34,57,91,.08); color:var(--ink); }

        .pp-log { position:absolute; top:0; right:0; height:100%; width:min(360px, 92vw);
          background:var(--paper); box-shadow:-12px 0 40px rgba(20,32,54,.2);
          transform:translateX(105%); transition:transform .45s var(--spring); display:flex; flex-direction:column; }
        .pp-log.open { transform:translateX(0); }
        .pp-log header { padding:18px 20px 10px; display:flex; align-items:center; gap:10px; }
        .pp-log header h2 { margin:0; font-family:'Fredoka', sans-serif; font-weight:600; font-size:20px; flex:1; }
        .pp-log header .count { background:var(--sea); color:#fff; border-radius:999px; font-size:12px;
          font-weight:800; padding:3px 10px; }
        .pp-close { border:none; background:rgba(34,57,91,.08); color:var(--ink); border-radius:10px;
          width:32px; height:32px; font-size:16px; cursor:pointer; font-weight:800;
          transition:transform .25s var(--spring); }
        .pp-close:hover { transform:scale(1.1) rotate(90deg); }
        .pp-list { overflow-y:auto; padding:6px 14px 20px; flex:1; }
        .pp-trip { width:100%; text-align:left; border:none; background:#fff; border-radius:14px;
          padding:12px 14px; margin:8px 0; cursor:pointer; font:inherit; color:var(--ink);
          box-shadow:0 3px 10px rgba(34,57,91,.08); display:flex; align-items:center; gap:10px;
          transition:transform .25s var(--spring), box-shadow .2s ease; }
        .pp-trip:hover { box-shadow:0 6px 18px rgba(34,57,91,.16); transform:translateY(-2px) scale(1.015); }
        .pp-trip:active { transform:scale(.98); }
        .pp-trip .flag { width:10px; height:10px; border-radius:3px; background:var(--cherry); flex:none;
          transform:rotate(45deg); }
        .pp-trip b { font-size:15px; display:block; }
        .pp-trip small { font-weight:600; opacity:.55; }
        .pp-trip .n { margin-left:auto; font-weight:800; font-size:12px; opacity:.5; }
        .pp-empty { text-align:center; opacity:.6; font-weight:700; padding:40px 20px; line-height:1.5; }

        .pp-detail { padding:0 18px 20px; overflow-y:auto; flex:1; }
        .pp-back { border:none; background:none; color:var(--sea); font:inherit; font-weight:800;
          cursor:pointer; padding:6px 0; }
        .pp-detail h3 { margin:2px 0 0; font-family:'Fredoka', sans-serif; font-weight:600; font-size:24px; }
        .pp-detail .meta { font-size:13px; font-weight:700; opacity:.55; margin-bottom:12px; }
        .pp-live { background:#fff; border-radius:14px; padding:12px 14px; margin-bottom:14px;
          box-shadow:0 3px 10px rgba(34,57,91,.08); animation:pp-pop2 .3s var(--spring); }
        .pp-live-loading { color:var(--ink); opacity:.55; font-weight:700; font-size:13px; }
        .pp-wx { display:flex; align-items:center; gap:12px; }
        .pp-wx .ic { font-size:30px; line-height:1; }
        .pp-wx .tmp { font-family:'Fredoka', sans-serif; font-weight:600; font-size:26px; }
        .pp-wx .dsc { display:flex; flex-direction:column; font-weight:800; font-size:14px; color:var(--ink); }
        .pp-wx .dsc small { font-weight:700; opacity:.5; font-size:11px; margin-top:2px; }
        .pp-wiki { margin:10px 0 0; font-size:13px; font-weight:600; line-height:1.5; color:var(--ink); opacity:.85; }
        .pp-wiki a { color:var(--sea); font-weight:800; white-space:nowrap; text-decoration:none; }
        .pp-wiki a:hover { text-decoration:underline; }
        .pp-note { width:100%; box-sizing:border-box; border:2px solid rgba(34,57,91,.12); border-radius:12px;
          background:#fff; font:inherit; font-weight:600; font-size:14px; color:var(--ink); padding:10px 12px;
          resize:vertical; min-height:64px; }
        .pp-note:focus { outline:none; border-color:var(--sea); }
        .pp-shots { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:14px; }
        .pp-shot { position:relative; background:#fff; padding:6px 6px 20px; border-radius:6px;
          box-shadow:0 4px 12px rgba(34,57,91,.16); transform:rotate(var(--tilt));
          animation:pp-shot-in .5s var(--spring); transition:transform .3s var(--spring); }
        .pp-shot:hover { transform:rotate(0deg) scale(1.05); z-index:2; }
        .pp-shot img { width:100%; aspect-ratio:1; object-fit:cover; border-radius:3px; display:block; }
        .pp-shot button { position:absolute; top:-7px; right:-7px; border:none; background:var(--ink); color:#fff;
          width:22px; height:22px; border-radius:50%; cursor:pointer; font-size:11px; font-weight:800;
          transition:transform .25s var(--spring); }
        .pp-shot button:hover { transform:scale(1.2); }
        .pp-add { margin-top:14px; width:100%; border:2px dashed rgba(34,57,91,.25); background:none;
          border-radius:14px; padding:14px; font:inherit; font-weight:800; color:var(--sea); cursor:pointer;
          transition:transform .25s var(--spring), background .15s ease; }
        .pp-add:hover { background:rgba(76,138,196,.08); transform:scale(1.02); }
        .pp-add:active { transform:scale(.97); }
        .pp-danger { margin-top:16px; width:100%; border:none; background:none; color:var(--cherry-dk);
          font:inherit; font-weight:800; cursor:pointer; opacity:.8; }

        .pp-toast { position:absolute; left:50%; bottom:96px; transform:translateX(-50%);
          background:var(--ink); color:#fff; font-weight:700; font-size:14px; padding:10px 18px;
          border-radius:999px; box-shadow:var(--shadow); max-width:calc(100% - 40px); text-align:center;
          animation:pp-pop .4s var(--spring); z-index:5; }
        .pp-driving { position:absolute; top:76px; left:50%; transform:translateX(-50%);
          background:var(--paper); border-radius:999px; padding:8px 18px; font-weight:800; font-size:13px;
          box-shadow:var(--shadow); display:flex; gap:8px; align-items:center;
          animation:pp-pop3 .4s var(--spring); }
        .pp-driving .wheel { width:12px; height:12px; border:3px solid var(--cherry); border-radius:50%;
          border-top-color:transparent; animation:pp-spin .7s linear infinite; }
        .pp-persist { position:absolute; bottom:6px; left:50%; transform:translateX(-50%);
          font-size:11px; font-weight:700; opacity:.55; color:var(--title-ink); }
        @keyframes pp-pop { from { opacity:0; transform:translate(-50%,14px) scale(.8);} to { opacity:1; transform:translate(-50%,0) scale(1);} }
        @keyframes pp-pop2 { from { opacity:0; transform:translateY(14px) scale(.85);} to { opacity:1; transform:translateY(0) scale(1);} }
        @keyframes pp-pop3 { from { opacity:0; transform:translate(-50%,-10px) scale(.85);} to { opacity:1; transform:translate(-50%,0) scale(1);} }
        @keyframes pp-shot-in { from { opacity:0; transform:rotate(var(--tilt)) scale(.6);} to { opacity:1; transform:rotate(var(--tilt)) scale(1);} }
        @keyframes pp-spin { to { transform:rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          .pp-log { transition:none; }
          .pp-driving .wheel { animation:none; }
          .pp-root, .pp-title, .pp-glow { transition:none; }
          .pp-sugs, .pp-chip, .pp-toast, .pp-driving, .pp-shot { animation:none; }
          .pp-trip, .pp-shot, .pp-close, .pp-add, .pp-chip button, .pp-ticket button.go { transition:none; }
        }
        @media (max-width:640px) {
          .pp-title { left:16px; top:14px; }
          .pp-odo { top:auto; bottom:104px; right:12px; padding:6px 10px; gap:10px; }
          .pp-ticket { bottom:14px; }
          .pp-chip { bottom:160px; }
        }
        button:focus-visible, input:focus-visible, textarea:focus-visible, .pp-trip:focus-visible {
          outline:3px solid var(--sea); outline-offset:2px; }
      `}</style>

      <div className="pp-glow" ref={glowRef} />
      <div className="pp-canvas" ref={mountRef} />

      <div className="pp-title">
        <h1>Poly Planet<span className="dot">.</span></h1>
        <p>a tiny world of everywhere you've been</p>
      </div>

      <div className="pp-odo">
        <span><b>{trips.length}</b>places</span>
        <span><b>{totalKm.toLocaleString()}</b>km driven</span>
        <button onClick={() => { setPanelOpen(true); setSelectedId(null); }}>Travel log</button>
      </div>

      {driving && (
        <div className="pp-driving"><span className="wheel" />{driving === "…" ? "Finding place…" : `Driving to ${driving}…`}</div>
      )}

      {toast && <div className="pp-toast">{toast}</div>}

      {popTrip && !panelOpen && (
        <div className="pp-chip">
          <b>{popTrip.name}</b>
          <small>{fmtDate(popTrip.ts)} · {popTrip.count} snapshot{popTrip.count === 1 ? "" : "s"}</small>
          <div className="row">
            <button className="open" onClick={() => { setSelectedId(popTrip.id); setPanelOpen(true); }}>Open trip</button>
            <button className="dismiss" onClick={closePopout}>Dismiss</button>
          </div>
        </div>
      )}

      <div className="pp-ticket">
        {sugs.length > 0 && (
          <div className="pp-sugs">
            {sugs.map((c, i) => (
              <button key={`${c.name}-${i}`} onClick={() => goTo(c)}>
                {c.name}
                <small>{[c.region, c.country].filter(Boolean).join(", ") || `${c.lat.toFixed(1)}, ${c.lng.toFixed(1)}`}</small>
              </button>
            ))}
          </div>
        )}
        <div className="bar">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGo()}
            placeholder="Where to next?"
            aria-label="Destination"
          />
          <button className="go" onClick={handleGo} disabled={!!driving}>
            {driving ? "En route…" : "Drive there"}
          </button>
        </div>
      </div>

      <aside className={`pp-log ${panelOpen ? "open" : ""}`} aria-hidden={!panelOpen}>
        <header>
          <h2>{selected ? "Trip" : "Travel log"}</h2>
          {!selected && <span className="count">{trips.length}</span>}
          <button className="pp-close" onClick={() => { setPanelOpen(false); setSelectedId(null); }} aria-label="Close panel">×</button>
        </header>

        {!selected ? (
          <div className="pp-list">
            {loaded && trips.length === 0 && (
              <div className="pp-empty">No trips yet.<br />Type any place in the world below and hit Drive — the car handles the rest.</div>
            )}
            {[...trips].reverse().map((t) => (
              <button key={t.id} className="pp-trip" onClick={() => setSelectedId(t.id)}>
                <span className="flag" />
                <span><b>{t.name}</b><small>{fmtDate(t.ts)}</small></span>
                <span className="n">{t.photoIds.length > 0 ? `${t.photoIds.length} 📷` : ""}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="pp-detail">
            <button className="pp-back" onClick={() => setSelectedId(null)}>← All trips</button>
            <h3>{selected.name}</h3>
            <div className="meta">
              {fmtDate(selected.ts)} · {Math.round(selected.km || 0).toLocaleString()} km leg
              {selected.revisits ? ` · visited ${selected.revisits + 1}×` : ""}
              {(selected.region || selected.country)
                ? ` · ${[selected.region, selected.country].filter(Boolean).join(", ")}` : ""}
            </div>

            {(() => {
              const info = placeInfo[selected.id];
              if (!info || info.loading) return <div className="pp-live pp-live-loading">Fetching live info…</div>;
              const { wx, wiki } = info;
              if (!wx && !wiki) return null; // APIs unreachable → show nothing, app still works
              return (
                <div className="pp-live">
                  {wx && (
                    <div className="pp-wx">
                      <span className="ic">{wx.icon}</span>
                      <span className="tmp">{wx.temp}°C</span>
                      <span className="dsc">
                        {wx.desc}
                        <small>feels {wx.feels}° · wind {wx.wind} km/h · {localTimeAt(wx.tzOffset)} local</small>
                      </span>
                    </div>
                  )}
                  {wiki && (
                    <p className="pp-wiki">
                      {wiki.extract.length > 220 ? wiki.extract.slice(0, 217) + "…" : wiki.extract}
                      {wiki.url && <a href={wiki.url} target="_blank" rel="noreferrer"> Wikipedia ↗</a>}
                    </p>
                  )}
                </div>
              );
            })()}
            <textarea
              className="pp-note"
              defaultValue={selected.note}
              key={selected.id}
              placeholder="What do you remember about this place?"
              onBlur={(e) => saveNote(e.target.value)}
            />
            <div className="pp-shots">
              {selected.photoIds.map((pid, i) => (
                <div className="pp-shot" key={pid} style={{ "--tilt": `${(i % 2 ? 1 : -1) * (1 + (i % 3))}deg` }}>
                  {photos[pid]
                    ? <img src={photos[pid]} alt={`Snapshot from ${selected.name}`} />
                    : <div style={{ aspectRatio: "1", background: "#eef2f6", borderRadius: 3 }} />}
                  <button onClick={() => removePhoto(pid)} aria-label="Remove snapshot">×</button>
                </div>
              ))}
            </div>
            <button className="pp-add" onClick={() => fileRef.current && fileRef.current.click()}>
              + Add snapshots ({selected.photoIds.length}/12)
            </button>
            <input
              ref={fileRef} type="file" accept="image/*" multiple hidden
              onChange={(e) => { addSnapshots(e.target.files); e.target.value = ""; }}
            />
            <button className="pp-danger" onClick={() => deleteTrip(selected)}>Remove this trip</button>
          </div>
        )}
      </aside>

      {persistErr && <div className="pp-persist">Couldn't reach saved storage — changes live in this session only.</div>}
    </div>
  );
}
