// Corrective shapes from Corrective Smooth (delta mush), computed per body. Pure functions on typed
// arrays (no three.js) so they run in a worker and in tests.
//
// For one key pose: skin the rest mesh with CoR on the CPU (as the shader does), smooth it, re-add the rest
// mesh's detail in the smoothed surface's local frames (that's delta mush, i.e. Blender's Corrective
// Smooth), and take the difference from the plain skinned result. Rotated back into rest space by each
// vertex's CoR rotation, that difference is a morph target which, skinned, lands exactly on the smoothed
// result: CoR maps a rest-space offset d to R d.
// Chosen in Phase 0 (review/phase0/REPORT.md, section B: CoR + Corrective Smooth).

export interface Adjacency { offsets: Int32Array; nbrs: Int32Array }

/** Vertex neighbours from triangles (only vertices < n). */
export function adjacency(tris: Uint32Array, n: number): Adjacency {
  const sets: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    if (a >= n || b >= n || c >= n) continue;
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
  }
  const offsets = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + sets[i].size;
  const nbrs = new Int32Array(offsets[n]);
  for (let i = 0; i < n; i++) nbrs.set([...sets[i]], offsets[i]);
  return { offsets, nbrs };
}

export const SMOOTH = { iterations: 12, factor: 0.5 }; // as in the Phase 0 Blender comparison

/** Length-weighted Laplacian smoothing of the first n vertices (others copied). */
export function smooth(pos: Float32Array, adj: Adjacency, n: number, out: Float32Array, iters = SMOOTH.iterations, factor = SMOOTH.factor) {
  out.set(pos);
  const tmp = new Float32Array(n * 3);
  const { offsets, nbrs } = adj;
  for (let k = 0; k < iters; k++) {
    for (let i = 0; i < n; i++) {
      const px = out[i * 3], py = out[i * 3 + 1], pz = out[i * 3 + 2];
      let x = 0, y = 0, z = 0, ws = 0;
      for (let e = offsets[i]; e < offsets[i + 1]; e++) {
        const j = nbrs[e] * 3;
        const dx = out[j] - px, dy = out[j + 1] - py, dz = out[j + 2] - pz;
        const w = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6);
        x += out[j] * w; y += out[j + 1] * w; z += out[j + 2] * w; ws += w;
      }
      if (ws > 0) {
        tmp[i * 3] = px + factor * (x / ws - px);
        tmp[i * 3 + 1] = py + factor * (y / ws - py);
        tmp[i * 3 + 2] = pz + factor * (z / ws - pz);
      } else { tmp[i * 3] = px; tmp[i * 3 + 1] = py; tmp[i * 3 + 2] = pz; }
    }
    out.set(tmp);
  }
  return out;
}

/** Orthonormal frame per vertex (tangent, bitangent, normal; 9 floats): normal from adjacent triangles,
 *  tangent toward the vertex's first neighbour. Deterministic, so rest and posed frames correspond. */
export function frames(pos: Float32Array, tris: Uint32Array, adj: Adjacency, n: number, out = new Float32Array(n * 9)) {
  const nrm = new Float32Array(n * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    if (tris[t] >= n || tris[t + 1] >= n || tris[t + 2] >= n) continue;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { nrm[v] += nx; nrm[v + 1] += ny; nrm[v + 2] += nz; }
  }
  for (let i = 0; i < n; i++) {
    let nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const j = adj.offsets[i] < adj.offsets[i + 1] ? adj.nbrs[adj.offsets[i]] : i;
    let tx = pos[j * 3] - pos[i * 3], ty = pos[j * 3 + 1] - pos[i * 3 + 1], tz = pos[j * 3 + 2] - pos[i * 3 + 2];
    const d = tx * nx + ty * ny + tz * nz; tx -= d * nx; ty -= d * ny; tz -= d * nz;
    let tl = Math.hypot(tx, ty, tz);
    if (tl < 1e-9) { // degenerate: any perpendicular
      tx = Math.abs(nx) < 0.9 ? 0 : 1; ty = Math.abs(nx) < 0.9 ? -nz : 0; tz = Math.abs(nx) < 0.9 ? ny : -nx;
      tl = Math.hypot(tx, ty, tz);
    }
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    out.set([tx, ty, tz, bx, by, bz, nx, ny, nz], i * 9);
  }
  return out;
}

export interface RestPrep { local: Float32Array } // rest detail in the smoothed rest frames (3 per vertex)

/** Per body shape: the rest mesh's detail relative to its own smoothed surface. */
export function prepareRest(rest: Float32Array, tris: Uint32Array, adj: Adjacency, n: number): RestPrep {
  const s = smooth(rest, adj, n, new Float32Array(rest.length));
  const f = frames(s, tris, adj, n);
  const local = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const dx = rest[i * 3] - s[i * 3], dy = rest[i * 3 + 1] - s[i * 3 + 1], dz = rest[i * 3 + 2] - s[i * 3 + 2];
    for (let k = 0; k < 3; k++) local[i * 3 + k] = dx * f[i * 9 + k * 3] + dy * f[i * 9 + k * 3 + 1] + dz * f[i * 9 + k * 3 + 2];
  }
  return { local };
}

// ---------- CPU CoR skinning (matches corSkinning.ts) ----------
function matQuat(m: Float32Array, o: number, out: Float32Array, q: number) {
  // m is a column-major 4x4 at offset o; rotation part
  const m00 = m[o], m10 = m[o + 1], m20 = m[o + 2], m01 = m[o + 4], m11 = m[o + 5], m21 = m[o + 6], m02 = m[o + 8], m12 = m[o + 9], m22 = m[o + 10];
  const t = m00 + m11 + m22;
  let x, y, z, w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  out[q] = x; out[q + 1] = y; out[q + 2] = z; out[q + 3] = w;
}

/** Skin `rest` (first n vertices) with CoR. mats: B column-major 4x4 skinning matrices (bone world x
 *  inverse bind). Writes posed positions and each vertex's blended rotation quaternion (x,y,z,w). */
export function skinCoR(rest: Float32Array, n: number, skinIndex: Uint8Array, skinWeight: Float32Array, inf: number, cor: Float32Array,
  mats: Float32Array, posed: Float32Array, rots: Float32Array) {
  const B = mats.length / 16, bq = new Float32Array(B * 4);
  for (let b = 0; b < B; b++) matQuat(mats, b * 16, bq, b * 4);
  for (let i = 0; i < n; i++) {
    let qx = 0, qy = 0, qz = 0, qw = 0;
    const b0 = skinIndex[i * inf] * 4;
    let cx = 0, cy = 0, cz = 0;
    const px = cor[i * 3], py = cor[i * 3 + 1], pz = cor[i * 3 + 2];
    for (let k = 0; k < inf; k++) {
      const w = skinWeight[i * inf + k];
      if (w === 0) continue;
      const b = skinIndex[i * inf + k], q = b * 4, o = b * 16;
      const sgn = bq[q] * bq[b0] + bq[q + 1] * bq[b0 + 1] + bq[q + 2] * bq[b0 + 2] + bq[q + 3] * bq[b0 + 3] < 0 ? -w : w;
      qx += bq[q] * sgn; qy += bq[q + 1] * sgn; qz += bq[q + 2] * sgn; qw += bq[q + 3] * sgn;
      // LBS of the centre
      cx += w * (mats[o] * px + mats[o + 4] * py + mats[o + 8] * pz + mats[o + 12]);
      cy += w * (mats[o + 1] * px + mats[o + 5] * py + mats[o + 9] * pz + mats[o + 13]);
      cz += w * (mats[o + 2] * px + mats[o + 6] * py + mats[o + 10] * pz + mats[o + 14]);
    }
    const ql = Math.hypot(qx, qy, qz, qw) || 1; qx /= ql; qy /= ql; qz /= ql; qw /= ql;
    rots[i * 4] = qx; rots[i * 4 + 1] = qy; rots[i * 4 + 2] = qz; rots[i * 4 + 3] = qw;
    // R (v - c) + LBS(c)
    const vx = rest[i * 3] - px, vy = rest[i * 3 + 1] - py, vz = rest[i * 3 + 2] - pz;
    const [rx, ry, rz] = rotate(qx, qy, qz, qw, vx, vy, vz);
    posed[i * 3] = rx + cx; posed[i * 3 + 1] = ry + cy; posed[i * 3 + 2] = rz + cz;
  }
}

function rotate(x: number, y: number, z: number, w: number, vx: number, vy: number, vz: number): [number, number, number] {
  // v + 2w(q x v) + 2 q x (q x v)
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

export interface SparseDelta { indices: Uint32Array; deltas: Float32Array }

/** The corrective for one key pose: rest-space offsets that move the CoR-skinned mesh onto its
 *  Corrective-Smooth result. Offsets under `minLen` metres are dropped. */
export function corrective(posed: Float32Array, rots: Float32Array, prep: RestPrep, tris: Uint32Array, adj: Adjacency, n: number, minLen = 1e-4): SparseDelta {
  const s = smooth(posed, adj, n, new Float32Array(posed.length));
  const f = frames(s, tris, adj, n);
  const idx: number[] = [], out: number[] = [];
  for (let i = 0; i < n; i++) {
    const l0 = prep.local[i * 3], l1 = prep.local[i * 3 + 1], l2 = prep.local[i * 3 + 2];
    const fx = s[i * 3] + l0 * f[i * 9] + l1 * f[i * 9 + 3] + l2 * f[i * 9 + 6];
    const fy = s[i * 3 + 1] + l0 * f[i * 9 + 1] + l1 * f[i * 9 + 4] + l2 * f[i * 9 + 7];
    const fz = s[i * 3 + 2] + l0 * f[i * 9 + 2] + l1 * f[i * 9 + 5] + l2 * f[i * 9 + 8];
    const cx = fx - posed[i * 3], cy = fy - posed[i * 3 + 1], cz = fz - posed[i * 3 + 2];
    if (cx * cx + cy * cy + cz * cz < minLen * minLen) continue;
    // back into rest space: R^-1 c (conjugate quaternion)
    const [rx, ry, rz] = rotate(-rots[i * 4], -rots[i * 4 + 1], -rots[i * 4 + 2], rots[i * 4 + 3], cx, cy, cz);
    idx.push(i); out.push(rx, ry, rz);
  }
  return { indices: Uint32Array.from(idx), deltas: Float32Array.from(out) };
}

/** Area-weighted vertex normals of the first n vertices (3 per vertex). */
export function normals(pos: Float32Array, tris: Uint32Array, n: number, out = new Float32Array(n * 3)) {
  out.fill(0);
  for (let t = 0; t < tris.length; t += 3) {
    if (tris[t] >= n || tris[t + 1] >= n || tris[t + 2] >= n) continue;
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { out[v] += nx; out[v + 1] += ny; out[v + 2] += nz; }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]) || 1;
    out[i * 3] /= l; out[i * 3 + 1] /= l; out[i * 3 + 2] /= l;
  }
  return out;
}

export interface BakeInput {
  n: number; rest: Float32Array; tris: Uint32Array; skinIndex: Uint8Array; skinWeight: Float32Array; inf: number;
  cor: Float32Array; mats: Float32Array[];
}
export interface BakedKey { indices: Uint32Array; deltas: Float32Array; normalDeltas: Float32Array }

/** All keys for one body: position offsets plus the matching change in rest-space normals. */
export function bakeAll(inp: BakeInput, adj?: Adjacency): BakedKey[] {
  const { n, rest, tris } = inp;
  adj ??= adjacency(tris, n);
  const prep = prepareRest(rest, tris, adj, n);
  const n0 = normals(rest, tris, n);
  const posed = new Float32Array(rest.length), rots = new Float32Array((rest.length / 3) * 4);
  const moved = new Float32Array(rest.length), n1 = new Float32Array(n * 3);
  return inp.mats.map(m => {
    skinCoR(rest, n, inp.skinIndex, inp.skinWeight, inp.inf, inp.cor, m, posed, rots);
    const d = corrective(posed, rots, prep, tris, adj!, n);
    moved.set(rest);
    for (let k = 0; k < d.indices.length; k++) {
      const v = d.indices[k] * 3;
      moved[v] += d.deltas[k * 3]; moved[v + 1] += d.deltas[k * 3 + 1]; moved[v + 2] += d.deltas[k * 3 + 2];
    }
    normals(moved, tris, n, n1);
    const nd = new Float32Array(d.deltas.length);
    for (let k = 0; k < d.indices.length; k++) {
      const v = d.indices[k] * 3;
      nd[k * 3] = n1[v] - n0[v]; nd[k * 3 + 1] = n1[v + 1] - n0[v + 1]; nd[k * 3 + 2] = n1[v + 2] - n0[v + 2];
    }
    return { indices: d.indices, deltas: d.deltas, normalDeltas: nd };
  });
}
