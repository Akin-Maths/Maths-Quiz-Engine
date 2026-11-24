import React, { useState, useMemo, useCallback, useId, useEffect, useRef } from "react";
/* ---------- seeded RNG so a quiz is reproducible from its seed ---------- */
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seededInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const pm = (n, sym = "") => (n >= 0 ? `+ ${n}${sym}` : `- ${Math.abs(n)}${sym}`);
// Like pm(), but omits the term entirely when n is 0 (avoids ugly "+ 0" in
// equations/formulae where a zero constant should just not appear at all).
const pm0 = (n, sym = "") => (n === 0 ? "" : ` ${pm(n, sym)}`);
// Coefficient-of-x display that avoids "1x"/"-1x" (should read "x"/"-x").
const coefX = (m, sym = "x") => (m === 1 ? sym : m === -1 ? `-${sym}` : `${m}${sym}`);
const pmX = (n, sym) => `${n >= 0 ? "+" : "-"} ${coefX(Math.abs(n), sym)}`;
// Friendly labels for the V1/V2/V3 same-skills-fresh-numbers follow-up
// quizzes (feature 6) — used both on the version-switch buttons and on the
// printed page's version banner, so a teacher can tell handouts apart at a
// glance. Internal ids stay "V1"/"V2"/"V3" (encoded into quiz codes).
const VERSION_LABELS = { V1: "Version 1", V2: "Version 2", V3: "Version 3" };

function partitionFour(rng, total) {
  let a = seededInt(rng, 2, Math.floor(total * 0.35));
  let b = seededInt(rng, 2, Math.floor(total * 0.35));
  let both = seededInt(rng, 2, Math.floor(total * 0.2));
  let outside = total - a - b - both;
  if (outside < 1) outside = 1;
  return { aOnly: a, bOnly: b, both, outside };
}

const CONTEXTS = [
  { noun: "students", labelA: "Maths", labelB: "Science", verb: "like" },
  { noun: "students", labelA: "Football", labelB: "Tennis", verb: "play" },
  { noun: "customers", labelA: "Tea", labelB: "Coffee", verb: "drink" },
];

/* ---------- Venn diagram, redrawn with proper clipPath masking so
   shaded / filled regions are geometrically correct (no stray fills) ---------- */
function VennSVG({ labelA, labelB, values, shade }) {
  const uid = useId().replace(/:/g, "");
  const r = 52;
  const cx1 = 92;
  const cx2 = 148;
  const cy = 100;
  const boxPad = 14;
  const boxX = cx1 - r - boxPad - 20;
  const boxY = cy - r - boxPad - 16; // extra headroom for the A/B labels above the circles
  const boxW = cx2 - cx1 + 2 * r + 2 * boxPad + 40;
  const boxH = 2 * r + 2 * boxPad + 16;
  const viewW = boxX + boxW + 10;
  const viewH = boxY + boxH + 10;

  return (
    <svg viewBox={`0 0 ${viewW} ${viewH}`} width="100%" style={{ maxWidth: 260, display: "block" }}>
      <defs>
        <clipPath id={`clipA-${uid}`}><circle cx={cx1} cy={cy} r={r} /></clipPath>
        <clipPath id={`clipB-${uid}`}><circle cx={cx2} cy={cy} r={r} /></clipPath>
      </defs>

      <rect x={boxX} y={boxY} width={boxW} height={boxH} fill="none" stroke="#000" strokeWidth="1.2" />
      <text x={boxX + 5} y={boxY + 13} fontSize="11" fontFamily="Arial, sans-serif" fill="#000">e</text>

      {shade === "aOnly" && (
        <g clipPath={`url(#clipA-${uid})`}>
          <rect x={boxX} y={boxY} width={boxW} height={boxH} fill="#c9c9c9" />
          <circle cx={cx2} cy={cy} r={r} fill="#fff" />
        </g>
      )}
      {shade === "bOnly" && (
        <g clipPath={`url(#clipB-${uid})`}>
          <rect x={boxX} y={boxY} width={boxW} height={boxH} fill="#c9c9c9" />
          <circle cx={cx1} cy={cy} r={r} fill="#fff" />
        </g>
      )}

      <circle cx={cx1} cy={cy} r={r} fill="none" stroke="#000" strokeWidth="1.4" />
      <circle cx={cx2} cy={cy} r={r} fill="none" stroke="#000" strokeWidth="1.4" />

      <text x={cx1 - r * 0.75} y={cy - r - 6} fontSize="13" fontFamily="Arial, sans-serif" fontWeight="700" fill="#000">{labelA}</text>
      <text x={cx2 + r * 0.45} y={cy - r - 6} fontSize="13" fontFamily="Arial, sans-serif" fontWeight="700" fill="#000">{labelB}</text>

      {values && (
        <>
          <text x={cx1 - r * 0.55} y={cy + 5} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{values.aOnly}</text>
          <text x={(cx1 + cx2) / 2} y={cy + 5} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{values.both}</text>
          <text x={cx2 + r * 0.55} y={cy + 5} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{values.bOnly}</text>
          <text x={(boxX + boxW / 2)} y={boxY + boxH - 8} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{values.outside}</text>
        </>
      )}
    </svg>
  );
}

function BoxplotSVG({ min, q1, median, q3, max, unitLabel }) {
  const W = 280, H = 90, padL = 20, padR = 20, axisY = 40;
  const scale = (v) => padL + ((v - min) / (max - min)) * (W - padL - padR);
  const boxTop = axisY - 14, boxBot = axisY + 14;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 320, display: "block" }}>
      <line x1={scale(min)} y1={axisY} x2={scale(q1)} y2={axisY} stroke="#000" strokeWidth="1.4" />
      <line x1={scale(q3)} y1={axisY} x2={scale(max)} y2={axisY} stroke="#000" strokeWidth="1.4" />
      <line x1={scale(min)} y1={boxTop} x2={scale(min)} y2={boxBot} stroke="#000" strokeWidth="1.4" />
      <line x1={scale(max)} y1={boxTop} x2={scale(max)} y2={boxBot} stroke="#000" strokeWidth="1.4" />
      <rect x={scale(q1)} y={boxTop} width={scale(q3) - scale(q1)} height={boxBot - boxTop} fill="#fff" stroke="#000" strokeWidth="1.4" />
      <line x1={scale(median)} y1={boxTop} x2={scale(median)} y2={boxBot} stroke="#000" strokeWidth="1.6" />
      {[min, q1, median, q3, max].map((v, i) => (
        <text key={i} x={scale(v)} y={H - 6} fontSize="10.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{v}</text>
      ))}
      <text x={W / 2} y={H - 0} fontSize="9" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#555">{unitLabel}</text>
    </svg>
  );
}


/* ---------- right-angled triangle, proportionally scaled, 4 orientations.
   base/height/hyp are real numeric lengths (order preserved visually);
   pass '?' as a label to mark the unknown side. ---------- */
function RightTriangleSVG({ base, height, orientation = "bl", baseLabel, heightLabel, hypLabel, angleLabel }) {
  const boxW = 220, boxH = 170, marginX = 46, marginY = 30;
  const maxSide = Math.max(base, height);
  const scale = 108 / maxSide;
  const b = Math.max(base * scale, 34);
  const h = Math.max(height * scale, 34);
  let A, B, C; // A = right-angle vertex, B = end of base leg, C = end of height leg
  if (orientation === "bl") { A = [marginX, boxH - marginY]; B = [marginX + b, boxH - marginY]; C = [marginX, boxH - marginY - h]; }
  else if (orientation === "br") { A = [boxW - marginX, boxH - marginY]; B = [boxW - marginX - b, boxH - marginY]; C = [boxW - marginX, boxH - marginY - h]; }
  else if (orientation === "tl") { A = [marginX, marginY]; B = [marginX + b, marginY]; C = [marginX, marginY + h]; }
  else { A = [boxW - marginX, marginY]; B = [boxW - marginX - b, marginY]; C = [boxW - marginX, marginY + h]; }

  const sq = 10; // right-angle marker size
  const markerPts =
    orientation === "bl" ? `${A[0]},${A[1] - sq} ${A[0] + sq},${A[1] - sq} ${A[0] + sq},${A[1]}` :
    orientation === "br" ? `${A[0]},${A[1] - sq} ${A[0] - sq},${A[1] - sq} ${A[0] - sq},${A[1]}` :
    orientation === "tl" ? `${A[0]},${A[1] + sq} ${A[0] + sq},${A[1] + sq} ${A[0] + sq},${A[1]}` :
    `${A[0]},${A[1] + sq} ${A[0] - sq},${A[1] + sq} ${A[0] - sq},${A[1]}`;

  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const baseMid = mid(A, B), heightMid = mid(A, C), hypMid = mid(B, C);
  const baseUp = orientation === "bl" || orientation === "br" ? -10 : 16;
  const heightSide = orientation === "bl" || orientation === "tl" ? -12 : 12;
  const hypOffsetX = (orientation === "bl" || orientation === "tl") ? 10 : -10;
  const hypOffsetY = (orientation === "bl" || orientation === "br") ? 8 : -8;

  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width="100%" style={{ maxWidth: 260, display: "block" }}>
      <polygon points={`${A[0]},${A[1]} ${B[0]},${B[1]} ${C[0]},${C[1]}`} fill="none" stroke="#000" strokeWidth="1.6" />
      <polyline points={markerPts} fill="none" stroke="#000" strokeWidth="1.2" />
      <text x={baseMid[0]} y={baseMid[1] + baseUp} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{baseLabel}</text>
      <text x={heightMid[0] + (heightSide < 0 ? -8 : 8)} y={heightMid[1] + 4} fontSize="13" fontFamily="Arial, sans-serif" textAnchor={heightSide < 0 ? "end" : "start"} fill="#000">{heightLabel}</text>
      <text x={hypMid[0] + hypOffsetX} y={hypMid[1] + hypOffsetY} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{hypLabel}</text>
      {angleLabel && <text x={B[0] + (A[0] - B[0]) * 0.22} y={B[1] + (A[1] - B[1]) * 0.22 + 4} fontSize="12" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{angleLabel}</text>}
    </svg>
  );
}

/* ---------- general (non-right-angled) triangle for sine/cosine/area rule questions.
   Vertices are placed based on real angles/sides so the triangle is geometrically
   correct; labels can be strings (numbers with units, "?", or an angle in °). ---------- */
function GeneralTriangleSVG({ sideAB, angleA, angleB, labelA, labelB, labelC, sideALabel, sideBLabel, sideCLabel, labelExt }) {
  // Place A at origin along AB; B along positive x. Compute C from angleA and law of sines.
  const angleC = 180 - angleA - angleB;
  const sinA = Math.sin(angleA * Math.PI / 180);
  const sinB_ = Math.sin(angleB * Math.PI / 180);
  const sinC = Math.sin(angleC * Math.PI / 180);
  // side c (opposite C) = sideAB. side a (opposite A) = sideAB * sinA / sinC. side b (opposite B) = sideAB * sinB_ / sinC.
  const sideB_len = sideAB * sinB_ / sinC;
  // C position: from A at angle angleA above AB
  const Cx = sideB_len * Math.cos(angleA * Math.PI / 180);
  const Cy = -sideB_len * Math.sin(angleA * Math.PI / 180);
  // Fit into viewbox
  const xs = [0, sideAB, Cx], ys = [0, 0, Cy];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const extra = labelExt ? 56 : 0;
  const baseW = 260, boxH = 200, pad = 38;
  const boxW = baseW + extra;
  const scale = Math.min((baseW - 2 * pad) / w, (boxH - 2 * pad) / h);
  const tx = (x) => (x - minX) * scale + pad;
  const ty = (y) => (y - minY) * scale + pad;
  const A = [tx(0), ty(0)];
  const B = [tx(sideAB), ty(0)];
  const C = [tx(Cx), ty(Cy)];
  const D = [B[0] + 46, B[1]];
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  // Side labels sit just outside each edge
  const AB_mid = mid(A, B);
  const AC_mid = mid(A, C);
  const BC_mid = mid(B, C);
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width={330 + extra} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <polygon points={`${A[0]},${A[1]} ${B[0]},${B[1]} ${C[0]},${C[1]}`} fill="none" stroke="#000" strokeWidth="1.6" />
      {labelExt && <line x1={B[0]} y1={B[1]} x2={D[0]} y2={D[1]} stroke="#000" strokeWidth="1.6" />}
      {labelExt && <text x={D[0] + 6} y={D[1] + 5} fontSize="13" fontFamily="Arial, sans-serif" fontWeight="700" fill="#000">D</text>}
      {/* Vertex letters */}
      <text x={A[0] - 14} y={A[1] + 15} fontSize="13" fontFamily="Arial, sans-serif" fontWeight="700" fill="#000">A</text>
      <text x={B[0] + (labelExt ? -2 : 6)} y={B[1] + 16} fontSize="13" fontFamily="Arial, sans-serif" fontWeight="700" fill="#000">B</text>
      <text x={C[0] - 4} y={C[1] - 9} fontSize="13" fontFamily="Arial, sans-serif" fontWeight="700" fill="#000">C</text>
      {/* Angle arcs and labels, one in each corner that has a label */}
      {labelA && <AngleMark V={A} P={B} Q={C} label={labelA} arcR={22} bold={labelA === "?"} />}
      {labelB && <AngleMark V={B} P={A} Q={C} label={labelB} arcR={22} bold={labelB === "?"} />}
      {labelC && <AngleMark V={C} P={A} Q={B} label={labelC} arcR={22} bold={labelC === "?"} />}
      {labelExt && <AngleMark V={B} P={D} Q={C} label={labelExt} arcR={30} bold={labelExt === "?"} />}
      {/* Side labels: c = AB (bottom), b = AC (left), a = BC (right) */}
      {sideCLabel && <text x={AB_mid[0]} y={AB_mid[1] + 16} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{svgMath(sideCLabel)}</text>}
      {sideBLabel && <text x={AC_mid[0] - 14} y={AC_mid[1]} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="end" fill="#000">{svgMath(sideBLabel)}</text>}
      {sideALabel && <text x={BC_mid[0] + 12} y={BC_mid[1]} fontSize="13" fontFamily="Arial, sans-serif" fill="#000">{svgMath(sideALabel)}</text>}
    </svg>
  );
}


function polarPt(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}

/* ---------- circle theorem diagrams. The calling subtopic resolves all the
   geometry (which angle is "given" vs "?") and passes final numeric angles
   plus label strings — this component is a pure, geometrically-correct
   renderer, same division of labour as GeneralTriangleSVG. ---------- */
function CircleTheoremSVG({ theorem, ...props }) {
  const boxW = 240, boxH = 200, cx = 120, cy = 104, R = 72;
  const circle = <circle cx={cx} cy={cy} r={R} fill="none" stroke="#000" strokeWidth="1.4" />;

  function rightAngleMarker(vertex, p1, p2, size = 9) {
    const u1 = [p1[0] - vertex[0], p1[1] - vertex[1]];
    const l1 = Math.hypot(u1[0], u1[1]);
    const n1 = [u1[0] / l1, u1[1] / l1];
    const u2 = [p2[0] - vertex[0], p2[1] - vertex[1]];
    const l2 = Math.hypot(u2[0], u2[1]);
    const n2 = [u2[0] / l2, u2[1] / l2];
    const m1 = [vertex[0] + n1[0] * size, vertex[1] + n1[1] * size];
    const m2 = [m1[0] + n2[0] * size, m1[1] + n2[1] * size];
    const m3 = [vertex[0] + n2[0] * size, vertex[1] + n2[1] * size];
    return `${m1[0]},${m1[1]} ${m2[0]},${m2[1]} ${m3[0]},${m3[1]}`;
  }

  if (theorem === "centre") {
    const { centreAngleDeg, centreLabel, circumLabel } = props;
    const [Ax, Ay] = polarPt(cx, cy, R, 90 + centreAngleDeg / 2);
    const [Bx, By] = polarPt(cx, cy, R, 90 - centreAngleDeg / 2);
    const [Cx, Cy] = polarPt(cx, cy, R, 270);
    return (
      <svg viewBox={`0 0 ${boxW} ${boxH}`} width="100%" style={{ maxWidth: 260, display: "block" }}>
        {circle}
        <line x1={cx} y1={cy} x2={Ax} y2={Ay} stroke="#000" strokeWidth="1.3" />
        <line x1={cx} y1={cy} x2={Bx} y2={By} stroke="#000" strokeWidth="1.3" />
        <line x1={Cx} y1={Cy} x2={Ax} y2={Ay} stroke="#000" strokeWidth="1.3" />
        <line x1={Cx} y1={Cy} x2={Bx} y2={By} stroke="#000" strokeWidth="1.3" />
        <circle cx={cx} cy={cy} r={2.2} fill="#000" />
        <text x={cx + 6} y={cy - 6} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">O</text>
        <text x={Ax + (Ax > cx ? 6 : -14)} y={Ay - 4} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">A</text>
        <text x={Bx + (Bx > cx ? 6 : -14)} y={By + 14} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">B</text>
        <text x={Cx - 6} y={Cy + 18} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">C</text>
        <text x={cx} y={cy - 22} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{centreLabel}</text>
        <text x={Cx} y={Cy - 12} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{circumLabel}</text>
      </svg>
    );
  }

  if (theorem === "semicircle") {
    const { cAngleDeg, labelA, labelB } = props;
    const [Ax, Ay] = polarPt(cx, cy, R, 180);
    const [Bx, By] = polarPt(cx, cy, R, 0);
    const [Cx, Cy] = polarPt(cx, cy, R, cAngleDeg);
    const markerPts = rightAngleMarker([Cx, Cy], [Ax, Ay], [Bx, By]);
    return (
      <svg viewBox={`0 0 ${boxW} ${boxH}`} width="100%" style={{ maxWidth: 260, display: "block" }}>
        {circle}
        <line x1={Ax} y1={Ay} x2={Bx} y2={By} stroke="#000" strokeWidth="1.3" />
        <line x1={Ax} y1={Ay} x2={Cx} y2={Cy} stroke="#000" strokeWidth="1.3" />
        <line x1={Bx} y1={By} x2={Cx} y2={Cy} stroke="#000" strokeWidth="1.3" />
        <polyline points={markerPts} fill="none" stroke="#000" strokeWidth="1.1" />
        <text x={Ax - 14} y={Ay + 4} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">A</text>
        <text x={Bx + 4} y={By + 4} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">B</text>
        <text x={Cx - 4} y={Cy - 10} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">C</text>
        <text x={(Ax + Cx) / 2 - 10} y={(Ay + Cy) / 2 - 4} fontSize="13" fontFamily="Arial, sans-serif" fill="#000">{labelA}</text>
        <text x={(Bx + Cx) / 2 + 2} y={(By + Cy) / 2 - 4} fontSize="13" fontFamily="Arial, sans-serif" fill="#000">{labelB}</text>
      </svg>
    );
  }

  if (theorem === "tangent-kite") {
    const { angleAOBdeg, labelO, labelP } = props;
    const alpha = (angleAOBdeg / 2) * (Math.PI / 180);
    const d = R / Math.cos(alpha);
    const A = [cx + R * Math.cos(alpha), cy - R * Math.sin(alpha)];
    const B = [cx + R * Math.cos(alpha), cy + R * Math.sin(alpha)];
    const P = [cx + d, cy];
    return (
      <svg viewBox={`0 0 ${boxW} ${boxH}`} width="100%" style={{ maxWidth: 260, display: "block" }}>
        {circle}
        <line x1={cx} y1={cy} x2={A[0]} y2={A[1]} stroke="#000" strokeWidth="1.3" />
        <line x1={cx} y1={cy} x2={B[0]} y2={B[1]} stroke="#000" strokeWidth="1.3" />
        <line x1={A[0]} y1={A[1]} x2={P[0]} y2={P[1]} stroke="#000" strokeWidth="1.3" />
        <line x1={B[0]} y1={B[1]} x2={P[0]} y2={P[1]} stroke="#000" strokeWidth="1.3" />
        <polyline points={rightAngleMarker(A, [cx, cy], P)} fill="none" stroke="#000" strokeWidth="1.1" />
        <polyline points={rightAngleMarker(B, [cx, cy], P)} fill="none" stroke="#000" strokeWidth="1.1" />
        <circle cx={cx} cy={cy} r={2.2} fill="#000" />
        <text x={cx - 18} y={cy + 4} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">O</text>
        <text x={A[0] - 4} y={A[1] - 8} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">A</text>
        <text x={B[0] - 4} y={B[1] + 16} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">B</text>
        <text x={P[0] + 6} y={P[1] + 4} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">P</text>
        <text x={cx + 16} y={cy - 4} fontSize="13" fontFamily="Arial, sans-serif" fill="#000">{labelO}</text>
        <text x={P[0] - 38} y={P[1] + 4} fontSize="13" fontFamily="Arial, sans-serif" fill="#000">{labelP}</text>
      </svg>
    );
  }

  // theorem === "cyclic-quad"
  const { angleAtADeg, labelA, labelC } = props;
  const [Ax, Ay] = polarPt(cx, cy, R, 0);
  const [Bx, By] = polarPt(cx, cy, R, 180 - angleAtADeg);
  const [Cx, Cy] = polarPt(cx, cy, R, 180);
  const [Dx, Dy] = polarPt(cx, cy, R, 180 + angleAtADeg);
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width="100%" style={{ maxWidth: 260, display: "block" }}>
      {circle}
      <polygon points={`${Ax},${Ay} ${Bx},${By} ${Cx},${Cy} ${Dx},${Dy}`} fill="none" stroke="#000" strokeWidth="1.4" />
      <text x={Ax + 6} y={Ay + 4} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">A</text>
      <text x={Bx - 4} y={By - 8} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">B</text>
      <text x={Cx - 16} y={Cy + 4} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">C</text>
      <text x={Dx - 4} y={Dy + 18} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">D</text>
      <text x={Ax - 28} y={Ay - 2} fontSize="13" fontFamily="Arial, sans-serif" fill="#000">{labelA}</text>
      <text x={Cx + 10} y={Cy - 2} fontSize="13" fontFamily="Arial, sans-serif" fill="#000">{labelC}</text>
    </svg>
  );
}

/* ---------- Tier 2 diagram helpers: coordinate grid, bar/pie charts,
   frequency tree, angle facts (line/point), bearings, a plain rectangle,
   a composite rectilinear (L-shaped) figure, simple quadrilaterals and
   regular polygons, and a general axis+polyline reader for conversion
   and distance-time graphs. Same division of labour as the components
   above: callers resolve all geometry/values, these just render. ---------- */
function CoordinateGridSVG({ points, xMin = -6, xMax = 6, yMin = -6, yMax = 6, lines = [], segments = [], polygon = null, step = 1 }) {
  const boxW = 280, boxH = 280, pad = 26;
  const sx = (boxW - 2 * pad) / (xMax - xMin);
  const sy = (boxH - 2 * pad) / (yMax - yMin);
  const px = (x) => pad + (x - xMin) * sx;
  const py = (y) => boxH - pad - (y - yMin) * sy;
  const gridX = [];
  for (let x = Math.ceil(xMin / step) * step; x <= xMax; x += step) gridX.push(x);
  const gridY = [];
  for (let y = Math.ceil(yMin / step) * step; y <= yMax; y += step) gridY.push(y);
  const lab = (v) => (v < 0 ? "\u2212" + Math.abs(v) : String(v));
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width={320} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      {gridX.map((x) => <line key={`gx${x}`} x1={px(x)} y1={pad} x2={px(x)} y2={boxH - pad} stroke="#ddd" strokeWidth="1" />)}
      {gridY.map((y) => <line key={`gy${y}`} x1={pad} y1={py(y)} x2={boxW - pad} y2={py(y)} stroke="#ddd" strokeWidth="1" />)}
      <line x1={pad} y1={py(0)} x2={boxW - pad} y2={py(0)} stroke="#000" strokeWidth="1.4" />
      <line x1={px(0)} y1={pad} x2={px(0)} y2={boxH - pad} stroke="#000" strokeWidth="1.4" />
      <text x={boxW - pad + 6} y={py(0) + 4} fontSize="13" fontStyle="italic" fontFamily="'Times New Roman', serif" fill="#000">x</text>
      <text x={px(0) + 7} y={pad - 8} fontSize="13" fontStyle="italic" fontFamily="'Times New Roman', serif" fill="#000">y</text>
      {gridX.filter((x) => x !== 0).map((x) => (
        <text key={`tx${x}`} x={px(x)} y={py(0) + 12} fontSize="9.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#444">{lab(x)}</text>
      ))}
      {gridY.filter((y) => y !== 0).map((y) => (
        <text key={`ty${y}`} x={px(0) - 5} y={py(y) + 3.5} fontSize="9.5" fontFamily="Arial, sans-serif" textAnchor="end" fill="#444">{lab(y)}</text>
      ))}
      <text x={px(0) - 5} y={py(0) + 12} fontSize="9.5" fontFamily="Arial, sans-serif" textAnchor="end" fill="#444">0</text>
      {polygon && <polygon points={polygon.map((q) => `${px(q.x)},${py(q.y)}`).join(" ")} fill="#cfe0f588" stroke="#1f3d66" strokeWidth="1.6" />}
      {segments.map((sg, i) => <line key={`sg${i}`} x1={px(sg.x1)} y1={py(sg.y1)} x2={px(sg.x2)} y2={py(sg.y2)} stroke={sg.color || "#1f3d66"} strokeWidth="1.7" strokeDasharray={sg.dash ? "5 4" : undefined} />)}
      {lines.map((ln, i) => { const c = y8ClipLine(ln.x1, ln.y1, ln.x2, ln.y2, xMin, xMax, yMin, yMax); return c ? <line key={`ln${i}`} x1={px(c[0])} y1={py(c[1])} x2={px(c[2])} y2={py(c[3])} stroke="#b23b2e" strokeWidth="2" /> : null; })}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={px(p.x)} cy={py(p.y)} r={3.4} fill="#000" />
          <text x={px(p.x) + 7} y={py(p.y) - 6} fontSize="13" fontFamily="Arial, sans-serif" fontWeight="700" fill="#000" stroke="#fff" strokeWidth="3" paintOrder="stroke">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

function BarChartSVG({ categories, values, yLabel = "Frequency", yStart = 0 }) {
  const boxW = 300, boxH = 230, padL = 46, padR = 14, padT = 14, padB = 40;
  const maxV = Math.max(...values);
  const step = maxV <= 10 ? 1 : maxV <= 20 ? 2 : maxV <= 50 ? 5 : 10;
  const axisMax = (Math.floor(maxV / step) + 1) * step;
  const gap = (boxW - padL - padR) / values.length;
  const barW = gap * 0.6;
  const scaleY = (v) => (boxH - padT - padB) * ((v - yStart) / (axisMax - yStart));
  const ticks = [];
  for (let t = yStart; t <= axisMax; t += step) ticks.push(t);
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width={360} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} y1={boxH - padB - scaleY(t)} x2={boxW - padR} y2={boxH - padB - scaleY(t)} stroke="#d5d5d5" strokeWidth="1" />
          <text x={padL - 5} y={boxH - padB - scaleY(t) + 3} fontSize="9" fontFamily="Arial, sans-serif" textAnchor="end" fill="#444">{t}</text>
        </g>
      ))}
      <line x1={padL} y1={padT} x2={padL} y2={boxH - padB} stroke="#000" strokeWidth="1.4" />
      <line x1={padL} y1={boxH - padB} x2={boxW - padR} y2={boxH - padB} stroke="#000" strokeWidth="1.4" />
      {values.map((v, i) => {
        const h = scaleY(v);
        const x = padL + gap * i + (gap - barW) / 2;
        const y = boxH - padB - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={h} fill="#fff" stroke="#000" strokeWidth="1.3" />
            <text x={x + barW / 2} y={boxH - padB + 13} fontSize="10" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{categories[i]}</text>
          </g>
        );
      })}
      <text x={11} y={(padT + boxH - padB) / 2} fontSize="10" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#333" transform={`rotate(-90 11 ${(padT + boxH - padB) / 2})`}>{yLabel}</text>
    </svg>
  );
}

function PieChartSVG({ sectors, markIndex }) {
  const cx = 110, cy = 100, r = 82;
  let cum = 90;
  const paths = sectors.map((s) => {
    const start = cum;
    const end = cum - s.angle;
    const [x1, y1] = polarPt(cx, cy, r, start);
    const [x2, y2] = polarPt(cx, cy, r, end);
    const large = s.angle > 180 ? 1 : 0;
    const mid = start - s.angle / 2;
    cum = end;
    return { d: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`, mid, angle: s.angle };
  });
  return (
    <svg viewBox="0 0 220 200" width="100%" style={{ maxWidth: 240, display: "block" }}>
      {paths.map((p, i) => <path key={i} d={p.d} fill={i === markIndex ? "#d9d9d9" : "#fff"} stroke="#000" strokeWidth="1.3" />)}
      {paths.map((p, i) => i === markIndex && (
        <text key={`l${i}`} x={cx + Math.cos((p.mid * Math.PI) / 180) * r * 0.55} y={cy - Math.sin((p.mid * Math.PI) / 180) * r * 0.55 + 4} fontSize="12" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{p.angle}°</text>
      ))}
      <circle cx={cx} cy={cy} r={1.6} fill="#000" />
    </svg>
  );
}

function FrequencyTreeSVG({ labelsStage1, labelsStage2, freqs, unknownIndex }) {
  const boxW = 300, boxH = 190;
  const rootX = 20, rootY = 95;
  const s1X = 130;
  const s1Ys = [55, 135];
  const s2X = 250;
  const s2Ys = [30, 80, 110, 160];
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width="100%" style={{ maxWidth: 320, display: "block" }}>
      {s1Ys.map((y, i) => <line key={`l1-${i}`} x1={rootX} y1={rootY} x2={s1X} y2={y} stroke="#000" strokeWidth="1.2" />)}
      {s1Ys.map((y1, i) => [0, 1].map((j) => (
        <line key={`l2-${i}-${j}`} x1={s1X} y1={y1} x2={s2X} y2={s2Ys[i * 2 + j]} stroke="#000" strokeWidth="1.2" />
      )))}
      <circle cx={rootX} cy={rootY} r={2.4} fill="#000" />
      {s1Ys.map((y, i) => (
        <g key={`n1-${i}`}>
          <circle cx={s1X} cy={y} r={2.4} fill="#000" />
          <text x={(rootX + s1X) / 2} y={(rootY + y) / 2 - 5} fontSize="11" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{labelsStage1[i]}</text>
        </g>
      ))}
      {s2Ys.map((y, idx) => {
        const i = Math.floor(idx / 2), j = idx % 2;
        const midx = (s1X + s2X) / 2, midy = (s1Ys[i] + y) / 2;
        return (
          <g key={`n2-${idx}`}>
            <text x={midx} y={midy - 5} fontSize="11" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{labelsStage2[j]}</text>
            <rect x={s2X + 4} y={y - 9} width={34} height={18} fill="#fff" stroke="#000" strokeWidth="1" />
            <text x={s2X + 21} y={y + 4} fontSize="12" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{idx === unknownIndex ? "?" : freqs[idx]}</text>
          </g>
        );
      })}
    </svg>
  );
}

function AngleFactsSVG({ mode = "line", angles, unknownIndex, labels }) {
  const W = 300, R = mode === "line" ? 112 : 100;
  const cx = W / 2, cy = mode === "line" ? 128 : 116;
  const H = mode === "line" ? 150 : 232;
  let cum = 0;
  const rays = [0];
  angles.forEach((a) => { cum += a; rays.push(cum); });
  const toXY = (deg) => polarPt(cx, cy, R, deg);
  const arcR = mode === "line" ? 26 : 24;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={360} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      {mode === "line" && <line x1={cx - R - 18} y1={cy} x2={cx + R + 18} y2={cy} stroke="#000" strokeWidth="1.5" />}
      {rays.map((r, i) => {
        if (mode === "line" && (i === 0 || i === rays.length - 1)) return null;
        if (mode === "point" && i === rays.length - 1) return null;
        const [x, y] = toXY(r);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#000" strokeWidth="1.5" />;
      })}
      <circle cx={cx} cy={cy} r={2.4} fill="#000" />
      {angles.map((a, i) => {
        const P = polarPt(cx, cy, 110, rays[i]), Q = polarPt(cx, cy, 110, rays[i + 1]);
        const label = labels ? labels[i] : i === unknownIndex ? "?" : `${a}\u00B0`;
        return <AngleMark key={i} V={[cx, cy]} P={P} Q={Q} label={label} arcR={arcR} inset bold={i === unknownIndex} fontSize={i === unknownIndex ? 15 : 13} />;
      })}
    </svg>
  );
}

function BearingSVG({ bearingDeg, unknown }) {
  const boxW = 240, boxH = 220;
  const Ax = 70, Ay = 150, R = 90;
  const rad = (bearingDeg * Math.PI) / 180;
  const Bx = Ax + R * Math.sin(rad);
  const By = Ay - R * Math.cos(rad);
  const arcR = 32;
  const startPt = [Ax, Ay - arcR];
  const endPt = [Ax + arcR * Math.sin(rad), Ay - arcR * Math.cos(rad)];
  const large = bearingDeg > 180 ? 1 : 0;
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width="100%" style={{ maxWidth: 260, display: "block" }}>
      <line x1={Ax} y1={Ay + 20} x2={Ax} y2={Ay - 70} stroke="#000" strokeWidth="1.2" strokeDasharray="4,3" />
      <polygon points={`${Ax},${Ay - 70} ${Ax - 4},${Ay - 60} ${Ax + 4},${Ay - 60}`} fill="#000" />
      <text x={Ax} y={Ay - 74} fontSize="11" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">N</text>
      <line x1={Ax} y1={Ay} x2={Bx} y2={By} stroke="#000" strokeWidth="1.5" />
      <path d={`M${startPt[0]},${startPt[1]} A${arcR},${arcR} 0 ${large} 1 ${endPt[0]},${endPt[1]}`} fill="none" stroke="#000" strokeWidth="1" />
      <circle cx={Ax} cy={Ay} r={2.4} fill="#000" />
      <circle cx={Bx} cy={By} r={2.4} fill="#000" />
      <text x={Ax - 14} y={Ay + 14} fontSize="12" fontFamily="Arial, sans-serif" fontWeight="700" fill="#000">A</text>
      <text x={Bx + (Bx > Ax ? 6 : -16)} y={By - 4} fontSize="12" fontFamily="Arial, sans-serif" fontWeight="700" fill="#000">B</text>
      <text x={Ax + 18} y={Ay - 30} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">{unknown ? "?" : `${bearingDeg}°`}</text>
    </svg>
  );
}

function RectangleSVG({ w, h, wLabel, hLabel }) {
  // With plain numbers, always draw the longer side horizontally (saves
  // vertical space on the page). With explicit labels (e.g. "(3x + 7) cm"),
  // keep w across the top/bottom and h down the side as given.
  const custom = wLabel !== undefined || hLabel !== undefined;
  const long = custom ? w : Math.max(w, h), short = custom ? h : Math.min(w, h);
  const rw = custom ? 190 : Math.max(Math.min(190, 24 * long), 90);
  const rh = Math.min(Math.max((short / long) * rw, 38), 78);
  const padTop = 16, padLeft = 64, padRight = 20;
  const bottom = wLabel !== undefined ? wLabel : `${long} cm`;
  const side = hLabel !== undefined ? hLabel : `${short} cm`;
  const svgText = (t, props) => <text {...props} fontSize="13" fontFamily="Arial, sans-serif" fill="#000">{svgMath(t)}</text>;
  return (
    <svg viewBox={`0 0 ${rw + padLeft + padRight} ${rh + padTop + 30}`} width={Math.min(rw + padLeft + padRight, 300) * 1.1} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <rect x={padLeft} y={padTop} width={rw} height={rh} fill="none" stroke="#000" strokeWidth="1.6" />
      {svgText(bottom, { x: padLeft + rw / 2, y: padTop + rh + 18, textAnchor: "middle" })}
      {svgText(side, { x: padLeft - 8, y: padTop + rh / 2 + 4, textAnchor: "end" })}
    </svg>
  );
}

function CompositeRectSVG({ W, H, a, b }) {
  const scale = 150 / Math.max(W, H);
  const pad = 30;
  const w = W * scale, h = H * scale, na = a * scale, nb = b * scale;
  const P = [[pad, pad], [pad + w - na, pad], [pad + w - na, pad + nb], [pad + w, pad + nb], [pad + w, pad + h], [pad, pad + h]];
  const pts = P.map((p) => p.join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${pad * 2 + w + 20} ${pad * 2 + h + 10}`} width="100%" style={{ maxWidth: 280, display: "block" }}>
      <polygon points={pts} fill="none" stroke="#000" strokeWidth="1.6" />
      <text x={pad + w - na + 8} y={pad + nb / 2 + 4} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">{b}</text>
      <text x={pad + w - na / 2} y={pad + nb - 6} fontSize="12" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{a}</text>
      <text x={pad + w / 2} y={pad + h + 16} fontSize="12" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{W}</text>
      <text x={pad - 10} y={pad + h / 2 + 4} fontSize="12" fontFamily="Arial, sans-serif" textAnchor="end" fill="#000">{H}</text>
    </svg>
  );
}

function QuadrilateralSVG({ shape }) {
  const shapes = {
    parallelogram: [[20, 0], [90, 0], [70, 50], [0, 50]],
    rhombus: [[45, 0], [90, 45], [45, 90], [0, 45]],
    kite: [[45, 0], [80, 40], [45, 95], [10, 40]],
    trapezium: [[15, 0], [75, 0], [95, 55], [0, 55]],
    rectangle: [[0, 0], [90, 0], [90, 45], [0, 45]],
    square: [[0, 0], [65, 0], [65, 65], [0, 65]],
  };
  const pts = shapes[shape];
  const maxX = Math.max(...pts.map((p) => p[0])), maxY = Math.max(...pts.map((p) => p[1]));
  const pad = 20;
  const ptsStr = pts.map(([x, y]) => `${x + pad},${y + pad}`).join(" ");
  return (
    <svg viewBox={`0 0 ${maxX + 2 * pad} ${maxY + 2 * pad}`} width="100%" style={{ maxWidth: 220, display: "block" }}>
      <polygon points={ptsStr} fill="none" stroke="#000" strokeWidth="1.6" />
    </svg>
  );
}

function parallelTick(cx, cy) {
  return (
    <g stroke="#000" strokeWidth="1.3">
      <line x1={cx - 4} y1={cy - 4} x2={cx + 3} y2={cy} />
      <line x1={cx - 4} y1={cy + 4} x2={cx + 3} y2={cy} />
    </g>
  );
}

function sideTicks(p1, p2, count) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
  const spacing = 4.5;
  const marks = [];
  for (let i = 0; i < count; i++) {
    const offset = (i - (count - 1) / 2) * spacing;
    const cx = mx + ux * offset, cy = my + uy * offset;
    marks.push(
      <line key={i} x1={cx - px * 4} y1={cy - py * 4} x2={cx + px * 4} y2={cy + py * 4} stroke="#000" strokeWidth="1.3" />
    );
  }
  return marks;
}

function TrapeziumAnglesSVG({ a }) {
  const pad = 26;
  const A = [15, 0], B = [75, 0], C = [95, 55], D = [0, 55];
  const ptsStr = [A, B, C, D].map(([x, y]) => `${x + pad},${y + pad}`).join(" ");
  return (
    <svg viewBox={`0 0 ${95 + 2 * pad} ${55 + 2 * pad}`} width="100%" style={{ maxWidth: 240, display: "block" }}>
      <polygon points={ptsStr} fill="none" stroke="#000" strokeWidth="1.6" />
      {parallelTick((A[0] + B[0]) / 2 + pad, (A[1] + B[1]) / 2 + pad)}
      {parallelTick((C[0] + D[0]) / 2 + pad, (C[1] + D[1]) / 2 + pad)}
      <text x={A[0] + pad - 6} y={A[1] + pad - 8} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="end" fill="#000">A</text>
      <text x={B[0] + pad + 6} y={B[1] + pad - 8} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="start" fill="#000">B</text>
      <text x={C[0] + pad + 6} y={C[1] + pad + 14} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="start" fill="#000">C</text>
      <text x={D[0] + pad - 6} y={D[1] + pad + 14} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="end" fill="#000">D</text>
      <text x={A[0] + pad + 10} y={A[1] + pad + 16} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">{a}°</text>
      <text x={D[0] + pad + 10} y={D[1] + pad - 6} fontSize="12" fontFamily="Arial, sans-serif" fill="#000">?</text>
    </svg>
  );
}

function KiteAnglesSVG({ angleA, angleBD }) {
  const pad = 22;
  const A = [45, 0], B = [80, 40], C = [45, 95], D = [10, 40];
  const centre = [45, 43.75];
  const labelPos = ([vx, vy]) => [vx + 0.35 * (centre[0] - vx), vy + 0.35 * (centre[1] - vy)];
  const [lax, lay] = labelPos(A), [lbx, lby] = labelPos(B), [ldx, ldy] = labelPos(D), [lcx, lcy] = labelPos(C);
  const ptsStr = [A, B, C, D].map(([x, y]) => `${x + pad},${y + pad}`).join(" ");
  const shift = ([x, y]) => [x + pad, y + pad];
  return (
    <svg viewBox={`0 0 ${90 + 2 * pad} ${95 + 2 * pad}`} width="100%" style={{ maxWidth: 200, display: "block" }}>
      <polygon points={ptsStr} fill="none" stroke="#000" strokeWidth="1.6" />
      {sideTicks(shift(A), shift(B), 1)}
      {sideTicks(shift(A), shift(D), 1)}
      {sideTicks(shift(C), shift(B), 2)}
      {sideTicks(shift(C), shift(D), 2)}
      <text x={A[0] + pad} y={A[1] + pad - 8} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">A</text>
      <text x={B[0] + pad + 8} y={B[1] + pad + 4} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="start" fill="#000">B</text>
      <text x={C[0] + pad} y={C[1] + pad + 16} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">C</text>
      <text x={D[0] + pad - 8} y={D[1] + pad + 4} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="end" fill="#000">D</text>
      <text x={lax + pad} y={lay + pad} fontSize="11.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{angleA}°</text>
      <text x={lbx + pad} y={lby + pad} fontSize="11.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{angleBD}°</text>
      <text x={ldx + pad} y={ldy + pad} fontSize="11.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{angleBD}°</text>
      <text x={lcx + pad} y={lcy + pad} fontSize="11.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">?</text>
    </svg>
  );
}

function RegularPolygonSVG({ sides, sideLabel }) {
  const cx = 80, cy = 74, r = 56;
  const offset = sides % 2 === 0 ? 90 + 180 / sides : 90;
  const pts = [];
  for (let i = 0; i < sides; i++) pts.push(polarPt(cx, cy, r, offset + i * (360 / sides)));
  const ptsStr = pts.map((p) => p.join(",")).join(" ");
  let low = 0, lowY = -1e9;
  pts.forEach((p, i) => { const q = pts[(i + 1) % sides]; const y = (p[1] + q[1]) / 2; if (y > lowY) { lowY = y; low = i; } });
  const a = pts[low], b = pts[(low + 1) % sides];
  return (
    <svg viewBox="0 0 160 160" width={190} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <polygon points={ptsStr} fill="none" stroke="#000" strokeWidth="1.7" strokeLinejoin="round" />
      {sideLabel && <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 + 16} fontSize="12.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{sideLabel}</text>}
    </svg>
  );
}

function LineGraphSVG({ points, xMax, yMax, xLabel, yLabel, readX, readY }) {
  const boxW = 280, boxH = 220, padL = 40, padR = 16, padT = 14, padB = 34;
  const sx = (boxW - padL - padR) / xMax;
  const sy = (boxH - padT - padB) / yMax;
  const px = (x) => padL + x * sx;
  const py = (y) => boxH - padB - y * sy;
  const linePts = points.map((p) => `${px(p.x)},${py(p.y)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width="100%" style={{ maxWidth: 300, display: "block" }}>
      <line x1={padL} y1={padT} x2={padL} y2={boxH - padB} stroke="#000" strokeWidth="1.4" />
      <line x1={padL} y1={boxH - padB} x2={boxW - padR} y2={boxH - padB} stroke="#000" strokeWidth="1.4" />
      <polyline points={linePts} fill="none" stroke="#000" strokeWidth="1.6" />
      <text x={(boxW + padL - padR) / 2} y={boxH - 6} fontSize="10.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{xLabel}</text>
      <text x={12} y={(padT + boxH - padB) / 2} fontSize="10.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000" transform={`rotate(-90 12 ${(padT + boxH - padB) / 2})`}>{yLabel}</text>
      <text x={padL} y={boxH - padB + 14} fontSize="9.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#666">0</text>
      <text x={boxW - padR} y={boxH - padB + 14} fontSize="9.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#666">{xMax}</text>
      <text x={padL - 6} y={padT + 4} fontSize="9.5" fontFamily="Arial, sans-serif" textAnchor="end" fill="#666">{yMax}</text>
      {readX != null && (
        <>
          <line x1={px(readX)} y1={py(0)} x2={px(readX)} y2={py(readY != null ? readY : 0)} stroke="#888" strokeWidth="1" strokeDasharray="3,2" />
          {readY != null && <line x1={px(0)} y1={py(readY)} x2={px(readX)} y2={py(readY)} stroke="#888" strokeWidth="1" strokeDasharray="3,2" />}
        </>
      )}
    </svg>
  );
}

/* ---------- 3D shape diagrams (Surface Area & Volume, Properties of 3D
   Shapes): standard GCSE-textbook "pseudo-3D" outline — a square-on front
   face plus a foreshortened receding direction for depth, hidden edges
   dashed. Proportions follow the real l/w/h passed in, not just decorative. ---------- */
function CuboidSVG({ l, w, h, showL, showW, showH }) {
  const boxW = 260, boxH = 200;
  const maxDim = Math.max(l, w, h);
  const scale = 100 / maxDim;
  const fl = Math.max(l * scale, 30), fh = Math.max(h * scale, 30);
  const dep = Math.max(w * scale * 0.55, 22);
  const padL = 44, padT = 26;
  const x0 = padL, y0 = padT + fh;
  const A = [x0, y0], B = [x0 + fl, y0], C = [x0 + fl, y0 - fh], D = [x0, y0 - fh];
  const dx = dep * 0.75, dy = -dep * 0.6;
  const A2 = [A[0] + dx, A[1] + dy], B2 = [B[0] + dx, B[1] + dy], C2 = [C[0] + dx, C[1] + dy], D2 = [D[0] + dx, D[1] + dy];
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width="100%" style={{ maxWidth: 260, display: "block" }}>
      <line x1={A[0]} y1={A[1]} x2={A2[0]} y2={A2[1]} stroke="#000" strokeWidth="1.1" strokeDasharray="3,3" />
      <line x1={D2[0]} y1={D2[1]} x2={A2[0]} y2={A2[1]} stroke="#000" strokeWidth="1.1" strokeDasharray="3,3" />
      <line x1={D2[0]} y1={D2[1]} x2={D[0]} y2={D[1]} stroke="#000" strokeWidth="1.1" strokeDasharray="3,3" />
      <polygon points={`${A[0]},${A[1]} ${B[0]},${B[1]} ${C[0]},${C[1]} ${D[0]},${D[1]}`} fill="none" stroke="#000" strokeWidth="1.6" />
      <polygon points={`${D[0]},${D[1]} ${C[0]},${C[1]} ${C2[0]},${C2[1]} ${D2[0]},${D2[1]}`} fill="none" stroke="#000" strokeWidth="1.6" />
      <polygon points={`${B[0]},${B[1]} ${C[0]},${C[1]} ${C2[0]},${C2[1]} ${B2[0]},${B2[1]}`} fill="none" stroke="#000" strokeWidth="1.6" />
      <text x={(A[0] + B[0]) / 2} y={y0 + 16} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{showL}</text>
      <text x={A[0] - 10} y={(A[1] + D[1]) / 2} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="end" fill="#000">{showH}</text>
      <text x={(B[0] + B2[0]) / 2 + 8} y={(B[1] + B2[1]) / 2} fontSize="13" fontFamily="Arial, sans-serif" fill="#000">{showW}</text>
    </svg>
  );
}

function CylinderSVG({ r, h, showR, showH }) {
  const boxW = 200, boxH = 220;
  const maxDim = Math.max(r * 2, h);
  const scale = 130 / maxDim;
  const rx = Math.max(r * scale, 26), ry = rx * 0.35;
  const H = Math.max(h * scale, 40);
  const cx = boxW / 2, topY = 40, botY = topY + H;
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width="100%" style={{ maxWidth: 200, display: "block" }}>
      <ellipse cx={cx} cy={topY} rx={rx} ry={ry} fill="none" stroke="#000" strokeWidth="1.6" />
      <line x1={cx - rx} y1={topY} x2={cx - rx} y2={botY} stroke="#000" strokeWidth="1.6" />
      <line x1={cx + rx} y1={topY} x2={cx + rx} y2={botY} stroke="#000" strokeWidth="1.6" />
      <path d={`M${cx - rx},${botY} A${rx},${ry} 0 0 0 ${cx + rx},${botY}`} fill="none" stroke="#000" strokeWidth="1.6" />
      <path d={`M${cx - rx},${botY} A${rx},${ry} 0 0 1 ${cx + rx},${botY}`} fill="none" stroke="#000" strokeDasharray="3,3" strokeWidth="1.1" />
      {showR && <line x1={cx} y1={topY} x2={cx + rx} y2={topY} stroke="#000" strokeWidth="1.1" />}
      <text x={cx + rx / 2} y={topY - 6} fontSize="12.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{showR}</text>
      <text x={cx + rx + 10} y={(topY + botY) / 2} fontSize="13" fontFamily="Arial, sans-serif" fill="#000">{showH}</text>
    </svg>
  );
}

function TriangularPrismSVG({ base, height, length, showBase, showHeight, showLength }) {
  const boxW = 260, boxH = 200;
  const maxDim = Math.max(base, height, length);
  const scale = 90 / maxDim;
  const b = Math.max(base * scale, 30), h = Math.max(height * scale, 30);
  const dep = Math.max(length * scale * 0.6, 40);
  const padL = 46, padT = 26;
  const x0 = padL, y0 = padT + h;
  const A = [x0, y0], B = [x0 + b, y0], C = [x0, y0 - h];
  const dx = dep * 0.85, dy = -dep * 0.45;
  const A2 = [A[0] + dx, A[1] + dy], B2 = [B[0] + dx, B[1] + dy], C2 = [C[0] + dx, C[1] + dy];
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width="100%" style={{ maxWidth: 260, display: "block" }}>
      <line x1={A[0]} y1={A[1]} x2={A2[0]} y2={A2[1]} stroke="#000" strokeWidth="1.1" strokeDasharray="3,3" />
      <polygon points={`${A[0]},${A[1]} ${B[0]},${B[1]} ${C[0]},${C[1]}`} fill="none" stroke="#000" strokeWidth="1.6" />
      <polygon points={`${A2[0]},${A2[1]} ${B2[0]},${B2[1]} ${C2[0]},${C2[1]}`} fill="none" stroke="#000" strokeWidth="1.6" />
      <line x1={B[0]} y1={B[1]} x2={B2[0]} y2={B2[1]} stroke="#000" strokeWidth="1.6" />
      <line x1={C[0]} y1={C[1]} x2={C2[0]} y2={C2[1]} stroke="#000" strokeWidth="1.6" />
      <text x={(A[0] + B[0]) / 2} y={y0 + 16} fontSize="12.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{showBase}</text>
      <text x={A[0] - 10} y={(A[1] + C[1]) / 2} fontSize="12.5" fontFamily="Arial, sans-serif" textAnchor="end" fill="#000">{showHeight}</text>
      <text x={(B[0] + B2[0]) / 2 + 8} y={(B[1] + B2[1]) / 2} fontSize="12.5" fontFamily="Arial, sans-serif" fill="#000">{showLength}</text>
    </svg>
  );
}

/* ---------- scatter graph for Correlation & Regression: caller supplies
   already-scaled points plus explicit xMax/yMax (like LineGraphSVG) so a
   line of best fit and the data always share the same axes. ---------- */
function ScatterSVG({ points, xMax, yMax, showLine }) {
  const boxW = 300, boxH = 250, padL = 40, padR = 16, padT = 14, padB = 38;
  const px = (x) => padL + (x / xMax) * (boxW - padL - padR);
  const py = (y) => boxH - padB - (y / yMax) * (boxH - padT - padB);
  const stepFor = (m) => (m <= 10 ? 1 : m <= 24 ? 2 : m <= 50 ? 5 : 10);
  const xs = stepFor(xMax), ys = stepFor(yMax);
  const xt = [], yt = [];
  for (let v = 0; v <= xMax; v += xs) xt.push(v);
  for (let v = 0; v <= yMax; v += ys) yt.push(v);
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width={360} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      {xt.map((v) => <line key={`gx${v}`} x1={px(v)} y1={padT} x2={px(v)} y2={boxH - padB} stroke="#e3e3e3" strokeWidth="1" />)}
      {yt.map((v) => <line key={`gy${v}`} x1={padL} y1={py(v)} x2={boxW - padR} y2={py(v)} stroke="#e3e3e3" strokeWidth="1" />)}
      <line x1={padL} y1={padT} x2={padL} y2={boxH - padB} stroke="#000" strokeWidth="1.4" />
      <line x1={padL} y1={boxH - padB} x2={boxW - padR} y2={boxH - padB} stroke="#000" strokeWidth="1.4" />
      {xt.map((v) => <text key={`tx${v}`} x={px(v)} y={boxH - padB + 12} fontSize="9" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#444">{v}</text>)}
      {yt.map((v) => <text key={`ty${v}`} x={padL - 5} y={py(v) + 3} fontSize="9" fontFamily="Arial, sans-serif" textAnchor="end" fill="#444">{v}</text>)}
      <text x={(boxW + padL - padR) / 2} y={boxH - 8} fontSize="12" fontStyle="italic" fontFamily="'Times New Roman', serif" textAnchor="middle" fill="#000">x</text>
      <text x={12} y={(padT + boxH - padB) / 2} fontSize="12" fontStyle="italic" fontFamily="'Times New Roman', serif" textAnchor="middle" fill="#000" transform={`rotate(-90 12 ${(padT + boxH - padB) / 2})`}>y</text>
      {showLine && <line x1={px(showLine.x1)} y1={py(showLine.y1)} x2={px(showLine.x2)} y2={py(showLine.y2)} stroke="#b23b2e" strokeWidth="1.5" />}
      {points.map((p, i) => <circle key={i} cx={px(p.x)} cy={py(p.y)} r={3} fill="#000" />)}
    </svg>
  );
}

/* ---------- analogue clock face for the Time group. ---------- */
function ClockSVG({ hour, minute }) {
  const cx = 80, cy = 80, R = 68;
  const hourAngle = ((hour % 12) + minute / 60) * 30 - 90;
  const minAngle = minute * 6 - 90;
  const hx = cx + R * 0.5 * Math.cos((hourAngle * Math.PI) / 180), hy = cy + R * 0.5 * Math.sin((hourAngle * Math.PI) / 180);
  const mx = cx + R * 0.8 * Math.cos((minAngle * Math.PI) / 180), my = cy + R * 0.8 * Math.sin((minAngle * Math.PI) / 180);
  const ticks = [];
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 - 90) * (Math.PI / 180);
    ticks.push(<line key={i} x1={cx + R * 0.88 * Math.cos(a)} y1={cy + R * 0.88 * Math.sin(a)} x2={cx + R * Math.cos(a)} y2={cy + R * Math.sin(a)} stroke="#000" strokeWidth="1.4" />);
  }
  return (
    <svg viewBox="0 0 160 160" width="100%" style={{ maxWidth: 160, display: "block" }}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#000" strokeWidth="1.6" />
      {ticks}
      <line x1={cx} y1={cy} x2={hx} y2={hy} stroke="#000" strokeWidth="2.4" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={mx} y2={my} stroke="#000" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={2} fill="#000" />
    </svg>
  );
}

/* ---------- coordinate grid that also draws a labelled polygon (for
   Transformations of Shapes) — same axis/gridline drawing as
   CoordinateGridSVG, extended to render a shape outline plus one label
   per vertex. Only the object shape is drawn; questions ask for the
   coordinates of a transformed vertex rather than requiring a second,
   possibly-overlapping image shape to be rendered. ---------- */
function ShapeGridSVG({ shapes, xMin = -6, xMax = 6, yMin = -6, yMax = 6, lines = [] }) {
  const boxW = 260, boxH = 260, pad = 22;
  const sx = (boxW - 2 * pad) / (xMax - xMin);
  const sy = (boxH - 2 * pad) / (yMax - yMin);
  const px = (x) => pad + (x - xMin) * sx;
  const py = (y) => boxH - pad - (y - yMin) * sy;
  const gridX = []; for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x++) gridX.push(x);
  const gridY = []; for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y++) gridY.push(y);
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width={320} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      {gridX.map((x) => <line key={`gx${x}`} x1={px(x)} y1={pad} x2={px(x)} y2={boxH - pad} stroke="#ddd" strokeWidth="1" />)}
      {gridY.map((y) => <line key={`gy${y}`} x1={pad} y1={py(y)} x2={boxW - pad} y2={py(y)} stroke="#ddd" strokeWidth="1" />)}
      <line x1={pad} y1={py(0)} x2={boxW - pad} y2={py(0)} stroke="#000" strokeWidth="1.4" />
      <line x1={px(0)} y1={pad} x2={px(0)} y2={boxH - pad} stroke="#000" strokeWidth="1.4" />
      <text x={px(0) + 4} y={py(0) - 4} fontSize="11" fontFamily="Arial, sans-serif" fill="#000">O</text>
      {gridX.filter((x) => x !== 0).map((x) => <text key={`tx${x}`} x={px(x)} y={py(0) + 11} fontSize="8.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#555">{x < 0 ? "\u2212" + Math.abs(x) : x}</text>)}
      {gridY.filter((y) => y !== 0).map((y) => <text key={`ty${y}`} x={px(0) - 4} y={py(y) + 3} fontSize="8.5" fontFamily="Arial, sans-serif" textAnchor="end" fill="#555">{y < 0 ? "\u2212" + Math.abs(y) : y}</text>)}
      {lines.map((ln, i) => { const c = y8ClipLine(ln.x1, ln.y1, ln.x2, ln.y2, xMin, xMax, yMin, yMax); return c ? <line key={`ln${i}`} x1={px(c[0])} y1={py(c[1])} x2={px(c[2])} y2={py(c[3])} stroke="#b23b2e" strokeWidth="1.8" strokeDasharray={ln.dashed ? "6 4" : undefined} /> : null; })}
      {shapes.map((s, i) => (
        <g key={i}>
          <polygon points={s.points.map((p) => `${px(p.x)},${py(p.y)}`).join(" ")} fill={s.fill || "none"} stroke={s.stroke || "#000"} strokeWidth="1.8" />
          {s.points.map((p, j) => p.label && (
            <text key={j} x={px(p.x) + 6} y={py(p.y) - 6} fontSize="12.5" fontFamily="Arial, sans-serif" fontWeight="700" fill={s.stroke || "#000"}>{p.label}</text>
          ))}
        </g>
      ))}
    </svg>
  );
}

/* ---------- angle marked with an arc between two labelled rays, for
   Geometric Notation questions — same ray/arc drawing idiom as the other
   angle-based diagrams (AngleFactsSVG, BearingSVG), fixed non-degenerate
   angle since only the letters (not the size) matter here. ---------- */
function NotationAngleSVG({ labels }) {
  const cx = 110, cy = 70, R = 96, arcR = 30;
  const angle1 = 205, angle2 = 335;
  const [x1, y1] = polarPt(cx, cy, R, angle1);
  const [x2, y2] = polarPt(cx, cy, R, angle2);
  const [ax1, ay1] = polarPt(cx, cy, arcR, angle1);
  const [ax2, ay2] = polarPt(cx, cy, arcR, angle2);
  return (
    <svg viewBox="0 0 220 130" width={260} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <line x1={cx} y1={cy} x2={x1} y2={y1} stroke="#000" strokeWidth="1.5" />
      <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="#000" strokeWidth="1.5" />
      <path d={`M${ax1},${ay1} A${arcR},${arcR} 0 0 0 ${ax2},${ay2}`} fill="none" stroke="#000" strokeWidth="1.2" />
      <circle cx={cx} cy={cy} r={2.2} fill="#000" />
      <text x={cx} y={cy - 12} fontSize="15" fontFamily="Arial, sans-serif" fontWeight="700" textAnchor="middle" fill="#000">{labels[1]}</text>
      <text x={x1 - 8} y={y1 + 6} fontSize="15" fontFamily="Arial, sans-serif" fontWeight="700" textAnchor="end" fill="#000">{labels[0]}</text>
      <text x={x2 + 8} y={y2 + 6} fontSize="15" fontFamily="Arial, sans-serif" fontWeight="700" fill="#000">{labels[2]}</text>
    </svg>
  );
}

// Three non-collinear lattice points (a valid triangle) inside the given
// bounds, for Transformations of Shapes questions.
function randomTriangle(rng, xMin, xMax, yMin, yMax) {
  let pts;
  do {
    pts = [0, 1, 2].map(() => ({ x: seededInt(rng, xMin, xMax), y: seededInt(rng, yMin, yMax) }));
  } while ((pts[1].x - pts[0].x) * (pts[2].y - pts[0].y) - (pts[1].y - pts[0].y) * (pts[2].x - pts[0].x) === 0);
  return pts;
}

// Inline stacked fraction: numerator over a horizontal vinculum over the
// denominator, for use inside a prompt/answer wherever a "/" would otherwise
// stand in for a real mathematical fraction. n/d accept plain values or
// small JSX (e.g. a surd) so callers can build up expressions like √a/a.
function Frac({ n, d }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", verticalAlign: "middle", margin: "0 3px", fontSize: "0.92em", lineHeight: 1.15, textAlign: "center" }}>
      <span style={{ padding: "0 3px 1px" }}>{n}</span>
      <span style={{ borderTop: "1.3px solid currentColor", width: "100%", height: 0 }} />
      <span style={{ padding: "1px 3px 0" }}>{d}</span>
    </span>
  );
}

// Neat mixed number: the whole part sits level with the fraction bar.
function Mixed({ w, n, d }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", verticalAlign: "middle", gap: 2, margin: "0 2px" }}>
      <span>{w}</span>
      <Frac n={n} d={d} />
    </span>
  );
}

// Italic serif x / y / z / n (and runs such as xy) wherever they appear as bare
// letters in a prompt or answer, so the algebraic x never looks like the
// multiplication sign. Walks strings, arrays, fragments and plain DOM
// elements; custom components and SVG are left alone.
function mathify(node) {
  if (typeof node === "string") {
    const re = /(^|[^A-Za-z])([xyzn]+)(?![A-Za-z])/g;
    const out = [];
    let last = 0, m, k = 0;
    while ((m = re.exec(node)) !== null) {
      const start = m.index + m[1].length;
      if (start > last) out.push(node.slice(last, start));
      out.push(<i key={k++} style={{ fontFamily: "'Times New Roman', Times, serif", fontSize: "1.08em" }}>{m[2]}</i>);
      last = start + m[2].length;
    }
    if (!out.length) return node;
    if (last < node.length) out.push(node.slice(last));
    return out;
  }
  if (Array.isArray(node)) return node.map((c, i) => { const r = mathify(c); return Array.isArray(r) ? <React.Fragment key={i}>{r}</React.Fragment> : r; });
  if (React.isValidElement(node) && (node.type === React.Fragment || (typeof node.type === "string" && node.type !== "svg"))) {
    const ch = node.props.children;
    if (ch === undefined || ch === null) return node;
    return React.cloneElement(node, undefined, ...(Array.isArray(ch) ? ch : [ch]).map((c, i) => { const r = mathify(c); return Array.isArray(r) ? <React.Fragment key={i}>{r}</React.Fragment> : r; }));
  }
  return node;
}

// Arc and label for one angle: P-V-Q with the angle at V. The label sits on
// the bisector, far enough out to clear both lines, with a white halo.
function AngleMark({ V, P, Q, label, arcR = 20, bold = false, fontSize = 12.5, inset = false, outside = false }) {
  const norm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const dP = Math.hypot(P[0] - V[0], P[1] - V[1]), dQ = Math.hypot(Q[0] - V[0], Q[1] - V[1]);
  const u1 = norm([P[0] - V[0], P[1] - V[1]]), u2 = norm([Q[0] - V[0], Q[1] - V[1]]);
  const cross = u1[0] * u2[1] - u1[1] * u2[0];
  const dot = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]));
  const ang = Math.acos(dot);
  // `inset` pulls both ends of the arc in from the lines so neighbouring arcs
  // (angles about a point / on a line) stay separate marks.
  const sgn = cross > 0 ? 1 : -1;
  const delta = inset ? Math.min(0.17, ang * 0.2) : 0;
  const rot = (v, t) => [v[0] * Math.cos(t) - v[1] * Math.sin(t), v[0] * Math.sin(t) + v[1] * Math.cos(t)];
  const r1 = rot(u1, sgn * delta), r2 = rot(u2, -sgn * delta);
  const a1 = [V[0] + r1[0] * arcR, V[1] + r1[1] * arcR], a2 = [V[0] + r2[0] * arcR, V[1] + r2[1] * arcR];
  const bis = norm([u1[0] + u2[0], u1[1] + u2[1]]);
  const text = String(label);
  const halfW = text.length * 3.7 + 3;
  // Clearance needed so the text box (half-width halfW, half-height 7) fits
  // inside the wedge, measured across the bisector.
  const ext = halfW * Math.abs(bis[1]) + 7 * Math.abs(bis[0]);
  const need = (ext + 3) / Math.max(Math.sin(ang / 2), 0.1);
  let lr = Math.max(arcR + 17, need);
  const cap = 0.75 * Math.min(dP, dQ);
  if (lr > cap) lr = Math.max(arcR + 10, cap);
  // `outside` puts the label beyond the vertex (away from the angle), for long labels.
  const outDist = 6 + halfW * 0.8 * Math.abs(bis[0]) + 7 * Math.abs(bis[1]);
  const lx = outside ? V[0] - bis[0] * outDist : V[0] + bis[0] * lr;
  const ly = outside ? V[1] - bis[1] * outDist : V[1] + bis[1] * lr;
  return (
    <g>
      <path d={`M${a1[0]},${a1[1]} A${arcR},${arcR} 0 0 ${cross > 0 ? 1 : 0} ${a2[0]},${a2[1]}`} fill="none" stroke="#000" strokeWidth="1.1" />
      <text x={lx} y={ly + 4} fontSize={fontSize} fontFamily="Arial, sans-serif" fontWeight={bold ? 700 : 400} textAnchor="middle" fill="#000" stroke="#fff" strokeWidth="3" paintOrder="stroke">{svgMath(text)}</text>
    </g>
  );
}

// Real superscript for an index: the base followed by a raised exponent, so
// "8^(2/3)" and "10^-5" print the way a textbook does. `e` may be a number
// (negatives get a true minus sign) or JSX such as an <IdxFrac /> for a
// fractional index. An exponent of 1 is dropped (x^1 -> x). `tall` pins the
// exponent to the top of the line for a very tall base such as a bracketed
// stacked fraction.
function Pow({ b, e, tall }) {
  if (e === 1) return <>{b}</>;
  const plain = typeof e === "number" || typeof e === "string";
  const shown = typeof e === "number" ? (e < 0 ? `\u2212${-e}` : `${e}`) : e;
  // Whole-number exponents sit at the usual superscript height. A fractional
  // index is a stacked fraction with a horizontal bar, lifted well above the
  // baseline so it reads as an exponent (centred around the top of the base)
  // rather than sitting down beside it.
  return (
    <>
      {b}
      <sup style={{ fontSize: plain ? "0.7em" : "0.8em", lineHeight: tall ? 1 : 0, verticalAlign: tall ? "top" : plain ? "super" : "0.9em", marginLeft: 1, whiteSpace: "nowrap" }}>{shown}</sup>
    </>
  );
}
// Stacked fraction (numerator, horizontal bar, denominator) for use as the
// exponent in <Pow>; `neg` puts a minus sign level with the bar.
function IdxFrac({ n, d, neg }) {
  const frac = (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", verticalAlign: "middle", lineHeight: 1.1, margin: "0 1px" }}>
      <span style={{ padding: "0 2px" }}>{n}</span>
      <span style={{ borderTop: "1.2px solid currentColor", width: "100%", textAlign: "center", padding: "0 2px" }}>{d}</span>
    </span>
  );
  return neg ? <span style={{ display: "inline-flex", alignItems: "center", verticalAlign: "middle" }}><span style={{ marginRight: 3, fontWeight: 600 }}>{"\u2212"}</span>{frac}</span> : frac;
}
// Brackets that stretch to the height of what they hold (a stacked fraction).
function TallParens({ children }) {
  const paren = { fontSize: "2.1em", fontWeight: 200, lineHeight: 0.6, verticalAlign: "middle", display: "inline-block" };
  return (
    <>
      <span style={paren}>(</span>
      {children}
      <span style={paren}>)</span>
    </>
  );
}
// nth root: the root index sits small and raised before the radical sign
// (a square root shows no index).
function Root({ n, x }) {
  return (
    <>
      {n !== 2 && <sup style={{ fontSize: "0.65em", lineHeight: 0, verticalAlign: "super", marginRight: 1 }}>{n}</sup>}
      {"\u221a"}
      <span style={{ borderTop: "1px solid currentColor", padding: "0 2px" }}>{x}</span>
    </>
  );
}

const SUBTOPIC_BANK = {
  "venn-shade": {
    topic: "Venn Diagrams", title: "Set notation — shade a region", marks: 1,
    build(rng) {
      const shadeChoice = pick(rng, ["aOnly", "bOnly"]);
      return {
        prompt: `On the diagram, shade the region that represents A ${shadeChoice === "aOnly" ? "∩ B′" : "′ ∩ B"}.`,
        render: <VennSVG labelA="A" labelB="B" shade={shadeChoice} />,
        answer: `Region inside ${shadeChoice === "aOnly" ? "A only" : "B only"} shaded.`,
      };
    },
  },
  "venn-complete": {
    topic: "Venn Diagrams", title: "Complete a diagram from a word problem", marks: 2,
    build(rng) {
      const ctx = pick(rng, CONTEXTS);
      const total = seededInt(rng, 24, 36);
      const p = partitionFour(rng, total);
      return {
        prompt: `${p.aOnly + p.both} out of ${total} ${ctx.noun} ${ctx.verb} ${ctx.labelA}. ${p.bOnly + p.both} ${ctx.verb} ${ctx.labelB}. ${p.both} ${ctx.verb} both. Complete the Venn diagram.`,
        render: <VennSVG labelA={ctx.labelA} labelB={ctx.labelB} />,
        answerRender: <VennSVG labelA={ctx.labelA} labelB={ctx.labelB} values={p} />,
        answer: `${ctx.labelA} only = ${p.aOnly}, both = ${p.both}, ${ctx.labelB} only = ${p.bOnly}, outside = ${p.outside}`,
      };
    },
  },
  "venn-prob-only": {
    topic: "Venn Diagrams", title: "Probability — one region only", marks: 1,
    build(rng) {
      const ctx = pick(rng, CONTEXTS);
      const total = seededInt(rng, 30, 50);
      const p = partitionFour(rng, total);
      return {
        prompt: `The Venn diagram shows information about ${total} ${ctx.noun}. Find P(${ctx.labelA} only).`,
        render: <VennSVG labelA={ctx.labelA} labelB={ctx.labelB} values={p} />,
        answer: <Frac n={p.aOnly} d={total} />,
      };
    },
  },
  "venn-prob-union": {
    topic: "Venn Diagrams", title: "Probability — union", marks: 1,
    build(rng) {
      const ctx = pick(rng, CONTEXTS);
      const total = seededInt(rng, 30, 50);
      const p = partitionFour(rng, total);
      return {
        prompt: `The Venn diagram shows information about ${total} ${ctx.noun}. Find P(${ctx.labelA} ∪ ${ctx.labelB}).`,
        render: <VennSVG labelA={ctx.labelA} labelB={ctx.labelB} values={p} />,
        answer: <Frac n={p.aOnly + p.bOnly + p.both} d={total} />,
      };
    },
  },
  "venn-missing": {
    topic: "Venn Diagrams", title: "Find a missing region from n() notation", marks: 2,
    build(rng) {
      const total = seededInt(rng, 40, 60);
      const p = partitionFour(rng, total);
      return {
        prompt: `e = ${total}, n(A) = ${p.aOnly + p.both}, n(B) = ${p.bOnly + p.both}, n(A ∩ B) = ${p.both}. Find n(neither A nor B).`,
        answer: `${p.outside}`,
      };
    },
  },

  "eb-single-pos": {
    topic: "Expanding Brackets", title: "Single bracket, positive coefficient", marks: 1,
    build(rng) {
      const a = seededInt(rng, 2, 6), b = seededInt(rng, 2, 9);
      return { prompt: `Expand and simplify ${a}(x + ${b})`, answer: `${a}x ${pm(a * b)}` };
    },
  },
  "eb-single-neg": {
    topic: "Expanding Brackets", title: "Single bracket, negative sign", marks: 1,
    build(rng) {
      const a = seededInt(rng, 2, 6), b = seededInt(rng, 2, 9);
      return { prompt: `Expand and simplify -${a}(x + ${b})`, answer: `-${a}x ${pm(-a * b)}` };
    },
  },
  "eb-single-term-outside": {
    topic: "Expanding Brackets", title: "Single bracket, algebraic term outside", marks: 2,
    build(rng) {
      const coeff = seededInt(rng, 2, 6), bAbs = seededInt(rng, 2, 9);
      const sign = pick(rng, ["+", "-"]);
      const bSigned = sign === "+" ? bAbs : -bAbs;
      return {
        prompt: `Expand and simplify ${coeff}x(x ${sign} ${bAbs})`,
        answer: `${coeff}x² ${pmX(coeff * bSigned, "x")}`,
      };
    },
  },
  "eb-double-pos": {
    topic: "Expanding Brackets", title: "Double brackets, both positive", marks: 2,
    build(rng) {
      const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9);
      return { prompt: `Expand and simplify (x + ${a})(x + ${b})`, answer: `x² ${pmX(a + b, "x")} ${pm(a * b)}` };
    },
  },
  "eb-double-mixed": {
    topic: "Expanding Brackets", title: "Double brackets, mixed signs", marks: 2,
    build(rng) {
      const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9);
      return { prompt: `Expand and simplify (x + ${a})(x - ${b})`, answer: `x² ${pmX(a - b, "x")} ${pm(-a * b)}` };
    },
  },
  "eb-double-neg": {
    topic: "Expanding Brackets", title: "Double brackets, both negative", marks: 2,
    build(rng) {
      const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9);
      return { prompt: `Expand and simplify (x - ${a})(x - ${b})`, answer: `x² ${pmX(-(a + b), "x")} ${pm(a * b)}` };
    },
  },
  "eb-squared": {
    topic: "Expanding Brackets", title: "Repeated (squared) bracket", marks: 2,
    build(rng) {
      const a = seededInt(rng, 2, 9);
      return { prompt: `Expand and simplify (x - ${a})²`, answer: `x² ${pmX(-2 * a, "x")} ${pm(a * a)}` };
    },
  },

  "fac-common": {
    topic: "Factorising", title: "Common factor", marks: 1,
    build(rng) {
      const c = seededInt(rng, 2, 5), a = seededInt(rng, 2, 6), b = seededInt(rng, 2, 9);
      return { prompt: `Factorise fully ${c * a}x + ${c * b}`, answer: `${c}(${a}x + ${b})` };
    },
  },
  "fac-quadratic": {
    topic: "Factorising", title: "Simple quadratic (coefficient 1)", marks: 2,
    build(rng) {
      const a = seededInt(rng, 1, 7), b = seededInt(rng, 1, 7);
      return { prompt: `Factorise x² ${pmX(a + b, "x")} ${pm(a * b)}`, answer: `(x + ${a})(x + ${b})` };
    },
  },
  "fac-dots": {
    topic: "Factorising", title: "Difference of two squares", marks: 1,
    build(rng) {
      const a = seededInt(rng, 2, 9);
      return { prompt: `Factorise x² - ${a * a}`, answer: `(x + ${a})(x - ${a})` };
    },
  },
  "fac-hcf-lookalike": {
    topic: "Factorising", title: "HCF with single x term (DOTS look-alike)", marks: 1,
    build(rng) {
      const a = seededInt(rng, 2, 9);
      return { prompt: `Factorise x² - ${a}x`, answer: `x(x - ${a})` };
    },
  },

  "product-rule-counting": {
    topic: "Probability", title: "Product rule for counting", marks: 1,
    build(rng) {
      const items = pick(rng, [
        { a: "sandwich fillings", b: "drinks" },
        { a: "starters", b: "main courses" },
        { a: "T-shirt colours", b: "sizes" },
      ]);
      const a = seededInt(rng, 3, 6), b = seededInt(rng, 2, 5);
      return {
        prompt: `A café offers ${a} types of ${items.a} and ${b} types of ${items.b}. Work out the number of different combinations of one ${items.a.replace(/s$/, "")} and one ${items.b.replace(/s$/, "")}.`,
        answer: `${a} × ${b} = ${a * b}`,
      };
    },
  },
  "tree-replacement": {
    topic: "Probability", title: "Tree diagram — with replacement", marks: 2,
    build(rng) {
      const total = seededInt(rng, 6, 10);
      const r = seededInt(rng, 2, total - 2);
      const b = total - r;
      return {
        prompt: `A bag contains ${r} red counters and ${b} blue counters. A counter is taken at random and replaced. A second counter is then taken. Find P(both counters are the same colour).`,
        answer: <>(<Frac n={r} d={total} />)² + (<Frac n={b} d={total} />)² = <Frac n={r * r + b * b} d={total * total} /></>,
      };
    },
  },
  "tree-no-replacement": {
    topic: "Probability", title: "Tree diagram — without replacement", marks: 2,
    build(rng) {
      const total = seededInt(rng, 6, 10);
      const red = seededInt(rng, 2, total - 2);
      return {
        prompt: `A bag contains ${total} counters, of which ${red} are red. A counter is taken at random and not replaced. A second counter is then taken. Find P(both counters are red).`,
        answer: <><Frac n={red} d={total} /> × <Frac n={red - 1} d={total - 1} /> = <Frac n={red * (red - 1)} d={total * (total - 1)} /></>,
      };
    },
  },

  "set-notation-list": {
    topic: "Set Notation", title: "List the elements of a set", marks: 2,
    build(rng) {
      const k = seededInt(rng, 2, 5);
      const m = seededInt(rng, 20, 40);
      const elems = [];
      for (let n = k; n < m; n += k) elems.push(n);
      return {
        prompt: `A is the set of multiples of ${k} less than ${m}. List the elements of set A.`,
        answer: `A = ${elems.join(", ")}`,
      };
    },
  },
  "set-notation-membership": {
    topic: "Set Notation", title: "Set membership (∈ / ∉)", marks: 1,
    build(rng) {
      const k = seededInt(rng, 2, 5);
      const m = seededInt(rng, 20, 40);
      const elems = [];
      for (let n = k; n < m; n += k) elems.push(n);
      const isMember = pick(rng, [true, false]);
      const x = isMember ? pick(rng, elems) : (() => {
        let v;
        do { v = seededInt(rng, 1, m); } while (elems.includes(v));
        return v;
      })();
      return {
        prompt: `A is the set of multiples of ${k} less than ${m}. Is ${x} ∈ A? Write True or False.`,
        answer: isMember ? "True" : "False",
      };
    },
  },

  "boxplot-range": {
    topic: "Boxplots", title: "Range from a boxplot", marks: 1,
    build(rng) {
      const ctx = pick(rng, [
        { noun: "runners", label: "times (minutes) taken to finish a race" },
        { noun: "plants", label: "heights (cm)" },
        { noun: "students", label: "test scores (marks out of 100)" },
      ]);
      const min = seededInt(rng, 2, 10);
      const q1 = min + seededInt(rng, 3, 8);
      const median = q1 + seededInt(rng, 2, 6);
      const q3 = median + seededInt(rng, 2, 6);
      const max = q3 + seededInt(rng, 3, 8);
      return {
        prompt: `The boxplot shows the ${ctx.label} for a group of ${ctx.noun}. Find the range.`,
        render: <BoxplotSVG min={min} q1={q1} median={median} q3={q3} max={max} unitLabel={ctx.label} />,
        answer: `${max} - ${min} = ${max - min}`,
      };
    },
  },
  "boxplot-iqr": {
    topic: "Boxplots", title: "Interquartile range from a boxplot", marks: 1,
    build(rng) {
      const ctx = pick(rng, [
        { noun: "runners", label: "times (minutes) taken to finish a race" },
        { noun: "plants", label: "heights (cm)" },
        { noun: "students", label: "test scores (marks out of 100)" },
      ]);
      const min = seededInt(rng, 2, 10);
      const q1 = min + seededInt(rng, 3, 8);
      const median = q1 + seededInt(rng, 2, 6);
      const q3 = median + seededInt(rng, 2, 6);
      const max = q3 + seededInt(rng, 3, 8);
      return {
        prompt: `The boxplot shows the ${ctx.label} for a group of ${ctx.noun}. Find the interquartile range (IQR).`,
        render: <BoxplotSVG min={min} q1={q1} median={median} q3={q3} max={max} unitLabel={ctx.label} />,
        answer: `${q3} - ${q1} = ${q3 - q1}`,
      };
    },
  },

  "cf-table-complete": {
    topic: "Cumulative Frequency", title: "Complete a cumulative frequency table", marks: 2,
    build(rng) {
      const freqs = [seededInt(rng, 3, 12), seededInt(rng, 3, 12), seededInt(rng, 3, 12), seededInt(rng, 3, 12)];
      const bounds = [0, 10, 20, 30, 40];
      let running = 0;
      const cum = freqs.map((f) => (running += f));
      const rows = freqs.map((f, i) => `${bounds[i]} < t ≤ ${bounds[i + 1]}: frequency ${f}`).join("; ");
      return {
        prompt: `A survey records times, t (minutes). ${rows}. Complete the cumulative frequency column.`,
        render: (
          <table style={{ borderCollapse: "collapse", fontSize: 12, fontFamily: "Arial, sans-serif" }}>
            <thead>
              <tr>
                <th style={cellStyle}>Time (t)</th>
                <th style={cellStyle}>Frequency</th>
                <th style={cellStyle}>Cumulative frequency</th>
              </tr>
            </thead>
            <tbody>
              {freqs.map((f, i) => (
                <tr key={i}>
                  <td style={cellStyle}>{bounds[i]} &lt; t ≤ {bounds[i + 1]}</td>
                  <td style={cellStyle}>{f}</td>
                  <td style={cellStyle}>&nbsp;</td>
                </tr>
              ))}
            </tbody>
          </table>
        ),
        answer: `Cumulative frequencies: ${cum.join(", ")}`,
      };
    },
  },
  "cf-median-class": {
    topic: "Cumulative Frequency", title: "Identify the class containing the median", marks: 1,
    build(rng) {
      const freqs = [seededInt(rng, 3, 12), seededInt(rng, 3, 12), seededInt(rng, 3, 12), seededInt(rng, 3, 12)];
      const bounds = [0, 10, 20, 30, 40];
      let running = 0;
      const cum = freqs.map((f) => (running += f));
      const total = cum[cum.length - 1];
      const half = total / 2;
      const idx = cum.findIndex((c) => c >= half);
      const rows = freqs.map((f, i) => `${bounds[i]} < t ≤ ${bounds[i + 1]}: cumulative frequency ${cum[i]}`).join("; ");
      return {
        prompt: `${total} students were timed. ${rows}. Which class interval contains the median?`,
        answer: `${bounds[idx]} < t ≤ ${bounds[idx + 1]} (median is the ${half}th value)`,
      };
    },
  },
};

const cellStyle = { border: "1px solid #000", padding: "4px 10px", textAlign: "center" };
function bracket(v) { return v >= 0 ? `(x + ${v})` : `(x - ${-v})`; }

/* --- HT1 Week 1: Expanding Triple Brackets, Factorising Quadratics (a=1, a>1), Solving by Factorising --- */
SUBTOPIC_BANK["expanding-triple-brackets"] = {
  topic: "Expanding Brackets", title: "Triple brackets", marks: 3,
  build(rng) {
    const vals = [seededInt(rng, 1, 5), seededInt(rng, 1, 5), seededInt(rng, 1, 5)].map((v) => pick(rng, [1, -1]) * v);
    const [a, b, c] = vals;
    const p = a + b + c, q = a * b + b * c + c * a, r = a * b * c;
    return {
      prompt: `Expand and simplify ${bracket(a)}${bracket(b)}${bracket(c)}`,
      answer: `x³ ${pmX(p, "x²")} ${pmX(q, "x")} ${pm(r)}`,
    };
  },
};
// Shared by the "coefficient of x² > 1" factorising/solving subtopics below:
// picking p, q, m, n independently from up to {2,3} and {1..6} allows an
// "ac" product (p*q*m*n — the number a student has to find a factor pair of,
// via the ac-method, that sums to the x-coefficient) as large as 9*36=324,
// which realistically needs a calculator to factor. Capping it at maxAC
// keeps every generated question mentally factorable, matching how these
// are actually meant to be practised (non-calculator). Rejection sampling
// rather than shrinking m/n's range outright, since p*q varies (4-9) and a
// fixed smaller range would either still allow large ac at p*q=9 or needlessly
// restrict variety at p*q=4.
function pickNonMonicFactors(rng, maxAC = 60) {
  let p, q, m, n;
  for (let tries = 0; tries < 50; tries++) {
    p = seededInt(rng, 2, 3);
    q = seededInt(rng, 2, 3);
    m = seededInt(rng, 1, 6);
    n = seededInt(rng, 1, 6);
    if (p * q * m * n <= maxAC) break;
  }
  return { p, q, m, n };
}
SUBTOPIC_BANK["fac-quadratic-agt1"] = {
  topic: "Factorising", title: "Quadratic, coefficient of x² greater than 1", marks: 2,
  build(rng) {
    const { p, q, m, n } = pickNonMonicFactors(rng);
    const lead = p * q, xc = p * n + q * m, con = m * n;
    return {
      prompt: `Factorise ${lead}x² ${pmX(xc, "x")} ${pm(con)}`,
      answer: `(${p}x + ${m})(${q}x + ${n})`,
    };
  },
};

/* --- Factorising: expansion to match Mr Barton's full "Factorising" skill list --- */
SUBTOPIC_BANK["fac-common-algebraic"] = {
  topic: "Factorising", title: "Common factor including a letter", marks: 1,
  build(rng) {
    const A = seededInt(rng, 2, 9) * seededInt(rng, 1, 3);
    const B = seededInt(rng, 2, 9) * seededInt(rng, 1, 3);
    const g = gcd(A, B);
    const coeff = g === 1 ? "" : `${g}`;
    return { prompt: `Factorise fully ${A}x² + ${B}x`, answer: `${coeff}x(${A / g}x + ${B / g})` };
  },
};
SUBTOPIC_BANK["fac-monic-neg"] = {
  topic: "Factorising", title: "Quadratic with negative terms (coefficient 1)", marks: 2,
  build(rng) {
    const a = seededInt(rng, 1, 9), b = seededInt(rng, 1, 9);
    return { prompt: `Factorise x² ${pmX(a - b, "x")} ${pm(-a * b)}`, answer: `(x + ${a})(x - ${b})` };
  },
};
SUBTOPIC_BANK["fac-monic-perfect-square"] = {
  topic: "Factorising", title: "Perfect square trinomial (coefficient 1)", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 9);
    const sign = pick(rng, [1, -1]);
    return {
      prompt: `Factorise x² ${pmX(sign * 2 * a, "x")} ${pm(a * a)}`,
      answer: sign === 1 ? `(x + ${a})²` : `(x - ${a})²`,
    };
  },
};
SUBTOPIC_BANK["fac-nonmonic-neg"] = {
  topic: "Factorising", title: "Non-monic quadratic with negative terms", marks: 3,
  build(rng) {
    const { p, q, m, n } = pickNonMonicFactors(rng);
    const lead = p * q, xc = q * m - p * n, con = -(m * n);
    return {
      prompt: `Factorise ${lead}x² ${pmX(xc, "x")} ${pm(con)}`,
      answer: `(${p}x + ${m})(${q}x - ${n})`,
    };
  },
};
SUBTOPIC_BANK["fac-nonmonic-perfect-square"] = {
  topic: "Factorising", title: "Non-monic perfect square trinomial", marks: 3,
  build(rng) {
    const p = seededInt(rng, 2, 4), m = seededInt(rng, 2, 7);
    const sign = pick(rng, [1, -1]);
    const lead = p * p, xc = sign * 2 * p * m, con = m * m;
    return {
      prompt: `Factorise ${lead}x² ${pmX(xc, "x")} ${pm(con)}`,
      answer: sign === 1 ? `(${p}x + ${m})²` : `(${p}x - ${m})²`,
    };
  },
};
SUBTOPIC_BANK["fac-dots-nonmonic"] = {
  topic: "Factorising", title: "Difference of two squares (non-monic / two variables)", marks: 2,
  build(rng) {
    const variant = pick(rng, ["coeff", "twoVar"]);
    if (variant === "coeff") {
      const p = seededInt(rng, 2, 6), m = seededInt(rng, 2, 9);
      return { prompt: `Factorise ${p * p}x² - ${m * m}`, answer: `(${p}x + ${m})(${p}x - ${m})` };
    }
    const a = seededInt(rng, 2, 9);
    return { prompt: `Factorise x² - ${a * a}y²`, answer: `(x + ${a}y)(x - ${a}y)` };
  },
};
SUBTOPIC_BANK["fac-common-then-simplify"] = {
  topic: "Factorising", title: "Common factor, then factorise fully", marks: 3,
  build(rng) {
    const c = seededInt(rng, 2, 5), a = seededInt(rng, 2, 8);
    return { prompt: `Factorise fully ${c}x² - ${c * a * a}`, answer: `${c}(x + ${a})(x - ${a})` };
  },
};
SUBTOPIC_BANK["fac-negative-leading"] = {
  topic: "Factorising", title: "Negative leading coefficient", marks: 2,
  build(rng) {
    const a = seededInt(rng, 1, 8), b = seededInt(rng, 1, 8);
    return {
      prompt: `Factorise -x² ${pmX(a + b, "x")} ${pm(-a * b)}`,
      answer: `-(x - ${a})(x - ${b})`,
    };
  },
};
SUBTOPIC_BANK["fac-common-bracket"] = {
  topic: "Factorising", title: "Common bracket factor", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9);
    return { prompt: `Factorise x(x + ${a}) + ${b}(x + ${a})`, answer: `(x + ${a})(x + ${b})` };
  },
};
SUBTOPIC_BANK["fac-grouping"] = {
  topic: "Factorising", title: "Factorising by grouping (four terms)", marks: 3,
  build(rng) {
    const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9);
    return { prompt: `Factorise by grouping: x² + ${a}x + ${b}x + ${a * b}`, answer: `(x + ${a})(x + ${b})` };
  },
};
SUBTOPIC_BANK["fac-two-variables"] = {
  topic: "Factorising", title: "Quadratic in two variables", marks: 3,
  build(rng) {
    const a = seededInt(rng, 1, 7), b = seededInt(rng, 1, 7);
    return {
      prompt: `Factorise x² ${pmX(a + b, "xy")} ${pmX(a * b, "y²")}`,
      answer: `(x + ${a}y)(x + ${b}y)`,
    };
  },
};

SUBTOPIC_BANK["solve-quadratic-factorise"] = {
  topic: "Solving Quadratics", title: "Solve by factorising (a = 1)", marks: 2,
  build(rng) {
    const a = seededInt(rng, 1, 7), b = seededInt(rng, 1, 7);
    return {
      prompt: `Solve by factorising: x² ${pmX(a + b, "x")} ${pm(a * b)} = 0`,
      answer: `x = -${a} or x = -${b}`,
    };
  },
};
SUBTOPIC_BANK["solve-quadratic-factorise-agt1"] = {
  topic: "Solving Quadratics", title: "Solve by factorising (a ≠ 1)", marks: 3,
  build(rng) {
    const { p, q, m, n } = pickNonMonicFactors(rng);
    const lead = p * q, xc = p * n + q * m, con = m * n;
    // Roots are -m/p and -n/q — reduce each fraction so answers like "x = -1/2"
    // come out in lowest terms rather than e.g. "x = -2/4".
    const fracStr = (num, den) => {
      const g = gcd(num, den);
      const rn = num / g, rd = den / g;
      return rd === 1 ? `${rn}` : `${rn}/${rd}`;
    };
    return {
      prompt: `Solve by factorising: ${lead}x² ${pmX(xc, "x")} ${pm(con)} = 0`,
      answer: `(${p}x + ${m})(${q}x + ${n}) = 0, so x = -${fracStr(m, p)} or x = -${fracStr(n, q)}`,
    };
  },
};
SUBTOPIC_BANK["solve-quadratic-rearrange"] = {
  topic: "Solving Quadratics", title: "Rearrange to = 0, then solve by factorising", marks: 3,
  build(rng) {
    // Roots p and -q (p ≠ q so the x-coefficient isn't 0), presented with a
    // constant split across both sides so the student has to combine/move
    // terms before the equation is in the usual "= 0" form to factorise.
    let p, q;
    do {
      p = seededInt(rng, 1, 8);
      q = seededInt(rng, 1, 8);
    } while (p === q);
    const xCoeff = q - p;
    const con = p * q;
    const a = seededInt(rng, 1, 9);
    const b = a + con;
    // pm0(n, "x") would render a coefficient of 1 or -1 as "1x"/"-1x" — write
    // the x-term by hand so it reads "x"/"-x" instead, same idea as coefX().
    const xTerm = (() => {
      const abs = Math.abs(xCoeff);
      return ` ${xCoeff > 0 ? "+" : "-"} ${abs === 1 ? "x" : `${abs}x`}`;
    })();
    return {
      prompt: `Solve: x²${xTerm} + ${a} = ${b}`,
      answer: `Rearrange to x²${xTerm} - ${con} = 0, then factorise: (x - ${p})(x + ${q}) = 0, so x = ${p} or x = -${q}`,
    };
  },
};

/* --- HT3 Week 4: Histograms, Circle Facts --- top skills by exam-spec usage (Dr Frost data) */
SUBTOPIC_BANK["histogram-freq-density"] = {
  topic: "Histograms", title: "Frequency density from a frequency table", marks: 1,
  build(rng) {
    const width = pick(rng, [2, 4, 5, 10]);
    const fd = seededInt(rng, 2, 8);
    const freq = fd * width;
    const lower = seededInt(rng, 0, 20);
    return {
      prompt: `A class interval ${lower} < h ≤ ${lower + width} has a frequency of ${freq}. Calculate the frequency density for this class.`,
      answer: `${freq} ÷ ${width} = ${fd}`,
    };
  },
};
SUBTOPIC_BANK["histogram-read-bar"] = {
  topic: "Histograms", title: "Frequency from a histogram bar", marks: 1,
  build(rng) {
    const width = pick(rng, [2, 4, 5, 10]);
    const fd = seededInt(rng, 2, 8);
    const freq = fd * width;
    const lower = seededInt(rng, 0, 20);
    return {
      prompt: `On a histogram, the bar for ${lower} < h ≤ ${lower + width} has a frequency density of ${fd}. Calculate the frequency for this class.`,
      answer: `${fd} × ${width} = ${freq}`,
    };
  },
};
SUBTOPIC_BANK["histogram-total-frequency"] = {
  topic: "Histograms", title: "Total frequency from a histogram", marks: 2,
  build(rng) {
    const widths = [2, 4, 4, 10];
    const fds = widths.map(() => seededInt(rng, 2, 7));
    const freqs = widths.map((w, i) => w * fds[i]);
    const total = freqs.reduce((a, b) => a + b, 0);
    const rows = widths.map((w, i) => `width ${w}, frequency density ${fds[i]}`).join("; ")
    return {
      prompt: `A histogram has 4 bars: ${rows}. Calculate the total frequency represented by the histogram.`,
      answer: `${freqs.join(" + ")} = ${total}`,
    };
  },
};

const CIRCLE_TERMS = [
  { def: "a straight line from the centre of a circle to any point on its circumference", term: "radius" },
  { def: "a straight line passing through the centre, connecting two points on the circumference", term: "diameter" },
  { def: "a straight line that touches the circle at exactly one point", term: "tangent" },
  { def: "a straight line joining two points on the circumference (not through the centre)", term: "chord" },
  { def: "part of the circumference of a circle", term: "arc" },
  { def: "the region enclosed by an arc and two radii", term: "sector" },
  { def: "the region enclosed by a chord and an arc", term: "segment" },
];
SUBTOPIC_BANK["circle-facts-parts"] = {
  topic: "Circle Facts", title: "Name the part of a circle", marks: 1,
  build(rng) {
    const t = pick(rng, CIRCLE_TERMS);
    return { prompt: `State the mathematical term for: ${t.def}.`, answer: t.term };
  },
};
SUBTOPIC_BANK["circle-facts-circumference-area"] = {
  topic: "Circle Facts", title: "Circumference or area from the radius", marks: 2,
  build(rng) {
    const r = seededInt(rng, 3, 12);
    const wantArea = pick(rng, [true, false]);
    return wantArea
      ? { prompt: `A circle has radius ${r} cm. Calculate its area. Give your answer in terms of π.`, answer: `π × ${r}² = ${r * r}π cm² (≈ ${(Math.PI * r * r).toFixed(1)} cm²)` }
      : { prompt: `A circle has radius ${r} cm. Calculate its circumference. Give your answer in terms of π.`, answer: `2 × π × ${r} = ${2 * r}π cm (≈ ${(2 * Math.PI * r).toFixed(1)} cm)` };
  },
};

/* Every scheme of work the school uses gets its own week-map here.
   Add a new key (e.g. "Year 11 · Set 1 (2026/27)") once that scheme's
   weeks are mapped — the picker below will offer it automatically. */

/* --- HT1 Week 2: Completing the Square, Solving (Completing Square & Quadratic Formula), Plotting Non-linear Graphs --- */
SUBTOPIC_BANK["completing-the-square"] = {
  topic: "Completing the Square", title: "Write in completed-square form", marks: 2,
  build(rng) {
    const k = seededInt(rng, 1, 6) * pick(rng, [1, -1]);
    const c = seededInt(rng, -10, 10);
    const p = k, q = c - k * k;
    return { prompt: `Write x² ${pmX(2 * k, "x")} ${pm(c)} in the form (x + p)² + q.`, answer: `(x ${pm(p)})² ${pm(q)}` };
  },
};
SUBTOPIC_BANK["completing-the-square-odd-b"] = {
  topic: "Completing the Square", title: "Write in completed-square form (b is odd)", marks: 3,
  build(rng) {
    const bAbs = pick(rng, [1, 3, 5, 7, 9]);
    const b = bAbs * pick(rng, [1, -1]);
    const c = seededInt(rng, -10, 10);
    // p = b/2 is a half-integer whenever b is odd, and q = c - p² =
    // (4c - b²)/4. Since b is odd, b² is odd and 4c is a multiple of 4 (so
    // even) — even minus odd is always odd, meaning the numerator can never
    // share a factor of 2 with the denominator 4, so q is already in lowest
    // terms with no further reduction needed.
    const qNum = 4 * c - b * b;
    const pSign = b >= 0 ? "+" : "-";
    const qSign = qNum >= 0 ? "+" : "-";
    return {
      prompt: `Write x² ${pmX(b, "x")} ${pm(c)} in the form (x + p)² + q.`,
      answer: <>(x {pSign} <Frac n={bAbs} d={2} />)² {qSign} <Frac n={Math.abs(qNum)} d={4} /></>,
    };
  },
};
SUBTOPIC_BANK["solve-completing-square"] = {
  topic: "Completing the Square", title: "Solve by completing the square (surd form)", marks: 3,
  build(rng) {
    const p = seededInt(rng, 1, 5) * pick(rng, [1, -1]);
    const m = seededInt(rng, 2, 20);
    const b = 2 * p, c = p * p - m;
    return { prompt: `Solve x² ${pmX(b, "x")} ${pm(c)} = 0 by completing the square. Give your answer in surd form.`, answer: `x = ${-p} ± √${m}` };
  },
};
SUBTOPIC_BANK["solve-quadratic-formula"] = {
  topic: "Quadratic Formula", title: "Solve using the quadratic formula", marks: 3,
  build(rng) {
    let a, b, c, D;
    do {
      a = seededInt(rng, 1, 3); b = seededInt(rng, -9, 9); c = seededInt(rng, -9, 9);
      D = b * b - 4 * a * c;
    } while (D < 0);
    const x1 = ((-b + Math.sqrt(D)) / (2 * a)).toFixed(2);
    const x2 = ((-b - Math.sqrt(D)) / (2 * a)).toFixed(2);
    return {
      prompt: `Solve ${a === 1 ? "" : a}x² ${pmX(b, "x")} ${pm(c)} = 0 using the quadratic formula. Give your answers to 2 decimal places.`,
      answer: `x = ${x1} or x = ${x2}`,
    };
  },
};
SUBTOPIC_BANK["plot-nonlinear-graph"] = {
  topic: "Graphs", title: "Complete a table of values for a quadratic", marks: 2,
  build(rng) {
    const c = seededInt(rng, -5, 5);
    const xs = [-2, -1, 0, 1, 2];
    const ys = xs.map((x) => x * x + c);
    return {
      prompt: `Complete the table of values for y = x² ${pm(c)}.`,
      render: (
        <table style={{ borderCollapse: "collapse", fontSize: 12, fontFamily: "Arial, sans-serif" }}>
          <tbody>
            <tr><th style={cellStyle}>x</th>{xs.map((x, i) => <td key={i} style={cellStyle}>{x}</td>)}</tr>
            <tr><th style={cellStyle}>y</th>{xs.map((_, i) => <td key={i} style={cellStyle}>&nbsp;</td>)}</tr>
          </tbody>
        </table>
      ),
      answer: `y = ${ys.join(", ")}`,
    };
  },
};
SUBTOPIC_BANK["plot-cubic-graph"] = {
  topic: "Graphs", title: "Complete a table of values for a cubic", marks: 2,
  build(rng) {
    const c = seededInt(rng, -5, 5);
    const xs = [-2, -1, 0, 1, 2];
    const ys = xs.map((x) => x * x * x + c);
    return {
      prompt: `Complete the table of values for y = x³ ${pm(c)}.`,
      render: (
        <table style={{ borderCollapse: "collapse", fontSize: 12, fontFamily: "Arial, sans-serif" }}>
          <tbody>
            <tr><th style={cellStyle}>x</th>{xs.map((x, i) => <td key={i} style={cellStyle}>{x}</td>)}</tr>
            <tr><th style={cellStyle}>y</th>{xs.map((_, i) => <td key={i} style={cellStyle}>&nbsp;</td>)}</tr>
          </tbody>
        </table>
      ),
      answer: `y = ${ys.join(", ")}`,
    };
  },
};

/* --- HT1 Week 3: Significant Points, Linear Simultaneous Equations --- */
SUBTOPIC_BANK["significant-points"] = {
  topic: "Significant Points", title: "Roots of a quadratic in factorised form", marks: 2,
  build(rng) {
    const sm = pick(rng, [1, -1]) * seededInt(rng, 2, 9);
    const sn = pick(rng, [1, -1]) * seededInt(rng, 2, 9);
    return { prompt: `Find the roots of y = ${bracket(sm)}${bracket(sn)}`, answer: `x = ${-sm} or x = ${-sn}` };
  },
};
SUBTOPIC_BANK["simultaneous-linear-basic"] = {
  topic: "Simultaneous Equations", title: "Linear simultaneous equations (matching coefficients)", marks: 3,
  build(rng) {
    const q = seededInt(rng, 1, 5), p1 = seededInt(rng, 1, 5), p2 = seededInt(rng, 1, 5);
    const x0 = seededInt(rng, -6, 6), y0 = seededInt(rng, -6, 6);
    const c1 = p1 * x0 + q * y0, c2 = p2 * x0 - q * y0;
    return {
      prompt: <>Solve the simultaneous equations:<br />{coefX(p1)} + {coefX(q, "y")} = {c1}<br />{coefX(p2)} - {coefX(q, "y")} = {c2}</>,
      answer: `x = ${x0}, y = ${y0}`,
    };
  },
};
SUBTOPIC_BANK["simultaneous-linear-scale-one"] = {
  topic: "Simultaneous Equations", title: "Linear simultaneous equations (scale one equation only)", marks: 3,
  build(rng) {
    const k = pick(rng, [2, 3]);
    const q2 = seededInt(rng, 1, 4);
    const q1 = q2 * k; // eq1's y-coefficient already equals eq2's scaled by k, so only eq2 ever needs multiplying
    let p1, p2;
    do {
      p1 = seededInt(rng, 1, 6);
      p2 = seededInt(rng, 1, 6);
    } while (p1 * q2 - p2 * q1 === 0); // avoid a degenerate (no unique solution) system
    const x0 = seededInt(rng, -6, 6), y0 = seededInt(rng, -6, 6);
    const c1 = p1 * x0 + q1 * y0, c2 = p2 * x0 + q2 * y0;
    return {
      prompt: <>Solve the simultaneous equations:<br />{coefX(p1)} {pmX(q1, "y")} = {c1}<br />{coefX(p2)} {pmX(q2, "y")} = {c2}</>,
      answer: `x = ${x0}, y = ${y0}`,
    };
  },
};
SUBTOPIC_BANK["simultaneous-linear-scaling"] = {
  topic: "Simultaneous Equations", title: "Linear simultaneous equations (needs scaling)", marks: 4,
  build(rng) {
    const p1 = seededInt(rng, 2, 5), q1 = seededInt(rng, 2, 5), p2 = seededInt(rng, 2, 5), q2 = seededInt(rng, 2, 5);
    const x0 = seededInt(rng, -6, 6), y0 = seededInt(rng, -6, 6);
    const c1 = p1 * x0 + q1 * y0, c2 = p2 * x0 + q2 * y0;
    return {
      prompt: <>Solve the simultaneous equations:<br />{p1}x {pmX(q1, "y")} = {c1}<br />{p2}x {pmX(q2, "y")} = {c2}</>,
      answer: `x = ${x0}, y = ${y0}`,
    };
  },
};

/* --- HT1 Week 4: Quadratic Simultaneous Equations, Functions - Substitution and Solving --- */
SUBTOPIC_BANK["quadratic-simultaneous-circle"] = {
  topic: "Quadratic Simultaneous Equations", title: "Simultaneous equations with the equation of a circle", marks: 4,
  build(rng) {
    // Built from two points (p, q) and (q, p) — both on the circle
    // x² + y² = p² + q² (swapping x/y in that equation changes nothing),
    // and both on the line x + y = p + q. Substituting y = s - x into the
    // circle equation always simplifies to x² - sx + pq = 0, which factors
    // as (x - p)(x - q) = 0 by construction — clean integers every time,
    // with the working actually worth showing (unlike guessing p,q and
    // hoping the quadratic happens to factor).
    let p, q;
    do {
      p = seededInt(rng, 1, 8);
      q = seededInt(rng, 1, 8);
    } while (p === q);
    const R = p * p + q * q, s = p + q;
    return {
      prompt: <>Solve the simultaneous equations:<br />x² + y² = {R}<br />x + y = {s}</>,
      answer: `From x + y = ${s}, y = ${s} - x. Substituting into the circle equation: x² + (${s} - x)² = ${R}, which simplifies to x² - ${s}x + ${p * q} = 0, so (x - ${p})(x - ${q}) = 0. This gives x = ${p}, y = ${q} or x = ${q}, y = ${p}.`,
    };
  },
};
SUBTOPIC_BANK["quadratic-simultaneous"] = {
  topic: "Quadratic Simultaneous Equations", title: "Linear and quadratic simultaneous equations", marks: 4,
  build(rng) {
    const r1 = seededInt(rng, -5, 6);
    const r2 = 1 - r1;
    const k = seededInt(rng, -6, 6);
    const m = k + r1 * r2;
    const y1 = r1 + k, y2 = r2 + k;
    return {
      prompt: `Solve the simultaneous equations: y = x ${pm(k)} and y = x² ${pm(m)}`,
      answer: `x = ${r1}, y = ${y1} or x = ${r2}, y = ${y2}`,
    };
  },
};
SUBTOPIC_BANK["functions-substitution-solving"] = {
  topic: "Functions", title: "Evaluate or solve a linear function", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 5), b = seededInt(rng, -8, 8);
    if (pick(rng, [true, false])) {
      const xval = seededInt(rng, -6, 6);
      return { prompt: `f(x) = ${a}x ${pm(b)}. Find f(${xval}).`, answer: `${a * xval + b}` };
    }
    const xsol = seededInt(rng, -8, 8);
    const target = a * xsol + b;
    return { prompt: `f(x) = ${a}x ${pm(b)}. Solve f(x) = ${target}.`, answer: `x = ${xsol}` };
  },
};
SUBTOPIC_BANK["functions-substitute-expression"] = {
  topic: "Functions", title: "Substitute an algebraic expression into a function", marks: 3,
  build(rng) {
    // f(x) = ax + b is evaluated at an expression in a *different* letter
    // (e.g. f(2t + 3)), so the input has to be substituted for x and the
    // result expanded and simplified — not just a number evaluated.
    const v = pick(rng, ["a", "k", "m", "n", "p", "t"]);
    const a = seededInt(rng, 2, 5);
    const c = pick(rng, [1, 1, 2, 3, 4]);
    let b, d;
    do { b = seededInt(rng, -8, 8); } while (b === 0);
    do { d = seededInt(rng, -6, 6); } while (d === 0);
    const resCoeff = a * c, resConst = a * d + b;
    return {
      prompt: `f(x) = ${a}x ${pm(b)}. Find f(${coefX(c, v)}${pm0(d)}), giving your answer in its simplest form.`,
      answer: `${a}(${coefX(c, v)}${pm0(d)}) ${pm(b)} = ${coefX(resCoeff, v)}${pm0(resConst)}`,
    };
  },
};

/* --- HT1 Week 5: Composite Functions, Inverse Functions, Changing the Subject --- */
SUBTOPIC_BANK["composite-functions"] = {
  topic: "Composite Functions", title: "Evaluate a composite function", marks: 3,
  build(rng) {
    const a = seededInt(rng, 2, 5), b = seededInt(rng, -6, 6), c = seededInt(rng, 2, 5), d = seededInt(rng, -6, 6);
    const xval = seededInt(rng, -5, 5);
    const inner = c * xval + d;
    const outer = a * inner + b;
    return { prompt: `f(x) = ${a}x ${pm(b)} and g(x) = ${c}x ${pm(d)}. Find fg(${xval}).`, answer: `${outer}` };
  },
};
SUBTOPIC_BANK["inverse-functions"] = {
  topic: "Inverse Functions", title: "Find the inverse of a linear function", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 5), b = seededInt(rng, -8, 8);
    return { prompt: `f(x) = ${a}x ${pm(b)}. Find f⁻¹(x).`, answer: <>f⁻¹(x) = <Frac n={<>x {pm(-b)}</>} d={a} /></> };
  },
};
SUBTOPIC_BANK["changing-subject-expand"] = {
  topic: "Changing the Subject", title: "Change the subject (expand first)", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 6), b = seededInt(rng, -9, 9);
    return { prompt: `Make x the subject of the formula y = ${a}(x ${pm(b)})`, answer: <>x = <Frac n="y" d={a} /> {pm(-b)}</> };
  },
};
SUBTOPIC_BANK["changing-subject-factorise"] = {
  topic: "Changing the Subject", title: "Change the subject (x appears twice)", marks: 4,
  build(rng) {
    // Every variant keeps a letter (not a plain number) multiplying x on at
    // least one side, so collecting the x terms can only be done by taking
    // x out as a common factor — x(a − c) — never by simplifying to a
    // single numerical multiple like 3x (which numeric coefficients on both
    // sides would collapse to, needing no factorising at all).
    const variant = pick(rng, ["letters", "bracket", "fraction"]);
    if (variant === "letters") {
      const pool = ["a", "b", "c", "d", "e", "f", "g", "h", "m", "n", "p", "q", "r", "s", "t", "u", "v", "w"];
      const letters = [];
      for (let i = 0; i < 4; i++) letters.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
      const [l1, l2, l3, l4] = letters;
      return {
        prompt: `Make x the subject of the formula ${l1}x + ${l2} = ${l3}x + ${l4}`,
        answer: <>x({l1} - {l3}) = {l4} - {l2}, so x = <Frac n={`${l4} - ${l2}`} d={`${l1} - ${l3}`} /></>,
      };
    }
    if (variant === "bracket") {
      const a = seededInt(rng, 2, 7);
      let b, c;
      do { b = seededInt(rng, -9, 9); } while (b === 0);
      do { c = seededInt(rng, -9, 9); } while (c === 0);
      return {
        prompt: `Make x the subject of the formula ${coefX(a)}${pm0(b)} = y(x ${pm(c)})`,
        answer: <>x({a} - y) = {coefX(c, "y")}{pm0(-b)}, so x = <Frac n={<>{coefX(c, "y")}{pm0(-b)}</>} d={<>{a} {pmX(-1, "y")}</>} /></>,
      };
    }
    let a, b, c, d;
    do {
      a = seededInt(rng, 1, 5); c = seededInt(rng, 1, 5);
      do { b = seededInt(rng, -6, 6); } while (b === 0);
      do { d = seededInt(rng, -6, 6); } while (d === 0);
    } while (a * d === b * c);
    return {
      prompt: <>Make x the subject of the formula y = <Frac n={<>{coefX(a)}{pm0(b)}</>} d={<>{coefX(c)}{pm0(d)}</>} /></>,
      answer: <>x({coefX(c, "y")}{pm0(-a)}) = {b} {pmX(-d, "y")}, so x = <Frac n={<>{b} {pmX(-d, "y")}</>} d={<>{coefX(c, "y")}{pm0(-a)}</>} /></>,
    };
  },
};

/* --- HT1 Week 6: Quadratic Sequences, Algebraic Fractions --- */
SUBTOPIC_BANK["quadratic-sequences"] = {
  topic: "Sequences", title: "Evaluate a term of a quadratic sequence", marks: 2,
  build(rng) {
    const a = seededInt(rng, 1, 4), b = seededInt(rng, -5, 5), c = seededInt(rng, -5, 5), n = seededInt(rng, 5, 10);
    return { prompt: `The nth term of a sequence is ${a}n² ${pmX(b, "n")} ${pm(c)}. Find the ${n}th term.`, answer: `${a * n * n + b * n + c}` };
  },
};
SUBTOPIC_BANK["algebraic-fractions-simplify"] = {
  topic: "Algebraic Fractions", title: "Simplify using difference of two squares", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 9);
    return { prompt: <>Simplify <Frac n={<>x² - {a * a}</>} d={<>x + {a}</>} /></>, answer: `x - ${a}` };
  },
};
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a || 1; }
SUBTOPIC_BANK["algebraic-fractions-muldiv"] = {
  topic: "Algebraic Fractions", title: "Multiply algebraic fractions", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9), c = seededInt(rng, 2, 9), d = seededInt(rng, 2, 9);
    const num = a * c, den = b * d, g = gcd(num, den);
    return { prompt: <>Simplify <Frac n={<>{a}x</>} d={b} /> × <Frac n={c} d={<>{d}x</>} /></>, answer: <Frac n={num / g} d={den / g} /> };
  },
};
SUBTOPIC_BANK["algebraic-fractions-addsub"] = {
  topic: "Algebraic Fractions", title: "Add algebraic fractions over a common denominator", marks: 3,
  build(rng) {
    const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9);
    return { prompt: <>Write as a single fraction: <Frac n={a} d="x" /> + <Frac n={b} d={<>x + 1</>} /></>, answer: <Frac n={<>{a + b}x + {a}</>} d={<>x(x + 1)</>} /> };
  },
};

/* --- HT1 Week 7: Surds --- */
const SURD_BASES = [2, 3, 5, 6, 7, 10, 11, 13];
SUBTOPIC_BANK["surds-simplify"] = {
  topic: "Surds", title: "Simplify a surd", marks: 2,
  build(rng) {
    const b = pick(rng, SURD_BASES), a = seededInt(rng, 2, 6);
    return { prompt: `Simplify √${a * a * b}`, answer: `${a}√${b}` };
  },
};
SUBTOPIC_BANK["surds-add-subtract"] = {
  topic: "Surds", title: "Add or subtract like surds", marks: 1,
  build(rng) {
    const b = pick(rng, SURD_BASES), p = seededInt(rng, 2, 9), q = seededInt(rng, 2, 9);
    return { prompt: `Simplify ${p}√${b} + ${q}√${b}`, answer: `${p + q}√${b}` };
  },
};
SUBTOPIC_BANK["surds-multiply-expand"] = {
  topic: "Surds", title: "Expand brackets involving surds", marks: 3,
  build(rng) {
    const a = pick(rng, SURD_BASES), p = seededInt(rng, 1, 6), q = seededInt(rng, 1, 6);
    return { prompt: `Expand and simplify (√${a} + ${p})(√${a} + ${q})`, answer: `${a + p * q} + ${p + q}√${a}` };
  },
};
SUBTOPIC_BANK["surds-basic-rationalising"] = {
  topic: "Surds", title: "Rationalise a simple denominator", marks: 2,
  build(rng) {
    const a = pick(rng, SURD_BASES);
    return { prompt: <>Rationalise the denominator: <Frac n="1" d={<>√{a}</>} /></>, answer: <Frac n={<>√{a}</>} d={a} /> };
  },
};
SUBTOPIC_BANK["surds-rationalising-harder"] = {
  topic: "Surds", title: "Rationalise using the conjugate", marks: 3,
  build(rng) {
    let a, b;
    do { a = pick(rng, SURD_BASES); b = seededInt(rng, 1, 4); } while (a - b * b === 0);
    return { prompt: <>Rationalise the denominator: <Frac n="1" d={<>√{a} - {b}</>} /></>, answer: <Frac n={<>√{a} + {b}</>} d={a - b * b} /> };
  },
};

const ORIENTATIONS = ["bl", "br", "tl", "tr"];
SUBTOPIC_BANK["pythagoras-hypotenuse"] = {
  topic: "Pythagoras", title: "Calculate the hypotenuse", marks: 2,
  build(rng) {
    const base = seededInt(rng, 3, 12), height = seededInt(rng, 3, 12);
    const hyp = Math.sqrt(base * base + height * height);
    const orientation = pick(rng, ORIENTATIONS);
    return {
      prompt: `Calculate the length of the hypotenuse. Give your answer to 1 decimal place.`,
      render: <RightTriangleSVG base={base} height={height} orientation={orientation} baseLabel={base} heightLabel={height} hypLabel="?" />,
      answer: `√(${base}² + ${height}²) = ${hyp.toFixed(1)}`,
    };
  },
};
SUBTOPIC_BANK["pythagoras-shorter-side"] = {
  topic: "Pythagoras", title: "Calculate a shorter side", marks: 3,
  build(rng) {
    const known = seededInt(rng, 3, 10);
    const hyp = seededInt(rng, known + 2, known + 12);
    const missing = Math.sqrt(hyp * hyp - known * known);
    const orientation = pick(rng, ORIENTATIONS);
    const missingIsBase = pick(rng, [true, false]);
    return {
      prompt: `Calculate the length of the missing side. Give your answer to 1 decimal place.`,
      render: (
        <RightTriangleSVG
          base={missingIsBase ? missing : known}
          height={missingIsBase ? known : missing}
          orientation={orientation}
          baseLabel={missingIsBase ? "?" : known}
          heightLabel={missingIsBase ? known : "?"}
          hypLabel={hyp}
        />
      ),
      answer: `√(${hyp}² - ${known}²) = ${missing.toFixed(1)}`,
    };
  },
};


/* ------ Number strand batch: highest exam-usage skills across the missing groups ------ */

/* Percentages */
SUBTOPIC_BANK["percent-of-amount"] = {
  topic: "Percentages", title: "Percentage of an amount (calculator)", marks: 1,
  build(rng) {
    const pct = pick(rng, [5, 10, 15, 20, 25, 40, 60, 75, 80]);
    const amount = seededInt(rng, 4, 40) * 5;
    return { prompt: `Work out ${pct}% of £${amount}.`, answer: `£${(pct * amount / 100).toFixed(2)}` };
  },
};
SUBTOPIC_BANK["percent-one-of-another"] = {
  topic: "Percentages", title: "One number as a percentage of another", marks: 2,
  build(rng) {
    const denom = pick(rng, [20, 25, 40, 50, 80, 200, 250]);
    const num = seededInt(rng, 1, denom - 1);
    return { prompt: `Express ${num} as a percentage of ${denom}.`, answer: `${((num / denom) * 100).toFixed(1)}%` };
  },
};
SUBTOPIC_BANK["percent-compound-increase"] = {
  topic: "Percentages", title: "Compound percentage increase", marks: 3,
  build(rng) {
    const P = seededInt(rng, 10, 40) * 100;
    const r = pick(rng, [2, 3, 4, 5]);
    const n = seededInt(rng, 3, 8);
    const final = P * Math.pow(1 + r / 100, n);
    return {
      prompt: `£${P} is invested at ${r}% compound interest per year. Find the value after ${n} years to the nearest penny.`,
      answer: <>£{P} × <Pow b={(1 + r / 100).toFixed(2)} e={n} /> = £{final.toFixed(2)}</>,
    };
  },
};
SUBTOPIC_BANK["percent-reverse"] = {
  topic: "Percentages", title: "Find the original value (reverse percentage)", marks: 3,
  build(rng) {
    const r = pick(rng, [10, 15, 20, 25, 40]);
    const original = seededInt(rng, 20, 80) * 10;
    const newVal = original * (1 - r / 100);
    return {
      prompt: `After a ${r}% decrease, a value is £${newVal.toFixed(2)}. Find the original value.`,
      answer: `£${newVal.toFixed(2)} ÷ ${(1 - r / 100).toFixed(2)} = £${original.toFixed(2)}`,
    };
  },
};

/* Standard Form */
SUBTOPIC_BANK["sf-large-to-sf"] = {
  topic: "Standard Form", title: "Convert a large ordinary number to standard form", marks: 1,
  build(rng) {
    const d = seededInt(rng, 1, 9) + seededInt(rng, 0, 9) / 10;
    const e = seededInt(rng, 3, 8);
    const val = Math.round(d * Math.pow(10, e));
    return { prompt: `Write ${val.toLocaleString("en-GB")} in standard form.`, answer: <>{d.toFixed(1)} × <Pow b={10} e={e} /></> };
  },
};
SUBTOPIC_BANK["sf-small-to-ordinary"] = {
  topic: "Standard Form", title: "Convert a small standard form number to ordinary", marks: 1,
  build(rng) {
    const d = seededInt(rng, 1, 9) + seededInt(rng, 0, 9) / 10;
    const e = -seededInt(rng, 3, 7);
    const val = d * Math.pow(10, e);
    return { prompt: <>Write {d.toFixed(1)} × <Pow b={10} e={e} /> as an ordinary number.</>, answer: `${val.toFixed(-e + 1)}` };
  },
};
SUBTOPIC_BANK["sf-multiply"] = {
  topic: "Standard Form", title: "Multiply numbers in standard form", marks: 2,
  build(rng) {
    const d1 = seededInt(rng, 2, 5), e1 = seededInt(rng, 2, 6);
    const d2 = seededInt(rng, 2, 5), e2 = seededInt(rng, 2, 6);
    let d = d1 * d2, e = e1 + e2;
    while (d >= 10) { d /= 10; e += 1; }
    return {
      prompt: <>Work out ({d1} × <Pow b={10} e={e1} />) × ({d2} × <Pow b={10} e={e2} />). Give your answer in standard form.</>,
      answer: <>{d} × <Pow b={10} e={e} /></>,
    };
  },
};

/* Rounding */
SUBTOPIC_BANK["round-decimal-places"] = {
  topic: "Rounding", title: "Round to a given number of decimal places", marks: 1,
  build(rng) {
    const dp = seededInt(rng, 2, 4);
    const digits = Array.from({ length: 6 }, () => seededInt(rng, 0, 9)).join("");
    const val = parseFloat(`${seededInt(rng, 1, 99)}.${digits}`);
    return { prompt: `Round ${val} to ${dp} decimal places.`, answer: `${val.toFixed(dp)}` };
  },
};
SUBTOPIC_BANK["round-significant-figures"] = {
  topic: "Rounding", title: "Round to a given number of significant figures", marks: 1,
  build(rng) {
    const sf = seededInt(rng, 2, 3);
    const val = seededInt(rng, 1000, 99999);
    const pow = Math.pow(10, Math.floor(Math.log10(val)) - (sf - 1));
    const rounded = Math.round(val / pow) * pow;
    return { prompt: `Round ${val} to ${sf} significant figures.`, answer: `${rounded}` };
  },
};
SUBTOPIC_BANK["round-error-interval"] = {
  topic: "Rounding", title: "Error interval for a rounded number", marks: 2,
  build(rng) {
    const val = seededInt(rng, 3, 30) * 10;
    return {
      prompt: `A number, x, has been rounded to the nearest 10 to give ${val}. Write down the error interval for x.`,
      answer: `${val - 5} ≤ x < ${val + 5}`,
    };
  },
};

/* Estimation */
SUBTOPIC_BANK["estimation-calculation"] = {
  topic: "Estimation", title: "Estimate a calculation by rounding to 1 s.f.", marks: 2,
  build(rng) {
    const a = seededInt(rng, 20, 99);
    const b = parseFloat((seededInt(rng, 15, 95) / 10).toFixed(1));
    // The prompt no longer states "round to 1 s.f." explicitly, so at an
    // exact halfway point — a's units digit is 5 (e.g. 45), or b's tenths
    // digit is 5 (e.g. 3.5) — rounding either direction is defensible;
    // cover both instead of marking only one "correct". Away from a
    // halfway point there's only one reasonable 1 s.f. rounding, so this
    // collapses back to a single exact answer as before.
    const aCandidates = a % 10 === 5 ? [a - 5, a + 5] : [Math.round(a / 10) * 10];
    const bCandidates = Math.round(b * 10) % 10 === 5 ? [Math.floor(b), Math.ceil(b)] : [Math.round(b)];
    const products = aCandidates.flatMap((ra) => bCandidates.map((rb) => ra * rb));
    const lo = Math.min(...products), hi = Math.max(...products);
    return {
      prompt: `Estimate the value of ${a} × ${b}.`,
      answer: lo === hi
        ? `${aCandidates[0]} × ${bCandidates[0]} = ${lo} (rounding each number to 1 significant figure)`
        : `Rounding each number to 1 significant figure — accept any answer from ${lo} to ${hi} (e.g. ${aCandidates[0]} × ${bCandidates[0]} = ${aCandidates[0] * bCandidates[0]})`,
    };
  },
};

/* Factors, Multiples, Primes */
SUBTOPIC_BANK["fmp-prime-factorisation"] = {
  topic: "Factors & Multiples", title: "Write a number as a product of primes", marks: 2,
  build(rng) {
    const target = pick(rng, [24, 36, 60, 72, 84, 90, 120, 126, 140, 150, 168, 180, 210, 216]);
    const factors = {};
    let n = target;
    for (const p of [2, 3, 5, 7, 11, 13]) { while (n % p === 0) { factors[p] = (factors[p] || 0) + 1; n /= p; } }
    if (n > 1) factors[n] = 1;
    const answer = (
      <>
        {Object.entries(factors).map(([p, k], i) => (
          <React.Fragment key={p}>{i > 0 ? " × " : ""}<Pow b={p} e={k} /></React.Fragment>
        ))}
      </>
    );
    return { prompt: `Write ${target} as a product of its prime factors.`, answer };
  },
};
SUBTOPIC_BANK["fmp-hcf-lcm"] = {
  topic: "Factors & Multiples", title: "Find the HCF of two numbers", marks: 2,
  build(rng) {
    const pairs = [[24, 36], [45, 60], [48, 72], [56, 84], [90, 126], [72, 108], [84, 140]];
    const [a, b] = pick(rng, pairs);
    function gcdLocal(x, y) { while (y) { [x, y] = [y, x % y]; } return x; }
    return { prompt: `Find the highest common factor (HCF) of ${a} and ${b}.`, answer: `HCF = ${gcdLocal(a, b)}` };
  },
};

/* Powers & Roots */
SUBTOPIC_BANK["powers-laws-multiply"] = {
  topic: "Powers & Roots", title: "Laws of indices — multiplying and dividing powers", marks: 2,
  build(rng) {
    const base = pick(rng, ["a", "b", "x", "y"]);
    const p = seededInt(rng, 2, 9), q = seededInt(rng, 2, 9), r = seededInt(rng, 1, 4);
    return {
      prompt: <>Simplify: (<Pow b={base} e={p} /> × <Pow b={base} e={q} />) ÷ <Pow b={base} e={r} />. Leave your answer in index form.</>,
      answer: <Pow b={base} e={p + q - r} />,
    };
  },
};
SUBTOPIC_BANK["powers-zero-and-fractional"] = {
  topic: "Powers & Roots", title: "Evaluate a number raised to a fractional or zero index", marks: 2,
  build(rng) {
    const which = pick(rng, ["zero", "fractional"]);
    if (which === "zero") {
      const b = seededInt(rng, 2, 9);
      return { prompt: <>Work out the value of <Pow b={b} e={0} /></>, answer: `1` };
    }
    const b = pick(rng, [4, 9, 16, 25, 36, 49, 64, 81, 100]);
    return { prompt: <>Work out the value of <Pow b={b} e={<IdxFrac n="1" d="2" />} /></>, answer: `${Math.sqrt(b)}` };
  },
};

/* Fractions */
SUBTOPIC_BANK["frac-of-amount"] = {
  topic: "Fractions", title: "Fraction of an amount", marks: 1,
  build(rng) {
    const denom = pick(rng, [3, 4, 5, 6, 8, 10]);
    const numer = seededInt(rng, 1, denom - 1);
    const amount = denom * seededInt(rng, 3, 30);
    return { prompt: <>Work out <Frac n={numer} d={denom} /> of {amount}.</>, answer: `${(numer * amount) / denom}` };
  },
};
SUBTOPIC_BANK["frac-multiply-mixed"] = {
  topic: "Fractions", title: "Multiply mixed numbers", marks: 3,
  build(rng) {
    const a = seededInt(rng, 1, 4), b = seededInt(rng, 2, 5), c = seededInt(rng, 1, 4), d = seededInt(rng, 2, 5);
    const m = seededInt(rng, 1, b - 1), n = seededInt(rng, 1, d - 1);
    const impA = a * b + m, impB = c * d + n;
    const num = impA * impB, den = b * d;
    function gcdLocal(x, y) { while (y) { [x, y] = [y, x % y]; } return x; }
    const g = gcdLocal(num, den);
    return {
      prompt: <>Work out <Mixed w={a} n={m} d={b} /> × <Mixed w={c} n={n} d={d} />. Give your answer as a mixed number in its simplest form.</>,
      answer: <>= <Frac n={impA} d={b} /> × <Frac n={impB} d={d} /> = <Frac n={num / g} d={den / g} /></>,
    };
  },
};
SUBTOPIC_BANK["frac-recurring-to-fraction"] = {
  topic: "Fractions", title: "Convert a recurring decimal to a fraction", marks: 3,
  build(rng) {
    const digit = seededInt(rng, 1, 8);
    return {
      prompt: `Convert 0.${digit}̇ (the digit ${digit} recurring) to a fraction in its simplest form.`,
      answer: <Frac n={digit} d="9" />,
    };
  },
};

/* Negative Numbers */
SUBTOPIC_BANK["neg-order"] = {
  topic: "Negative Numbers", title: "Order positive and negative integers", marks: 1,
  build(rng) {
    const nums = [];
    while (nums.length < 6) { const v = seededInt(rng, -12, 12); if (!nums.includes(v)) nums.push(v); }
    const sorted = [...nums].sort((a, b) => a - b);
    return { prompt: `Order these numbers from smallest to largest: ${nums.join(", ")}`, answer: `${sorted.join(", ")}` };
  },
};
SUBTOPIC_BANK["neg-difference"] = {
  topic: "Negative Numbers", title: "Difference between a positive and a negative", marks: 1,
  build(rng) {
    const pos = seededInt(rng, 3, 20), neg = -seededInt(rng, 3, 20);
    return { prompt: `Work out the difference between ${pos} and ${neg}.`, answer: `${pos} - (${neg}) = ${pos - neg}` };
  },
};

/* Order of Operations */
SUBTOPIC_BANK["bidmas-two-operations"] = {
  topic: "Order of Operations", title: "Evaluate a two-operation calculation", marks: 1,
  build(rng) {
    const a = seededInt(rng, 3, 12), b = seededInt(rng, 2, 8), c = seededInt(rng, 2, 8);
    const which = pick(rng, ["mul_add", "sub_div", "add_sq"]);
    if (which === "mul_add") return { prompt: `Work out ${a} + ${b} × ${c}`, answer: `${a + b * c}` };
    if (which === "sub_div") return { prompt: `Work out ${a * c} - ${b * c} ÷ ${c}`, answer: `${a * c - b}` };
    return { prompt: `Work out ${a} + ${b}²`, answer: `${a + b * b}` };
  },
};


/* ------ HT2 Set 2: Weeks 3-6 (Indices, Bounds, Proportion, Trig block) ------ */

/* Week 3: Negative & Fractional Indices */
SUBTOPIC_BANK["indices-negative"] = {
  topic: "Indices", title: "Evaluate a negative index", marks: 1,
  build(rng) {
    const b = pick(rng, [2, 3, 4, 5, 6, 10]);
    const p = seededInt(rng, 1, 3);
    return { prompt: <>Work out the value of <Pow b={b} e={-p} />. Give your answer as a fraction.</>, answer: <Frac n="1" d={Math.pow(b, p)} /> };
  },
};
SUBTOPIC_BANK["indices-fractional"] = {
  topic: "Indices", title: "Evaluate a fractional index (m/n form)", marks: 2,
  build(rng) {
    const base = pick(rng, [8, 27, 16, 32, 64]);
    let root;
    if (base === 8 || base === 27 || base === 64) { root = Math.round(Math.cbrt(base)); }
    else { root = Math.round(Math.pow(base, 1 / (base === 32 ? 5 : 4))); }
    const denom = base === 32 ? 5 : (base === 16 ? 4 : 3);
    // The numerator is never equal to, or a multiple/factor-sharing partner
    // of, the denominator: the index must be a proper simplest-form fraction
    // (no 3/3, which is just 1, and no 2/4, which is 1/2).
    const numer = pick(rng, [2, 3, 4].filter((n) => n !== denom && gcd(n, denom) === 1));
    return {
      prompt: <>Work out the value of <Pow b={base} e={<IdxFrac n={numer} d={denom} />} />.</>,
      answer: <><Pow b={<>(<Pow b={base} e={<IdxFrac n="1" d={denom} />} />)</>} e={numer} /> = <Pow b={root} e={numer} /> = {Math.pow(root, numer)}</>,
    };
  },
};

/* Week 4: Bounds (Introduction, ×÷, Suitable Degree of Accuracy) */
SUBTOPIC_BANK["bounds-intro"] = {
  topic: "Bounds", title: "Upper and lower bounds of a rounded value", marks: 2,
  build(rng) {
    const val = seededInt(rng, 5, 50) * pick(rng, [0.1, 1, 10]);
    const dp = val < 1 ? 1 : 0;
    const step = val < 1 ? 0.1 : (pick(rng, [1, 10]));
    const half = step / 2;
    return {
      prompt: `A length is measured as ${val.toFixed(dp)} cm, correct to the nearest ${step} cm. Write down the upper and lower bounds of the length.`,
      answer: `Lower bound = ${(val - half).toFixed(dp + 1)} cm; Upper bound = ${(val + half).toFixed(dp + 1)} cm`,
    };
  },
};
SUBTOPIC_BANK["bounds-multiply"] = {
  topic: "Bounds", title: "Bounds of a product or quotient", marks: 3,
  build(rng) {
    const a = seededInt(rng, 5, 20), b = seededInt(rng, 3, 15);
    const aU = a + 0.5, aL = a - 0.5, bU = b + 0.5, bL = b - 0.5;
    return {
      prompt: `A = ${a} correct to the nearest whole number. B = ${b} correct to the nearest whole number. Work out the upper bound of A × B.`,
      answer: `Upper bound = ${aU} × ${bU} = ${(aU * bU).toFixed(2)}`,
    };
  },
};
SUBTOPIC_BANK["bounds-accuracy"] = {
  topic: "Bounds", title: "Suitable degree of accuracy from bounds", marks: 3,
  build(rng) {
    const a = seededInt(rng, 5, 12), b = seededInt(rng, 3, 8);
    const lower = ((a - 0.5) / (b + 0.5)).toFixed(3);
    const upper = ((a + 0.5) / (b - 0.5)).toFixed(3);
    return {
      prompt: <>x = <Frac n="A" d="B" /> where A = {a} and B = {b}, both to the nearest whole number. Work out the value of x to a suitable degree of accuracy. Justify your answer.</>,
      answer: `LB = ${lower}, UB = ${upper}. Both round to the same value to 1 s.f., so x ≈ ${Math.round((a / b) * 10) / 10} (1 s.f.).`,
    };
  },
};

/* Week 5: Direct/Inverse Proportion, Applied Proportion */
SUBTOPIC_BANK["direct-proportion"] = {
  topic: "Proportion", title: "Direct proportion — find k and use it", marks: 3,
  build(rng) {
    const k = seededInt(rng, 2, 8);
    const x1 = seededInt(rng, 2, 6);
    const y1 = k * x1 * x1;
    const x2 = seededInt(rng, 7, 12);
    return {
      prompt: `y is directly proportional to x². When x = ${x1}, y = ${y1}. Find y when x = ${x2}.`,
      answer: <>k = <Frac n={y1} d={<>{x1}²</>} /> = {k}; y = {k} × {x2}² = {k * x2 * x2}</>,
    };
  },
};
SUBTOPIC_BANK["inverse-proportion"] = {
  topic: "Proportion", title: "Inverse proportion — find k and use it", marks: 3,
  build(rng) {
    const x1 = seededInt(rng, 2, 8);
    let x2;
    do { x2 = seededInt(rng, 2, 8); } while (x2 === x1);
    const m = seededInt(rng, 2, 6);
    const k = x1 * x2 * m;
    const y1 = k / x1;
    const y2 = k / x2;
    return {
      prompt: `y is inversely proportional to x. When x = ${x1}, y = ${y1}. Find y when x = ${x2}.`,
      answer: <>k = {x1} × {y1} = {k}; y = <Frac n={k} d={x2} /> = {y2}</>,
    };
  },
};
SUBTOPIC_BANK["applied-proportion-graph"] = {
  topic: "Proportion", title: "Identify a proportion relationship from a graph description", marks: 1,
  build(rng) {
    const type = pick(rng, ["direct", "inverse", "square"]);
    const desc = type === "direct" ? "a straight line through the origin" :
                  type === "inverse" ? "a reciprocal curve (y falls as x rises), approaching but never reaching the axes" :
                  "a curve through the origin that rises more steeply as x increases";
    const rel = type === "direct" ? <>y ∝ x (y = kx)</> :
                 type === "inverse" ? <>y ∝ <Frac n="1" d="x" /> (y = <Frac n="k" d="x" />)</> :
                 <>y ∝ x² (y = kx²)</>;
    return { prompt: `A graph of y against x is described as ${desc}. Write down the proportional relationship between y and x.`, answer: rel };
  },
};

/* Week 6: Sine Rule, Cosine Rule, Area Rule */
SUBTOPIC_BANK["sine-rule-side"] = {
  topic: "Non-Right Trigonometry", title: "Sine rule — find a missing side", marks: 3,
  build(rng) {
    const A = seededInt(rng, 30, 70), B = seededInt(rng, 40, 90);
    const a = seededInt(rng, 6, 15);
    const bLen = (a * Math.sin(B * Math.PI / 180)) / Math.sin(A * Math.PI / 180);
    // Compute AB length so the drawing scales sensibly (use law of sines: c = a * sinC / sinA)
    const C = 180 - A - B;
    const c = (a * Math.sin(C * Math.PI / 180)) / Math.sin(A * Math.PI / 180);
    return {
      prompt: `Find the length of side b (opposite angle B) to 1 decimal place.`,
      render: (
        <GeneralTriangleSVG
          sideAB={c} angleA={A} angleB={B}
          labelA={`${A}°`} labelB={`${B}°`}
          sideALabel={`a = ${a} cm`} sideBLabel={`b = ?`}
        />
      ),
      answer: <>b = <Frac n={<>{a} × sin{B}°</>} d={<>sin{A}°</>} /> = {bLen.toFixed(1)} cm</>,
    };
  },
};
SUBTOPIC_BANK["sine-rule-angle"] = {
  topic: "Non-Right Trigonometry", title: "Sine rule — find a missing angle", marks: 3,
  build(rng) {
    let A, a, b, sinB;
    do {
      A = seededInt(rng, 30, 70);
      a = seededInt(rng, 6, 12);
      b = a + seededInt(rng, 1, 5);
      sinB = (b * Math.sin(A * Math.PI / 180)) / a;
    } while (sinB > 1);
    const B = Math.asin(sinB) * 180 / Math.PI;
    const C = 180 - A - B;
    const c = (a * Math.sin(C * Math.PI / 180)) / Math.sin(A * Math.PI / 180);
    return {
      prompt: `Find the size of angle B to 1 decimal place.`,
      render: (
        <GeneralTriangleSVG
          sideAB={c} angleA={A} angleB={B}
          labelA={`${A}°`} labelB={`?°`}
          sideALabel={`a = ${a} cm`} sideBLabel={`b = ${b} cm`}
        />
      ),
      answer: <>sin B = <Frac n={<>{b} × sin{A}°</>} d={a} />; B = {B.toFixed(1)}°</>,
    };
  },
};
SUBTOPIC_BANK["cosine-rule-side"] = {
  topic: "Non-Right Trigonometry", title: "Cosine rule — find a missing side", marks: 3,
  build(rng) {
    const b = seededInt(rng, 6, 14), c = seededInt(rng, 6, 14);
    const A = seededInt(rng, 40, 110);
    const aSq = b * b + c * c - 2 * b * c * Math.cos(A * Math.PI / 180);
    const a = Math.sqrt(aSq);
    // For the drawing we know angle A and the two adjacent sides b (AC) and c (AB).
    // We need angle B for the SVG helper: sin B = b sin A / a
    const B = Math.asin((b * Math.sin(A * Math.PI / 180)) / a) * 180 / Math.PI;
    return {
      prompt: `Find the length of side a (opposite angle A) to 1 decimal place.`,
      render: (
        <GeneralTriangleSVG
          sideAB={c} angleA={A} angleB={B}
          labelA={`${A}°`}
          sideALabel={`a = ?`} sideBLabel={`b = ${b} cm`} sideCLabel={`c = ${c} cm`}
        />
      ),
      answer: `a² = ${b}² + ${c}² - 2(${b})(${c})cos${A}° = ${aSq.toFixed(2)}; a = ${a.toFixed(1)} cm`,
    };
  },
};
SUBTOPIC_BANK["cosine-rule-angle"] = {
  topic: "Non-Right Trigonometry", title: "Cosine rule — find a missing angle", marks: 3,
  build(rng) {
    let a, b, c, cosA;
    do {
      a = seededInt(rng, 5, 11); b = seededInt(rng, 5, 11); c = seededInt(rng, 5, 11);
      cosA = (b * b + c * c - a * a) / (2 * b * c);
    } while (Math.abs(cosA) >= 1 || a + b <= c || a + c <= b || b + c <= a);
    const A = Math.acos(cosA) * 180 / Math.PI;
    const B = Math.asin((b * Math.sin(A * Math.PI / 180)) / a) * 180 / Math.PI;
    return {
      prompt: `Find the size of angle A (opposite side a) to 1 decimal place.`,
      render: (
        <GeneralTriangleSVG
          sideAB={c} angleA={A} angleB={B}
          labelA={`?°`}
          sideALabel={`a = ${a} cm`} sideBLabel={`b = ${b} cm`} sideCLabel={`c = ${c} cm`}
        />
      ),
      answer: <>cos A = <Frac n={<>{b}² + {c}² - {a}²</>} d={<>2 × {b} × {c}</>} /> = {cosA.toFixed(3)}; A = {A.toFixed(1)}°</>,
    };
  },
};
SUBTOPIC_BANK["area-rule"] = {
  topic: "Non-Right Trigonometry", title: "Area of a triangle using ½ab sin C", marks: 2,
  build(rng) {
    const a = seededInt(rng, 6, 15), b = seededInt(rng, 6, 15);
    const C = seededInt(rng, 30, 130);
    const area = 0.5 * a * b * Math.sin(C * Math.PI / 180);
    // Draw: the included angle is at C, adjacent sides are a and b. Place C at "A" position
    // in the SVG helper (i.e. angle at A = C°). Second side across the base.
    const cSide = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(C * Math.PI / 180));
    const angleB_ = Math.asin((b * Math.sin(C * Math.PI / 180)) / cSide) * 180 / Math.PI;
    return {
      prompt: `Find the area of the triangle to 1 decimal place.`,
      render: (
        <GeneralTriangleSVG
          sideAB={cSide} angleA={C} angleB={angleB_}
          labelA={`${C}°`}
          sideBLabel={`${b} cm`} sideCLabel={`${a} cm`}
        />
      ),
      answer: `Area = ½ × ${a} × ${b} × sin${C}° = ${area.toFixed(1)} cm²`,
    };
  },
};

/* --- HT3 Week 5: Circle Theorems (L1/L2/L3, Mixed Practice) --- top skills by exam-spec usage (Dr Frost data) --- */
SUBTOPIC_BANK["circle-theorem-centre-circumference"] = {
  topic: "Circle Theorems", title: "Angle at the centre vs angle at the circumference", marks: 2,
  build(rng) {
    const circumAngle = seededInt(rng, 25, 75);
    const centreAngle = circumAngle * 2;
    const askCentre = pick(rng, [true, false]);
    return {
      prompt: `A, B and C are points on the circumference of a circle, centre O. Find the size of angle ${askCentre ? "AOB" : "ACB"}.`,
      render: (
        <CircleTheoremSVG
          theorem="centre"
          centreAngleDeg={centreAngle}
          centreLabel={askCentre ? "?" : `${centreAngle}°`}
          circumLabel={askCentre ? `${circumAngle}°` : "?"}
        />
      ),
      answer: askCentre
        ? `Angle at the centre = 2 × angle at the circumference = 2 × ${circumAngle}° = ${centreAngle}°`
        : `Angle at the circumference = angle at the centre ÷ 2 = ${centreAngle}° ÷ 2 = ${circumAngle}°`,
    };
  },
};
SUBTOPIC_BANK["circle-theorem-semicircle"] = {
  topic: "Circle Theorems", title: "Angle in a semicircle", marks: 1,
  build(rng) {
    const angleA = seededInt(rng, 25, 65);
    const angleB = 90 - angleA;
    const askB = pick(rng, [true, false]);
    const cAngleDeg = 2 * angleA;
    return {
      prompt: `AB is a diameter of the circle. C is a point on the circumference. Find the size of angle ${askB ? "ABC" : "BAC"}.`,
      render: (
        <CircleTheoremSVG
          theorem="semicircle"
          cAngleDeg={cAngleDeg}
          labelA={askB ? `${angleA}°` : "?"}
          labelB={askB ? "?" : `${angleB}°`}
        />
      ),
      answer: `Angle in a semicircle = 90°, so the missing angle = 90° - ${askB ? angleA : angleB}° = ${askB ? angleB : angleA}°`,
    };
  },
};
SUBTOPIC_BANK["circle-theorem-tangent-kite"] = {
  topic: "Circle Theorems", title: "Tangents from an external point", marks: 2,
  build(rng) {
    const knownVertex = pick(rng, ["O", "P"]);
    const knownValue = seededInt(rng, 40, 140);
    const angleAOB = knownVertex === "O" ? knownValue : 180 - knownValue;
    const angleAPB = 180 - angleAOB;
    return {
      prompt: `PA and PB are tangents to the circle, centre O, touching at A and B. Find the size of angle ${knownVertex === "O" ? "APB" : "AOB"}.`,
      render: (
        <CircleTheoremSVG
          theorem="tangent-kite"
          angleAOBdeg={angleAOB}
          labelO={knownVertex === "O" ? `${angleAOB}°` : "?"}
          labelP={knownVertex === "O" ? "?" : `${angleAPB}°`}
        />
      ),
      answer: `Angles OAP and OBP are both 90° (radius ⊥ tangent). The quadrilateral OAPB's angles sum to 360°, so the missing angle = 360° - 90° - 90° - ${knownValue}° = ${knownVertex === "O" ? angleAPB : angleAOB}°`,
    };
  },
};
SUBTOPIC_BANK["circle-theorem-cyclic-quadrilateral"] = {
  topic: "Circle Theorems", title: "Cyclic quadrilateral — opposite angles", marks: 2,
  build(rng) {
    const given = seededInt(rng, 65, 115);
    const other = 180 - given;
    const unknownVertex = pick(rng, ["A", "C"]);
    const angleAtA = unknownVertex === "A" ? other : given;
    return {
      prompt: `ABCD is a cyclic quadrilateral. Find the size of angle ${unknownVertex === "A" ? "DAB" : "BCD"}.`,
      render: (
        <CircleTheoremSVG
          theorem="cyclic-quad"
          angleAtADeg={angleAtA}
          labelA={unknownVertex === "A" ? "?" : `${given}°`}
          labelC={unknownVertex === "C" ? "?" : `${given}°`}
        />
      ),
      answer: `Opposite angles in a cyclic quadrilateral sum to 180°, so the missing angle = 180° - ${given}° = ${other}°`,
    };
  },
};

/* --- HT4 Week 2: Congruence, Similar Shapes - Linear --- text-only: shapes fully specified
   by letter correspondence, same precedent as the existing tree-diagram / venn-missing subtopics --- */
const CONGRUENCE_CRITERIA = [
  { code: "SSS", desc: "all three pairs of corresponding sides are equal", parts: (rng) => {
      const a = seededInt(rng, 4, 12), b = seededInt(rng, 4, 12), c = seededInt(rng, 4, 12);
      return `AB = ${a} cm, BC = ${b} cm, CA = ${c} cm. DE = ${a} cm, EF = ${b} cm, FD = ${c} cm.`;
    } },
  { code: "SAS", desc: "two pairs of corresponding sides are equal, with the included angle equal", parts: (rng) => {
      const a = seededInt(rng, 4, 12), b = seededInt(rng, 4, 12), ang = seededInt(rng, 30, 120);
      return `AB = ${a} cm, BC = ${b} cm, angle B = ${ang}°. DE = ${a} cm, EF = ${b} cm, angle E = ${ang}°.`;
    } },
  { code: "ASA", desc: "two pairs of corresponding angles are equal, with a corresponding side equal", parts: (rng) => {
      const a = seededInt(rng, 4, 12), ang1 = seededInt(rng, 30, 80), ang2 = seededInt(rng, 30, 80);
      return `AB = ${a} cm, angle A = ${ang1}°, angle B = ${ang2}°. DE = ${a} cm, angle D = ${ang1}°, angle E = ${ang2}°.`;
    } },
  { code: "RHS", desc: "both are right-angled, with the hypotenuse and one other side equal", parts: (rng) => {
      const h = seededInt(rng, 8, 15), a = seededInt(rng, 4, 7);
      return `Triangles ABC and DEF are both right-angled. AB = ${h} cm (hypotenuse), AC = ${a} cm. DE = ${h} cm (hypotenuse), DF = ${a} cm.`;
    } },
];
SUBTOPIC_BANK["congruence-criteria"] = {
  topic: "Congruence", title: "State the congruence criterion (SSS, SAS, ASA, RHS)", marks: 1,
  build(rng) {
    const c = pick(rng, CONGRUENCE_CRITERIA);
    const given = c.parts(rng);
    return {
      prompt: `Triangle ABC is congruent to triangle DEF. ${given} State which condition (SSS, SAS, ASA or RHS) proves this.`,
      answer: `${c.code} — ${c.desc}`,
    };
  },
};
SUBTOPIC_BANK["similar-shapes-find-length"] = {
  topic: "Similar Shapes", title: "Find a missing length using similar triangles", marks: 2,
  build(rng) {
    const k = pick(rng, [2, 3, 4]);
    const AB = seededInt(rng, 3, 8);
    const BC = seededInt(rng, 3, 9);
    const PQ = AB * k;
    return {
      prompt: `Triangle ABC is similar to triangle PQR, with AB corresponding to PQ. AB = ${AB} cm, PQ = ${PQ} cm, and BC = ${BC} cm. Find the length of QR.`,
      answer: <>Scale factor = <Frac n={PQ} d={AB} /> = {k}; QR = {BC} × {k} = {BC * k} cm</>,
    };
  },
};
SUBTOPIC_BANK["similar-shapes-identify"] = {
  topic: "Similar Shapes", title: "Determine whether two shapes are similar", marks: 2,
  build(rng) {
    const w1 = seededInt(rng, 3, 8), h1 = seededInt(rng, 3, 9);
    const isSimilar = pick(rng, [true, false]);
    const k = pick(rng, [2, 3, 1.5]);
    const w2 = w1 * k;
    const h2 = isSimilar ? h1 * k : h1 * k + seededInt(rng, 1, 3);
    return {
      prompt: `Rectangle A has width ${w1} cm and height ${h1} cm. Rectangle B has width ${w2} cm and height ${h2} cm. Are rectangles A and B similar? Give a reason.`,
      answer: isSimilar
        ? `${w2}/${w1} = ${k} and ${h2}/${h1} = ${k} — the ratios are equal, so yes, they are similar.`
        : `${w2}/${w1} = ${k} but ${h2}/${h1} = ${(h2 / h1).toFixed(2)} — the ratios are different, so no, they are not similar.`,
    };
  },
};

/* --- HT4 Week 3: Similar Shapes (Area & Volume), Iterations --- */
SUBTOPIC_BANK["similar-shapes-area-scale"] = {
  topic: "Similar Shapes", title: "Area of a similar shape using scale factor squared", marks: 2,
  build(rng) {
    const k = pick(rng, [2, 3, 4]);
    const areaSmall = seededInt(rng, 4, 20);
    const areaLarge = areaSmall * k * k;
    const askLarge = pick(rng, [true, false]);
    return {
      prompt: askLarge
        ? `Two similar shapes have a linear scale factor of ${k}. The smaller shape has an area of ${areaSmall} cm². Find the area of the larger shape.`
        : `Two similar shapes have a linear scale factor of ${k}. The larger shape has an area of ${areaLarge} cm². Find the area of the smaller shape.`,
      answer: askLarge
        ? `Area scale factor = ${k}² = ${k * k}; Area = ${areaSmall} × ${k * k} = ${areaLarge} cm²`
        : `Area scale factor = ${k}² = ${k * k}; Area = ${areaLarge} ÷ ${k * k} = ${areaSmall} cm²`,
    };
  },
};
SUBTOPIC_BANK["similar-shapes-volume-scale"] = {
  topic: "Similar Shapes", title: "Volume of a similar shape using scale factor cubed", marks: 2,
  build(rng) {
    const k = pick(rng, [2, 3]);
    const volSmall = seededInt(rng, 2, 10);
    const volLarge = volSmall * k * k * k;
    const askLarge = pick(rng, [true, false]);
    return {
      prompt: askLarge
        ? `Two similar solids have a linear scale factor of ${k}. The smaller solid has a volume of ${volSmall} cm³. Find the volume of the larger solid.`
        : `Two similar solids have a linear scale factor of ${k}. The larger solid has a volume of ${volLarge} cm³. Find the volume of the smaller solid.`,
      answer: askLarge
        ? `Volume scale factor = ${k}³ = ${k ** 3}; Volume = ${volSmall} × ${k ** 3} = ${volLarge} cm³`
        : `Volume scale factor = ${k}³ = ${k ** 3}; Volume = ${volLarge} ÷ ${k ** 3} = ${volSmall} cm³`,
    };
  },
};
SUBTOPIC_BANK["iterations-fixed-point"] = {
  topic: "Iterations", title: "Iterate a fixed-point formula", marks: 3,
  build(rng) {
    const c = seededInt(rng, 2, 9);
    const d = seededInt(rng, 3, 8);
    const x0 = seededInt(rng, 1, 4);
    const x1 = (x0 * x0 + c) / d;
    const x2 = (x1 * x1 + c) / d;
    return {
      prompt: <>Using the iteration formula xₙ₊₁ = <Frac n={<>xₙ² + {c}</>} d={d} />, with x₀ = {x0}, find the values of x₁ and x₂. Give your answers to 2 decimal places.</>,
      answer: <>x₁ = <Frac n={<>x₀² + {c}</>} d={d} /> = {x1.toFixed(2)}; x₂ = <Frac n={<>{x1.toFixed(2)}² + {c}</>} d={d} /> = {x2.toFixed(2)}</>,
    };
  },
};

/* --- HT4 Week 4: Equation of a Circle, Linear Graphs (recap) --- */
SUBTOPIC_BANK["circle-eq-radius-from-eq"] = {
  topic: "Equation of a Circle", title: "Find the radius from the equation of a circle", marks: 1,
  build(rng) {
    const r = seededInt(rng, 2, 12);
    const k = r * r;
    return { prompt: `A circle, centred at the origin, has the equation x² + y² = ${k}. Write down the radius of the circle.`, answer: `r = √${k} = ${r}` };
  },
};
SUBTOPIC_BANK["circle-eq-write-given-radius"] = {
  topic: "Equation of a Circle", title: "Write the equation of a circle given its radius", marks: 1,
  build(rng) {
    const r = seededInt(rng, 2, 15);
    return { prompt: `Write down the equation of a circle, centred at the origin, with radius ${r}.`, answer: `x² + y² = ${r * r}` };
  },
};
SUBTOPIC_BANK["linear-graph-two-points"] = {
  topic: "Linear Graphs", title: "Find the equation of a line through two points", marks: 3,
  build(rng) {
    const m = pick(rng, [-4, -3, -2, -1, 1, 2, 3, 4]);
    const c = seededInt(rng, -9, 9);
    const x1 = seededInt(rng, -6, 0);
    const x2 = seededInt(rng, 1, 6);
    const y1 = m * x1 + c, y2 = m * x2 + c;
    return {
      prompt: `A straight line passes through (${x1}, ${y1}) and (${x2}, ${y2}). Find the equation of the line in the form y = mx + c.`,
      answer: <>m = <Frac n={<>{y2} - {y1}</>} d={<>{x2} - {x1}</>} /> = {m}; c = {c}; y = {m}x {pm(c)}</>,
    };
  },
};
SUBTOPIC_BANK["linear-graph-parallel"] = {
  topic: "Linear Graphs", title: "Equation of a line parallel to a given line", marks: 2,
  build(rng) {
    const m = pick(rng, [-4, -3, -2, -1, 1, 2, 3, 4]);
    const c0 = seededInt(rng, -9, 9);
    const x0 = seededInt(rng, -6, 6);
    const y0 = seededInt(rng, -12, 12);
    const c = y0 - m * x0;
    return {
      prompt: `Find the equation of the line parallel to y = ${m}x ${pm(c0)}, passing through the point (${x0}, ${y0}). Give your answer in the form y = mx + c.`,
      answer: `Gradient = ${m} (parallel lines have equal gradients); c = ${y0} - ${m} × ${x0} = ${c}; y = ${m}x ${pm(c)}`,
    };
  },
};
SUBTOPIC_BANK["linear-graph-perpendicular"] = {
  topic: "Linear Graphs", title: "Equation of a line perpendicular to a given line", marks: 3,
  build(rng) {
    const m = pick(rng, [-4, -3, -2, -1, 1, 2, 3, 4]);
    const perpM = -1 / m;
    const x0 = seededInt(rng, -6, 6) * Math.abs(m);
    const y0 = seededInt(rng, -12, 12);
    const c = y0 - perpM * x0;
    const perpMDisplay = Number.isInteger(perpM) ? `${perpM}` : <>{perpM > 0 ? "" : "-"}<Frac n="1" d={Math.abs(m)} /></>;
    return {
      prompt: `A line has gradient ${m}. Find the equation, in the form y = mx + c, of the line perpendicular to it that passes through (${x0}, ${y0}).`,
      answer: <>Perpendicular gradient = -<Frac n="1" d={m} /> = {perpMDisplay}; c = {y0} - ({perpMDisplay}) × {x0} = {c}; y = {perpMDisplay}x {pm(c)}</>,
    };
  },
};

/* --- HT4 Week 5: Inequalities (Linear, Quadratic) --- Graphical Inequalities skipped:
   lower exam-usage than the linear/quadratic skills and needs a shaded-region diagram
   with no existing template. --- */
SUBTOPIC_BANK["inequality-list-integers"] = {
  topic: "Inequalities", title: "List integer values satisfying an inequality", marks: 1,
  build(rng) {
    const lo = seededInt(rng, -8, -1);
    const hi = seededInt(rng, 1, 8);
    const values = [];
    for (let n = lo + 1; n <= hi; n++) values.push(n);
    return { prompt: `n is an integer such that ${lo} < n ≤ ${hi}. List all the possible values of n.`, answer: `n = ${values.join(", ")}` };
  },
};
SUBTOPIC_BANK["inequality-linear-twostep"] = {
  topic: "Inequalities", title: "Solve a two-step linear inequality", marks: 2,
  build(rng) {
    const negCoef = pick(rng, [true, false]);
    const a = seededInt(rng, 2, 6) * (negCoef ? -1 : 1);
    const x0 = seededInt(rng, -8, 8);
    const b = seededInt(rng, -9, 9);
    const c = a * x0 + b;
    const symbol = pick(rng, ["<", ">"]);
    const flipped = negCoef ? (symbol === "<" ? ">" : "<") : symbol;
    return {
      prompt: `Solve the inequality ${a}x ${pm(b)} ${symbol} ${c}`,
      answer: `${a}x ${symbol} ${c - b}; x ${flipped} ${x0}${negCoef ? " (the inequality sign flips when dividing by a negative)" : ""}`,
    };
  },
};
SUBTOPIC_BANK["inequality-both-sides"] = {
  topic: "Inequalities", title: "Solve an inequality with the unknown on both sides", marks: 3,
  build(rng) {
    const p = seededInt(rng, 3, 7);
    const q = seededInt(rng, 1, p - 1);
    const x0 = seededInt(rng, -6, 6);
    const b = seededInt(rng, -9, 9);
    const d = b + (p - q) * x0;
    const symbol = pick(rng, ["<", ">"]);
    return {
      prompt: `Solve the inequality ${p}x ${pm(b)} ${symbol} ${q}x ${pm(d)}`,
      answer: `${p - q}x ${symbol} ${d - b}; x ${symbol} ${x0}`,
    };
  },
};
SUBTOPIC_BANK["inequality-quadratic-solve"] = {
  topic: "Inequalities", title: "Solve a quadratic inequality by factorising", marks: 3,
  build(rng) {
    const r1 = seededInt(rng, -7, -1);
    const r2 = seededInt(rng, 1, 7);
    const b = -(r1 + r2), c = r1 * r2;
    const wantOutside = pick(rng, [true, false]);
    const symbol = wantOutside ? ">" : "<";
    return {
      prompt: `Solve the inequality x² ${pmX(b, "x")} ${pm(c)} ${symbol} 0`,
      answer: wantOutside
        ? `(x - ${r2})(x + ${-r1}) ${symbol} 0, roots at x = ${r1} and x = ${r2}; x < ${r1} or x > ${r2}`
        : `(x - ${r2})(x + ${-r1}) ${symbol} 0, roots at x = ${r1} and x = ${r2}; ${r1} < x < ${r2}`,
    };
  },
};

/* --- HT5 Week 1: Vectors, Algebraic Proof --- vector routes are given by naming the
   shape (e.g. "OAB is a triangle") rather than a drawing, same precedent as the
   existing text-only tree-diagram / venn-missing subtopics. --- */
SUBTOPIC_BANK["vectors-column-arithmetic"] = {
  topic: "Vectors", title: "Column vector arithmetic", marks: 2,
  build(rng) {
    const a1 = seededInt(rng, -6, 6), a2 = seededInt(rng, -6, 6);
    const b1 = seededInt(rng, -6, 6), b2 = seededInt(rng, -6, 6);
    const p = seededInt(rng, 2, 4), q = seededInt(rng, 2, 4);
    const r1 = p * a1 - q * b1, r2 = p * a2 - q * b2;
    return {
      prompt: `a = (${a1}, ${a2}) and b = (${b1}, ${b2}). Find ${p}a - ${q}b as a column vector.`,
      answer: `(${p}×${a1} - ${q}×${b1}, ${p}×${a2} - ${q}×${b2}) = (${r1}, ${r2})`,
    };
  },
};
SUBTOPIC_BANK["vectors-route-midpoint"] = {
  topic: "Vectors", title: "Vector routes — dividing a line in a ratio", marks: 3,
  build(rng) {
    const m = seededInt(rng, 1, 3), n = seededInt(rng, 1, 3);
    return {
      prompt: `OAB is a triangle with OA = a and OB = b. P lies on AB such that AP : PB = ${m} : ${n}. Find the vector OP in terms of a and b.`,
      answer: <>OP = a + <Frac n={m} d={m + n} />(b - a) = <Frac n={n} d={m + n} />a + <Frac n={m} d={m + n} />b</>,
    };
  },
};
SUBTOPIC_BANK["vectors-parallel-proof"] = {
  topic: "Vectors", title: "Show that two vectors are parallel", marks: 2,
  build(rng) {
    const p = seededInt(rng, 1, 4), q = seededInt(rng, 1, 4);
    const k = seededInt(rng, 2, 4);
    return {
      prompt: `OA = ${p}a + ${q}b and OC = ${p * k}a + ${q * k}b. Show that OA and OC are parallel.`,
      answer: `OC = ${k}(${p}a + ${q}b) = ${k} × OA, so OC is a scalar multiple of OA — the vectors are parallel.`,
    };
  },
};
const PROOF_TEMPLATES_OE = [
  {
    prompt: "Prove that the sum of two consecutive odd numbers is always even.",
    answer: "Let the odd numbers be 2n + 1 and 2n + 3. Sum = 4n + 4 = 2(2n + 2), which is a multiple of 2, so it is always even.",
  },
  {
    prompt: "Prove that the sum of three consecutive integers is always a multiple of 3.",
    answer: "Let the integers be n, n + 1, n + 2. Sum = 3n + 3 = 3(n + 1), which is a multiple of 3.",
  },
  {
    prompt: "Prove that the square of an odd number is always odd.",
    answer: "Let the odd number be 2n + 1. (2n + 1)² = 4n² + 4n + 1 = 2(2n² + 2n) + 1, which is 2 × integer + 1, so it is always odd.",
  },
  {
    prompt: "Prove that the difference between the squares of two consecutive even numbers is always a multiple of 4.",
    answer: "Let the even numbers be 2n and 2n + 2. (2n + 2)² - (2n)² = 4n² + 8n + 4 - 4n² = 8n + 4 = 4(2n + 1), which is a multiple of 4.",
  },
];
SUBTOPIC_BANK["algebraic-proof-odd-even"] = {
  topic: "Algebraic Proof", title: "Prove a statement about odd, even or consecutive numbers", marks: 3,
  build(rng) {
    const t = pick(rng, PROOF_TEMPLATES_OE);
    return { prompt: t.prompt, answer: t.answer };
  },
};
const PROOF_TEMPLATES_MULT = [
  {
    prompt: "Prove that n² + n is always even, for any positive integer n.",
    answer: "n² + n = n(n + 1), the product of two consecutive integers. One of any two consecutive integers is always even, so the product is always even.",
  },
  {
    prompt: "Prove that (n + 1)² - (n - 1)² is always a multiple of 4.",
    answer: "(n + 1)² - (n - 1)² = (n² + 2n + 1) - (n² - 2n + 1) = 4n, which is a multiple of 4.",
  },
  {
    prompt: "Prove that the sum of the squares of any two odd numbers is always even.",
    answer: "Let the odd numbers be 2a + 1 and 2b + 1. Sum of squares = 4a² + 4a + 1 + 4b² + 4b + 1 = 2(2a² + 2a + 2b² + 2b + 1), which is a multiple of 2, so it is always even.",
  },
];
SUBTOPIC_BANK["algebraic-proof-multiple"] = {
  topic: "Algebraic Proof", title: "Prove an expression is a multiple of a number", marks: 3,
  build(rng) {
    const t = pick(rng, PROOF_TEMPLATES_MULT);
    return { prompt: t.prompt, answer: t.answer };
  },
};

/* ------ Tier 1 full-spec batch: groups with no scheme-of-work week (not tied to
   Year 11 Set 2's timeline) but added so every group has coverage in the full spec
   browser. No new diagram types needed here — all text or simple HTML tables. ------ */

/* Number → Addition & Subtraction */
SUBTOPIC_BANK["addsub-word-problem"] = {
  topic: "Addition & Subtraction", title: "Two-step word problem with addition and subtraction", marks: 2,
  build(rng) {
    const start = seededInt(rng, 200, 900);
    const gain = seededInt(rng, 50, 300);
    const spend = seededInt(rng, 30, 250);
    const result = start + gain - spend;
    return {
      prompt: `A shop had ${start} items in stock. A delivery of ${gain} items arrived, then ${spend} items were sold. How many items are now in stock?`,
      answer: `${start} + ${gain} - ${spend} = ${result}`,
    };
  },
};

/* Number → Multiplication & Division */
SUBTOPIC_BANK["multiply-two-two-digit"] = {
  topic: "Multiplication & Division", title: "Multiply a 2-digit number by a 2-digit number", marks: 2,
  build(rng) {
    const a = seededInt(rng, 12, 45), b = seededInt(rng, 12, 45);
    return { prompt: `Work out ${a} × ${b}`, answer: `${a * b}` };
  },
};
SUBTOPIC_BANK["divide-with-remainder-decimal"] = {
  topic: "Multiplication & Division", title: "Divide, giving the remainder as a decimal", marks: 2,
  build(rng) {
    const divisor = pick(rng, [2, 4, 5, 8, 10, 20, 25]);
    const quotient = seededInt(rng, 10, 40);
    const remainder = seededInt(rng, 1, divisor - 1);
    const dividend = divisor * quotient + remainder;
    return { prompt: `Work out ${dividend} ÷ ${divisor}. Give your answer as a decimal.`, answer: `${dividend / divisor}` };
  },
};

/* Number → Decimal Arithmetic */
SUBTOPIC_BANK["decimal-multiply-by-integer"] = {
  topic: "Decimal Arithmetic", title: "Multiply a decimal by an integer", marks: 1,
  build(rng) {
    const d = seededInt(rng, 11, 99) / 10, n = seededInt(rng, 3, 9);
    return { prompt: `Work out ${d} × ${n}`, answer: `${Math.round(d * n * 10) / 10}` };
  },
};
SUBTOPIC_BANK["decimal-divide-by-decimal"] = {
  topic: "Decimal Arithmetic", title: "Divide a decimal by a decimal", marks: 2,
  build(rng) {
    const divisor = seededInt(rng, 2, 9) / 10;
    const quotient = seededInt(rng, 3, 20);
    const dividend = Math.round(divisor * quotient * 10) / 10;
    return {
      prompt: `Work out ${dividend} ÷ ${divisor}`,
      answer: `${dividend} ÷ ${divisor} = ${Math.round(dividend * 10)} ÷ ${Math.round(divisor * 10)} = ${quotient}`,
    };
  },
};

/* Number → Place Value (Including Decimals) */
SUBTOPIC_BANK["place-value-digit-value"] = {
  topic: "Place Value (Including Decimals)", title: "State the place value of a digit", marks: 1,
  build(rng) {
    const digits = Array.from({ length: 6 }, () => seededInt(rng, 0, 9));
    if (digits[0] === 0) digits[0] = seededInt(rng, 1, 9);
    const number = digits.join("");
    const placeNames = ["hundred thousands", "ten thousands", "thousands", "hundreds", "tens", "units"];
    const placeValues = [100000, 10000, 1000, 100, 10, 1];
    const idx = seededInt(rng, 0, 5);
    return {
      prompt: `In the number ${Number(number).toLocaleString("en-GB")}, what is the value of the digit in the ${placeNames[idx]} column?`,
      answer: `${digits[idx]} × ${placeValues[idx]} = ${digits[idx] * placeValues[idx]}`,
    };
  },
};
SUBTOPIC_BANK["order-decimals"] = {
  topic: "Place Value (Including Decimals)", title: "Order decimals", marks: 1,
  build(rng) {
    // Numbers that all look alike: same whole part, and decimal parts built
    // from just two digits plus zero, with different lengths (e.g. 3.4, 3.45,
    // 3.405, 3.54, 3.045), so pupils must compare place by place.
    const whole = seededInt(rng, 0, 9);
    let d1 = seededInt(rng, 1, 9), d2 = seededInt(rng, 1, 9);
    while (d2 === d1) d2 = seededInt(rng, 1, 9);
    const digits = [d1, d2, 0];
    const pool = new Set();
    for (let len = 1; len <= 3; len++) {
      const rec = (prefix) => {
        if (prefix.length === len) { if (prefix[prefix.length - 1] !== 0) pool.add(prefix.join("")); return; }
        digits.forEach((dg) => rec(prefix.concat([dg])));
      };
      rec([]);
    }
    const all = [...pool];
    const nums = [];
    let guard = 0;
    while (nums.length < 5 && guard < 200) {
      guard++;
      const frac = pick(rng, all);
      const v = `${whole}.${frac}`;
      if (!nums.includes(v) && !nums.some((x) => parseFloat(x) === parseFloat(v))) nums.push(v);
    }
    const ascending = pick(rng, [true, false]);
    const sorted = [...nums].sort((a, b) => (ascending ? parseFloat(a) - parseFloat(b) : parseFloat(b) - parseFloat(a)));
    return {
      prompt: `Write these decimals in order, ${ascending ? "smallest to largest" : "largest to smallest"}: ${nums.join(",   ")}`,
      answer: sorted.join(", "),
    };
  },
};

/* Number → Number Properties */
SUBTOPIC_BANK["number-properties-classify"] = {
  topic: "Number Properties", title: "Classify a number as square, cube, prime, odd or even", marks: 1,
  build(rng) {
    const pool = [
      { n: 4, props: "square, even" }, { n: 8, props: "cube, even" }, { n: 9, props: "square, odd" },
      { n: 27, props: "cube, odd" }, { n: 17, props: "prime, odd" }, { n: 25, props: "square, odd" },
      { n: 36, props: "square, even" }, { n: 49, props: "square, odd" }, { n: 64, props: "square, cube, even" },
      { n: 2, props: "prime, even" }, { n: 23, props: "prime, odd" }, { n: 125, props: "cube, odd" },
    ];
    const item = pick(rng, pool);
    return { prompt: `List all the words that describe the number ${item.n}, from: square, cube, prime, odd, even.`, answer: item.props };
  },
};
SUBTOPIC_BANK["number-properties-next-even-odd"] = {
  topic: "Number Properties", title: "Find the next odd or even number", marks: 1,
  build(rng) {
    const isEven = pick(rng, [true, false]);
    let n = seededInt(rng, 10, 500);
    if (isEven && n % 2 !== 0) n += 1;
    if (!isEven && n % 2 === 0) n += 1;
    return { prompt: `Write down the next ${isEven ? "even" : "odd"} number after ${n}.`, answer: `${n + 2}` };
  },
};

/* Number → Money */
SUBTOPIC_BANK["money-change-due"] = {
  topic: "Money", title: "Determine the change due after buying multiple items", marks: 2,
  build(rng) {
    const price1 = seededInt(rng, 100, 600) / 100, price2 = seededInt(rng, 100, 600) / 100;
    const total = Math.round((price1 + price2) * 100) / 100;
    const paid = pick(rng, [15, 20]);
    const change = Math.round((paid - total) * 100) / 100;
    return {
      prompt: `Kai buys two items costing £${price1.toFixed(2)} and £${price2.toFixed(2)}. He pays with a £${paid} note. How much change does he get?`,
      answer: `£${paid} - (£${price1.toFixed(2)} + £${price2.toFixed(2)}) = £${paid} - £${total.toFixed(2)} = £${change.toFixed(2)}`,
    };
  },
};
SUBTOPIC_BANK["money-cost-per-item"] = {
  topic: "Money", title: "Find the cost per item given a total", marks: 2,
  build(rng) {
    const qty = seededInt(rng, 3, 8);
    const unitPrice = seededInt(rng, 50, 400) / 100;
    const total = Math.round(qty * unitPrice * 100) / 100;
    return {
      prompt: `${qty} identical items cost a total of £${total.toFixed(2)}. Work out the cost of one item.`,
      answer: `£${total.toFixed(2)} ÷ ${qty} = £${unitPrice.toFixed(2)}`,
    };
  },
};

/* Number → Fraction, Decimal & Percentage Equivalence */
SUBTOPIC_BANK["fdp-percent-to-decimal"] = {
  topic: "Fraction, Decimal & Percentage Equivalence", title: "Convert a percentage to a decimal", marks: 1,
  build(rng) {
    const pct = seededInt(rng, 1, 99) + pick(rng, [0, 0.5]);
    return { prompt: `Write ${pct}% as a decimal.`, answer: `${pct / 100}` };
  },
};
SUBTOPIC_BANK["fdp-recurring-partial-nonrecurring"] = {
  topic: "Fraction, Decimal & Percentage Equivalence", title: "Convert a recurring decimal (with a non-recurring part) to a fraction", marks: 4,
  build(rng) {
    const a = seededInt(rng, 1, 8), b = seededInt(rng, 1, 9);
    function gcdLocal(x, y) { while (y) { [x, y] = [y, x % y]; } return x; }
    const num = 9 * a + b, den = 90, g = gcdLocal(num, den);
    return {
      prompt: `Convert 0.${a}${b}̇ (the digit ${b} recurring) to a fraction in its simplest form.`,
      answer: <>Let x = 0.{a}{b}̇. 100x - 10x = {9 * a + b}; 90x = {9 * a + b}; x = <Frac n={num} d={den} /> = <Frac n={num / g} d={den / g} /></>,
    };
  },
};
SUBTOPIC_BANK["fdp-order-mixed"] = {
  topic: "Fraction, Decimal & Percentage Equivalence", title: "Order a mixture of fractions, decimals and percentages", marks: 2,
  build(rng) {
    const pool = [
      { label: <Frac n="1" d="4" />, val: 0.25 }, { label: <Frac n="3" d="5" />, val: 0.6 }, { label: "0.7", val: 0.7 },
      { label: "45%", val: 0.45 }, { label: "0.35", val: 0.35 }, { label: <Frac n="3" d="4" />, val: 0.75 },
      { label: "80%", val: 0.8 }, { label: <Frac n="1" d="5" />, val: 0.2 }, { label: "65%", val: 0.65 },
      { label: <Frac n="9" d="10" />, val: 0.9 }, { label: "15%", val: 0.15 },
    ];
    const chosen = [];
    while (chosen.length < 4) {
      const item = pick(rng, pool);
      if (!chosen.some((c) => c.val === item.val)) chosen.push(item);
    }
    const sorted = [...chosen].sort((x, y) => x.val - y.val);
    const joinLabels = (list) => list.map((c, i) => <React.Fragment key={i}>{i > 0 && ", "}{c.label}</React.Fragment>);
    return {
      prompt: <>Write these in order, smallest to largest: {joinLabels(chosen)}</>,
      answer: <>{joinLabels(sorted)}</>,
    };
  },
};

/* Number → Calculator Use */
SUBTOPIC_BANK["calculator-fractions"] = {
  topic: "Calculator Use", title: "Use a calculator to evaluate an expression with fractions", marks: 2,
  build(rng) {
    const a = seededInt(rng, 1, 9), b = seededInt(rng, 2, 9), c = seededInt(rng, 1, 9), d = seededInt(rng, 2, 9);
    const result = a / b + c / d;
    return { prompt: <>Use a calculator to work out <Frac n={a} d={b} /> + <Frac n={c} d={d} />. Give your answer as a decimal to 3 significant figures.</>, answer: `${result.toPrecision(3)}` };
  },
};
SUBTOPIC_BANK["calculator-powers-roots"] = {
  topic: "Calculator Use", title: "Use a calculator to evaluate powers and roots", marks: 2,
  build(rng) {
    const base = seededInt(rng, 2, 15);
    if (pick(rng, [true, false])) {
      const exp = seededInt(rng, 2, 4);
      return { prompt: `Use a calculator to work out ${base}^${exp}`, answer: `${Math.pow(base, exp)}` };
    }
    return { prompt: `Use a calculator to work out √${base * base}`, answer: `${base}` };
  },
};

/* Number → Combinations & Permutations */
SUBTOPIC_BANK["combinations-list-two-groups"] = {
  topic: "Combinations & Permutations", title: "List combinations of items from two groups", marks: 2,
  build(rng) {
    const [nameA, countA, nameB, countB] = pick(rng, [["shirts", 2, "trousers", 2], ["starters", 2, "mains", 3], ["toppings", 3, "bases", 2]]);
    const lettersA = "ABCDE".slice(0, countA).split("");
    const lettersB = "XYZ".slice(0, countB).split("");
    const combos = [];
    for (const a of lettersA) for (const b of lettersB) combos.push(`${a}${b}`);
    return {
      prompt: `A shop sells ${countA} types of ${nameA} (labelled ${lettersA.join(", ")}) and ${countB} types of ${nameB} (labelled ${lettersB.join(", ")}). List all the possible combinations of one ${nameA.replace(/s$/, "")} and one ${nameB.replace(/s$/, "")}.`,
      answer: combos.join(", "),
    };
  },
};
SUBTOPIC_BANK["combinations-choose-two"] = {
  topic: "Combinations & Permutations", title: "List combinations when choosing 2 items from a group", marks: 2,
  build(rng) {
    const n = seededInt(rng, 4, 6);
    const items = "ABCDEF".slice(0, n).split("");
    const combos = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) combos.push(`${items[i]}${items[j]}`);
    return {
      prompt: `${n} people (${items.join(", ")}) are in a raffle. Two winners are chosen at random (order doesn't matter). List all the possible pairs of winners.`,
      answer: `${combos.join(", ")} (${combos.length} pairs)`,
    };
  },
};

/* Algebra → Algebraic Notation & Manipulation */
SUBTOPIC_BANK["collect-like-terms-multi"] = {
  topic: "Algebraic Notation & Manipulation", title: "Collect like terms with multiple variables", marks: 2,
  build(rng) {
    const a1 = seededInt(rng, 1, 8), b1 = seededInt(rng, 1, 8), a2 = seededInt(rng, 1, 8), b2 = seededInt(rng, 1, 8);
    return { prompt: `Simplify ${a1}x + ${b1}y + ${a2}x - ${b2}y`, answer: `${a1 + a2}x ${pmX(b1 - b2, "y")}` };
  },
};
SUBTOPIC_BANK["multiply-algebraic-terms"] = {
  topic: "Algebraic Notation & Manipulation", title: "Multiply algebraic terms", marks: 1,
  build(rng) {
    const a = seededInt(rng, 2, 7), b = seededInt(rng, 2, 7);
    const vars = pick(rng, [["x", "y"], ["a", "b"], ["p", "q"]]);
    return { prompt: `Simplify ${a}${vars[0]} × ${b}${vars[1]}`, answer: `${a * b}${vars[0]}${vars[1]}` };
  },
};
SUBTOPIC_BANK["algebraic-notation-write"] = {
  topic: "Algebraic Notation & Manipulation", title: "Write an expression using correct algebraic notation", marks: 1,
  build(rng) {
    const items = [
      { words: "n multiplied by itself", answer: "n²" },
      { words: "n multiplied by 4, then 3 added", answer: "4n + 3" },
      { words: "5 subtracted from n, then the result multiplied by 2", answer: "2(n - 5)" },
      { words: "n divided by 3, then 1 added", answer: <><Frac n="n" d="3" /> + 1</> },
      { words: "n multiplied by itself, then multiplied by n again", answer: "n³" },
    ];
    const item = pick(rng, items);
    return { prompt: `Write an expression for: ${item.words}.`, answer: item.answer };
  },
};

/* Algebra → Substitution */
SUBTOPIC_BANK["substitution-one-variable"] = {
  topic: "Substitution", title: "Substitute into an expression with one variable", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 8), b = seededInt(rng, -9, 9), x = seededInt(rng, -6, 6);
    return { prompt: `Work out the value of ${a}x ${pm(b)} when x = ${x}`, answer: `${a}×${x} ${pm(b)} = ${a * x + b}` };
  },
};
SUBTOPIC_BANK["substitution-formula-negatives"] = {
  topic: "Substitution", title: "Substitute negative numbers into a formula", marks: 3,
  build(rng) {
    const a = seededInt(rng, 2, 6), b = seededInt(rng, 2, 6);
    const x = seededInt(rng, -8, -1), y = seededInt(rng, -8, -1);
    return { prompt: `P = ${a}x² - ${b}y. Work out the value of P when x = ${x} and y = ${y}.`, answer: `${a}×(${x})² - ${b}×(${y}) = ${a * x * x} - ${b * y} = ${a * x * x - b * y}` };
  },
};

/* Algebra → Solving Linear Equations */
SUBTOPIC_BANK["solve-two-step-equation"] = {
  topic: "Solving Linear Equations", title: "Solve a two-step linear equation", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 9), x0 = seededInt(rng, -9, 9), b = seededInt(rng, -9, 9);
    const c = a * x0 + b;
    return { prompt: `Solve ${a}x ${pm(b)} = ${c}`, answer: `${a}x = ${c - b}; x = ${x0}` };
  },
};
SUBTOPIC_BANK["solve-equation-both-sides-brackets"] = {
  topic: "Solving Linear Equations", title: "Solve an equation with brackets and the unknown on both sides", marks: 4,
  build(rng) {
    const a = seededInt(rng, 2, 5), x0 = seededInt(rng, -8, 8), k = seededInt(rng, 1, 6);
    let q;
    do { q = seededInt(rng, 1, 4); } while (q === a); // q === a would make both sides identical (0x = 0), not a solvable single-answer equation
    const d = a * x0 + a * k - q * x0;
    return {
      prompt: `Solve ${a}(x + ${k}) = ${q}x ${pm(d)}`,
      answer: `${a}x + ${a * k} = ${q}x ${pm(d)}; ${a - q}x = ${d - a * k}; x = ${x0}`,
    };
  },
};
SUBTOPIC_BANK["form-solve-perimeter-equation"] = {
  topic: "Solving Linear Equations", title: "Form and solve a linear equation for the perimeter of a shape", marks: 4,
  build(rng) {
    const x0 = seededInt(rng, 2, 12), a = seededInt(rng, 2, 5), b = seededInt(rng, 1, 9), width = seededInt(rng, 3, 9);
    const side1 = a * x0 + b;
    const perimeter = 2 * (side1 + width);
    return {
      prompt: `The diagram shows a rectangle. The perimeter of the rectangle is ${perimeter} cm. Form and solve an equation to find x.`,
      render: <RectangleSVG w={side1} h={width} wLabel={`(${a}x + ${b}) cm`} hLabel={`${width} cm`} />,
      accurateDiagram: true,
      answer: `2((${a}x + ${b}) + ${width}) = ${perimeter}; ${2 * a}x + ${2 * (b + width)} = ${perimeter}; ${2 * a}x = ${perimeter - 2 * (b + width)}; x = ${x0}`,
    };
  },
};

/* Algebra → Sequences & Series (Advanced) */
SUBTOPIC_BANK["arithmetic-sequence-nth-term-value"] = {
  topic: "Sequences & Series (Advanced)", title: "Find a term of an arithmetic sequence from its first term and common difference", marks: 2,
  build(rng) {
    const a1 = seededInt(rng, -10, 10), d = seededInt(rng, -6, 6) || 1, n = seededInt(rng, 8, 20);
    return { prompt: `An arithmetic sequence has first term ${a1} and common difference ${d}. Find the ${n}th term.`, answer: `${a1} + (${n} - 1) × ${d} = ${a1 + (n - 1) * d}` };
  },
};
SUBTOPIC_BANK["arithmetic-series-sum"] = {
  topic: "Sequences & Series (Advanced)", title: "Find the sum of the first n terms of an arithmetic series", marks: 3,
  build(rng) {
    const a1 = seededInt(rng, 1, 10), d = seededInt(rng, 1, 6), n = seededInt(rng, 5, 15);
    const sum = (n / 2) * (2 * a1 + (n - 1) * d);
    return { prompt: `An arithmetic series has first term ${a1} and common difference ${d}. Find the sum of the first ${n} terms.`, answer: <>Sₙ = <Frac n="n" d="2" /> × (2a + (n-1)d) = <Frac n={n} d="2" /> × ({2 * a1} + {(n - 1) * d}) = {sum}</> };
  },
};

/* Statistics & Probability → Probability Scale */
SUBTOPIC_BANK["probability-scale-words"] = {
  topic: "Probability Scale", title: "Describe a probability using words", marks: 1,
  build(rng) {
    const items = [
      { p: 0, word: "impossible" }, { p: 0.05, word: "very unlikely" }, { p: 0.25, word: "unlikely" },
      { p: 0.5, word: "evens (equally likely)" }, { p: 0.75, word: "likely" }, { p: 0.95, word: "very likely" }, { p: 1, word: "certain" },
    ];
    const item = pick(rng, items);
    return { prompt: `An event has a probability of ${item.p}. Describe this probability using one word or phrase (e.g. impossible, unlikely, evens, likely, certain).`, answer: item.word };
  },
};
SUBTOPIC_BANK["probability-scale-compare"] = {
  topic: "Probability Scale", title: "Compare the likelihood of events using probabilities", marks: 2,
  build(rng) {
    const pA = seededInt(rng, 1, 9) / 10;
    let pB = seededInt(rng, 1, 9) / 10;
    while (pB === pA) pB = seededInt(rng, 1, 9) / 10;
    const more = pA > pB ? "A" : "B";
    return { prompt: `Event A has probability ${pA} and event B has probability ${pB}. Which event is more likely to happen?`, answer: `Event ${more} (${Math.max(pA, pB)} > ${Math.min(pA, pB)})` };
  },
};

/* Statistics & Probability → Theoretical Probabilities & Mutually Exclusive Events */
SUBTOPIC_BANK["theoretical-probability-single"] = {
  topic: "Theoretical Probabilities & Mutually Exclusive Events", title: "Find a probability using counts", marks: 1,
  build(rng) {
    const total = seededInt(rng, 15, 30), favourable = seededInt(rng, 2, total - 2);
    return { prompt: `A bag contains ${total} counters, of which ${favourable} are blue. A counter is chosen at random. Find the probability that it is blue.`, answer: <Frac n={favourable} d={total} /> };
  },
};
SUBTOPIC_BANK["theoretical-probability-not-event"] = {
  topic: "Theoretical Probabilities & Mutually Exclusive Events", title: "Find the probability of an event not occurring", marks: 2,
  build(rng) {
    const denom = pick(rng, [8, 10, 12, 15, 20, 25]), num = seededInt(rng, 1, denom - 1);
    return { prompt: <>P(rain tomorrow) = <Frac n={num} d={denom} />. Find P(no rain tomorrow).</>, answer: <>1 - <Frac n={num} d={denom} /> = <Frac n={denom - num} d={denom} /></> };
  },
};
SUBTOPIC_BANK["mutually-exclusive-missing-probability"] = {
  topic: "Theoretical Probabilities & Mutually Exclusive Events", title: "Find a missing probability for mutually exclusive events", marks: 2,
  build(rng) {
    const denom = pick(rng, [10, 12, 20, 25]);
    const a = seededInt(rng, 1, denom - 3);
    const b = seededInt(rng, 1, denom - a - 2);
    const c = denom - a - b;
    return {
      prompt: <>A spinner can land on red, blue or green. P(red) = <Frac n={a} d={denom} /> and P(blue) = <Frac n={b} d={denom} />. Find P(green).</>,
      answer: <>1 - <Frac n={a} d={denom} /> - <Frac n={b} d={denom} /> = <Frac n={c} d={denom} /></>,
    };
  },
};

/* Statistics & Probability → Averages & Range for Listed Data */
SUBTOPIC_BANK["averages-range-listed"] = {
  topic: "Averages & Range for Listed Data", title: "Find the mean, median or range of a list", marks: 2,
  build(rng) {
    const n = 7;
    const values = Array.from({ length: n }, () => seededInt(rng, 1, 20));
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const which = pick(rng, ["mean", "median", "range"]);
    const answer = which === "mean" ? <><Frac n={sum} d={n} /> = {(sum / n).toFixed(2)}</>
      : which === "median" ? `Sorted: ${sorted.join(", ")}; median = ${sorted[Math.floor(n / 2)]}`
      : `${sorted[n - 1]} - ${sorted[0]} = ${sorted[n - 1] - sorted[0]}`;
    return {
      prompt: `Find the ${which} of this data set: ${values.join(", ")}${which === "mean" ? " Give your answer to 2 decimal places." : ""}`,
      answer,
    };
  },
};
SUBTOPIC_BANK["averages-missing-value-given-mean"] = {
  topic: "Averages & Range for Listed Data", title: "Find a missing value given the mean", marks: 3,
  build(rng) {
    const missing = seededInt(rng, 4, 20);
    const knownValues = Array.from({ length: 4 }, () => seededInt(rng, 2, 18));
    const n = 5;
    const total = knownValues.reduce((a, b) => a + b, 0) + missing;
    const mean = total / n;
    return {
      prompt: `The mean of 5 numbers is ${mean}. Four of the numbers are: ${knownValues.join(", ")}. Find the missing number.`,
      answer: `Total = ${mean} × ${n} = ${total}; missing number = ${total} - (${knownValues.join(" + ")}) = ${missing}`,
    };
  },
};

/* Statistics & Probability → Averages & Range for Tabulated Data --- rendered as
   HTML tables throughout, per request, rather than a list of raw numbers. */
SUBTOPIC_BANK["mean-from-grouped-table"] = {
  topic: "Averages & Range for Tabulated Data", title: "Estimate the mean from a grouped frequency table", marks: 3,
  build(rng) {
    const bounds = [0, 10, 20, 30, 40];
    const freqs = [seededInt(rng, 2, 8), seededInt(rng, 2, 8), seededInt(rng, 2, 8), seededInt(rng, 2, 8)];
    const mids = bounds.slice(0, 4).map((b, i) => (b + bounds[i + 1]) / 2);
    const fx = freqs.map((f, i) => f * mids[i]);
    const totalF = freqs.reduce((a, b) => a + b, 0);
    const totalFX = fx.reduce((a, b) => a + b, 0);
    return {
      prompt: `The table shows the time, t (minutes), taken by a group of runners to finish a race. Estimate the mean time. Give your answer to 2 decimal places.`,
      // No Midpoint/f × x columns — the whole point of "estimate the mean"
      // is finding the midpoints and multiplying by frequency yourself;
      // handing those over as blank-but-labelled columns just turns it into
      // fill-in-the-blanks.
      render: (
        <table style={{ borderCollapse: "collapse", fontSize: 12, fontFamily: "Arial, sans-serif" }}>
          <thead>
            <tr><th style={cellStyle}>Time (t)</th><th style={cellStyle}>Frequency (f)</th></tr>
          </thead>
          <tbody>
            {freqs.map((f, i) => (
              <tr key={i}>
                <td style={cellStyle}>{bounds[i]} &lt; t ≤ {bounds[i + 1]}</td>
                <td style={cellStyle}>{f}</td>
              </tr>
            ))}
            <tr><td style={cellStyle}><strong>Total</strong></td><td style={cellStyle}><strong>{totalF}</strong></td></tr>
          </tbody>
        </table>
      ),
      answer: `f × x values: ${fx.join(", ")}; Σfx = ${totalFX}; mean ≈ ${totalFX} ÷ ${totalF} = ${(totalFX / totalF).toFixed(2)}`,
    };
  },
};
SUBTOPIC_BANK["grouped-table-modal-median-class"] = {
  topic: "Averages & Range for Tabulated Data", title: "Modal class and median class from a grouped table", marks: 2,
  build(rng) {
    const bounds = [0, 10, 20, 30, 40, 50];
    const freqs = [seededInt(rng, 2, 10), seededInt(rng, 2, 10), seededInt(rng, 2, 10), seededInt(rng, 2, 10), seededInt(rng, 2, 10)];
    let running = 0;
    const cum = freqs.map((f) => (running += f));
    const total = cum[cum.length - 1];
    const half = total / 2;
    const medianIdx = cum.findIndex((c) => c >= half);
    const modalIdx = freqs.indexOf(Math.max(...freqs));
    const askModal = pick(rng, [true, false]);
    return {
      prompt: `The table shows the heights, h (cm), of a group of plants. Find the ${askModal ? "modal class" : "class interval containing the median"}.`,
      render: (
        <table style={{ borderCollapse: "collapse", fontSize: 12, fontFamily: "Arial, sans-serif" }}>
          <thead><tr><th style={cellStyle}>Height (h)</th><th style={cellStyle}>Frequency</th></tr></thead>
          <tbody>
            {freqs.map((f, i) => (
              <tr key={i}><td style={cellStyle}>{bounds[i]} &lt; h ≤ {bounds[i + 1]}</td><td style={cellStyle}>{f}</td></tr>
            ))}
          </tbody>
        </table>
      ),
      answer: askModal
        ? `Modal class = ${bounds[modalIdx]} < h ≤ ${bounds[modalIdx + 1]} (highest frequency = ${freqs[modalIdx]})`
        : `${total} plants total, the median is the ${half}th value, which falls in ${bounds[medianIdx]} < h ≤ ${bounds[medianIdx + 1]}`,
    };
  },
};
SUBTOPIC_BANK["ungrouped-frequency-table-mean"] = {
  topic: "Averages & Range for Tabulated Data", title: "Mean from an ungrouped frequency table", marks: 3,
  build(rng) {
    const values = [1, 2, 3, 4, 5];
    const freqs = values.map(() => seededInt(rng, 1, 9));
    const fx = values.map((v, i) => v * freqs[i]);
    const totalF = freqs.reduce((a, b) => a + b, 0);
    const totalFX = fx.reduce((a, b) => a + b, 0);
    return {
      prompt: `The table shows the number of siblings for a group of students. Calculate the mean number of siblings. Give your answer to 2 decimal places.`,
      render: (
        <table style={{ borderCollapse: "collapse", fontSize: 12, fontFamily: "Arial, sans-serif" }}>
          <thead><tr><th style={cellStyle}>Siblings (x)</th><th style={cellStyle}>Frequency (f)</th><th style={cellStyle}>f × x</th></tr></thead>
          <tbody>
            {values.map((v, i) => (
              <tr key={i}><td style={cellStyle}>{v}</td><td style={cellStyle}>{freqs[i]}</td><td style={cellStyle}>&nbsp;</td></tr>
            ))}
            <tr><td style={cellStyle}><strong>Total</strong></td><td style={cellStyle}><strong>{totalF}</strong></td><td style={cellStyle}></td></tr>
          </tbody>
        </table>
      ),
      answer: <>f × x values: {fx.join(", ")}; Σfx = {totalFX}, Σf = {totalF}; mean = <Frac n={totalFX} d={totalF} /> = {(totalFX / totalF).toFixed(2)}</>,
    };
  },
};

/* Statistics & Probability → Data Collection & Sampling */
SUBTOPIC_BANK["stratified-sample-one-category"] = {
  topic: "Data Collection & Sampling", title: "Take a stratified sample by one category", marks: 3,
  build(rng) {
    const groups = pick(rng, [["Year 9", "Year 10", "Year 11"], ["Boys", "Girls"], ["Cats", "Dogs", "Rabbits"]]);
    const counts = groups.map(() => seededInt(rng, 30, 150));
    const total = counts.reduce((a, b) => a + b, 0);
    const sampleSize = pick(rng, [20, 30, 40, 50]);
    const askIdx = seededInt(rng, 0, groups.length - 1);
    const rows = groups.map((g, i) => `${g}: ${counts[i]}`).join(", ");
    const exact = (counts[askIdx] / total) * sampleSize;
    return {
      prompt: `A school has ${total} students: ${rows}. A stratified sample of ${sampleSize} students is taken. How many students from ${groups[askIdx]} should be in the sample?`,
      answer: <><Frac n={counts[askIdx]} d={total} /> × {sampleSize} = {exact.toFixed(2)} ≈ {Math.round(exact)}</>,
    };
  },
};
SUBTOPIC_BANK["capture-recapture"] = {
  topic: "Data Collection & Sampling", title: "Use the capture-recapture method to estimate a population", marks: 3,
  build(rng) {
    const firstCaught = seededInt(rng, 20, 60);
    const populationEstimate = seededInt(rng, 200, 600);
    const secondCaught = seededInt(rng, 20, 60);
    const recaught = Math.max(2, Math.round((firstCaught * secondCaught) / populationEstimate));
    const estimate = Math.round((firstCaught * secondCaught) / recaught);
    return {
      prompt: `${firstCaught} fish are caught, tagged, and released. Later, ${secondCaught} fish are caught, of which ${recaught} are tagged. Estimate the total population of fish.`,
      answer: <>Population ≈ <Frac n={<>{firstCaught} × {secondCaught}</>} d={recaught} /> = {estimate}</>,
    };
  },
};

/* Statistics & Probability → Experimental Probability (Relative Frequency) & Bias */
SUBTOPIC_BANK["expected-value-biased"] = {
  topic: "Experimental Probability (Relative Frequency) & Bias", title: "Use a probability to find an expected value", marks: 2,
  build(rng) {
    const denom = pick(rng, [4, 5, 6, 8, 10]), num = seededInt(rng, 1, denom - 1);
    const trials = pick(rng, [50, 100, 200, 300]);
    return {
      prompt: <>A biased coin has P(heads) = <Frac n={num} d={denom} />. It is flipped {trials} times. Work out the expected number of heads.</>,
      answer: <><Frac n={num} d={denom} /> × {trials} = {Math.round((num / denom) * trials)}</>,
    };
  },
};
SUBTOPIC_BANK["relative-frequency-from-data"] = {
  topic: "Experimental Probability (Relative Frequency) & Bias", title: "Find the relative frequency of an outcome", marks: 2,
  build(rng) {
    const trials = pick(rng, [40, 50, 80, 100, 200]);
    const occurrences = seededInt(rng, 5, trials - 5);
    function gcdLocal(x, y) { while (y) { [x, y] = [y, x % y]; } return x; }
    const g = gcdLocal(occurrences, trials);
    return {
      prompt: `A dice is rolled ${trials} times. A six occurs ${occurrences} times. Find the relative frequency of rolling a six.`,
      answer: <><Frac n={occurrences} d={trials} /> = <Frac n={occurrences / g} d={trials / g} /></>,
    };
  },
};

/* ===== Tier 2 batch: contained new diagram types (bar/pie charts, frequency
   trees, coordinate grids, angle/bearing diagrams, composite shapes,
   quadrilaterals/polygons, conversion & distance-time graphs), plus several
   diagram-free groups (units, compound measures, multiplicative reasoning,
   ratio). See chat summary for the 3 groups intentionally skipped this round. ===== */
SUBTOPIC_BANK["venn-prob-set-notation"] = {
  topic: "Venn Diagrams (Probability)", title: "Probability using set notation from a Venn diagram", marks: 2,
  build(rng) {
    const ctx = pick(rng, CONTEXTS);
    const total = seededInt(rng, 30, 50);
    const p = partitionFour(rng, total);
    const mode = pick(rng, ["union", "AnotB", "neither"]);
    let expr, value;
    if (mode === "union") { expr = "P(A ∪ B)"; value = p.aOnly + p.bOnly + p.both; }
    else if (mode === "AnotB") { expr = "P(A ∩ B′)"; value = p.aOnly; }
    else { expr = "P(A′ ∩ B′)"; value = p.outside; }
    return {
      prompt: `Set A represents "${ctx.verb} ${ctx.labelA}" and set B represents "${ctx.verb} ${ctx.labelB}" among ${total} ${ctx.noun}. Use the Venn diagram to find ${expr}.`,
      render: <VennSVG labelA="A" labelB="B" values={p} />,
      answer: <Frac n={value} d={total} />,
    };
  },
};
SUBTOPIC_BANK["venn-independence-check"] = {
  topic: "Venn Diagrams (Probability)", title: "Determine if two events are independent", marks: 3,
  build(rng) {
    const ctx = pick(rng, CONTEXTS);
    const total = seededInt(rng, 20, 40);
    const p = partitionFour(rng, total);
    const pA = (p.aOnly + p.both) / total;
    const pB = (p.bOnly + p.both) / total;
    const pAandB = p.both / total;
    const independent = Math.abs(pA * pB - pAandB) < 1e-9;
    return {
      prompt: `The Venn diagram shows information about ${total} ${ctx.noun} who ${ctx.verb} ${ctx.labelA} (A) and/or ${ctx.labelB} (B). Determine, showing your working, whether events A and B are independent.`,
      render: <VennSVG labelA="A" labelB="B" values={p} />,
      answer: <>P(A) = <Frac n={p.aOnly + p.both} d={total} />, P(B) = <Frac n={p.bOnly + p.both} d={total} />, P(A) × P(B) = {(pA * pB).toFixed(3)}. P(A ∩ B) = <Frac n={p.both} d={total} /> = {pAandB.toFixed(3)}. {independent ? "These are equal, so A and B are independent." : "These are not equal, so A and B are not independent."}</>,
    };
  },
};
SUBTOPIC_BANK["two-way-table-complete"] = {
  topic: "Two-Way Tables", title: "Complete a two-way table from totals", marks: 3,
  build(rng) {
    const rowLabels = ["Boys", "Girls"];
    const colLabels = pick(rng, [["Football", "Netball"], ["Bus", "Walk"], ["Tea", "Coffee"]]);
    const a = seededInt(rng, 8, 20), b = seededInt(rng, 8, 20), c = seededInt(rng, 8, 20), d = seededInt(rng, 8, 20);
    const rowTotal1 = a + b, rowTotal2 = c + d;
    const colTotal1 = a + c, colTotal2 = b + d;
    const grandTotal = rowTotal1 + rowTotal2;
    return {
      prompt: `The two-way table shows information about ${grandTotal} students. Copy and complete the table.`,
      render: (
        <table style={{ borderCollapse: "collapse", fontSize: 12, fontFamily: "Arial, sans-serif" }}>
          <thead>
            <tr><th style={cellStyle}></th><th style={cellStyle}>{colLabels[0]}</th><th style={cellStyle}>{colLabels[1]}</th><th style={cellStyle}>Total</th></tr>
          </thead>
          <tbody>
            <tr><td style={cellStyle}><strong>{rowLabels[0]}</strong></td><td style={cellStyle}>?</td><td style={cellStyle}>{b}</td><td style={cellStyle}>{rowTotal1}</td></tr>
            <tr><td style={cellStyle}><strong>{rowLabels[1]}</strong></td><td style={cellStyle}>{c}</td><td style={cellStyle}>?</td><td style={cellStyle}>{rowTotal2}</td></tr>
            <tr><td style={cellStyle}><strong>Total</strong></td><td style={cellStyle}>{colTotal1}</td><td style={cellStyle}>{colTotal2}</td><td style={cellStyle}>{grandTotal}</td></tr>
          </tbody>
        </table>
      ),
      answer: `${rowLabels[0]} & ${colLabels[0]} = ${a}; ${rowLabels[1]} & ${colLabels[1]} = ${d}`,
    };
  },
};
SUBTOPIC_BANK["frequency-tree-complete"] = {
  topic: "Frequency Trees", title: "Complete a frequency tree", marks: 3,
  build(rng) {
    const total = seededInt(rng, 40, 80);
    const stage1A = seededInt(rng, Math.round(total * 0.3), Math.round(total * 0.6));
    const stage1B = total - stage1A;
    const stage2AA = Math.min(stage1A - 1, Math.max(1, seededInt(rng, Math.round(stage1A * 0.3), Math.round(stage1A * 0.7))));
    const stage2AB = stage1A - stage2AA;
    const stage2BA = Math.min(stage1B - 1, Math.max(1, seededInt(rng, Math.round(stage1B * 0.3), Math.round(stage1B * 0.7))));
    const stage2BB = stage1B - stage2BA;
    const freqs = [stage2AA, stage2AB, stage2BA, stage2BB];
    const unknownIndex = seededInt(rng, 0, 3);
    const ctx = pick(rng, [
      { root: "own a pet", s1: ["Yes", "No"], s2: ["Cat", "Dog"] },
      { root: "play an instrument", s1: ["Yes", "No"], s2: ["Piano", "Guitar"] },
    ]);
    return {
      prompt: `${total} students were asked whether they ${ctx.root}. The frequency tree shows the results. Find the missing value marked "?".`,
      render: <FrequencyTreeSVG labelsStage1={ctx.s1} labelsStage2={ctx.s2} freqs={freqs} unknownIndex={unknownIndex} />,
      answer: `${freqs[unknownIndex]}`,
    };
  },
};
SUBTOPIC_BANK["bar-chart-read-frequency"] = {
  topic: "Bar Charts", title: "Read a frequency from a bar chart", marks: 1,
  build(rng) {
    const options = [
      { label: "colour", categories: ["Red", "Blue", "Green", "Yellow"] },
      { label: "pet", categories: ["Cat", "Dog", "Fish", "Bird"] },
      { label: "way to travel to school", categories: ["Bus", "Car", "Bike", "Walk"] },
    ];
    const opt = pick(rng, options);
    const values = opt.categories.map(() => seededInt(rng, 2, 18));
    const askIndex = seededInt(rng, 0, opt.categories.length - 1);
    return {
      prompt: `The bar chart shows the favourite ${opt.label} of a group of students. How many students chose ${opt.categories[askIndex]}?`,
      accurateDiagram: true,
      render: <BarChartSVG categories={opt.categories} values={values} />,
      answer: `${values[askIndex]}`,
    };
  },
};
SUBTOPIC_BANK["pie-chart-angle-to-frequency"] = {
  topic: "Pie Charts", title: "Find a frequency from a pie chart angle", marks: 2,
  build(rng) {
    const total = pick(rng, [24, 36, 40, 60, 72]);
    const unitAngle = 360 / total;
    let f1, f2, f3, f4;
    do {
      f1 = seededInt(rng, 2, Math.floor(total * 0.4));
      f2 = seededInt(rng, 2, Math.floor(total * 0.3));
      f3 = seededInt(rng, 2, Math.floor(total * 0.2));
      f4 = total - f1 - f2 - f3;
    } while (f4 < 2);
    const freqs = [f1, f2, f3, f4];
    const markIndex = seededInt(rng, 0, 3);
    const sectors = freqs.map((f) => ({ angle: f * unitAngle }));
    return {
      prompt: `The pie chart shows how ${total} people travel to work. The angle of one sector is marked. Find the number of people represented by that sector.`,
      render: <PieChartSVG sectors={sectors} markIndex={markIndex} />,
      answer: `${sectors[markIndex].angle}° ÷ 360° × ${total} = ${freqs[markIndex]} people`,
    };
  },
};
SUBTOPIC_BANK["timetable-read"] = {
  topic: "Timetables", title: "Read a bus/train timetable", marks: 2,
  build(rng) {
    const stops = ["Station", "High St", "Market Sq", "Retail Park"];
    const gaps = [seededInt(rng, 8, 15), seededInt(rng, 6, 12), seededInt(rng, 10, 18)];
    const baseHour = seededInt(rng, 7, 10);
    const baseMin = pick(rng, [0, 15, 30, 45]);
    const startTotal = baseHour * 60 + baseMin;
    const busInterval = seededInt(rng, 20, 30);
    const buses = [0, 1, 2].map((i) => {
      let t = startTotal + i * busInterval;
      const times = [t];
      gaps.forEach((g) => { t += g; times.push(t); });
      return times;
    });
    const fmt = (mins) => { const h = Math.floor(mins / 60) % 24, m = mins % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };
    const askBus = seededInt(rng, 0, 2);
    const fromIdx = 0, toIdx = seededInt(rng, 1, 3);
    const journeyMins = buses[askBus][toIdx] - buses[askBus][fromIdx];
    return {
      prompt: `The timetable shows bus times from ${stops[0]} to ${stops[3]}. How long does the ${["first", "second", "third"][askBus]} bus take to travel from ${stops[fromIdx]} to ${stops[toIdx]}?`,
      render: (
        <table style={{ borderCollapse: "collapse", fontSize: 12, fontFamily: "Arial, sans-serif" }}>
          <thead><tr><th style={cellStyle}></th>{buses.map((_, i) => <th key={i} style={cellStyle}>Bus {i + 1}</th>)}</tr></thead>
          <tbody>
            {stops.map((s, i) => (
              <tr key={i}><td style={cellStyle}>{s}</td>{buses.map((bus, j) => <td key={j} style={cellStyle}>{fmt(bus[i])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      ),
      answer: `${journeyMins} minutes (${fmt(buses[askBus][fromIdx])} to ${fmt(buses[askBus][toIdx])})`,
    };
  },
};
SUBTOPIC_BANK["ungrouped-freq-table-form"] = {
  topic: "Frequency Tables", title: "Read/interpret an ungrouped frequency table", marks: 2,
  build(rng) {
    const values = [1, 2, 3, 4, 5];
    const freqs = values.map(() => seededInt(rng, 2, 9));
    const total = freqs.reduce((x, y) => x + y, 0);
    const mode = pick(rng, ["mostCommon", "totalCount", "specificFreq"]);
    let question, answer;
    if (mode === "mostCommon") {
      const maxF = Math.max(...freqs);
      question = "Which value has the highest frequency?";
      answer = `${values[freqs.indexOf(maxF)]} (frequency ${maxF})`;
    } else if (mode === "totalCount") {
      question = "How many students were surveyed in total?";
      answer = `${total}`;
    } else {
      const idx = seededInt(rng, 0, 4);
      question = `How many students have ${values[idx]} siblings?`;
      answer = `${freqs[idx]}`;
    }
    return {
      prompt: `The table shows the number of siblings for a group of students. ${question}`,
      render: (
        <table style={{ borderCollapse: "collapse", fontSize: 12, fontFamily: "Arial, sans-serif" }}>
          <thead><tr><th style={cellStyle}>Number of siblings</th>{values.map((v) => <th key={v} style={cellStyle}>{v}</th>)}</tr></thead>
          <tbody><tr><td style={cellStyle}>Frequency</td>{freqs.map((f, i) => <td key={i} style={cellStyle}>{f}</td>)}</tr></tbody>
        </table>
      ),
      answer,
    };
  },
};
SUBTOPIC_BANK["angles-on-a-line"] = {
  topic: "Angle Facts", title: "Angles on a straight line", marks: 2,
  build(rng) {
    const n = pick(rng, [2, 3]);
    let angles;
    if (n === 2) {
      const a = seededInt(rng, 30, 140);
      angles = [a, 180 - a];
    } else {
      const a = seededInt(rng, 20, 80);
      const b = seededInt(rng, 20, 80);
      angles = [a, b, 180 - a - b];
    }
    const unknownIndex = seededInt(rng, 0, angles.length - 1);
    return {
      prompt: `The angles shown lie on a straight line. Find the size of the angle marked "?".`,
      render: <AngleFactsSVG mode="line" angles={angles} unknownIndex={unknownIndex} />,
      answer: `${angles[unknownIndex]}° (angles on a straight line sum to 180°)`,
    };
  },
};
SUBTOPIC_BANK["angles-about-a-point"] = {
  topic: "Angle Facts", title: "Angles about a point", marks: 2,
  build(rng) {
    const a = seededInt(rng, 60, 140);
    const b = seededInt(rng, 60, 140);
    const c = 360 - a - b;
    const angles = [a, b, c];
    const unknownIndex = seededInt(rng, 0, 2);
    return {
      prompt: `The angles shown are the angles around a single point. Find the size of the angle marked "?".`,
      render: <AngleFactsSVG mode="point" angles={angles} unknownIndex={unknownIndex} />,
      answer: `${angles[unknownIndex]}° (angles about a point sum to 360°)`,
    };
  },
};
SUBTOPIC_BANK["bearings-find"] = {
  topic: "Bearings", title: "Find a bearing between two points", marks: 2,
  build(rng) {
    const bearingDeg = seededInt(rng, 1, 35) * 10;
    return {
      prompt: `B is on a bearing from A as shown. What is the bearing of B from A? Give your answer as a three-figure bearing.`,
      render: <BearingSVG bearingDeg={bearingDeg} unknown={true} />,
      answer: `${String(bearingDeg).padStart(3, "0")}°`,
    };
  },
};
SUBTOPIC_BANK["area-rectangle-triangle"] = {
  topic: "Area & Perimeter", title: "Area of a rectangle or right-angled triangle", marks: 2,
  build(rng) {
    const shape = pick(rng, ["rectangle", "triangle"]);
    if (shape === "rectangle") {
      const w = seededInt(rng, 4, 15), h = seededInt(rng, 3, 12);
      return {
        prompt: `Calculate the area of a rectangle with length ${w} cm and width ${h} cm.`,
        render: <RectangleSVG w={w} h={h} />,
        answer: `${w} × ${h} = ${w * h} cm²`,
      };
    }
    const b = seededInt(rng, 6, 16), h = seededInt(rng, 4, 14);
    return {
      prompt: `Calculate the area of a right-angled triangle with base ${b} cm and height ${h} cm.`,
      render: <RightTriangleSVG base={b} height={h} orientation="bl" baseLabel={`${b} cm`} heightLabel={`${h} cm`} hypLabel="" />,
      answer: `½ × ${b} × ${h} = ${(b * h) / 2} cm²`,
    };
  },
};
SUBTOPIC_BANK["composite-rectilinear-area-perimeter"] = {
  topic: "Area & Perimeter", title: "Area and perimeter of a composite rectilinear shape", marks: 3,
  build(rng) {
    const W = seededInt(rng, 10, 18);
    const H = seededInt(rng, 8, 14);
    const a = seededInt(rng, 2, Math.floor(W * 0.5));
    const b = seededInt(rng, 2, Math.floor(H * 0.5));
    const area = W * H - a * b;
    const perimeter = 2 * (W + H);
    const askMode = pick(rng, ["area", "perimeter"]);
    return {
      prompt: `The diagram shows a composite shape made from two rectangles. Calculate the ${askMode} of the shape. All lengths are in cm.`,
      render: <CompositeRectSVG W={W} H={H} a={a} b={b} />,
      answer: askMode === "area"
        ? `Area = (${W} × ${H}) − (${a} × ${b}) = ${W * H} − ${a * b} = ${area} cm²`
        : `Perimeter = 2 × (${W} + ${H}) = ${perimeter} cm (the two step edges match the outer rectangle's missing sides)`,
    };
  },
};
SUBTOPIC_BANK["coordinates-identify-point"] = {
  topic: "Coordinates", title: "Read a coordinate from a grid", marks: 1,
  build(rng) {
    let x, y;
    do { x = seededInt(rng, -6, 6); y = seededInt(rng, -6, 6); } while (x === 0 && y === 0);
    return {
      prompt: `Write down the coordinates of point P shown on the grid.`,
      accurateDiagram: true,
      render: <CoordinateGridSVG points={[{ x, y, label: "P" }]} />,
      answer: `(${x}, ${y})`,
    };
  },
};
SUBTOPIC_BANK["coordinates-midpoint-calc"] = {
  topic: "Coordinates", title: "Find the midpoint of two coordinates", marks: 2,
  build(rng) {
    const x1 = seededInt(rng, -6, 6), y1 = seededInt(rng, -6, 6);
    let x2, y2;
    do { x2 = seededInt(rng, -6, 6); } while ((x1 + x2) % 2 !== 0);
    do { y2 = seededInt(rng, -6, 6); } while ((y1 + y2) % 2 !== 0);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    return {
      prompt: `Find the midpoint of the line segment joining A(${x1}, ${y1}) and B(${x2}, ${y2}).`,
      render: <CoordinateGridSVG points={[{ x: x1, y: y1, label: "A" }, { x: x2, y: y2, label: "B" }]} />,
      answer: `(${mx}, ${my})`,
    };
  },
};
SUBTOPIC_BANK["shape-properties-quadrilateral-name"] = {
  topic: "2D Shapes", title: "Name a quadrilateral from its diagram", marks: 1,
  build(rng) {
    const shapes = [
      { key: "parallelogram", name: "parallelogram" }, { key: "rhombus", name: "rhombus" },
      { key: "kite", name: "kite" }, { key: "trapezium", name: "trapezium" },
      { key: "rectangle", name: "rectangle" }, { key: "square", name: "square" },
    ];
    const s = pick(rng, shapes);
    return {
      prompt: `Write down the mathematical name of the quadrilateral shown.`,
      render: <QuadrilateralSVG shape={s.key} />,
      answer: s.name,
    };
  },
};
SUBTOPIC_BANK["shape-properties-symmetry"] = {
  topic: "2D Shapes", title: "Symmetry of a regular polygon", marks: 2,
  build(rng) {
    const namesBySides = { 3: "triangle", 4: "square", 5: "pentagon", 6: "hexagon", 7: "heptagon", 8: "octagon" };
    const sides = pick(rng, [3, 4, 5, 6, 7, 8]);
    const mode = pick(rng, ["rotational", "lines"]);
    return {
      prompt: `The diagram shows a regular ${namesBySides[sides]}. State the ${mode === "rotational" ? "order of rotational symmetry" : "number of lines of symmetry"} of this shape.`,
      render: <RegularPolygonSVG sides={sides} />,
      answer: `${sides}`,
    };
  },
};
SUBTOPIC_BANK["trig-find-side"] = {
  topic: "Trigonometry", title: "Use SOHCAHTOA to find a missing side", marks: 3,
  build(rng) {
    const angle = pick(rng, [25, 30, 35, 40, 50, 55, 60, 65]);
    const knownSide = seededInt(rng, 6, 15);
    const findType = pick(rng, ["opposite", "adjacent", "hypotenuse"]);
    const rad = (angle * Math.PI) / 180;
    let base, height, baseLabel, heightLabel, hypLabel, workingFunc, unknownVal;
    if (findType === "opposite") {
      base = knownSide; height = knownSide * Math.tan(rad); unknownVal = height;
      workingFunc = <>tan({angle}°) = <Frac n="opposite" d={knownSide} /> → opposite = {knownSide} × tan({angle}°)</>;
      baseLabel = `${knownSide} cm`; heightLabel = "?"; hypLabel = "";
    } else if (findType === "adjacent") {
      height = knownSide; base = knownSide / Math.tan(rad); unknownVal = base;
      workingFunc = <>tan({angle}°) = <Frac n={knownSide} d="adjacent" /> → adjacent = {knownSide} ÷ tan({angle}°)</>;
      baseLabel = "?"; heightLabel = `${knownSide} cm`; hypLabel = "";
    } else {
      base = knownSide; height = base * Math.tan(rad); unknownVal = base / Math.cos(rad);
      workingFunc = <>cos({angle}°) = <Frac n={knownSide} d="hypotenuse" /> → hypotenuse = {knownSide} ÷ cos({angle}°)</>;
      baseLabel = `${knownSide} cm`; heightLabel = ""; hypLabel = "?";
    }
    return {
      prompt: `Calculate the length marked "?" in the right-angled triangle. Give your answer to 1 decimal place.`,
      render: <RightTriangleSVG base={base} height={height} orientation="bl" baseLabel={baseLabel} heightLabel={heightLabel} hypLabel={hypLabel} angleLabel={`${angle}°`} />,
      answer: <>{workingFunc} = {unknownVal.toFixed(1)} cm</>,
    };
  },
};
SUBTOPIC_BANK["trig-find-angle"] = {
  topic: "Trigonometry", title: "Use SOHCAHTOA to find a missing angle", marks: 3,
  build(rng) {
    const opp = seededInt(rng, 5, 12);
    const adj = seededInt(rng, 5, 12);
    const angle = (Math.atan(opp / adj) * 180) / Math.PI;
    return {
      prompt: `Calculate the angle marked "?" in the right-angled triangle. Give your answer to 1 decimal place.`,
      render: <RightTriangleSVG base={adj} height={opp} orientation="bl" baseLabel={`${adj} cm`} heightLabel={`${opp} cm`} hypLabel="" angleLabel="?" />,
      answer: <>tan(?) = <Frac n={opp} d={adj} /> → ? = tan⁻¹(<Frac n={opp} d={adj} />) = {angle.toFixed(1)}°</>,
    };
  },
};
SUBTOPIC_BANK["metric-conversion"] = {
  topic: "Units of Measurement", title: "Convert between metric units", marks: 2,
  build(rng) {
    const conversions = [
      { from: "cm", to: "mm", factor: 10 }, { from: "m", to: "cm", factor: 100 },
      { from: "km", to: "m", factor: 1000 }, { from: "kg", to: "g", factor: 1000 },
      { from: "litres", to: "ml", factor: 1000 }, { from: "m", to: "mm", factor: 1000 },
      { from: "tonnes", to: "kg", factor: 1000 },
    ];
    const c = pick(rng, conversions);
    const direction = pick(rng, ["forward", "backward"]);
    const baseVal = seededInt(rng, 2, 12);
    if (direction === "forward") {
      return { prompt: `Convert ${baseVal} ${c.from} into ${c.to}.`, answer: `${baseVal} × ${c.factor} = ${baseVal * c.factor} ${c.to}` };
    }
    const bigVal = baseVal * c.factor;
    return { prompt: `Convert ${bigVal} ${c.to} into ${c.from}.`, answer: `${bigVal} ÷ ${c.factor} = ${baseVal} ${c.from}` };
  },
};
SUBTOPIC_BANK["suitable-unit-estimate"] = {
  topic: "Units of Measurement", title: "Choose a suitable metric unit", marks: 1,
  build(rng) {
    const items = [
      { item: "the length of a classroom", unit: "metres (m)" }, { item: "the mass of a bag of sugar", unit: "grams (g)" },
      { item: "the mass of a car", unit: "kilograms (kg)" }, { item: "the capacity of a bathtub", unit: "litres (l)" },
      { item: "the length of a pencil", unit: "centimetres (cm)" }, { item: "the distance from London to Paris", unit: "kilometres (km)" },
      { item: "the capacity of a teaspoon", unit: "millilitres (ml)" }, { item: "the mass of a letter", unit: "grams (g)" },
    ];
    const it = pick(rng, items);
    return { prompt: `State a suitable metric unit for measuring ${it.item}.`, answer: it.unit };
  },
};
SUBTOPIC_BANK["conversion-graph-read"] = {
  topic: "Units of Measurement", title: "Use a conversion graph", marks: 2,
  build(rng) {
    const pairs = [
      { xLabel: "Miles", yLabel: "Kilometres", xMax: 50, factor: 1.6 },
      { xLabel: "Pounds (£)", yLabel: "Euros (€)", xMax: 100, factor: 1.15 },
      { xLabel: "Gallons", yLabel: "Litres", xMax: 20, factor: 4.5 },
    ];
    const p = pick(rng, pairs);
    const yMax = Math.round(p.xMax * p.factor);
    const readX = seededInt(rng, 2, p.xMax - 2);
    const readY = Math.round(readX * p.factor);
    return {
      prompt: `The graph can be used to convert between ${p.xLabel} and ${p.yLabel}. Use the graph to convert ${readX} ${p.xLabel} into ${p.yLabel}.`,
      render: <LineGraphSVG points={[{ x: 0, y: 0 }, { x: p.xMax, y: yMax }]} xMax={p.xMax} yMax={yMax} xLabel={p.xLabel} yLabel={p.yLabel} readX={readX} readY={readY} />,
      answer: `≈ ${readY} ${p.yLabel} (reading from the graph at ${readX} ${p.xLabel})`,
    };
  },
};
SUBTOPIC_BANK["compound-measures-calc"] = {
  topic: "Compound Measures", title: "Calculate using density, speed or pressure", marks: 3,
  build(rng) {
    const mode = pick(rng, ["density", "speed", "pressure"]);
    if (mode === "density") {
      const volume = seededInt(rng, 4, 12), density = seededInt(rng, 2, 9), mass = volume * density;
      const find = pick(rng, ["mass", "density"]);
      return find === "mass"
        ? { prompt: `An object has a volume of ${volume} cm³ and a density of ${density} g/cm³. Calculate its mass.`, answer: `Mass = density × volume = ${density} × ${volume} = ${mass} g` }
        : { prompt: `An object has a mass of ${mass} g and a volume of ${volume} cm³. Calculate its density.`, answer: `Density = mass ÷ volume = ${mass} ÷ ${volume} = ${density} g/cm³` };
    }
    if (mode === "speed") {
      const time = seededInt(rng, 2, 8), speed = seededInt(rng, 20, 70), distance = time * speed;
      const find = pick(rng, ["distance", "speed"]);
      return find === "distance"
        ? { prompt: `A car travels at an average speed of ${speed} mph for ${time} hours. Calculate the distance travelled.`, answer: `Distance = speed × time = ${speed} × ${time} = ${distance} miles` }
        : { prompt: `A car travels ${distance} miles in ${time} hours. Calculate its average speed.`, answer: `Speed = distance ÷ time = ${distance} ÷ ${time} = ${speed} mph` };
    }
    const area = seededInt(rng, 2, 10), pressure = seededInt(rng, 3, 12), force = area * pressure;
    const find = pick(rng, ["force", "pressure"]);
    return find === "force"
      ? { prompt: `A force acts on an area of ${area} m² with a pressure of ${pressure} N/m². Calculate the force.`, answer: `Force = pressure × area = ${pressure} × ${area} = ${force} N` }
      : { prompt: `A force of ${force} N acts on an area of ${area} m². Calculate the pressure.`, answer: `Pressure = force ÷ area = ${force} ÷ ${area} = ${pressure} N/m²` };
  },
};
SUBTOPIC_BANK["distance-time-graph-read"] = {
  topic: "Compound Measures", title: "Interpret a distance-time graph", marks: 3,
  build(rng) {
    const outDist = seededInt(rng, 10, 30);
    const outTime = seededInt(rng, 1, 3);
    const stopTime = seededInt(rng, 1, 2);
    const backTime = seededInt(rng, 1, 3);
    const t1 = outTime, t2 = t1 + stopTime, t3 = t2 + backTime;
    const points = [{ x: 0, y: 0 }, { x: t1, y: outDist }, { x: t2, y: outDist }, { x: t3, y: 0 }];
    const mode = pick(rng, ["returnSpeed", "stopDuration", "outSpeed"]);
    let question, answer;
    if (mode === "returnSpeed") {
      const speed = outDist / backTime;
      question = "Calculate the average speed of the return journey.";
      answer = `${outDist} ÷ ${backTime} = ${speed.toFixed(1)} km/h`;
    } else if (mode === "stopDuration") {
      question = "How long did the journey stop for?";
      answer = `${stopTime} hour${stopTime > 1 ? "s" : ""}`;
    } else {
      const speed = outDist / outTime;
      question = "Calculate the average speed of the outward journey.";
      answer = `${outDist} ÷ ${outTime} = ${speed.toFixed(1)} km/h`;
    }
    return {
      prompt: `The graph shows a car's journey. ${question}`,
      render: <LineGraphSVG points={points} xMax={t3} yMax={outDist} xLabel="Time (hours)" yLabel="Distance (km)" />,
      answer,
    };
  },
};
SUBTOPIC_BANK["multiplicative-best-value"] = {
  topic: "Multiplicative Reasoning", title: "Determine best value for money", marks: 3,
  build(rng) {
    const item = pick(rng, ["cereal", "washing powder", "coffee", "biscuits"]);
    const sizeA = seededInt(rng, 2, 6) * 100;
    const priceA = seededInt(rng, 15, 40) / 10;
    const sizeB = sizeA + seededInt(rng, 2, 4) * 100;
    const priceB = priceA + seededInt(rng, 5, 15) / 10;
    const ppgA = priceA / sizeA, ppgB = priceB / sizeB;
    const better = ppgA < ppgB ? "A" : "B";
    return {
      prompt: `A packet of ${item}: Pack A is ${sizeA} g for £${priceA.toFixed(2)}. Pack B is ${sizeB} g for £${priceB.toFixed(2)}. Which pack is better value for money?`,
      answer: `Pack A: £${priceA.toFixed(2)} ÷ ${sizeA} = £${ppgA.toFixed(4)} per g. Pack B: £${priceB.toFixed(2)} ÷ ${sizeB} = £${ppgB.toFixed(4)} per g. Pack ${better} is better value.`,
    };
  },
};
SUBTOPIC_BANK["multiplicative-recipe-scaling"] = {
  topic: "Multiplicative Reasoning", title: "Scale a recipe using ratios", marks: 3,
  build(rng) {
    const ingredients = pick(rng, [
      [{ name: "flour", unit: "g", amt: 200 }, { name: "sugar", unit: "g", amt: 100 }, { name: "butter", unit: "g", amt: 150 }],
      [{ name: "rice", unit: "g", amt: 250 }, { name: "stock", unit: "ml", amt: 500 }, { name: "peas", unit: "g", amt: 80 }],
    ]);
    const baseServings = pick(rng, [4, 6, 8]);
    const multiplier = pick(rng, [1.5, 2, 2.5, 3]);
    const newServings = Math.round(baseServings * multiplier);
    const askIdx = seededInt(rng, 0, ingredients.length - 1);
    const scaledAmt = ingredients[askIdx].amt * multiplier;
    return {
      prompt: `A recipe for ${baseServings} people needs ${ingredients.map((i) => `${i.amt}${i.unit} of ${i.name}`).join(", ")}. What quantity of ${ingredients[askIdx].name} is needed for ${newServings} people?`,
      answer: <>{ingredients[askIdx].amt} × (<Frac n={newServings} d={baseServings} />) = {scaledAmt}{ingredients[askIdx].unit}</>,
    };
  },
};
SUBTOPIC_BANK["ratio-simplify"] = {
  topic: "Ratio", title: "Write a ratio in its simplest form", marks: 2,
  build(rng) {
    const g = seededInt(rng, 2, 12);
    const p = seededInt(rng, 2, 9);
    const q = seededInt(rng, 2, 9);
    const a = g * p, b = g * q;
    const d = gcd(a, b);
    return { prompt: `Write the ratio ${a} : ${b} in its simplest form.`, answer: `${a / d} : ${b / d}` };
  },
};
SUBTOPIC_BANK["ratio-share-amount"] = {
  topic: "Ratio", title: "Share an amount into a ratio", marks: 3,
  build(rng) {
    const parts = pick(rng, [2, 3]);
    const ratioParts = parts === 2 ? [seededInt(rng, 1, 7), seededInt(rng, 1, 7)] : [seededInt(rng, 1, 5), seededInt(rng, 1, 5), seededInt(rng, 1, 5)];
    const sumParts = ratioParts.reduce((x, y) => x + y, 0);
    const unit = seededInt(rng, 2, 12);
    const total = sumParts * unit;
    const shares = ratioParts.map((p) => p * unit);
    return {
      prompt: `Share £${total} in the ratio ${ratioParts.join(" : ")}.`,
      answer: `1 part = £${total} ÷ ${sumParts} = £${unit}. Shares: ${shares.map((s) => `£${s}`).join(", ")}.`,
    };
  },
};

/* --- Using Ratio: expansion to match Mr Barton's full "Using ratio" skill list --- */
const RATIO_MIX_ITEMS_2 = [
  ["red paint", "white paint"],
  ["flour", "butter"],
  ["orange squash", "water"],
  ["cement", "sand"],
  ["blackcurrant juice", "lemonade"],
];
const RATIO_MIX_ITEMS_3 = [
  ["red paint", "white paint", "blue paint"],
  ["flour", "butter", "sugar"],
  ["orange squash", "water", "ice"],
  ["cement", "sand", "gravel"],
  ["milk", "cocoa powder", "sugar"],
];
const RATIO_MIX_NOUNS = { "red paint": "paint", "flour": "cake mixture", "orange squash": "squash", "cement": "concrete", "blackcurrant juice": "drink", "milk": "hot chocolate" };
function joinAnd(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
const RATIO_PEOPLE_PAIRS = [
  ["Amara", "Ben"],
  ["Chloe", "David"],
  ["Elena", "Farid"],
  ["Grace", "Hassan"],
  ["Priya", "Jack"],
];

SUBTOPIC_BANK["ratio-total-parts"] = {
  topic: "Ratio", title: "Finding the total number of parts in a ratio", marks: 1,
  build(rng) {
    const parts = pick(rng, [2, 3]);
    const items = parts === 2 ? pick(rng, RATIO_MIX_ITEMS_2) : pick(rng, RATIO_MIX_ITEMS_3);
    const noun = RATIO_MIX_NOUNS[items[0]] || "mixture";
    const ratioParts = parts === 2 ? [seededInt(rng, 1, 9), seededInt(rng, 1, 9)] : [seededInt(rng, 1, 7), seededInt(rng, 1, 7), seededInt(rng, 1, 7)];
    const total = ratioParts.reduce((x, y) => x + y, 0);
    const desc = joinAnd(items);
    return {
      prompt: `Some ${noun} is made by mixing ${desc} in the ratio ${ratioParts.join(" : ")}. How many parts are there in total?`,
      answer: `${total}`,
    };
  },
};
SUBTOPIC_BANK["ratio-quantity-one-part-given"] = {
  topic: "Ratio", title: "Finding quantities from a ratio (one part given)", marks: 2,
  build(rng) {
    const [nameSmall, nameBig] = pick(rng, RATIO_PEOPLE_PAIRS);
    const small = seededInt(rng, 2, 7);
    const big = small + seededInt(rng, 1, 6);
    const unit = seededInt(rng, 2, 15);
    return {
      prompt: `${nameSmall} and ${nameBig} share some money in the ratio ${small} : ${big}. ${nameSmall} receives £${small * unit}. Work out how much ${nameBig} receives.`,
      answer: `1 part = £${small * unit} ÷ ${small} = £${unit}. ${nameBig} receives ${big} × £${unit} = £${big * unit}.`,
    };
  },
};
SUBTOPIC_BANK["ratio-quantity-difference-given"] = {
  topic: "Ratio", title: "Finding quantities from a ratio (difference given)", marks: 3,
  build(rng) {
    const [nameSmall, nameBig] = pick(rng, RATIO_PEOPLE_PAIRS);
    const small = seededInt(rng, 2, 7);
    const big = small + seededInt(rng, 1, 6);
    const unit = seededInt(rng, 2, 12);
    const diff = (big - small) * unit;
    const total = (big + small) * unit;
    return {
      prompt: `${nameBig} and ${nameSmall} split a prize in the ratio ${big} : ${small}. ${nameBig} receives £${diff} more than ${nameSmall}. Find the total prize money.`,
      answer: `1 part = £${diff} ÷ ${big - small} = £${unit}. Total = ${big + small} × £${unit} = £${total}.`,
    };
  },
};
SUBTOPIC_BANK["ratio-to-fraction"] = {
  topic: "Ratio", title: "Ratio to fraction", marks: 1,
  build(rng) {
    const a = seededInt(rng, 1, 9), b = seededInt(rng, 1, 9);
    return {
      prompt: `The ratio of red to blue counters is ${a} : ${b}. What fraction of the counters are red?`,
      answer: <Frac n={a} d={a + b} />,
    };
  },
};
SUBTOPIC_BANK["fraction-to-ratio"] = {
  topic: "Ratio", title: "Fraction to ratio", marks: 1,
  build(rng) {
    const d = pick(rng, [3, 4, 5, 6, 7, 8]);
    const n = seededInt(rng, 1, d - 1);
    return {
      prompt: `${n}/${d} of the students in a class are boys. Write the ratio of boys to girls.`,
      answer: `${n} : ${d - n}`,
    };
  },
};
SUBTOPIC_BANK["ratio-to-percentage"] = {
  topic: "Ratio", title: "Ratio to percentage", marks: 2,
  build(rng) {
    const total = pick(rng, [4, 5, 8, 10, 20]);
    const a = seededInt(rng, 1, total - 1);
    const b = total - a;
    const pct = (a / total) * 100;
    const pctStr = Number.isInteger(pct) ? `${pct}` : pct.toFixed(1);
    return {
      prompt: `The ratio of cats to dogs at a shelter is ${a} : ${b}. What percentage of the animals are cats?`,
      answer: `${a}/${total} × 100% = ${pctStr}%`,
    };
  },
};
SUBTOPIC_BANK["percentage-to-ratio"] = {
  topic: "Ratio", title: "Percentage to ratio", marks: 2,
  build(rng) {
    const pct = pick(rng, [10, 20, 25, 30, 40, 60, 70, 75, 80]);
    const g = gcd(pct, 100 - pct);
    return {
      prompt: `${pct}% of a garden is lawn and the rest is patio. Write the ratio of lawn to patio in its simplest form.`,
      answer: `${pct} : ${100 - pct} = ${pct / g} : ${(100 - pct) / g}`,
    };
  },
};
const RATIO_TRIOS = [
  { items: ["red counters", "blue counters", "green counters"], intro: "In a bag of counters" },
  { items: ["orange juice", "apple juice", "mango juice"], intro: "In a jug of fruit drink" },
  { items: ["cement", "sand", "gravel"], intro: "In a batch of concrete" },
  { items: ["flour", "sugar", "butter"], intro: "In a cake recipe" },
  { items: ["gold beads", "silver beads", "bronze beads"], intro: "In a jar of beads" },
];
SUBTOPIC_BANK["ratio-combine-two"] = {
  topic: "Ratio", title: "Combining two ratios", marks: 3,
  build(rng) {
    const { items: [A, B, C], intro } = pick(rng, RATIO_TRIOS);
    // The two ratios share B, so B's parts (q and r) must be made equal using
    // their LCM. Taking q and r from pairs that share a factor, where neither
    // divides the other, guarantees LCM < q × r and that BOTH ratios need
    // scaling — so simply multiplying the two B values together (cross-
    // multiplying) gives an answer that isn't in simplest form.
    const [q, r] = pick(rng, [[4, 6], [6, 4], [6, 9], [9, 6], [4, 10], [10, 4], [6, 8], [8, 6], [6, 10], [10, 6], [8, 12], [12, 8], [9, 12], [12, 9], [10, 15], [15, 10], [6, 15], [15, 6], [8, 10], [10, 8]]);
    const L = (q * r) / gcd(q, r);
    let p, s, totalA, totalC, guard = 0;
    do {
      p = seededInt(rng, 1, 9);
      s = seededInt(rng, 1, 9);
      totalA = p * (L / q);
      totalC = s * (L / r);
      guard++;
      // Keep both given ratios, and the final answer, in simplest form.
    } while ((gcd(p, q) !== 1 || gcd(r, s) !== 1 || p === q || r === s || gcd(gcd(totalA, L), totalC) !== 1) && guard < 80);
    return {
      prompt: `${intro}, the ratio of ${A} to ${B} is ${p} : ${q}, and the ratio of ${B} to ${C} is ${r} : ${s}. Find ${A} : ${B} : ${C}.`,
      answer: `LCM of ${q} and ${r} = ${L}. ${A} : ${B} = ${totalA} : ${L} and ${B} : ${C} = ${L} : ${totalC}, so ${A} : ${B} : ${C} = ${totalA} : ${L} : ${totalC}`,
    };
  },
};

/* --- Surface Area & Volume --- */
SUBTOPIC_BANK["volume-cuboid"] = {
  topic: "Volume", title: "Volume of a cuboid", marks: 2,
  build(rng) {
    const l = seededInt(rng, 3, 12), w = seededInt(rng, 3, 12), h = seededInt(rng, 3, 12);
    const v = l * w * h;
    return {
      prompt: `Calculate the volume of the cuboid shown.`,
      render: <CuboidSVG l={l} w={w} h={h} showL={`${l} cm`} showW={`${w} cm`} showH={`${h} cm`} />,
      answer: `${l} × ${w} × ${h} = ${v} cm³`,
    };
  },
};
SUBTOPIC_BANK["volume-cylinder"] = {
  topic: "Volume", title: "Volume of a cylinder", marks: 3,
  build(rng) {
    const r = seededInt(rng, 2, 8), h = seededInt(rng, 4, 15);
    const v = Math.PI * r * r * h;
    return {
      prompt: `Calculate the volume of the cylinder shown. Give your answer to 1 decimal place.`,
      render: <CylinderSVG r={r} h={h} showR={`${r} cm`} showH={`${h} cm`} />,
      answer: <>π × {r}² × {h} = {v.toFixed(1)} cm³</>,
    };
  },
};
SUBTOPIC_BANK["surface-area-cuboid"] = {
  topic: "Surface Area", title: "Surface area of a cuboid", marks: 3,
  build(rng) {
    const l = seededInt(rng, 3, 12), w = seededInt(rng, 3, 12), h = seededInt(rng, 3, 12);
    const sa = 2 * (l * w + l * h + w * h);
    return {
      prompt: `Calculate the total surface area of the cuboid shown.`,
      render: <CuboidSVG l={l} w={w} h={h} showL={`${l} cm`} showW={`${w} cm`} showH={`${h} cm`} />,
      answer: `2 × (${l}×${w} + ${l}×${h} + ${w}×${h}) = 2 × (${l * w} + ${l * h} + ${w * h}) = ${sa} cm²`,
    };
  },
};
SUBTOPIC_BANK["volume-triangular-prism"] = {
  topic: "Volume", title: "Volume of a triangular prism", marks: 3,
  build(rng) {
    const base = seededInt(rng, 4, 12);
    const height = seededInt(rng, 2, 6) * 2; // even, so the cross-section area is always a whole number
    const length = seededInt(rng, 5, 15);
    const crossArea = (base * height) / 2;
    const v = crossArea * length;
    return {
      prompt: `The prism has a right-angled triangular cross-section. Calculate the volume of the prism.`,
      render: <TriangularPrismSVG base={base} height={height} length={length} showBase={`${base} cm`} showHeight={`${height} cm`} showLength={`${length} cm`} />,
      answer: `Cross-section area = ½ × ${base} × ${height} = ${crossArea} cm². Volume = ${crossArea} × ${length} = ${v} cm³`,
    };
  },
};

/* --- Properties of 3D Shapes --- */
const POLYHEDRA = [
  { name: "cube", f: 6, e: 12, v: 8 },
  { name: "cuboid", f: 6, e: 12, v: 8 },
  { name: "triangular prism", f: 5, e: 9, v: 6 },
  { name: "square-based pyramid", f: 5, e: 8, v: 5 },
  { name: "tetrahedron (triangular-based pyramid)", f: 4, e: 6, v: 4 },
  { name: "hexagonal prism", f: 8, e: 18, v: 12 },
  { name: "pentagonal prism", f: 7, e: 15, v: 10 },
  { name: "octahedron", f: 8, e: 12, v: 6 },
];
SUBTOPIC_BANK["three-d-faces-edges-vertices"] = {
  topic: "Properties of 3D Shapes", title: "State the faces, edges and vertices of a 3D shape", marks: 3,
  build(rng) {
    const s = pick(rng, POLYHEDRA);
    const ask = pick(rng, ["all", "faces", "edges", "vertices"]);
    if (ask === "all") {
      return { prompt: `State the number of faces, edges and vertices of a ${s.name}.`, answer: `Faces = ${s.f}, edges = ${s.e}, vertices = ${s.v}` };
    }
    const val = ask === "faces" ? s.f : ask === "edges" ? s.e : s.v;
    return { prompt: `State the number of ${ask} of a ${s.name}.`, answer: `${val}` };
  },
};
// Only shapes whose (faces, edges, vertices) triple is unique across the
// list go in the reverse "name it" direction, so the question is never
// ambiguous between two differently-named shapes that happen to share
// the same counts (a cube and a cuboid, for instance).
const UNIQUE_POLYHEDRA = [
  { name: "cube", f: 6, e: 12, v: 8 },
  { name: "triangular prism", f: 5, e: 9, v: 6 },
  { name: "square-based pyramid", f: 5, e: 8, v: 5 },
  { name: "tetrahedron", f: 4, e: 6, v: 4 },
  { name: "hexagonal prism", f: 8, e: 18, v: 12 },
  { name: "pentagonal prism", f: 7, e: 15, v: 10 },
  { name: "octahedron", f: 8, e: 12, v: 6 },
];
SUBTOPIC_BANK["three-d-name-from-properties"] = {
  topic: "Properties of 3D Shapes", title: "Name a 3D shape from its faces, edges and vertices", marks: 2,
  build(rng) {
    const s = pick(rng, UNIQUE_POLYHEDRA);
    return { prompt: `A polyhedron has ${s.f} faces, ${s.e} edges and ${s.v} vertices. Name the shape.`, answer: s.name };
  },
};

/* --- Transformations of Shapes --- */
SUBTOPIC_BANK["transform-reflect-shape"] = {
  topic: "Transformations", title: "Reflect a shape in a line", marks: 2,
  build(rng) {
    const pts = randomTriangle(rng, -4, 4, -4, 4);
    const labels = ["A", "B", "C"];
    const labelledPts = pts.map((p, i) => ({ ...p, label: labels[i] }));
    const line = pick(rng, ["the x-axis", "the y-axis", "the line y = x"]);
    const reflect = (p) => {
      if (line === "the x-axis") return { x: p.x, y: -p.y };
      if (line === "the y-axis") return { x: -p.x, y: p.y };
      return { x: p.y, y: p.x };
    };
    const newPts = pts.map(reflect);
    const askIdx = seededInt(rng, 0, 2);
    return {
      prompt: `Triangle ABC is shown on the grid. The triangle is reflected in ${line}. Write down the coordinates of the image of point ${labels[askIdx]}.`,
      render: <ShapeGridSVG shapes={[{ points: labelledPts }]} />,
      answer: `${labels[askIdx]}' = (${newPts[askIdx].x}, ${newPts[askIdx].y})`,
    };
  },
};
SUBTOPIC_BANK["transform-translate-shape"] = {
  topic: "Transformations", title: "Translate a shape by a vector", marks: 2,
  build(rng) {
    const pts = randomTriangle(rng, -4, 2, -4, 2);
    const labels = ["A", "B", "C"];
    const labelledPts = pts.map((p, i) => ({ ...p, label: labels[i] }));
    const vx = seededInt(rng, -4, 4), vy = seededInt(rng, -4, 4);
    const askIdx = seededInt(rng, 0, 2);
    const newP = { x: pts[askIdx].x + vx, y: pts[askIdx].y + vy };
    return {
      prompt: <>Triangle ABC is shown on the grid. The triangle is translated by the vector <Frac n={vx} d={vy} />. Write down the coordinates of the image of point {labels[askIdx]}.</>,
      render: <ShapeGridSVG shapes={[{ points: labelledPts }]} />,
      answer: `${labels[askIdx]}' = (${newP.x}, ${newP.y})`,
    };
  },
};
SUBTOPIC_BANK["transform-rotate-shape"] = {
  topic: "Transformations", title: "Rotate a shape about the origin", marks: 3,
  build(rng) {
    const pts = randomTriangle(rng, -4, 4, -4, 4);
    const labels = ["A", "B", "C"];
    const labelledPts = pts.map((p, i) => ({ ...p, label: labels[i] }));
    const angle = pick(rng, [90, 180, 270]);
    const direction = angle === 180 ? "" : pick(rng, ["clockwise", "anticlockwise"]);
    const rotate = (p) => {
      const deg = direction === "clockwise" ? -angle : angle;
      const k = (((Math.round(deg / 90)) % 4) + 4) % 4;
      if (k === 0) return { x: p.x, y: p.y };
      if (k === 1) return { x: -p.y, y: p.x };
      if (k === 2) return { x: -p.x, y: -p.y };
      return { x: p.y, y: -p.x };
    };
    const newPts = pts.map(rotate);
    const askIdx = seededInt(rng, 0, 2);
    const dirText = angle === 180 ? "180°" : `${angle}° ${direction}`;
    return {
      prompt: `Triangle ABC is shown on the grid. The triangle is rotated ${dirText} about the origin O. Write down the coordinates of the image of point ${labels[askIdx]}.`,
      render: <ShapeGridSVG shapes={[{ points: labelledPts }]} />,
      answer: `${labels[askIdx]}' = (${newPts[askIdx].x}, ${newPts[askIdx].y})`,
    };
  },
};
SUBTOPIC_BANK["transform-enlarge-shape"] = {
  topic: "Transformations", title: "Enlarge a shape from a centre", marks: 3,
  build(rng) {
    const pts = randomTriangle(rng, -2, 2, -2, 2);
    const labels = ["A", "B", "C"];
    const labelledPts = pts.map((p, i) => ({ ...p, label: labels[i] }));
    const sf = pick(rng, [2, 3]);
    const askIdx = seededInt(rng, 0, 2);
    const newP = { x: pts[askIdx].x * sf, y: pts[askIdx].y * sf };
    return {
      prompt: `Triangle ABC is shown on the grid. The triangle is enlarged by scale factor ${sf}, centre the origin O. Write down the coordinates of the image of point ${labels[askIdx]}.`,
      render: <ShapeGridSVG shapes={[{ points: labelledPts }]} />,
      answer: `${labels[askIdx]}' = (${newP.x}, ${newP.y})`,
    };
  },
};

/* --- Time --- */
SUBTOPIC_BANK["time-duration-calc"] = {
  topic: "Time", title: "Calculate a duration using 24-hour time", marks: 2,
  build(rng) {
    const startH = seededInt(rng, 6, 20), startM = pick(rng, [0, 15, 30, 45]);
    let durH = seededInt(rng, 0, 3), durM = pick(rng, [0, 15, 30, 45]);
    if (durH === 0 && durM === 0) durM = 15;
    let endH = startH + durH, endM = startM + durM;
    if (endM >= 60) { endM -= 60; endH += 1; }
    endH = endH % 24;
    const pad2 = (n) => String(n).padStart(2, "0");
    const startStr = `${pad2(startH)}:${pad2(startM)}`;
    const endStr = `${pad2(endH)}:${pad2(endM)}`;
    const durStr = durH === 0 ? `${durM} minutes` : `${durH} hour${durH !== 1 ? "s" : ""}${durM ? ` ${durM} minutes` : ""}`;
    const askEnd = pick(rng, [true, false]);
    if (askEnd) {
      return { prompt: `A train departs at ${startStr} and the journey takes ${durStr}. At what time does it arrive?`, answer: `${endStr}` };
    }
    return { prompt: `A train departs at ${startStr} and arrives at ${endStr}. How long does the journey take?`, answer: durStr };
  },
};
SUBTOPIC_BANK["clock-reading"] = {
  topic: "Time", title: "Read an analogue clock and convert to 24-hour time", marks: 1,
  build(rng) {
    const hour12 = seededInt(rng, 1, 12);
    const minute = pick(rng, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    const period = pick(rng, ["am", "pm"]);
    const hour24 = period === "am" ? (hour12 === 12 ? 0 : hour12) : (hour12 === 12 ? 12 : hour12 + 12);
    const pad2 = (n) => String(n).padStart(2, "0");
    return {
      prompt: `The clock shows a time in the ${period === "am" ? "morning" : "afternoon/evening"}. Write this time using the 24-hour clock.`,
      render: <ClockSVG hour={hour12} minute={minute} />,
      answer: `${pad2(hour24)}:${pad2(minute)}`,
    };
  },
};

/* --- Trigonometric Graphs, Expressions & Equations in Degrees --- */
const TRIG_REF_ANGLES = [30, 45, 60];
SUBTOPIC_BANK["trig-equation-sin-cos"] = {
  topic: "Trigonometric Equations", title: "Solve a trigonometric equation for 0° ≤ x ≤ 360°", marks: 3,
  build(rng) {
    const func = pick(rng, ["sin", "cos"]);
    const base = pick(rng, TRIG_REF_ANGLES);
    const valueJSX =
      base === 45 ? <Frac n="√2" d="2" /> :
      (func === "sin") === (base === 30) ? "0.5" : <Frac n="√3" d="2" />;
    const sol1 = base;
    const sol2 = func === "sin" ? 180 - base : 360 - base;
    return {
      prompt: <>Solve {func}(x) = {valueJSX} for 0° ≤ x ≤ 360°. Give both solutions.</>,
      answer: `x = ${sol1}° or x = ${sol2}°`,
    };
  },
};
SUBTOPIC_BANK["trig-graph-max-min"] = {
  topic: "Trigonometric Graphs", title: "Key features of a sine or cosine graph", marks: 2,
  build(rng) {
    const func = pick(rng, ["sin", "cos"]);
    const a = seededInt(rng, 2, 5);
    const extremum = pick(rng, ["max", "min"]);
    const xVal = func === "sin" ? (extremum === "max" ? 90 : 270) : (extremum === "max" ? 0 : 180);
    const yVal = extremum === "max" ? a : -a;
    return {
      prompt: `The graph of y = ${a}${func}(x°) is drawn for 0° ≤ x < 360°. Write down the coordinates of its ${extremum === "max" ? "maximum" : "minimum"} point.`,
      answer: `(${xVal}, ${yVal})`,
    };
  },
};

/* --- Geometric Notation --- */
SUBTOPIC_BANK["geometric-notation-naming"] = {
  topic: "Geometric Notation", title: "Use correct notation to name an angle", marks: 1,
  build(rng) {
    const letterSets = [["A", "B", "C"], ["P", "Q", "R"], ["X", "Y", "Z"], ["D", "E", "F"]];
    const [p1, vertex, p2] = pick(rng, letterSets);
    return {
      prompt: `In the diagram, name the angle marked with the arc using correct three-letter notation.`,
      render: <NotationAngleSVG labels={[p1, vertex, p2]} />,
      answer: `∠${p1}${vertex}${p2} (the middle letter, ${vertex}, must be the vertex — ∠${p2}${vertex}${p1} is equally correct)`,
    };
  },
};

/* --- Correlation & Regression --- */
SUBTOPIC_BANK["scatter-correlation-type"] = {
  topic: "Correlation", title: "Identify the type of correlation from a scatter graph", marks: 1,
  build(rng) {
    const type = pick(rng, ["positive", "negative", "none"]);
    const n = 9;
    let points;
    if (type === "none") {
      points = Array.from({ length: n }, () => ({ x: seededInt(rng, 1, 20), y: seededInt(rng, 1, 20) }));
    } else {
      points = Array.from({ length: n }, (_, i) => {
        const noise = seededInt(rng, -2, 2);
        const x = 2 + i * 2;
        let y = type === "positive" ? x + noise : (22 - x) + noise;
        y = Math.max(1, Math.min(21, y));
        return { x, y };
      });
    }
    return {
      prompt: `The scatter graph shows 9 pairs of values, plotting x against y. Describe the type of correlation shown.`,
      accurateDiagram: true,
      render: <ScatterSVG points={points} xMax={22} yMax={22} />,
      answer: type === "none" ? "No correlation" : `${type === "positive" ? "Positive" : "Negative"} correlation`,
    };
  },
};
SUBTOPIC_BANK["line-of-best-fit-estimate"] = {
  topic: "Correlation", title: "Use a line of best fit to estimate a value", marks: 2,
  build(rng) {
    const m = pick(rng, [1, 2]);
    const c = seededInt(rng, 0, 6);
    const xMaxLine = 15;
    const yAtX = (x) => m * x + c;
    const n = 8;
    const points = Array.from({ length: n }, (_, i) => {
      const x = Math.round((1 + i * 1.8) * 10) / 10;
      const noise = seededInt(rng, -2, 2);
      return { x, y: Math.max(0, yAtX(x) + noise) };
    });
    const readX = seededInt(rng, 3, 12);
    const readY = yAtX(readX);
    const y1 = yAtX(0), y2 = yAtX(xMaxLine);
    const yMax = Math.ceil((y2 + 4) / 5) * 5;
    return {
      prompt: `The scatter graph shows a set of data with a line of best fit drawn. Use the line of best fit to estimate the value of y when x = ${readX}.`,
      accurateDiagram: true,
      render: <ScatterSVG points={points} xMax={xMaxLine + 2} yMax={yMax} showLine={{ x1: 0, y1, x2: xMaxLine, y2 }} />,
      answer: `y ≈ ${readY}`,
    };
  },
};

/* --- Time Series & Moving Averages --- */
SUBTOPIC_BANK["moving-average-calc"] = {
  topic: "Time Series", title: "Calculate a moving average", marks: 3,
  build(rng) {
    const base = seededInt(rng, 20, 60);
    const vals = [base];
    for (let i = 1; i < 5; i++) vals.push(vals[i - 1] + pick(rng, [-6, -3, 2, 4, 5, -2, 6]));
    let sum4 = vals[0] + vals[1] + vals[2] + vals[3];
    const rem = sum4 % 4;
    if (rem !== 0) vals[3] += (4 - rem); // nudge so the 4-point average is exact
    sum4 = vals[0] + vals[1] + vals[2] + vals[3];
    const ma = sum4 / 4;
    const quarters = ["Q1", "Q2", "Q3", "Q4", "Q5"];
    return {
      prompt: `A shop's quarterly sales (£000s) for five consecutive quarters were: ${quarters.map((q, i) => `${q} = ${vals[i]}`).join(", ")}. Calculate the first 4-point moving average (using Q1 to Q4).`,
      answer: `(${vals[0]} + ${vals[1]} + ${vals[2]} + ${vals[3]}) ÷ 4 = ${sum4} ÷ 4 = ${ma}`,
    };
  },
};

/* --- Estimating Gradient and Area Under a Curve --- */
SUBTOPIC_BANK["trapezium-rule-area"] = {
  topic: "Estimating Area", title: "Estimate the area under a curve using the trapezium rule", marks: 4,
  build(rng) {
    const n = pick(rng, [4, 5]);
    const h = pick(rng, [1, 2]);
    const y0 = seededInt(rng, 2, 6);
    const ys = [y0];
    for (let i = 1; i <= n; i++) ys.push(ys[i - 1] + seededInt(rng, 1, 4));
    const ends = ys[0] + ys[n];
    const middle = ys.slice(1, n);
    const middleSum = middle.reduce((s, v) => s + v, 0);
    const bracket = ends + 2 * middleSum;
    const area = (h / 2) * bracket;
    const xs = Array.from({ length: n + 1 }, (_, i) => i * h);
    return {
      prompt: `The table shows estimated values of y for a curve, taken at equal intervals of ${h}. x: ${xs.join(", ")}. y: ${ys.join(", ")}. Use the trapezium rule with ${n} equal strips to estimate the area under the curve between x = 0 and x = ${n * h}.`,
      answer: `Area ≈ (${h} ÷ 2) × [(${ys[0]} + ${ys[n]}) + 2 × (${middle.join(" + ")})] = (${h} ÷ 2) × [${ends} + ${2 * middleSum}] = (${h} ÷ 2) × ${bracket} = ${area.toFixed(1)}`,
    };
  },
};

/* --- Graphs of Exponential Functions --- */
SUBTOPIC_BANK["exponential-graph-features"] = {
  topic: "Exponential Graphs", title: "Interpret y = a × bˣ", marks: 3,
  build(rng) {
    const a = seededInt(rng, 2, 8);
    const mode = pick(rng, ["yintercept", "evaluate", "behaviour"]);
    if (mode === "evaluate") {
      const b = pick(rng, [2, 3]);
      const xval = seededInt(rng, 1, 3);
      const yval = a * Math.pow(b, xval);
      return { prompt: <>y = {a} × {b}<sup>x</sup>. Find the value of y when x = {xval}.</>, answer: `${yval}` };
    }
    const b = pick(rng, [2, 3, 0.5]);
    const bLabel = b === 0.5 ? "0.5" : `${b}`;
    if (mode === "yintercept") {
      return { prompt: <>The graph of y = {a} × {bLabel}<sup>x</sup> is drawn. Write down the y-intercept of the graph.</>, answer: `(0, ${a})` };
    }
    const behaviour = b > 1 ? "increases" : "decreases";
    return { prompt: <>The graph of y = {a} × {bLabel}<sup>x</sup> is drawn for x ≥ 0. State whether y increases or decreases as x increases.</>, answer: `y ${behaviour} as x increases` };
  },
};

/* --- Transformations of Curves --- */
SUBTOPIC_BANK["curve-transform-translate"] = {
  topic: "Transformations of Curves", title: "Transform a key point on a curve", marks: 2,
  build(rng) {
    const px0 = seededInt(rng, -6, 6), py0 = seededInt(rng, -8, 8);
    const kind = pick(rng, ["min", "max", "point"]);
    const pointDesc = kind === "min" ? "minimum point" : kind === "max" ? "maximum point" : "point";
    const transforms = [
      { desc: (k) => `y = f(x) + ${k}`, k: seededInt(rng, 1, 8), apply: (p, k) => ({ x: p.x, y: p.y + k }) },
      { desc: (k) => `y = f(x) − ${k}`, k: seededInt(rng, 1, 8), apply: (p, k) => ({ x: p.x, y: p.y - k }) },
      { desc: (k) => `y = f(x − ${k})`, k: seededInt(rng, 1, 8), apply: (p, k) => ({ x: p.x + k, y: p.y }) },
      { desc: (k) => `y = f(x + ${k})`, k: seededInt(rng, 1, 8), apply: (p, k) => ({ x: p.x - k, y: p.y }) },
      { desc: () => `y = −f(x)`, k: null, apply: (p) => ({ x: p.x, y: -p.y }) },
    ];
    const transform = pick(rng, transforms);
    const newP = transform.apply({ x: px0, y: py0 }, transform.k);
    return {
      prompt: `The curve y = f(x) has a ${pointDesc} at (${px0}, ${py0}). Write down the coordinates of the corresponding point on the graph of ${transform.desc(transform.k)}.`,
      answer: `(${newP.x}, ${newP.y})`,
    };
  },
};

const SET2_WEEKS = {
  "HT1 · Week 1 (07/09/26) — Expanding Triple Brackets, Factorising & Solving Quadratics": [
    "expanding-triple-brackets", "fac-quadratic", "fac-quadratic-agt1", "solve-quadratic-factorise",
    "solve-quadratic-factorise-agt1", "solve-quadratic-rearrange",
  ],
  "HT1 · Week 2 (14/09/26) — Completing the Square, Quadratic Formula, Graphs": [
    "completing-the-square", "solve-completing-square", "solve-quadratic-formula", "plot-nonlinear-graph",
  ],
  "HT1 · Week 3 (21/09/26) — Significant Points, Linear Simultaneous Equations": [
    "significant-points", "simultaneous-linear-basic", "simultaneous-linear-scaling",
  ],
  "HT1 · Week 4 (28/09/26) — Quadratic Simultaneous Equations, Functions": [
    "quadratic-simultaneous", "functions-substitution-solving",
  ],
  "HT1 · Week 5 (05/10/26) — Composite & Inverse Functions, Changing the Subject": [
    "composite-functions", "inverse-functions", "changing-subject-expand", "changing-subject-factorise",
  ],
  "HT1 · Week 6 (12/10/26) — Quadratic Sequences, Algebraic Fractions": [
    "quadratic-sequences", "algebraic-fractions-simplify", "algebraic-fractions-muldiv", "algebraic-fractions-addsub",
  ],
  "HT1 · Week 7 (19/10/26) — Surds": [
    "surds-simplify", "surds-add-subtract", "surds-multiply-expand", "surds-basic-rationalising", "surds-rationalising-harder",
  ],
  "HT2 · Week 3 (23/11/26) — Negative & Fractional Indices": [
    "indices-negative", "indices-fractional", "powers-laws-multiply", "powers-zero-and-fractional",
  ],
  "HT2 · Week 4 (30/11/26) — Bounds & Right-Angled Triangles": [
    "bounds-intro", "bounds-multiply", "bounds-accuracy", "pythagoras-hypotenuse", "pythagoras-shorter-side",
  ],
  "HT2 · Week 5 (07/12/26) — Proportion & Applied Proportion Graphs": [
    "direct-proportion", "inverse-proportion", "applied-proportion-graph",
  ],
  "HT2 · Week 6 (14/12/26) — Sine Rule, Cosine Rule, Area Rule": [
    "sine-rule-side", "sine-rule-angle", "cosine-rule-side", "cosine-rule-angle", "area-rule",
  ],
  "Pythagoras' Theorem (diagram demo)": [
    "pythagoras-hypotenuse", "pythagoras-shorter-side",
  ],
  "HT3 · Week 2 (11/01/27) — Probability: Product Rule, Tree Diagrams, Venn Diagrams": [
    "product-rule-counting", "tree-replacement", "tree-no-replacement", "venn-complete", "venn-prob-union",
  ],
  "HT3 · Week 3 (18/01/27) — Set Notation, Boxplots, Cumulative Frequency": [
    "set-notation-list", "set-notation-membership", "boxplot-range", "boxplot-iqr", "cf-median-class",
  ],
  "HT3 · Week 4 (25/01/27) — Histograms, Circle Facts": [
    "histogram-freq-density", "histogram-read-bar", "histogram-total-frequency", "circle-facts-parts", "circle-facts-circumference-area",
  ],
  "HT3 · Week 5 (01/02/27) — Circle Theorems": [
    "circle-theorem-centre-circumference", "circle-theorem-semicircle", "circle-theorem-tangent-kite", "circle-theorem-cyclic-quadrilateral",
  ],
  "HT4 · Week 2 (01/03/27) — Congruence & Similar Shapes": [
    "congruence-criteria", "similar-shapes-find-length", "similar-shapes-identify",
  ],
  "HT4 · Week 3 (08/03/27) — Similar Shapes (Area & Volume), Iterations": [
    "similar-shapes-area-scale", "similar-shapes-volume-scale", "iterations-fixed-point",
  ],
  "HT4 · Week 4 (15/03/27) — Equation of a Circle, Linear Graphs": [
    "circle-eq-radius-from-eq", "circle-eq-write-given-radius", "linear-graph-two-points", "linear-graph-parallel", "linear-graph-perpendicular",
  ],
  "HT4 · Week 5 (22/03/27) — Inequalities": [
    "inequality-list-integers", "inequality-linear-twostep", "inequality-both-sides", "inequality-quadratic-solve",
  ],
  "HT5 · Week 1 (12/04/27) — Vectors, Algebraic Proof": [
    "vectors-column-arithmetic", "vectors-route-midpoint", "vectors-parallel-proof", "algebraic-proof-odd-even", "algebraic-proof-multiple",
  ],
};

// Auto-suggested from the Set 1 tab of Year_11_Timeline_26-27.xlsx. Weeks
// that are PPE/feedback/INSET-only with no gradable topic (e.g. HT2 Weeks
// 1-2, most of HT3 Weeks 2-6) are omitted entirely, matching SET2_WEEKS'
// own convention. Picking a week just pre-ticks a starting selection — the
// teacher can freely tick/untick afterwards (see applyWeek).
const SET1_WEEKS = {
  "HT1 · Week 1 (07/09/26) — Factorising & Rearranging Review, Proof, Solving Quadratics": [
    "fac-quadratic-agt1", "changing-subject-expand", "algebraic-proof-odd-even", "solve-quadratic-formula",
  ],
  "HT1 · Week 2 (14/09/26) — Sketching Quadratics, Turning Points, Plotting Graphs": [
    "quadratic-roots-and-intercept", "turning-point-from-completed-square", "plot-nonlinear-graph",
  ],
  "HT1 · Week 3 (21/09/26) — Simultaneous Equations Graphically, Straight Line Graphs Review": [
    "quadratic-simultaneous", "linear-graph-two-points",
  ],
  "HT1 · Week 4 (28/09/26) — Equation of a Tangent": [
    "estimate-gradient-tangent", "linear-graph-perpendicular",
  ],
  "HT1 · Week 5 (05/10/26) — Graphing Inequalities, Iteration (W1)": [
    "inequality-linear-twostep", "inequality-both-sides", "iterations-fixed-point",
  ],
  "HT1 · Week 6 (12/10/26) — Iteration (W2), Algebraic Fractions": [
    "iteration-rearrange-first", "algebraic-fractions-simplify-basic", "algebraic-fractions-addsub-diffvars",
  ],
  "HT1 · Week 7 (19/10/26) — Evaluating Functions, Inverse & Composite Functions, Graph Transformations": [
    "functions-substitution-solving", "inverse-functions", "composite-functions", "curve-transform-translate",
  ],
  "HT2 · Week 3 (23/11/26) — Speed-Time Graphs, Vectors (W1)": [
    "distance-time-graph-read", "vectors-column-arithmetic",
  ],
  "HT2 · Week 4 (30/11/26) — Vectors (W2), Trig & Exponential Graphs, Congruent Triangles": [
    "vectors-parallel-proof", "trig-graph-max-min", "exponential-graph-features", "congruence-criteria",
  ],
  "HT2 · Week 5 (07/12/26) — Boxplots, Cumulative Frequency, Histograms (W1)": [
    "boxplot-range", "cf-median-class", "histogram-freq-density",
  ],
  "HT2 · Week 6 (14/12/26) — Histograms (W2), Assess & Review": [
    "histogram-read-bar", "histogram-total-frequency",
  ],
  "HT3 · Week 1 (04/01/27) — Venn Diagrams, Loci": [
    "venn-complete",
  ],
  // HT4's Set 1 content was added to the timeline by copying Set 2's own
  // HT4 weeks verbatim (Set 1 had nothing past HT3 — see CLAUDE.md), so
  // these four weeks intentionally match SET2_WEEKS' HT4 selections closely.
  "HT4 · Week 2 (01/03/27) — Circle Theorems": [
    "circle-theorem-centre-circumference", "circle-theorem-semicircle",
  ],
  "HT4 · Week 3 (08/03/27) — Congruence, Similar Shapes": [
    "congruence-criteria", "similar-shapes-identify",
  ],
  "HT4 · Week 4 (15/03/27) — Similar Shapes (Area & Volume), Iterations": [
    "similar-shapes-area-scale", "similar-shapes-volume-scale", "iterations-fixed-point",
  ],
  "HT4 · Week 5 (22/03/27) — Linear Graphs Recap, Equation of a Circle (W1)": [
    "linear-graph-two-points", "circle-eq-radius-from-eq",
  ],
  "HT5 · Week 1 (12/04/27) — Equation of a Circle (W2), Inequalities": [
    "circle-eq-write-given-radius", "inequality-linear-twostep", "inequality-quadratic-solve", "inequality-from-number-line",
  ],
  "HT5 · Week 2 (19/04/27) — Vectors, Algebraic Proof": [
    "vectors-route-midpoint", "algebraic-proof-multiple",
  ],
};

// Auto-suggested from the Foundation tab of Year_11_Timeline_26-27.xlsx,
// same convention as SET1_WEEKS above (PPE/feedback/revision-only weeks
// omitted; picking a week just pre-ticks a starting selection).
const FOUNDATION_WEEKS = {
  "HT1 · Week 1 (07/09/26) — Manipulating Expressions": [
    "collect-like-terms-multi", "eb-double-pos", "fac-common",
  ],
  "HT1 · Week 2 (14/09/26) — Factorising & Solving Quadratics, Substitution, Equations": [
    "fac-quadratic", "solve-quadratic-factorise", "substitution-one-variable", "solve-two-step-equation",
  ],
  "HT1 · Week 3 (21/09/26) — Equations and Formulae": [
    "solve-equation-both-sides-brackets", "form-solve-perimeter-equation", "changing-subject-expand",
  ],
  "HT1 · Week 4 (28/09/26) — Ratio": [
    "ratio-simplify", "ratio-share-amount", "ratio-total-parts", "ratio-quantity-one-part-given",
  ],
  "HT1 · Week 5 (05/10/26) — Fractions": [
    "frac-simplify", "fdp-percent-to-decimal", "frac-multiply-mixed", "frac-add-different-denom",
  ],
  "HT1 · Week 6 (12/10/26) — Fractions of an Amount, LCM and HCF": [
    "frac-of-amount", "fmp-hcf-lcm",
  ],
  "HT1 · Week 7 (19/10/26) — Percentages": [
    "percent-of-amount", "percent-one-of-another",
  ],
  "HT2 · Week 4 (30/11/26) — Percentage Change, Reverse Percentages": [
    "percent-compound-increase", "percent-reverse",
  ],
  "HT2 · Week 5 (07/12/26) — Compound & Simple Interest, Indices and Standard Form": [
    "percent-simple-interest", "powers-laws-multiply", "sf-large-to-sf",
  ],
  "HT2 · Week 6 (14/12/26) — Standard Form: Converting & Operations": [
    "sf-multiply", "sf-divide", "sf-add-subtract",
  ],
  "HT3 · Week 1 (04/01/27) — Averages": [
    "averages-range-listed",
  ],
  "HT3 · Week 2 (11/01/27) — Probability, Grouped Frequency Tables": [
    "theoretical-probability-single", "mean-from-grouped-table", "relative-frequency-from-data",
  ],
  "HT3 · Week 3 (18/01/27) — Transformations, Tree Diagrams, Venn Diagrams": [
    "transform-translate-shape", "tree-replacement", "venn-complete",
  ],
  "HT3 · Week 4 (25/01/27) — Reflection, Rotation, Enlargement": [
    "transform-reflect-shape", "transform-rotate-shape", "transform-enlarge-shape",
  ],
  "HT3 · Week 5 (01/02/27) — Angles, Angles in Parallel Lines, Polygons": [
    "angles-on-a-line", "angles-alternate", "angles-interior-polygon-sum",
  ],
  "HT4 · Week 3 (08/03/27) — Area, Perimeter and Volume": [
    "area-rectangle-triangle", "composite-rectilinear-area-perimeter", "circle-facts-circumference-area",
  ],
  "HT4 · Week 5 (22/03/27) — Data: Bar Charts, Scatter Graphs, Pie Charts": [
    "bar-chart-read-frequency", "scatter-correlation-type", "pie-chart-angle-to-frequency",
  ],
  "HT5 · Week 1 (12/04/27) — Pythagoras, Trigonometry": [
    "pythagoras-hypotenuse", "pythagoras-shorter-side", "trig-find-side",
  ],
  "HT5 · Week 2 (19/04/27) — Simultaneous Equations": [
    "simultaneous-linear-basic",
  ],
};

/* ---- Year 10 (2026/27) schemes of work, from "Year 10 Timelines 26-27.xlsx".
   Same shape as the Year 11 tables above: one entry per teaching week, listing
   the subtopics that week's lessons cover. A week is only listed if at least
   one of its lessons has matching question types in the bank (quiz/review,
   assessment, revision and INSET lessons carry no questions). Weeks pick up to
   six subtopics, taking one from each lesson in turn so every lesson is
   represented; the teacher can still tick/untick topics after choosing a week. ---- */

const Y10_SET1_WEEKS = {
  "HT1 · Week 1 (07/09/26) — Recurring Decimals, Surds (W1)": [
    "frac-recurring-to-fraction", "surds-simplify", "surds-add-subtract", "surds-multiply-expand", "fdp-recurring-partial-nonrecurring",
  ],
  "HT1 · Week 2 (14/09/26) — Surds (W2), Indices (W1)": [
    "surds-basic-rationalising", "surds-rationalising-harder", "indices-negative", "indices-fractional", "indices-negative-fractional-base", "indices-non-unit-fractional",
  ],
  "HT1 · Week 3 (21/09/26) — Indices (W2), Product Rule for Counting, Bounds & Error Intervals (W1)": [
    "indices-negative-fractional-base", "product-rule-counting", "round-error-interval", "indices-combined-negative-fractional",
  ],
  "HT1 · Week 4 (28/09/26) — Bounds & Error Intervals (W2)": [
    "bounds-intro", "bounds-multiply", "bounds-accuracy",
  ],
  "HT1 · Week 5 (05/10/26) — Expanding Brackets, Factorising (W1)": [
    "eb-double-pos", "eb-double-neg", "fac-grouping", "eb-double-mixed", "eb-squared", "expanding-triple-brackets",
  ],
  "HT1 · Week 6 (12/10/26) — Factorising (W2), Solving Quadratics by Factorising": [
    "fac-quadratic", "fac-quadratic-agt1", "fac-common-then-simplify", "solve-quadratic-factorise", "fac-monic-neg", "fac-nonmonic-neg",
  ],
  "HT1 · Week 7 (19/10/26) — Linear Equations, Rearranging Equations (W1)": [
    "solve-equation-both-sides-brackets", "changing-subject-expand", "solve-equation-fractions", "rearrange-square-root", "solve-equation-negative-coefficient",
  ],
  "HT2 · Week 1 (09/11/26) — Rearranging Equations (W2), Sequences": [
    "changing-subject-factorise", "find-nth-term-linear", "quadratic-sequences", "rearrange-square-root", "generate-terms-from-nth-term", "rearrange-square",
  ],
  "HT2 · Week 2 (16/11/26) — Solving Quadratics by Factorising": [
    "solve-quadratic-factorise", "solve-quadratic-factorise-agt1", "solve-quadratic-rearrange",
  ],
  "HT2 · Week 3 (23/11/26) — Quadratics (W1)": [
    "completing-the-square", "solve-completing-square", "solve-quadratic-formula", "solve-quadratic-word-problem", "completing-the-square-odd-b", "completing-square-non-monic",
  ],
  "HT2 · Week 4 (30/11/26) — Quadratics (W2), Transformations (W1)": [
    "solve-quadratic-word-problem", "transform-translate-shape", "transform-reflect-shape", "solve-quadratic-formula",
  ],
  "HT2 · Week 5 (07/12/26) — Transformations (W2)": [
    "transform-rotate-shape", "transform-enlarge-shape",
  ],
  "HT3 · Week 1 (04/01/27) — Transformations (W3)": [
    "transform-enlarge-shape",
  ],
  "HT3 · Week 2 (11/01/27) — Coordinate Geometry (W1)": [
    "plot-nonlinear-graph", "cubic-graph-features", "equation-from-gradient-and-point", "plot-cubic-graph", "reciprocal-graph-features", "x-and-y-intercepts-from-equation",
  ],
  "HT3 · Week 3 (18/01/27) — Coordinate Geometry (W2)": [
    "linear-graph-parallel", "sketch-quadratic-a1", "turning-point-from-completed-square", "plot-cubic-graph", "linear-graph-perpendicular", "sketch-quadratic-agt1",
  ],
  "HT3 · Week 4 (25/01/27) — Coordinate Geometry (W3), Quadratic Simultaneous Equations (W1)": [
    "circle-eq-radius-from-eq", "exponential-graph-features", "simultaneous-linear-scaling", "circle-eq-write-given-radius", "simultaneous-equations-word-problem",
  ],
  "HT3 · Week 5 (01/02/27) — Quadratic Simultaneous Equations (W2), Surface Area & Volume (W1)": [
    "quadratic-simultaneous", "plot-nonlinear-graph", "measures-convert-area-units", "volume-triangular-prism", "quadratic-simultaneous-circle", "volume-cuboid",
  ],
  "HT3 · Week 6 (08/02/27) — Surface Area & Volume (W2)": [
    "volume-cuboid", "volume-cone", "volume-cylinder", "surface-area-cuboid", "surface-area-cylinder",
  ],
  "HT4 · Week 1 (22/02/27) — Direct & Inverse Proportion (W1)": [
    "direct-proportion", "inverse-proportion",
  ],
  "HT4 · Week 2 (01/03/27) — Direct & Inverse Proportion (W2), Probability (W1)": [
    "applied-proportion-graph", "venn-independence-check", "tree-replacement", "mutually-exclusive-missing-probability",
  ],
  "HT4 · Week 3 (08/03/27) — Probability (W2)": [
    "tree-no-replacement", "combinations-list-two-groups", "venn-complete", "combinations-choose-two", "venn-prob-set-notation", "product-rule-counting",
  ],
  "HT4 · Week 4 (15/03/27) — Similarity & Congruence (W1)": [
    "similar-shapes-identify", "similar-shapes-find-length", "similar-shapes-area-scale", "similar-shapes-volume-scale",
  ],
  "HT4 · Week 5 (22/03/27) — Pythagoras & Trigonometry, Similarity & Congruence (W2)": [
    "pythagoras-hypotenuse", "congruence-criteria", "pythagoras-shorter-side", "trig-find-side", "trig-find-angle",
  ],
  "HT5 · Week 1 (12/04/27) — Further Trigonometry (W1)": [
    "trig-exact-values", "trig-elevation-depression", "sine-rule-side", "pythagoras-surd-answer", "sine-rule-angle",
  ],
  "HT5 · Week 2 (19/04/27) — Further Trigonometry (W2)": [
    "area-rule", "sine-rule-side", "cosine-rule-side", "cosine-rule-angle",
  ],
  "HT5 · Week 3 (26/04/27) — Data (W1)": [
    "averages-range-listed", "boxplot-range", "cf-table-complete", "boxplot-iqr", "mean-from-grouped-table", "cf-median-class",
  ],
  "HT5 · Week 4 (03/05/27) — Data (W2)": [
    "histogram-freq-density", "histogram-read-bar", "histogram-total-frequency",
  ],
  "HT5 · Week 5 (10/05/27) — Gradient & Area Under a Graph": [
    "estimate-gradient-tangent", "trapezium-rule-area", "distance-time-graph-read",
  ],
  "HT5 · Week 6 (17/05/27) — Circle Theorems": [
    "circle-theorem-semicircle", "circle-theorem-cyclic-quadrilateral", "circle-theorem-alternate-segment", "circle-theorem-isosceles-radii", "circle-theorem-centre-circumference", "circle-theorem-same-segment",
  ],
  "HT5 · Week 7 (24/05/27) — Algebraic Fractions (W1)": [
    "algebraic-fractions-simplify-basic", "algebraic-fractions-muldiv", "algebraic-fractions-addsub", "algebraic-fractions-simplify-factorise", "algebraic-fractions-divide", "algebraic-fractions-addsub-diffvars",
  ],
  "HT6 · Week 1 (07/06/27) — Algebraic Fractions (W2), Functions (W1)": [
    "algebraic-fractions-solve-equation", "functions-substitution-solving", "functions-substitute-expression", "solve-function-equation", "composite-functions",
  ],
  "HT6 · Week 2 (14/06/27) — Functions (W2)": [
    "composite-functions", "inverse-functions", "solve-function-equation",
  ],
};

const Y10_SET2_WEEKS = {
  "HT1 · Week 1 (07/09/26) — Estimation, HCF/LCM listing, HCF/LCM Venn Diagram, Fraction - Multiply/Divide": [
    "estimation-calculation", "fmp-hcf-lcm", "fmp-prime-factorisation", "frac-multiply-mixed", "round-significant-figures", "fmp-lcm",
  ],
  "HT1 · Week 2 (14/09/26) — Fraction - Add/Subtract, Two-Way Tables and Frequency Trees, Simplify, I:N Ratio": [
    "frac-add-different-denom", "two-way-table-complete", "ratio-simplify", "frac-subtract-different-denom", "frequency-tree-complete", "frac-add-mixed-numbers",
  ],
  "HT1 · Week 3 (21/09/26) — Share Ratio - 3 types, Combine Ratio, Ratio - Fraction and Percentages, …": [
    "ratio-share-amount", "ratio-combine-two", "ratio-to-fraction", "direct-proportion", "ratio-quantity-one-part-given", "ratio-to-percentage",
  ],
  "HT1 · Week 4 (28/09/26) — Exchange Rate, Inverse Proportion, Percentage - Non-calc": [
    "conversion-graph-read", "inverse-proportion", "fdp-percent-to-decimal", "frac-of-amount",
  ],
  "HT1 · Week 5 (05/10/26) — Percentages - Calc, Reverse Percentage, Percentage Change, Simple Interest": [
    "percent-of-amount", "percent-reverse", "percent-compound-increase", "percent-simple-interest", "percent-one-of-another", "percent-reverse-after-increase",
  ],
  "HT1 · Week 6 (12/10/26) — Compound Interest, Collect Like Terms": [
    "percent-compound-increase", "collect-like-terms-multi",
  ],
  "HT1 · Week 7 (19/10/26) — Multiply/Divide and collect like terms, Expand, Factorise": [
    "multiply-algebraic-terms", "eb-single-pos", "fac-common", "divide-algebraic-terms-basic", "eb-single-term-outside", "fac-quadratic",
  ],
  "HT2 · Week 1 (09/11/26) — Substitution, Multi-step equations, Equations with brackets, …": [
    "substitution-one-variable", "solve-two-step-equation", "solve-equation-both-sides-brackets", "substitution-formula-negatives", "solve-equation-negative-coefficient",
  ],
  "HT2 · Week 2 (16/11/26) — Form and Solve, Equations - Quadratics, Sequences - Rules,Missing Terms, Patterns": [
    "form-solve-perimeter-equation", "solve-quadratic-factorise", "generate-terms-from-nth-term", "form-equation-angles", "solve-quadratic-square-rooting", "arithmetic-sequence-nth-term-value",
  ],
  "HT2 · Week 3 (23/11/26) — Sequences - Non-linear and Patterns, Sequences - Nth term, Changing the subject, … (W1)": [
    "quadratic-sequences", "find-nth-term-linear", "changing-subject-expand", "powers-laws-multiply", "generate-terms-from-nth-term", "rearrange-square-root",
  ],
  "HT2 · Week 4 (30/11/26) — Negative Indices, Standard Form Conversion, Standard Form - Multiply/Divide, … (W2)": [
    "indices-negative", "sf-large-to-sf", "sf-multiply", "sf-add-subtract", "sf-small-to-sf", "sf-divide",
  ],
  "HT3 · Week 1 (04/01/27) — Averages and Range From List, Combined Mean, Averages from Discrete Data": [
    "averages-range-listed", "averages-missing-value-given-mean", "ungrouped-frequency-table-mean",
  ],
  "HT3 · Week 2 (11/01/27) — Averages from Grouped Data, Scatter Graphs": [
    "mean-from-grouped-table", "scatter-correlation-type", "line-of-best-fit-estimate", "grouped-table-modal-median-class",
  ],
  "HT3 · Week 3 (18/01/27) — Frequency Polygons, Pie Charts": [
    "bar-chart-read-frequency", "pie-chart-angle-to-frequency",
  ],
  "HT3 · Week 4 (25/01/27) — Basic Angle Facts, Angles in Parallel Lines": [
    "angles-on-a-line", "angles-triangle-sum", "angles-alternate", "angles-co-interior", "angles-about-a-point", "angles-isosceles-triangle",
  ],
  "HT3 · Week 5 (01/02/27) — Angles in Polygons, Bearings (W1)": [
    "angles-interior-polygon-sum", "angles-exterior-regular-polygon", "bearings-find", "angles-missing-in-polygon", "angles-interior-regular-polygon", "angles-polygon-sides-from-angle",
  ],
  "HT3 · Week 6 (08/02/27) — Bearings (W2), Pythag, Trig Side - Numerator": [
    "bearings-back-bearing", "pythagoras-hypotenuse", "trig-find-side", "pythagoras-shorter-side",
  ],
  "HT4 · Week 1 (22/02/27) — Trig Side - Denominator, Trig Angles, Mixed Right Angles": [
    "trig-find-side", "trig-find-angle", "pythagoras-hypotenuse",
  ],
  "HT4 · Week 2 (01/03/27) — Circumference, Area, Circle Problems": [
    "circle-facts-circumference-area", "circle-facts-parts",
  ],
  "HT4 · Week 3 (08/03/27) — Area/Perimeter of 2D Shapes, Volume of Prisms, Surface Area": [
    "area-rectangle-triangle", "volume-cuboid", "volume-triangular-prism", "surface-area-cuboid", "composite-rectilinear-area-perimeter", "volume-cylinder",
  ],
  "HT4 · Week 4 (15/03/27) — Spheres and Cones, Speed": [
    "volume-sphere", "compound-measures-calc", "volume-cone", "surface-area-sphere",
  ],
  "HT4 · Week 5 (22/03/27) — Distance Time Graphs, Density, Pressure": [
    "distance-time-graph-read", "compound-measures-calc",
  ],
  "HT5 · Week 1 (12/04/27) — Coordinates, midpoints, hor and vert lines, y=mx+c, Plotting Graphs, Equation of a line": [
    "coordinates-identify-point", "x-and-y-intercepts-from-equation", "equation-from-gradient-and-point", "coordinates-midpoint-calc",
  ],
  "HT5 · Week 2 (19/04/27) — Equation from two points, Parallel Lines and Mixed Practice, Plotting Quadratic, … (W1)": [
    "linear-graph-two-points", "linear-graph-parallel", "plot-nonlinear-graph", "conversion-graph-read", "parallel-or-perpendicular-classify", "distance-time-graph-read",
  ],
  "HT5 · Week 3 (26/04/27) — Basic Probability, Mutually Exclusive and Expected Outcomes, … (W2)": [
    "probability-scale-words", "mutually-exclusive-missing-probability", "combinations-list-two-groups", "theoretical-probability-single", "expected-value-biased", "product-rule-counting",
  ],
  "HT5 · Week 4 (03/05/27) — Probability Tree, Venn Diagram, Set Notation": [
    "tree-replacement", "venn-complete", "set-notation-list", "tree-no-replacement", "venn-prob-only", "set-notation-membership",
  ],
  "HT5 · Week 5 (10/05/27) — Translation, Reflection, Rotation": [
    "transform-translate-shape", "transform-reflect-shape", "transform-rotate-shape",
  ],
  "HT5 · Week 6 (17/05/27) — Enlargement, Congruence and Similarity": [
    "transform-enlarge-shape", "congruence-criteria", "similar-shapes-identify",
  ],
  "HT5 · Week 7 (24/05/27) — Similar Shapes, Column Vectors": [
    "similar-shapes-find-length", "similar-shapes-area-scale", "vectors-column-arithmetic", "similar-shapes-volume-scale",
  ],
  "HT6 · Week 1 (07/06/27) — Vectors and 2D Shapes, Sim Equ (W1)": [
    "vectors-negative-scalar-multiply", "simultaneous-linear-basic", "simultaneous-linear-scale-one", "vectors-equal-parallel",
  ],
  "HT6 · Week 2 (14/06/27) — Sim Equ (W2)": [
    "simultaneous-linear-scaling", "simultaneous-equations-word-problem",
  ],
};

const Y10_SET3_WEEKS = {
  "HT1 · Week 1 (07/09/26) — Two-way tables": [
    "two-way-table-complete", "ungrouped-freq-table-form",
  ],
  "HT1 · Week 2 (14/09/26) — Frequency trees, Rounding & estimation (W1)": [
    "frequency-tree-complete", "round-decimal-places",
  ],
  "HT1 · Week 3 (21/09/26) — Rounding & estimation (W2), Using a calculator": [
    "round-significant-figures", "estimation-calculation", "round-error-interval", "calculator-fractions", "calculator-powers-roots", "calculator-nested-rounding",
  ],
  "HT1 · Week 4 (28/09/26) — Factors & multiples (W1)": [
    "fmp-list-factors", "fmp-list-multiples",
  ],
  "HT1 · Week 5 (05/10/26) — Factors & multiples (W2), Fractions (W1)": [
    "number-properties-prime-or-composite", "fmp-prime-factorisation", "fmp-hcf-lcm", "frac-simplify", "fmp-lcm",
  ],
  "HT1 · Week 6 (12/10/26) — Fractions (W2)": [
    "frac-compare-different-denom", "frac-add-same-denom", "frac-subtract-different-denom", "frac-add-mixed-numbers", "frac-improper-mixed-convert", "frac-add-different-denom",
  ],
  "HT1 · Week 7 (19/10/26) — Fractions (W3), Ratio (W1)": [
    "frac-divide-fraction-by-fraction", "ratio-simplify", "ratio-share-amount", "frac-of-amount",
  ],
  "HT2 · Week 1 (09/11/26) — Ratio (W2)": [
    "ratio-total-parts", "ratio-quantity-one-part-given", "ratio-to-fraction", "fraction-to-ratio", "ratio-quantity-difference-given",
  ],
  "HT2 · Week 2 (16/11/26) — Ratio (W3), Proportion (W1)": [
    "ratio-combine-two", "ratio-to-percentage", "multiplicative-recipe-scaling", "direct-proportion", "percentage-to-ratio",
  ],
  "HT2 · Week 3 (23/11/26) — Proportion (W2)": [
    "multiplicative-best-value", "conversion-graph-read", "inverse-proportion", "applied-proportion-graph",
  ],
  "HT2 · Week 4 (30/11/26) — Proportion (W3), Percentages (W1)": [
    "compound-measures-calc", "percent-of-amount", "percent-one-of-another", "percent-simple-interest",
  ],
  "HT2 · Week 5 (07/12/26) — Percentages (W2)": [
    "percent-compound-increase", "percent-reverse", "percent-reverse-after-increase",
  ],
  "HT3 · Week 1 (04/01/27) — Algebra basics (W1)": [
    "algebraic-notation-write", "collect-like-terms-multi",
  ],
  "HT3 · Week 2 (11/01/27) — Algebra basics (W2)": [
    "multiply-algebraic-terms", "substitution-one-variable", "eb-single-pos", "eb-single-neg", "divide-algebraic-terms-basic", "fac-common",
  ],
  "HT3 · Week 3 (18/01/27) — Equations & changing the subject (W1)": [
    "solve-two-step-equation", "solve-equation-negative-coefficient", "solve-equation-both-sides-brackets",
  ],
  "HT3 · Week 4 (25/01/27) — Equations & changing the subject (W2)": [
    "form-equation-angles", "form-solve-perimeter-equation", "solve-equation-fractions", "changing-subject-expand",
  ],
  "HT3 · Week 5 (01/02/27) — Sequences (W1)": [
    "generate-terms-from-nth-term", "arithmetic-sequence-nth-term-value",
  ],
  "HT3 · Week 6 (08/02/27) — Sequences (W2), Quadratics (W1)": [
    "find-nth-term-linear", "quadratic-sequences", "eb-double-pos",
  ],
  "HT4 · Week 1 (22/02/27) — Quadratics (W2)": [
    "eb-double-mixed", "fac-quadratic", "fac-dots", "solve-quadratic-factorise",
  ],
  "HT4 · Week 2 (01/03/27) — Indices": [
    "powers-laws-multiply", "indices-divide-same-base", "indices-power-of-power-numeric", "indices-negative",
  ],
  "HT4 · Week 3 (08/03/27) — Standard form (W1)": [
    "sf-large-to-sf", "sf-small-to-sf", "sf-small-to-ordinary", "sf-multiply", "sf-compare-order",
  ],
  "HT4 · Week 4 (15/03/27) — Standard form (W2), Averages (W1)": [
    "sf-divide", "averages-range-listed", "averages-missing-value-given-mean", "sf-add-subtract",
  ],
  "HT4 · Week 5 (22/03/27) — Averages (W2)": [
    "ungrouped-frequency-table-mean", "grouped-table-modal-median-class", "mean-from-grouped-table",
  ],
  "HT5 · Week 1 (12/04/27) — Representing data (W1)": [
    "bar-chart-read-frequency", "pie-chart-angle-to-frequency", "scatter-correlation-type", "line-of-best-fit-estimate",
  ],
  "HT5 · Week 2 (19/04/27) — Representing data (W2), Angles (W1)": [
    "moving-average-calc", "ungrouped-freq-table-form", "angles-on-a-line", "angles-about-a-point",
  ],
  "HT5 · Week 3 (26/04/27) — Angles (W2)": [
    "angles-vertically-opposite", "angles-isosceles-triangle", "angles-corresponding", "angles-interior-polygon-sum", "angles-triangle-sum", "angles-quadrilateral-sum",
  ],
  "HT5 · Week 4 (03/05/27) — Bearings & scales (W1)": [
    "bearings-find", "bearings-back-bearing",
  ],
  "HT5 · Week 5 (10/05/27) — Bearings & scales (W2), Pythagoras (W1)": [
    "bearings-back-bearing", "pythagoras-hypotenuse", "pythagoras-shorter-side",
  ],
  "HT5 · Week 6 (17/05/27) — Pythagoras (W2)": [
    "pythagoras-distance-between-points",
  ],
};

const Y10_SET4_WEEKS = {
  "HT1 · Week 1 (07/09/26) — Integers & place value (W1)": [
    "place-value-digit-value", "number-properties-next-even-odd", "addsub-word-problem", "multiply-two-two-digit",
  ],
  "HT1 · Week 2 (14/09/26) — Integers & place value (W2)": [
    "divide-with-remainder-decimal", "bidmas-two-operations", "neg-order", "neg-difference",
  ],
  "HT1 · Week 3 (21/09/26) — Integers & place value (W3), Decimals (W1)": [
    "neg-multiply", "neg-divide", "order-decimals",
  ],
  "HT1 · Week 4 (28/09/26) — Decimals (W2)": [
    "decimal-add-different-dp", "decimal-subtract-different-dp", "decimal-multiply-by-integer",
  ],
  "HT1 · Week 5 (05/10/26) — Decimals (W3), Indices, powers & roots (W1)": [
    "decimal-multiply-decimal-by-decimal", "decimal-divide-by-decimal", "number-properties-square-or-cube", "decimal-divide-integer-by-decimal",
  ],
  "HT1 · Week 6 (12/10/26) — Indices, powers & roots (W2)": [
    "powers-laws-multiply", "indices-divide-same-base", "indices-power-of-power-numeric", "bidmas-with-powers",
  ],
  "HT1 · Week 7 (19/10/26) — Indices, powers & roots (W3), Factors, multiples & primes (W1)": [
    "calculator-powers-roots", "fmp-list-factors", "fmp-list-multiples",
  ],
  "HT2 · Week 1 (09/11/26) — Factors, multiples & primes (W2)": [
    "fmp-common-factors", "fmp-prime-factorisation", "fmp-hcf-lcm", "number-properties-prime-or-composite", "fmp-lcm",
  ],
  "HT2 · Week 2 (16/11/26) — Fractions (W1)": [
    "frac-simplify", "frac-improper-mixed-convert", "frac-add-different-denom", "frac-add-mixed-numbers", "frac-compare-different-denom", "frac-add-same-denom",
  ],
  "HT2 · Week 3 (23/11/26) — Fractions (W2), Fractions, decimals & percentages (W1)": [
    "frac-divide-fraction-by-fraction", "fdp-percent-to-decimal", "frac-of-amount",
  ],
  "HT2 · Week 4 (30/11/26) — Fractions, decimals & percentages (W2)": [
    "fdp-order-mixed", "fdp-fraction-to-recurring",
  ],
  "HT3 · Week 1 (04/01/27) — Percentages (W1)": [
    "percent-of-amount", "percent-one-of-another",
  ],
  "HT3 · Week 2 (11/01/27) — Percentages (W2)": [
    "percent-simple-interest", "percent-compound-increase", "percent-reverse", "percent-reverse-after-increase",
  ],
  "HT3 · Week 3 (18/01/27) — Ratio (W1)": [
    "ratio-simplify", "ratio-total-parts", "ratio-quantity-difference-given", "fraction-to-ratio", "ratio-share-amount", "ratio-quantity-one-part-given",
  ],
  "HT3 · Week 4 (25/01/27) — Ratio (W2), Proportion (W1)": [
    "ratio-to-percentage", "multiplicative-recipe-scaling", "direct-proportion", "multiplicative-best-value", "percentage-to-ratio", "conversion-graph-read",
  ],
  "HT3 · Week 5 (01/02/27) — Proportion (W2), Simple algebra (W1)": [
    "inverse-proportion", "applied-proportion-graph", "algebraic-notation-write", "compound-measures-calc",
  ],
  "HT3 · Week 6 (08/02/27) — Simple algebra (W2)": [
    "collect-like-terms-multi", "divide-algebraic-terms-basic", "substitution-one-variable", "eb-single-neg", "multiply-algebraic-terms", "eb-single-pos",
  ],
  "HT4 · Week 1 (22/02/27) — Substitution & equations (W1)": [
    "substitution-one-variable", "substitution-formula-negatives", "solve-two-step-equation",
  ],
  "HT4 · Week 2 (01/03/27) — Substitution & equations (W2), Sequences (W1)": [
    "solve-equation-both-sides-brackets", "form-solve-perimeter-equation", "generate-terms-from-nth-term", "arithmetic-sequence-nth-term-value", "form-equation-angles",
  ],
  "HT4 · Week 3 (08/03/27) — Sequences (W2), Averages (W1)": [
    "find-nth-term-linear", "quadratic-sequences", "averages-range-listed",
  ],
  "HT4 · Week 4 (15/03/27) — Averages (W2)": [
    "averages-missing-value-given-mean", "ungrouped-frequency-table-mean", "grouped-table-modal-median-class", "mean-from-grouped-table",
  ],
  "HT4 · Week 5 (22/03/27) — Tables & data collection (W1)": [
    "ungrouped-freq-table-form", "two-way-table-complete", "timetable-read", "bar-chart-read-frequency",
  ],
  "HT5 · Week 1 (12/04/27) — Tables & data collection (W2)": [
    "pie-chart-angle-to-frequency", "scatter-correlation-type", "line-of-best-fit-estimate", "stratified-sample-one-category",
  ],
  "HT5 · Week 2 (19/04/27) — Tables & data collection (W3), Measurements & units (W1)": [
    "frequency-tree-complete", "suitable-unit-estimate", "metric-conversion",
  ],
  "HT5 · Week 3 (26/04/27) — Measurements & units (W2)": [
    "clock-reading", "time-duration-calc", "conversion-graph-read", "compound-measures-calc",
  ],
  "HT5 · Week 4 (03/05/27) — 2D shapes (W1)": [
    "shape-naming-polygon-by-sides", "shape-properties-quadrilateral-name",
  ],
  "HT5 · Week 5 (10/05/27) — 2D shapes (W2), Angles (W1)": [
    "shape-properties-quadrilateral-name", "shape-properties-symmetry", "angles-on-a-line", "angles-about-a-point",
  ],
  "HT5 · Week 6 (17/05/27) — Angles (W2)": [
    "angles-vertically-opposite", "angles-isosceles-triangle", "angles-corresponding", "angles-interior-polygon-sum", "angles-triangle-sum", "angles-quadrilateral-sum",
  ],
  "HT5 · Week 7 (24/05/27) — Perimeter & area (W1)": [
    "area-rectangle-triangle", "composite-rectilinear-area-perimeter",
  ],
  "HT6 · Week 1 (07/06/27) — Perimeter & area (W2), 3D forms": [
    "circle-facts-parts", "circle-facts-circumference-area", "three-d-faces-edges-vertices", "volume-cuboid", "three-d-name-from-properties", "surface-area-cuboid",
  ],
  "HT6 · Week 2 (14/06/27) — Probability (W1)": [
    "probability-scale-words", "probability-scale-compare", "theoretical-probability-single", "theoretical-probability-not-event",
  ],
  "HT6 · Week 3 (21/06/27) — Probability (W2)": [
    "mutually-exclusive-missing-probability", "relative-frequency-from-data", "expected-value-biased",
  ],
};

/* Year 7 scheme of work — follows the White Rose Year 7 overview (12 weeks per
   term) and the Year 7 booklets. The timeline gives week numbers, not dates, so
   keys are labelled by term and week. A few extension steps from the overview
   (powers of 10 / standard form, multiplying by 0.1, percentages above 100%,
   parallel-line angles, etc.) sit at the end of their week's list. */
const Y7_WEEKS = {
  "Autumn · Week 1 — Sequences (W1)": [
    "seq-pattern-draw-next", "seq-continue-linear", "seq-term-to-term-rule", "seq-predict-pattern-term", "seq-linear-or-not",
  ],
  "Autumn · Week 2 — Sequences (W2)": [
    "seq-pattern-count-terms", "seq-linear-or-not", "seq-geometric-next", "seq-missing-terms-linear", "seq-continue-linear", "seq-term-to-term-rule",
  ],
  "Autumn · Week 3 — Algebraic notation and substitution (W1)": [
    "function-machine-output", "function-machine-input", "function-machine-expression", "algebraic-notation-write",
  ],
  "Autumn · Week 4 — Algebraic notation and substitution (W2)": [
    "function-machine-find-operation", "function-machine-expression", "substitution-one-variable", "substitution-two-variables", "algebraic-notation-index-form", "multiply-algebraic-terms",
  ],
  "Autumn · Week 5 — Expressions and equations (W1)": [
    "equivalent-expression-choose", "like-terms-identify", "collect-like-terms-multi", "solve-one-step-equation",
  ],
  "Autumn · Week 6 — Expressions and equations (W2)": [
    "collect-like-terms-multi", "solve-one-step-equation", "solve-two-step-equation", "form-solve-perimeter-equation",
  ],
  "Autumn · Week 7 — Place value, ordering and rounding (W1)": [
    "place-value-digit-value", "place-value-write-in-words", "number-line-interval-value", "order-decimals", "round-nearest-power-of-ten",
  ],
  "Autumn · Week 8 — Place value, ordering and rounding (W2)": [
    "order-decimals", "number-line-interval-value", "round-nearest-power-of-ten", "round-decimal-places", "sf-large-to-sf", "sf-small-to-sf",
  ],
  "Autumn · Week 9 — Four operations (W1)": [
    "decimal-add-different-dp", "decimal-subtract-different-dp", "multiply-divide-by-powers-of-10", "multiply-two-two-digit", "divide-integer-written", "addsub-word-problem",
  ],
  "Autumn · Week 10 — Four operations (W2)": [
    "decimal-multiply-by-integer", "decimal-multiply-decimal-by-decimal", "decimal-divide-by-integer", "bidmas-two-operations", "bidmas-with-powers", "multiply-divide-by-0.1-0.01",
  ],
  "Autumn · Week 11 — Averages and range": [
    "averages-range-listed", "averages-four-measures", "averages-missing-value-given-mean",
  ],
  "Autumn · Week 12 — Rounding and estimation": [
    "round-significant-figures", "round-decimal-places", "estimation-calculation", "estimate-over-under", "round-error-interval",
  ],
  "Spring · Week 1 — Graphing data (W1)": [
    "bar-chart-read-frequency", "pie-chart-angle-to-frequency", "pie-chart-angle-from-frequency", "coordinates-identify-point",
  ],
  "Spring · Week 2 — Graphing data (W2)": [
    "coordinates-identify-point", "coordinates-midpoint-calc", "bar-chart-read-frequency", "scatter-correlation-type",
  ],
  "Spring · Week 3 — Graphing data (W3)": [
    "scatter-correlation-type", "line-of-best-fit-estimate", "pie-chart-angle-to-frequency", "bar-chart-read-frequency",
  ],
  "Spring · Week 4 — Fractions, decimals and percentages (W1)": [
    "frac-simplify", "equivalent-fraction-missing", "fdp-convert-fraction-decimal-percentage", "fdp-percent-to-decimal",
  ],
  "Spring · Week 5 — Fractions, decimals and percentages (W2)": [
    "fraction-as-division", "fdp-convert-fraction-decimal-percentage", "frac-compare-different-denom", "fdp-order-mixed",
  ],
  "Spring · Week 6 — Fractions, decimals and percentages (W3)": [
    "fdp-order-mixed", "frac-of-amount", "fdp-convert-fraction-decimal-percentage", "frac-improper-mixed-convert",
  ],
  "Spring · Week 7 — Directed number (W1)": [
    "neg-order", "neg-add-subtract", "neg-missing-number", "neg-difference", "neg-mixed-word-problem",
  ],
  "Spring · Week 8 — Directed number (W2)": [
    "neg-add-subtract", "neg-multiply", "neg-divide", "neg-bidmas", "neg-missing-number",
  ],
  "Spring · Week 9 — Fractions and percentages of amounts (W1)": [
    "frac-of-amount", "fraction-find-whole", "percent-of-amount-mental", "percent-of-amount",
  ],
  "Spring · Week 10 — Fractions and percentages of amounts (W2)": [
    "percent-of-amount-mental", "percent-increase-decrease", "percent-find-whole", "percent-above-100",
  ],
  "Spring · Week 11 — Perimeter and area (W1)": [
    "metric-conversion", "perimeter-polygon-calc", "area-rectangle-triangle", "area-parallelogram", "area-triangle-base-height",
  ],
  "Spring · Week 12 — Perimeter and area (W2)": [
    "area-trapezium", "composite-rectilinear-area-perimeter", "measures-convert-area-units", "form-solve-perimeter-equation", "area-parallelogram",
  ],
  "Summer · Week 1 — Speed, distance and time (W1)": [
    "time-units-convert", "time-duration-calc", "timetable-read", "speed-calc",
  ],
  "Summer · Week 2 — Speed, distance and time (W2)": [
    "speed-calc", "distance-calc", "time-calc", "compound-measures-calc",
  ],
  "Summer · Week 3 — Speed, distance and time (W3)": [
    "distance-time-graph-read", "speed-calc", "distance-calc", "time-calc", "time-duration-calc",
  ],
  "Summer · Week 4 — Properties of number (W1)": [
    "fmp-list-multiples", "fmp-list-factors", "number-properties-prime-or-composite", "fmp-common-factors",
  ],
  "Summer · Week 5 — Properties of number (W2)": [
    "fmp-prime-factorisation", "number-properties-square-or-cube", "roots-evaluate", "triangular-numbers",
  ],
  "Summer · Week 6 — Properties of number (W3)": [
    "fmp-hcf-lcm", "fmp-lcm", "fmp-common-factors", "fmp-prime-factorisation", "number-properties-classify",
  ],
  "Summer · Week 7 — Add and subtract fractions (W1)": [
    "frac-simplify", "equivalent-fraction-missing", "frac-improper-mixed-convert", "frac-add-same-denom",
  ],
  "Summer · Week 8 — Add and subtract fractions (W2)": [
    "frac-add-same-denom", "frac-add-different-denom", "frac-subtract-different-denom", "frac-compare-different-denom",
  ],
  "Summer · Week 9 — Add and subtract fractions (W3)": [
    "frac-add-mixed-numbers", "frac-subtract-mixed-numbers-exchange", "frac-add-different-denom", "frac-subtract-different-denom", "frac-improper-mixed-convert",
  ],
  "Summer · Week 10 — Angles and polygons (W1)": [
    "angle-type-name", "geometric-notation-naming", "angles-about-a-point", "angles-on-a-line", "angles-vertically-opposite",
  ],
  "Summer · Week 11 — Angles and polygons (W2)": [
    "angles-triangle-sum", "angles-isosceles-triangle", "triangle-classify", "angles-quadrilateral-sum", "shape-properties-quadrilateral-name", "angles-parallelogram",
  ],
  "Summer · Week 12 — Angles and polygons (W3)": [
    "angles-interior-polygon-sum", "angles-missing-in-polygon", "shape-naming-polygon-by-sides", "angles-exterior-regular-polygon", "angles-alternate", "angles-co-interior",
  ],
};

/* Year 8 scheme of work — follows the White Rose Year 8 overview (12 teaching
   weeks per term) and the Year 8 booklets. The timeline has week numbers, not
   dates, so keys are labelled by term and week; topics over several weeks are
   labelled (W1), (W2), (W3). Extension steps sit at the end of their week. */
const Y8_WEEKS = {
  "Autumn · Week 1 — Ratio (W1)": ["ratio-simplify", "ratio-bar-model", "ratio-share-amount", "ratio-total-parts", "ratio-quantity-one-part-given"],
  "Autumn · Week 2 — Ratio (W2)": ["ratio-quantity-difference-given", "ratio-one-to-n", "ratio-to-fraction", "fraction-to-ratio", "ratio-combine-two"],
  "Autumn · Week 3 — Proportion and scale (W1)": ["direct-proportion", "conversion-graph-read", "currency-convert", "multiplicative-recipe-scaling", "multiplicative-best-value"],
  "Autumn · Week 4 — Proportion and scale (W2)": ["similar-shapes-find-length", "similar-shapes-identify", "scale-map-distance", "metric-conversion"],
  "Autumn · Week 5 — Algebraic manipulation (W1)": ["alg-classify-type", "form-expression-perimeter", "collect-like-terms-multi", "multiply-algebraic-terms", "divide-algebraic-terms-basic"],
  "Autumn · Week 6 — Algebraic manipulation (W2)": ["alg-directed-simplify", "substitution-formula-negatives", "eb-single-pos", "eb-single-neg", "fac-common", "eb-double-pos"],
  "Autumn · Week 7 — Coordinates and graphs (W1)": ["coordinates-identify-point", "coord-fourth-vertex", "line-equation-axis-parallel", "line-table-of-values"],
  "Autumn · Week 8 — Coordinates and graphs (W2)": ["line-table-of-values", "line-gradient-intercept-read", "line-equation-from-graph", "line-equation-axis-parallel"],
  "Autumn · Week 9 — Coordinates and graphs (W3)": ["line-gradient-intercept-read", "line-equation-from-graph", "coordinates-midpoint-calc"],
  "Autumn · Week 10 — Multiply and divide fractions (W1)": ["frac-multiply-integer", "frac-multiply-two", "frac-divide-by-integer", "frac-reciprocal"],
  "Autumn · Week 11 — Multiply and divide fractions (W2)": ["frac-divide-fraction-by-fraction", "frac-multiply-mixed", "frac-reciprocal", "frac-improper-mixed-convert", "algebraic-fractions-muldiv"],
  "Autumn · Week 12 — Symmetry and reflection": ["symmetry-lines-rotation", "shape-properties-symmetry", "transform-reflect-shape", "describe-reflection"],
  "Spring · Week 1 — Area, volume and density (W1)": ["solid-name-identify", "shape-naming-polygon-by-sides", "shape-properties-quadrilateral-name", "area-parallelogram", "area-triangle-base-height", "area-trapezium"],
  "Spring · Week 2 — Area, volume and density (W2)": ["three-d-faces-edges-vertices", "volume-cuboid", "capacity-mass-convert", "density-calc", "density-find-mass-volume"],
  "Spring · Week 3 — Equations and inequalities (W1)": ["solve-one-step-equation", "solve-two-step-equation", "solve-linear-brackets", "solve-equation-fractions", "solve-equation-both-sides-brackets"],
  "Spring · Week 4 — Equations and inequalities (W2)": ["inequality-list-integers", "inequality-from-number-line", "inequality-double-sided", "ineq-represent-number-line", "inequality-linear-twostep", "inequality-both-sides"],
  "Spring · Week 5 — Percentages (W1)": ["fdp-percent-to-decimal", "percent-of-amount", "percent-multiplier", "percent-increase-decrease"],
  "Spring · Week 6 — Percentages (W2)": ["percent-multiplier", "percent-one-of-another", "percent-change-find", "percent-compound-increase"],
  "Spring · Week 7 — Percentages (W3)": ["percent-change-find", "percent-reverse", "percent-reverse-after-increase", "percent-simple-interest"],
  "Spring · Week 8 — Indices (W1)": ["index-notation-evaluate", "algebraic-notation-index-form", "indices-simplify-algebra", "powers-laws-multiply", "indices-divide-same-base"],
  "Spring · Week 9 — Indices (W2)": ["indices-simplify-algebra", "indices-power-of-a-power", "indices-negative", "indices-fractional", "roots-evaluate"],
  "Spring · Week 10 — Standard form": ["sf-large-to-sf", "sf-small-to-sf", "sf-large-to-ordinary", "sf-small-to-ordinary", "sf-compare-order"],
  "Spring · Week 11 — Interpret and represent data (W1)": ["averages-range-listed", "averages-four-measures", "outlier-dotplot", "bar-chart-read-frequency"],
  "Spring · Week 12 — Interpret and represent data (W2)": ["ungrouped-frequency-table-mean", "compare-distributions", "averages-missing-value-given-mean", "mean-from-grouped-table", "grouped-table-modal-median-class"],
  "Summer · Week 1 — Angles in parallel lines and polygons (W1)": ["angles-on-a-line", "angles-about-a-point", "angles-vertically-opposite", "angles-triangle-sum", "angles-alternate", "angles-corresponding"],
  "Summer · Week 2 — Angles in parallel lines and polygons (W2)": ["angles-co-interior", "angles-parallel-lines-two-step", "angles-parallel-algebra", "angles-isosceles-triangle", "angles-parallelogram", "angles-trapezium"],
  "Summer · Week 3 — Angles in parallel lines and polygons (W3)": ["angles-quadrilateral-sum", "angles-interior-polygon-sum", "angles-exterior-regular-polygon", "angles-interior-regular-polygon", "angles-polygon-sides-from-angle", "angles-polygon-algebra"],
  "Summer · Week 4 — Tables and probability (W1)": ["probability-scale-words", "probability-scale-compare", "theoretical-probability-single", "theoretical-probability-not-event", "mutually-exclusive-missing-probability"],
  "Summer · Week 5 — Tables and probability (W2)": ["relative-frequency-from-data", "expected-value-biased", "sample-space-spinners", "combinations-list-two-groups"],
  "Summer · Week 6 — Tables and probability (W3)": ["two-way-table-complete", "two-way-table-probability", "frequency-tree-complete", "sample-space-spinners"],
  "Summer · Week 7 — Circles (W1)": ["circle-facts-parts", "circle-facts-circumference-area"],
  "Summer · Week 8 — Circles (W2)": ["circle-arc-sector", "circle-compound", "circle-facts-circumference-area"],
  "Summer · Week 9 — Graphs and charts (W1)": ["bar-chart-read-frequency", "pie-chart-angle-from-frequency", "pie-chart-angle-to-frequency", "misleading-bar-chart"],
  "Summer · Week 10 — Graphs and charts (W2)": ["scatter-correlation-type", "line-of-best-fit-estimate", "misleading-bar-chart", "pie-chart-angle-from-frequency"],
  "Summer · Week 11 — Sequences": ["seq-pattern-nth-term", "generate-terms-from-nth-term", "find-nth-term-linear", "seq-is-term-of-sequence", "seq-term-to-term-rule"],
  "Summer · Week 12 — Sequences consolidation": ["find-nth-term-linear", "seq-pattern-nth-term", "seq-is-term-of-sequence", "arithmetic-sequence-nth-term-value", "seq-missing-terms-linear"],
};

/* ---- Year 9 (2026/27) schemes of work, from "Year 9 (Y9) Timelines 26-27.xlsx" (Sets 1-3; the spreadsheet's Set 3 and Set 4 tabs are identical, so Set 3 covers both).
   Same shape as the Year 10 tables: one entry per teaching week, listing the subtopics that week's lessons cover; quiz, revision, assessment,
   INSET and buffer lessons carry no questions, and weeks with no teaching lessons are left out. Units that run for several weeks are
   labelled (W1), (W2)... Lessons with no matching question type yet (constructions, loci) fall back to the nearest available topics. ---- */
const Y9_SET1_WEEKS = {
  "HT1 · Week 1 (07/09/26) — Rounding and Estimating, LCM/HCF": ["round-decimal-places", "fmp-prime-factorisation", "round-significant-figures", "fmp-hcf-lcm", "estimation-calculation", "fmp-lcm"],
  "HT1 · Week 2 (14/09/26) — Fractions, Ratio and Proportion (W1)": ["frac-add-different-denom", "ratio-simplify", "frac-subtract-different-denom", "ratio-one-to-n", "frac-multiply-two", "frac-divide-fraction-by-fraction"],
  "HT1 · Week 3 (21/09/26) — Ratio and Proportion (W2)": ["ratio-one-to-n", "ratio-share-amount", "ratio-quantity-one-part-given", "ratio-quantity-difference-given", "ratio-combine-two", "direct-proportion"],
  "HT1 · Week 4 (28/09/26) — Ratio and Proportion (W3)": ["currency-convert", "multiplicative-recipe-scaling", "inverse-proportion", "multiplicative-best-value", "ratio-to-fraction"],
  "HT1 · Week 5 (05/10/26) — Percentages (W1)": ["percent-of-amount", "percent-one-of-another", "percent-increase-decrease", "percent-change-find"],
  "HT1 · Week 6 (12/10/26) — Percentages (W2)": ["percent-multiplier", "percent-reverse", "percent-simple-interest", "percent-compound-increase"],
  "HT1 · Week 7 (19/10/26) — Expand, Factorise and Simplify (W1)": ["collect-like-terms-multi", "multiply-algebraic-terms", "eb-single-pos", "eb-single-neg", "eb-single-term-outside", "eb-double-pos"],
  "HT2 · Week 1 (09/11/26) — Expand, Factorise and Simplify (W2), Equations and Sequences (W1)": ["fac-common-algebraic", "solve-one-step-equation", "fac-quadratic", "solve-two-step-equation", "fac-dots", "fac-quadratic-agt1"],
  "HT2 · Week 2 (16/11/26) — Equations and Sequences (W2)": ["solve-two-step-equation", "solve-linear-brackets", "solve-equation-both-sides-brackets", "seq-continue-linear", "seq-term-to-term-rule", "find-nth-term-linear"],
  "HT2 · Week 3 (23/11/26) — Equations and Sequences (W3), Index Laws and Standard Form (W1)": ["arithmetic-sequence-nth-term-value", "powers-laws-multiply", "seq-is-term-of-sequence", "indices-power-of-a-power", "indices-divide-same-base", "indices-negative"],
  "HT2 · Week 4 (30/11/26) — Index Laws and Standard Form (W2)": ["indices-negative", "sf-large-to-sf", "sf-small-to-sf", "sf-multiply", "sf-divide", "sf-add-subtract"],
  "HT3 · Week 1 (04/01/27) — Averages (W1)": ["averages-range-listed", "averages-four-measures", "ungrouped-frequency-table-mean"],
  "HT3 · Week 2 (11/01/27) — Averages (W2), Representing Data (W1)": ["ungrouped-frequency-table-mean", "bar-chart-read-frequency", "mean-from-grouped-table", "pie-chart-angle-from-frequency", "grouped-table-modal-median-class", "pie-chart-angle-to-frequency"],
  "HT3 · Week 3 (18/01/27) — Representing Data (W2), Angles (W1)": ["scatter-correlation-type", "angles-on-a-line", "line-of-best-fit-estimate", "angles-about-a-point", "misleading-bar-chart", "angles-vertically-opposite"],
  "HT3 · Week 4 (25/01/27) — Angles (W2)": ["angles-vertically-opposite", "angles-triangle-sum", "angles-alternate", "angles-corresponding", "angles-co-interior", "angles-parallel-lines-two-step"],
  "HT3 · Week 5 (01/02/27) — Bearings, Loci and Constructions (W1)": ["bearings-find", "bearings-back-bearing"],
  "HT3 · Week 6 (08/02/27) — Bearings, Loci and Constructions (W2)": ["bearings-back-bearing", "scale-map-distance"],
  "HT4 · Week 1 (22/02/27) — Right Angle Triangles (W1)": ["pythagoras-hypotenuse", "pythagoras-shorter-side", "pythagoras-converse-test", "pythagoras-distance-between-points", "trig-find-side", "trig-find-angle"],
  "HT4 · Week 2 (01/03/27) — Right Angle Triangles (W2), Circles and Sectors (W1)": ["trig-find-angle", "circle-facts-parts", "trig-exact-values", "trig-elevation-depression"],
  "HT4 · Week 3 (08/03/27) — Circles and Sectors (W2)": ["circle-facts-circumference-area", "circle-arc-sector", "circle-compound"],
  "HT4 · Week 4 (15/03/27) — 3D Shapes": ["three-d-faces-edges-vertices", "solid-name-identify", "volume-cuboid", "volume-triangular-prism", "volume-cylinder", "surface-area-cuboid"],
  "HT4 · Week 5 (22/03/27) — Compound Measure (W1)": ["speed-calc", "distance-calc", "time-calc", "density-calc", "density-find-mass-volume"],
  "HT5 · Week 1 (12/04/27) — Compound Measure (W2), Coordinate Geometry (W1)": ["density-find-mass-volume", "coordinates-midpoint-calc", "compound-measures-calc", "line-table-of-values", "line-equation-from-graph", "line-gradient-intercept-read"],
  "HT5 · Week 2 (19/04/27) — Coordinate Geometry (W2), Simultaneous Equations (W1)": ["line-gradient-intercept-read", "simultaneous-linear-basic", "equation-from-gradient-and-point", "linear-graph-two-points", "linear-graph-parallel"],
  "HT5 · Week 3 (26/04/27) — Simultaneous Equations (W2)": ["simultaneous-linear-scale-one", "simultaneous-linear-scaling", "simultaneous-equations-word-problem"],
  "HT5 · Week 4 (03/05/27) — Transformations (W1)": ["transform-reflect-shape", "describe-reflection", "transform-translate-shape", "transform-rotate-shape"],
  "HT5 · Week 5 (10/05/27) — Transformations (W2), Probability (W1)": ["transform-enlarge-shape", "probability-scale-words", "theoretical-probability-single", "theoretical-probability-not-event", "mutually-exclusive-missing-probability", "expected-value-biased"],
  "HT5 · Week 6 (17/05/27) — Probability (W2), Venn Diagrams": ["sample-space-spinners", "set-notation-membership", "tree-replacement", "venn-complete", "venn-shade", "venn-prob-only"],
};
const Y9_SET2_WEEKS = {
  "HT1 · Week 1 (07/09/26) — Two-Way Tables & Frequency Trees, Rounding & Estimation (W1)": ["two-way-table-complete", "round-decimal-places", "frequency-tree-complete", "round-significant-figures", "two-way-table-probability"],
  "HT1 · Week 2 (14/09/26) — Rounding & Estimation (W2), Factors, Multiples & Primes": ["round-error-interval", "fmp-prime-factorisation", "estimation-calculation", "number-properties-classify", "bounds-intro", "number-properties-square-or-cube"],
  "HT1 · Week 3 (21/09/26) — HCF & LCM, Fractions (W1)": ["fmp-list-factors", "frac-simplify", "fmp-hcf-lcm", "frac-of-amount", "fmp-common-factors", "frac-compare-different-denom"],
  "HT1 · Week 4 (28/09/26) — Fractions (W2)": ["frac-add-different-denom", "frac-multiply-two", "frac-subtract-different-denom", "frac-multiply-mixed", "frac-add-mixed-numbers", "frac-divide-fraction-by-fraction"],
  "HT1 · Week 5 (05/10/26) — Ratio": ["ratio-simplify", "ratio-share-amount", "ratio-combine-two", "ratio-to-fraction", "ratio-one-to-n", "ratio-quantity-one-part-given"],
  "HT1 · Week 6 (12/10/26) — Proportion": ["direct-proportion", "multiplicative-recipe-scaling", "currency-convert", "inverse-proportion", "multiplicative-best-value"],
  "HT1 · Week 7 (19/10/26) — Calculator Skills, Percentages (W1)": ["bidmas-two-operations", "percent-one-of-another", "calculator-fractions", "percent-reverse", "percent-of-amount-mental", "percent-find-whole"],
  "HT2 · Week 1 (09/11/26) — Percentages (W2)": ["percent-increase-decrease", "percent-simple-interest", "percent-change-find", "percent-multiplier"],
  "HT2 · Week 2 (16/11/26) — Algebra (W1)": ["collect-like-terms-multi", "multiply-algebraic-terms", "eb-single-pos", "eb-double-pos", "like-terms-identify", "divide-algebraic-terms-basic"],
  "HT2 · Week 3 (23/11/26) — Algebra (W2)": ["fac-common", "fac-quadratic", "substitution-one-variable", "fac-common-algebraic", "fac-quadratic-agt1", "substitution-two-variables"],
  "HT2 · Week 4 (30/11/26) — Equations": ["solve-one-step-equation", "solve-two-step-equation", "solve-linear-brackets", "solve-equation-both-sides-brackets"],
  "HT2 · Week 5 (07/12/26) — Quadratic Equations": ["solve-quadratic-factorise", "solve-quadratic-factorise-agt1"],
  "HT3 · Week 1 (04/01/27) — Changing the Subject": ["changing-subject-expand", "rearrange-square-root", "rearrange-square", "changing-subject-factorise"],
  "HT3 · Week 2 (11/01/27) — Sequences (W1)": ["seq-continue-linear", "find-nth-term-linear", "generate-terms-from-nth-term", "seq-term-to-term-rule", "arithmetic-sequence-nth-term-value", "seq-missing-terms-linear"],
  "HT3 · Week 3 (18/01/27) — Sequences (W2), Indices & Standard Form (W1)": ["seq-pattern-draw-next", "powers-laws-multiply", "seq-pattern-count-terms", "indices-negative", "seq-pattern-nth-term", "sf-large-to-sf"],
  "HT3 · Week 4 (25/01/27) — Indices & Standard Form (W2), Averages (W1)": ["sf-multiply", "averages-range-listed", "sf-add-subtract", "averages-missing-value-given-mean", "sf-divide", "averages-four-measures"],
  "HT3 · Week 5 (01/02/27) — Averages (W2), Frequency Polygons": ["ungrouped-frequency-table-mean", "histogram-read-bar", "mean-from-grouped-table", "cf-table-complete", "ungrouped-freq-table-form", "grouped-table-modal-median-class"],
  "HT3 · Week 6 (08/02/27) — Scatter Graphs, Pie Charts": ["scatter-correlation-type", "pie-chart-angle-from-frequency", "line-of-best-fit-estimate", "pie-chart-angle-to-frequency"],
  "HT4 · Week 1 (22/02/27) — Angles (W1)": ["angles-on-a-line", "angles-alternate", "angles-about-a-point", "angles-corresponding", "angles-vertically-opposite", "angles-co-interior"],
  "HT4 · Week 2 (01/03/27) — Angles (W2), Maps & Scales": ["angles-alternate", "scale-map-distance", "angles-interior-polygon-sum", "angles-corresponding", "angles-exterior-regular-polygon", "angles-co-interior"],
  "HT4 · Week 3 (08/03/27) — Bearings, Plans & Elevations, Constructions & Loci (W1)": ["bearings-find", "three-d-faces-edges-vertices", "bearings-back-bearing", "solid-name-identify", "scale-map-distance"],
  "HT4 · Week 4 (15/03/27) — Constructions & Loci (W2), Pythagoras, Trigonometry (W1)": ["bearings-find", "pythagoras-hypotenuse", "trig-find-side", "scale-map-distance", "pythagoras-shorter-side", "trig-exact-values"],
  "HT4 · Week 5 (22/03/27) — Trigonometry (W2)": ["trig-find-side", "trig-find-angle", "trig-exact-values", "trig-elevation-depression"],
  "HT5 · Week 1 (12/04/27) — Circles (W1)": ["circle-facts-parts", "circle-arc-sector", "circle-facts-circumference-area"],
  "HT5 · Week 2 (19/04/27) — Circles (W2), Area": ["circle-compound", "area-rectangle-triangle", "circle-arc-sector", "area-trapezium", "composite-rectilinear-area-perimeter", "area-parallelogram"],
  "HT5 · Week 3 (26/04/27) — Surface Area & Volume": ["surface-area-cuboid", "volume-triangular-prism", "volume-sphere", "volume-cuboid", "volume-cylinder", "volume-cone"],
  "HT5 · Week 4 (03/05/27) — Compound Measures": ["speed-calc", "density-calc", "compound-measures-calc", "distance-calc", "density-find-mass-volume", "time-calc"],
  "HT5 · Week 5 (10/05/27) — Coordinates & Straight Lines (W1)": ["coordinates-identify-point", "coordinates-midpoint-calc", "line-gradient-intercept-read", "coord-fourth-vertex", "pythagoras-distance-between-points", "line-equation-from-graph"],
  "HT5 · Week 6 (17/05/27) — Coordinates & Straight Lines (W2)": ["equation-from-gradient-and-point", "linear-graph-two-points", "linear-graph-parallel", "line-table-of-values", "line-equation-from-graph", "parallel-or-perpendicular-classify"],
  "HT5 · Week 7 (24/05/27) — Quadratic Graphs": ["plot-nonlinear-graph", "significant-points", "plot-cubic-graph", "quadratic-roots-and-intercept", "cubic-graph-features", "sketch-quadratic-a1"],
  "HT6 · Week 1 (07/06/27) — Real-Life Graphs, Congruence & Similarity (W1)": ["conversion-graph-read", "congruence-criteria", "distance-time-graph-read", "similar-shapes-identify", "similar-shapes-find-length", "similar-shapes-area-scale"],
  "HT6 · Week 2 (14/06/27) — Congruence & Similarity (W2), Transformations (W1)": ["similar-shapes-find-length", "transform-translate-shape", "similar-shapes-identify", "transform-reflect-shape", "transform-rotate-shape", "describe-reflection"],
  "HT6 · Week 3 (21/06/27) — Transformations (W2)": ["transform-enlarge-shape", "transform-reflect-shape", "transform-rotate-shape"],
};
const Y9_SET34_WEEKS = {
  "HT1 · Week 1 (07/09/26) — Integers and place value (W1)": ["place-value-digit-value", "place-value-write-in-words", "number-line-interval-value", "order-decimals", "addsub-word-problem"],
  "HT1 · Week 2 (14/09/26) — Integers and place value (W2)": ["addsub-word-problem", "multiply-two-two-digit", "divide-integer-written", "neg-order", "neg-add-subtract", "neg-multiply"],
  "HT1 · Week 3 (21/09/26) — Integers and place value (W3), Decimals (W1)": ["neg-multiply", "decimal-add-different-dp", "neg-divide", "decimal-subtract-different-dp", "bidmas-two-operations"],
  "HT1 · Week 4 (28/09/26) — Decimals (W2)": ["decimal-subtract-different-dp", "decimal-multiply-by-integer", "decimal-divide-by-integer", "multiply-divide-by-powers-of-10", "decimal-multiply-decimal-by-decimal"],
  "HT1 · Week 5 (05/10/26) — Decimals (W3), Indices, Powers and Roots (W1)": ["decimal-multiply-decimal-by-decimal", "index-notation-evaluate", "decimal-divide-by-decimal", "number-properties-square-or-cube", "round-decimal-places"],
  "HT1 · Week 6 (12/10/26) — Indices, Powers and Roots (W2)": ["number-properties-square-or-cube", "roots-evaluate", "powers-laws-multiply", "indices-divide-same-base", "bidmas-with-powers"],
  "HT1 · Week 7 (19/10/26) — Indices, Powers and Roots (W3), Factors, Multiples and Primes (W1)": ["bidmas-with-powers", "fmp-list-factors", "calculator-powers-roots", "fmp-list-multiples", "fmp-prime-factorisation"],
  "HT2 · Week 1 (09/11/26) — Factors, Multiples and Primes (W2)": ["fmp-prime-factorisation", "fmp-common-factors", "fmp-hcf-lcm", "fmp-lcm", "number-properties-prime-or-composite"],
  "HT2 · Week 2 (16/11/26) — Fractions (W1)": ["frac-simplify", "equivalent-fraction-missing", "frac-compare-different-denom", "frac-improper-mixed-convert", "frac-of-amount", "frac-add-different-denom"],
  "HT2 · Week 3 (23/11/26) — Fractions (W2), FDP (W1)": ["frac-divide-fraction-by-fraction", "fdp-percent-to-decimal", "frac-add-mixed-numbers", "fdp-convert-fraction-decimal-percentage", "frac-multiply-mixed"],
  "HT2 · Week 4 (30/11/26) — FDP (W2)": ["fraction-as-division", "fdp-order-mixed"],
  "HT3 · Week 1 (04/01/27) — Percentages (W1)": ["percent-of-amount-mental", "percent-of-amount", "percent-one-of-another"],
  "HT3 · Week 2 (11/01/27) — Percentages (W2)": ["percent-one-of-another", "percent-increase-decrease", "percent-change-find", "percent-multiplier"],
  "HT3 · Week 3 (18/01/27) — Ratio (W1)": ["ratio-simplify", "ratio-one-to-n", "ratio-share-amount", "ratio-total-parts", "ratio-quantity-one-part-given", "ratio-to-fraction"],
  "HT3 · Week 4 (25/01/27) — Ratio (W2), Proportion (W1)": ["ratio-to-fraction", "direct-proportion", "ratio-combine-two", "multiplicative-recipe-scaling", "currency-convert"],
  "HT3 · Week 5 (01/02/27) — Proportion (W2), Simple Algebra (W1)": ["multiplicative-best-value", "algebraic-notation-write", "inverse-proportion", "like-terms-identify"],
  "HT3 · Week 6 (08/02/27) — Simple Algebra (W2)": ["like-terms-identify", "collect-like-terms-multi", "multiply-algebraic-terms", "divide-algebraic-terms-basic", "eb-single-pos", "eb-single-neg"],
  "HT4 · Week 1 (22/02/27) — Substitution and Equations (W1)": ["substitution-one-variable", "substitution-two-variables", "solve-one-step-equation", "solve-two-step-equation"],
  "HT4 · Week 2 (01/03/27) — Substitution and Equations (W2), Sequences (W1)": ["solve-two-step-equation", "seq-continue-linear", "solve-linear-brackets", "seq-term-to-term-rule", "solve-equation-both-sides-brackets", "find-nth-term-linear"],
  "HT4 · Week 3 (08/03/27) — Sequences (W2), Averages (W1)": ["find-nth-term-linear", "averages-range-listed", "generate-terms-from-nth-term", "seq-pattern-nth-term"],
  "HT4 · Week 4 (15/03/27) — Averages (W2)": ["averages-four-measures", "averages-missing-value-given-mean", "ungrouped-frequency-table-mean"],
  "HT4 · Week 5 (22/03/27) — Tables and Data Collection (W1)": ["two-way-table-complete", "frequency-tree-complete", "ungrouped-freq-table-form", "timetable-read"],
  "HT5 · Week 1 (12/04/27) — Tables and Data Collection (W2)": ["bar-chart-read-frequency", "pie-chart-angle-from-frequency", "stratified-sample-one-category", "scatter-correlation-type"],
  "HT5 · Week 2 (19/04/27) — Tables and Data Collection (W3), Measurements and Units (W1)": ["line-of-best-fit-estimate", "metric-conversion", "suitable-unit-estimate", "capacity-mass-convert"],
  "HT5 · Week 3 (26/04/27) — Measurements and Units (W2)": ["capacity-mass-convert", "time-units-convert", "time-duration-calc", "clock-reading", "measures-convert-area-units"],
  "HT5 · Week 4 (03/05/27) — 2D Shapes (W1)": ["shape-naming-polygon-by-sides", "shape-properties-quadrilateral-name", "triangle-classify"],
  "HT5 · Week 5 (10/05/27) — 2D Shapes (W2), Angles (W1)": ["shape-properties-symmetry", "angle-type-name", "symmetry-lines-rotation", "angles-on-a-line"],
  "HT5 · Week 6 (17/05/27) — Angles (W2)": ["angles-about-a-point", "angles-vertically-opposite", "angles-triangle-sum", "angles-isosceles-triangle", "angles-quadrilateral-sum", "angles-alternate"],
  "HT5 · Week 7 (24/05/27) — Perimeter and Area (W1)": ["perimeter-polygon-calc", "area-rectangle-triangle", "area-parallelogram", "area-triangle-base-height"],
  "HT6 · Week 1 (07/06/27) — Perimeter and Area (W2), 3D Forms": ["area-triangle-base-height", "three-d-faces-edges-vertices", "area-trapezium", "solid-name-identify", "composite-rectilinear-area-perimeter", "volume-cuboid"],
  "HT6 · Week 2 (14/06/27) — Probability (W1)": ["probability-scale-words", "theoretical-probability-single", "theoretical-probability-not-event", "mutually-exclusive-missing-probability", "sample-space-spinners"],
  "HT6 · Week 3 (21/06/27) — Probability (W2)": ["sample-space-spinners", "relative-frequency-from-data", "expected-value-biased"],
};

const SCHEMES = {
  "Year 11 · Set 2 (2026/27)": SET2_WEEKS,
  "Year 11 · Set 1 (2026/27)": SET1_WEEKS,
  "Year 11 · Foundation (2026/27)": FOUNDATION_WEEKS,
  "Year 10 · Set 1 (2026/27)": Y10_SET1_WEEKS,
  "Year 10 · Set 2 (2026/27)": Y10_SET2_WEEKS,
  "Year 10 · Set 3 (2026/27)": Y10_SET3_WEEKS,
  "Year 10 · Set 4 (2026/27)": Y10_SET4_WEEKS,
  "Year 7 (2026/27)": Y7_WEEKS,
  "Year 8 (2026/27)": Y8_WEEKS,
  "Year 9 · Set 1 (2026/27)": Y9_SET1_WEEKS,
  "Year 9 · Set 2 (2026/27)": Y9_SET2_WEEKS,
  "Year 9 · Set 3 (2026/27)": Y9_SET34_WEEKS,
};

// Every week should give a full 6-topic quiz. A week with fewer than 6 topics
// is topped up from earlier weeks of the same scheme: one topic from the week
// before, then one from the week before that, and so on (going round again if
// it still needs more). Added topics go after the week's own.
(function topUpWeeks(minTopics) {
  Object.values(SCHEMES).forEach((weeks) => {
    const keys = Object.keys(weeks);
    const original = keys.map((k) => weeks[k].slice());
    keys.forEach((key, idx) => {
      const own = original[idx];
      if (own.length >= minTopics) return;
      const list = own.slice();
      let added = true;
      while (list.length < minTopics && added) {
        added = false;
        for (let back = 1; back <= idx && list.length < minTopics; back++) {
          const candidate = original[idx - back].find((id) => !list.includes(id));
          if (candidate) { list.push(candidate); added = true; }
        }
      }
      weeks[key] = list;
    });
  });
})(6);

/* =====================================================================
   Algebra strand expansion — bringing every Algebra group up to a fuller
   Mr Barton-style skill breakdown (previously most groups had only 1-2
   subtopics). New ids below; wired into SUBTOPIC_TO_SPEC further down.
   ===================================================================== */

/* --- Algebraic Fractions --- */
SUBTOPIC_BANK["algebraic-fractions-simplify-basic"] = {
  topic: "Algebraic Fractions", title: "Simplify a fraction by cancelling a common factor", marks: 1,
  build(rng) {
    const A = seededInt(rng, 2, 9), B = seededInt(rng, 2, 9);
    const g = gcd(A, B);
    const numStr = coefX(A / g);
    const denCoeff = B / g;
    return {
      prompt: <>Simplify fully <Frac n={<>{A}x²</>} d={<>{B}x</>} /></>,
      answer: denCoeff === 1 ? numStr : <Frac n={numStr} d={`${denCoeff}`} />,
    };
  },
};
SUBTOPIC_BANK["algebraic-fractions-simplify-factorise"] = {
  topic: "Algebraic Fractions", title: "Simplify a fraction by factorising first", marks: 3,
  build(rng) {
    const a = seededInt(rng, 1, 7), b = seededInt(rng, 1, 7);
    return {
      prompt: <>Simplify fully <Frac n={<>x² {pmX(a + b, "x")} {pm(a * b)}</>} d={<>x {pm(a)}</>} /></>,
      answer: <>x {pm(b)}</>,
    };
  },
};
SUBTOPIC_BANK["algebraic-fractions-divide"] = {
  topic: "Algebraic Fractions", title: "Divide algebraic fractions", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9), c = seededInt(rng, 2, 9), d = seededInt(rng, 2, 9);
    const num = a * d, den = b * c, g = gcd(num, den);
    const numStr = coefX(num / g, "x²");
    const denCoeff = den / g;
    return {
      prompt: <>Simplify <Frac n={<>{a}x</>} d={b} /> ÷ <Frac n={c} d={<>{d}x</>} /></>,
      answer: denCoeff === 1 ? numStr : <Frac n={numStr} d={`${denCoeff}`} />,
    };
  },
};
SUBTOPIC_BANK["algebraic-fractions-addsub-diffvars"] = {
  topic: "Algebraic Fractions", title: "Add algebraic fractions with different single-letter denominators", marks: 3,
  build(rng) {
    const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9);
    const vars = pick(rng, [["x", "y"], ["a", "b"], ["p", "q"]]);
    return {
      prompt: <>Write as a single fraction: <Frac n={a} d={vars[0]} /> + <Frac n={b} d={vars[1]} /></>,
      answer: <Frac n={<>{a}{vars[1]} + {b}{vars[0]}</>} d={<>{vars[0]}{vars[1]}</>} />,
    };
  },
};
SUBTOPIC_BANK["algebraic-fractions-solve-equation"] = {
  topic: "Algebraic Fractions", title: "Solve an equation containing algebraic fractions", marks: 3,
  build(rng) {
    const p = seededInt(rng, 2, 5), q = seededInt(rng, 2, 5);
    const m = seededInt(rng, 1, 4);
    const x0 = m * p * q;
    const k = m * (p + q);
    return {
      prompt: <>Solve <Frac n="x" d={p} /> + <Frac n="x" d={q} /> = {k}</>,
      answer: `x = ${x0}`,
    };
  },
};

/* --- Introduction to Algebra --- */
SUBTOPIC_BANK["algebraic-notation-index-form"] = {
  topic: "Algebraic Notation & Manipulation", title: "Write a repeated product in index form", marks: 1,
  build(rng) {
    const letter = pick(rng, ["n", "x", "y", "a"]);
    const power = seededInt(rng, 2, 5);
    return {
      prompt: `Write ${Array(power).fill(letter).join(" × ")} in index form.`,
      answer: <Pow b={letter} e={power} />,
    };
  },
};
SUBTOPIC_BANK["divide-algebraic-terms-basic"] = {
  topic: "Algebraic Notation & Manipulation", title: "Divide algebraic terms (no powers)", marks: 1,
  build(rng) {
    const q = seededInt(rng, 2, 6);
    const coeffDen = seededInt(rng, 2, 6);
    const coeffNum = coeffDen * q;
    const vars = pick(rng, [["x", "y"], ["a", "b"], ["p", "q"]]);
    return {
      prompt: `Simplify ${coeffNum}${vars[0]}${vars[1]} ÷ ${coeffDen}${vars[0]}`,
      answer: `${q}${vars[1]}`,
    };
  },
};
SUBTOPIC_BANK["divide-algebraic-terms"] = {
  topic: "Algebraic Notation & Manipulation", title: "Divide algebraic terms", marks: 2,
  build(rng) {
    const q = seededInt(rng, 2, 6);
    const p2 = seededInt(rng, 1, 3);
    const p1 = p2 + seededInt(rng, 1, 3);
    const coeffDen = seededInt(rng, 2, 6);
    const coeffNum = coeffDen * q;
    const vars = pick(rng, [["x", "y"], ["a", "b"]]);
    // Renders exponents as real superscripts (via <sup>) rather than a raw
    // "^2" caret — a bare caret reads ambiguously here because the next
    // variable letter sits directly after it (e.g. "a^2b" can misread as
    // a^(2b)), unlike the numeric-base "8^5 ÷ 8^2" style prompts elsewhere.
    const powJSX = (base, p) => (p === 1 ? base : <>{base}<sup>{p}</sup></>);
    const pDiff = p1 - p2;
    return {
      prompt: <>Simplify {coeffNum}{powJSX(vars[0], p1)}{vars[1]} ÷ {coeffDen}{powJSX(vars[0], p2)}</>,
      answer: <>{q}{powJSX(vars[0], pDiff)}{vars[1]}</>,
    };
  },
};
SUBTOPIC_BANK["collect-like-terms-brackets"] = {
  topic: "Algebraic Notation & Manipulation", title: "Expand a bracket and collect like terms", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 6), b = seededInt(rng, 1, 8), c = seededInt(rng, 1, 8);
    return {
      prompt: `Expand and simplify ${a}(x + ${b}) + ${coefX(c)}`,
      answer: `${coefX(a + c)} ${pm(a * b)}`,
    };
  },
};
SUBTOPIC_BANK["expand-two-single-brackets"] = {
  topic: "Expanding Brackets", title: "Expand two single brackets and simplify", marks: 3,
  build(rng) {
    let a, c, secondOp;
    do {
      a = seededInt(rng, 2, 6);
      c = seededInt(rng, 2, 6);
      secondOp = pick(rng, ["+", "-"]);
    } while (secondOp === "-" && a === c);
    const bOp = pick(rng, ["+", "-"]);
    const dOp = pick(rng, ["+", "-"]);
    const b = seededInt(rng, 2, 9);
    const d = seededInt(rng, 2, 9);
    const bVal = bOp === "+" ? b : -b;
    const dVal = dOp === "+" ? d : -d;
    const secondSign = secondOp === "+" ? 1 : -1;
    const xCoeff = a + secondSign * c;
    const constTerm = a * bVal + secondSign * c * dVal;
    return {
      prompt: `Expand and simplify ${a}(x ${bOp} ${b}) ${secondOp} ${c}(x ${dOp} ${d})`,
      answer: `${coefX(xCoeff)}${pm0(constTerm)}`,
    };
  },
};
SUBTOPIC_BANK["substitution-two-variables"] = {
  topic: "Substitution", title: "Substitute into an expression with two variables", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 8), b = seededInt(rng, 2, 8);
    const x = seededInt(rng, -6, 6), y = seededInt(rng, -6, 6);
    return {
      prompt: `Work out the value of ${a}x + ${b}y when x = ${x} and y = ${y}`,
      answer: `${a}×${x} + ${b}×${y} = ${a * x} ${pm(b * y)} = ${a * x + b * y}`,
    };
  },
};
SUBTOPIC_BANK["substitution-square-root-formula"] = {
  topic: "Substitution", title: "Substitute into a formula involving a square root", marks: 3,
  build(rng) {
    const a = seededInt(rng, 3, 12), b = seededInt(rng, 3, 12);
    const rounded = Math.round(Math.sqrt(a * a + b * b) * 100) / 100;
    return {
      prompt: `c = √(a² + b²). Work out the value of c when a = ${a} and b = ${b}, giving your answer to 2 decimal places.`,
      answer: `c = √(${a}² + ${b}²) = √${a * a + b * b} = ${rounded.toFixed(2)}`,
    };
  },
};

/* --- Algebraic Proof --- */
const PROOF_COUNTEREXAMPLES = [
  { prompt: "Show, by means of a counter-example, that the statement \"n² > n for all positive integers n\" is false.", answer: "When n = 1, n² = 1, which is not greater than n = 1. This is a counter-example, so the statement is false." },
  { prompt: "Show, by means of a counter-example, that the statement \"the sum of two prime numbers is always even\" is false.", answer: "2 and 3 are both prime, and 2 + 3 = 5, which is odd. This is a counter-example, so the statement is false." },
  { prompt: "Show, by means of a counter-example, that the statement \"if n is a multiple of 3, then n + 1 is prime\" is false.", answer: "9 is a multiple of 3, but 9 + 1 = 10, which is not prime. This is a counter-example, so the statement is false." },
  { prompt: "Show, by means of a counter-example, that the statement \"(x + y)² = x² + y² for all x and y\" is false.", answer: "Let x = 1 and y = 1. (x + y)² = 2² = 4, but x² + y² = 1 + 1 = 2. Since 4 ≠ 2, this is a counter-example, so the statement is false." },
];
SUBTOPIC_BANK["algebraic-proof-counterexample"] = {
  topic: "Algebraic Proof", title: "Disprove a statement using a counter-example", marks: 2,
  build(rng) {
    const t = pick(rng, PROOF_COUNTEREXAMPLES);
    return { prompt: t.prompt, answer: t.answer };
  },
};

/* --- Formulae (Rearranging Formulae) --- */
SUBTOPIC_BANK["rearrange-square-root"] = {
  topic: "Changing the Subject", title: "Change the subject (square root)", marks: 3,
  build(rng) {
    const a = seededInt(rng, 2, 6);
    return {
      prompt: <>Make x the subject of the formula T = {a}√x</>,
      answer: <>x = <Frac n="T" d={a} />²</>,
    };
  },
};
SUBTOPIC_BANK["rearrange-square"] = {
  topic: "Changing the Subject", title: "Change the subject (square term)", marks: 3,
  build(rng) {
    let b;
    do { b = seededInt(rng, -9, 9); } while (b === 0);
    const a = seededInt(rng, 2, 6);
    return {
      prompt: `Make x the subject of the formula y = ${a}x²${pm0(b)}`,
      answer: <>x = √(<Frac n={<>y {pm(-b)}</>} d={a} />)</>,
    };
  },
};

/* --- Quadratic & Other Graphs --- */
SUBTOPIC_BANK["estimate-gradient-tangent"] = {
  topic: "Graphs", title: "Estimate the gradient of a curve at a point", marks: 2,
  build(rng) {
    const rise = seededInt(rng, 2, 12), run = seededInt(rng, 2, 8);
    return {
      prompt: `A tangent is drawn to a curve at point P. The tangent rises ${rise} units for every ${run} units it runs. Estimate the gradient of the curve at P. Give your answer to 2 decimal places.`,
      answer: `${rise}/${run} = ${(rise / run).toFixed(2)}`,
    };
  },
};
SUBTOPIC_BANK["quadratic-roots-and-intercept"] = {
  topic: "Quadratic Graphs", title: "Find the roots and y-intercept of a quadratic from its equation", marks: 3,
  build(rng) {
    const a = seededInt(rng, 1, 6), b = seededInt(rng, 1, 6);
    return {
      prompt: `A curve has equation y = (x + ${a})(x - ${b}). Write down the coordinates of the points where the curve crosses the x-axis and the y-axis.`,
      answer: `x-axis: (${-a}, 0) and (${b}, 0). y-axis: (0, ${-a * b})`,
    };
  },
};
SUBTOPIC_BANK["turning-point-from-completed-square"] = {
  topic: "Quadratic Graphs", title: "Find the turning point of a quadratic from completed-square form", marks: 2,
  build(rng) {
    let b;
    do { b = seededInt(rng, -12, 12); } while (b === 0);
    const a = seededInt(rng, 1, 8);
    return {
      prompt: `A curve has equation y = (x ${pm(a)})²${pm0(b)}. Write down the coordinates of its turning point.`,
      answer: `(${-a}, ${b})`,
    };
  },
};
SUBTOPIC_BANK["sketch-quadratic-a1"] = {
  topic: "Quadratic Graphs", title: "Sketch a quadratic graph (a = 1)", marks: 4,
  build(rng) {
    // Roots p, q kept the same parity so the axis of symmetry (p+q)/2 and
    // the turning point are always whole numbers, not half-integers.
    let p, q;
    do {
      p = seededInt(rng, -6, 6);
      q = seededInt(rng, -6, 6);
    } while (p === q || (p + q) % 2 !== 0);
    const b = -(p + q), c = p * q;
    const turningX = (p + q) / 2, half = (p - q) / 2;
    const turningY = -(half * half);
    const lo = Math.min(p, q), hi = Math.max(p, q);
    return {
      prompt: `Sketch the graph of y = x² ${pmX(b, "x")} ${pm(c)}. Show the coordinates of where the graph crosses the axes, and the coordinates of the turning point.`,
      answer: `Crosses the x-axis at (${lo}, 0) and (${hi}, 0); crosses the y-axis at (0, ${c}); turning point at (${turningX}, ${turningY}).`,
    };
  },
};
SUBTOPIC_BANK["sketch-quadratic-agt1"] = {
  topic: "Quadratic Graphs", title: "Sketch a quadratic graph (a ≠ 1)", marks: 4,
  build(rng) {
    const a = seededInt(rng, 2, 3);
    let p, q;
    do {
      p = seededInt(rng, -6, 6);
      q = seededInt(rng, -6, 6);
    } while (p === q || (p + q) % 2 !== 0);
    const b = -a * (p + q), c = a * p * q;
    const turningX = (p + q) / 2, half = (p - q) / 2;
    const turningY = -a * half * half;
    const lo = Math.min(p, q), hi = Math.max(p, q);
    return {
      prompt: `Sketch the graph of y = ${a}x² ${pmX(b, "x")} ${pm(c)}. Show the coordinates of where the graph crosses the axes, and the coordinates of the turning point.`,
      answer: `Crosses the x-axis at (${lo}, 0) and (${hi}, 0); crosses the y-axis at (0, ${c}); turning point at (${turningX}, ${turningY}).`,
    };
  },
};
SUBTOPIC_BANK["cubic-graph-features"] = {
  topic: "Other Graphs", title: "Identify features of a cubic graph from its equation", marks: 2,
  build(rng) {
    const roots = [seededInt(rng, -6, -1), seededInt(rng, 1, 3), seededInt(rng, 4, 7)];
    const factorStr = (r) => (r >= 0 ? `(x - ${r})` : `(x + ${-r})`);
    return {
      prompt: `A cubic curve has equation y = ${roots.map(factorStr).join("")}. Write down the x-coordinates of the points where the curve crosses the x-axis.`,
      answer: `x = ${roots.join(", ")}`,
    };
  },
};
SUBTOPIC_BANK["reciprocal-graph-features"] = {
  topic: "Other Graphs", title: "Identify features of a reciprocal graph", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 12);
    return {
      prompt: `A curve has equation y = ${a}/x. Write down the equations of its two asymptotes.`,
      answer: `x = 0 and y = 0`,
    };
  },
};

/* --- Functions --- */
SUBTOPIC_BANK["solve-function-equation"] = {
  topic: "Functions", title: "Solve f(x) = value for x", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 6), b = seededInt(rng, -8, 8);
    const xsol = seededInt(rng, -8, 8);
    const fx = a * xsol + b;
    return {
      prompt: `f(x) = ${a}x${pm0(b)}. Solve f(x) = ${fx}.`,
      answer: `x = ${xsol}`,
    };
  },
};

/* --- Inequalities --- */
SUBTOPIC_BANK["inequality-from-number-line"] = {
  topic: "Inequalities", title: "Write down the inequality shown on a number line", marks: 1,
  build(rng) {
    const val = seededInt(rng, -6, 6);
    const filled = pick(rng, [true, false]);
    const direction = pick(rng, ["greater", "less"]);
    const symbol = direction === "greater" ? (filled ? "≥" : ">") : (filled ? "≤" : "<");
    return {
      prompt: `On a number line, there is a ${filled ? "filled (closed)" : "open"} circle at ${val}, with the arrow pointing to the ${direction === "greater" ? "right" : "left"}. Write down the inequality shown.`,
      answer: `x ${symbol} ${val}`,
    };
  },
};
SUBTOPIC_BANK["inequality-double-sided"] = {
  topic: "Inequalities", title: "Write a double-sided inequality shown on a number line", marks: 2,
  build(rng) {
    const lo = seededInt(rng, -8, -1);
    const hi = lo + seededInt(rng, 2, 8);
    const loSym = pick(rng, [true, false]) ? "≤" : "<";
    const hiSym = pick(rng, [true, false]) ? "≤" : "<";
    return {
      prompt: `On a number line, x is shown between ${lo} (${loSym === "≤" ? "closed" : "open"} circle) and ${hi} (${hiSym === "≤" ? "closed" : "open"} circle). Write down the inequality shown.`,
      answer: `${lo} ${loSym} x ${hiSym} ${hi}`,
    };
  },
};
SUBTOPIC_BANK["solve-inequality-fraction"] = {
  topic: "Inequalities", title: "Solve an inequality involving a fraction", marks: 2,
  build(rng) {
    const p = seededInt(rng, 2, 6);
    const m = seededInt(rng, -6, 6);
    const b = seededInt(rng, -9, 9);
    const symbol = pick(rng, ["<", ">"]);
    const rhs = m + b;
    const xThreshold = p * m;
    return {
      prompt: <>Solve <Frac n="x" d={p} /> {b !== 0 && pm(b)} {symbol} {rhs}</>,
      answer: `x ${symbol} ${xThreshold}`,
    };
  },
};

/* --- Indices, Roots & Surds (Laws of Indices) --- */
SUBTOPIC_BANK["indices-power-of-a-power"] = {
  topic: "Indices", title: "Simplify a power raised to a power", marks: 1,
  build(rng) {
    const base = pick(rng, ["a", "b", "x", "y"]);
    const p = seededInt(rng, 2, 5), q = seededInt(rng, 2, 4);
    return { prompt: <>Simplify <Pow b={<>(<Pow b={base} e={p} />)</>} e={q} /></>, answer: <Pow b={base} e={p * q} /> };
  },
};
SUBTOPIC_BANK["indices-combined-negative-fractional"] = {
  topic: "Indices", title: "Evaluate a combined negative and fractional index", marks: 3,
  build(rng) {
    const base = pick(rng, [4, 8, 9, 27, 16]);
    const rootMap = { 4: 2, 9: 2, 16: 2, 8: 3, 27: 3 };
    const root = rootMap[base];
    const rooted = Math.round(Math.pow(base, 1 / root));
    // numerator coprime to the root so the index (e.g. -3/2, -2/3) is in simplest form
    const numerPower = root === 2 ? pick(rng, [1, 3]) : pick(rng, [1, 2]);
    const value = Math.pow(rooted, numerPower);
    return {
      prompt: <>Work out the value of <Pow b={base} e={<IdxFrac neg n={numerPower} d={root} />} />. Give your answer as a fraction.</>,
      answer: <Frac n="1" d={value} />,
    };
  },
};

/* --- Straight-Line Graphs --- */
SUBTOPIC_BANK["parallel-or-perpendicular-classify"] = {
  topic: "Linear Graphs", title: "Determine if two lines are parallel, perpendicular, or neither", marks: 2,
  build(rng) {
    const m1 = pick(rng, [-4, -3, -2, -1, 1, 2, 3, 4]);
    const relationship = pick(rng, ["parallel", "perpendicular", "neither"]);
    let m2Str;
    if (relationship === "parallel") {
      m2Str = coefX(m1, "");
    } else if (relationship === "perpendicular") {
      const invMag = Math.abs(m1);
      const invSign = m1 > 0 ? -1 : 1;
      m2Str = invMag === 1 ? (invSign === 1 ? "" : "-") : `${invSign === 1 ? "" : "-"}1/${invMag}`;
    } else {
      let m2;
      do { m2 = pick(rng, [-4, -3, -2, -1, 1, 2, 3, 4]); } while (m2 === m1);
      m2Str = coefX(m2, "");
    }
    const c1 = seededInt(rng, -8, 8), c2 = seededInt(rng, -8, 8);
    return {
      prompt: `Line A: y = ${coefX(m1)}${pm0(c1)}. Line B: y = ${m2Str}x${pm0(c2)}. State whether lines A and B are parallel, perpendicular, or neither.`,
      answer: relationship.charAt(0).toUpperCase() + relationship.slice(1),
    };
  },
};
SUBTOPIC_BANK["equation-from-gradient-and-point"] = {
  topic: "Linear Graphs", title: "Find the equation of a line given its gradient and a point", marks: 3,
  build(rng) {
    const m = pick(rng, [-4, -3, -2, -1, 1, 2, 3, 4]);
    const x1 = seededInt(rng, -6, 6), c = seededInt(rng, -10, 10);
    const y1 = m * x1 + c;
    return {
      prompt: `Find the equation of the line with gradient ${m} that passes through the point (${x1}, ${y1}).`,
      answer: `y = ${coefX(m)}${pm0(c)}`,
    };
  },
};
SUBTOPIC_BANK["x-and-y-intercepts-from-equation"] = {
  topic: "Linear Graphs", title: "Find the x- and y-intercepts of a line from its equation", marks: 2,
  build(rng) {
    const m = pick(rng, [-4, -3, -2, -1, 1, 2, 3, 4]);
    let k;
    do { k = seededInt(rng, -6, 6); } while (k === 0);
    const cClean = -m * k;
    return {
      prompt: `A line has equation y = ${coefX(m)}${pm0(cClean)}. Find the coordinates of the points where the line crosses the x-axis and the y-axis.`,
      answer: `x-axis: (${k}, 0). y-axis: (0, ${cClean})`,
    };
  },
};

/* --- Other Equations --- */
SUBTOPIC_BANK["iteration-rearrange-first"] = {
  topic: "Iterations", title: "Rearrange an equation for use with iteration", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 5), b = seededInt(rng, 2, 9);
    return {
      prompt: `Show that the equation x² - ${a}x - ${b} = 0 can be rearranged to give x = √(${a}x + ${b})`,
      answer: `x² = ${a}x + ${b}  ⟹  x = √(${a}x + ${b})`,
    };
  },
};
SUBTOPIC_BANK["simultaneous-equations-word-problem"] = {
  topic: "Simultaneous Equations", title: "Form and solve simultaneous equations from a word problem", marks: 4,
  build(rng) {
    const priceA = seededInt(rng, 2, 8), priceB = seededInt(rng, 2, 8);
    let qtyA1, qtyB1, qtyA2, qtyB2, det, guard = 0;
    do {
      qtyA1 = seededInt(rng, 1, 5); qtyB1 = seededInt(rng, 1, 5);
      qtyA2 = seededInt(rng, 1, 5); qtyB2 = seededInt(rng, 1, 5);
      det = qtyA1 * qtyB2 - qtyA2 * qtyB1;
      guard++;
    } while (det === 0 && guard < 30);
    const total1 = qtyA1 * priceA + qtyB1 * priceB;
    const total2 = qtyA2 * priceA + qtyB2 * priceB;
    return {
      prompt: `${qtyA1} adult tickets and ${qtyB1} child tickets cost £${total1} in total. ${qtyA2} adult tickets and ${qtyB2} child tickets cost £${total2} in total. Find the cost of one adult ticket and one child ticket.`,
      answer: `Adult ticket = £${priceA}, child ticket = £${priceB}`,
    };
  },
};

/* --- Sequences --- */
SUBTOPIC_BANK["find-nth-term-linear"] = {
  topic: "Sequences", title: "Find the nth term of a linear sequence", marks: 2,
  build(rng) {
    const d = seededInt(rng, 2, 9) * pick(rng, [1, -1]);
    const a1 = seededInt(rng, -10, 10);
    const terms = [0, 1, 2, 3].map((i) => a1 + i * d);
    return {
      prompt: `Find the nth term of the sequence ${terms.join(", ")}, ...`,
      answer: `${coefX(d, "n")}${pm0(a1 - d)}`,
    };
  },
};
SUBTOPIC_BANK["generate-terms-from-nth-term"] = {
  topic: "Sequences", title: "Generate terms of a sequence from its nth term rule", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 9), b = seededInt(rng, -9, 9);
    const terms = [1, 2, 3, 4].map((n) => a * n + b);
    return {
      prompt: `The nth term of a sequence is ${a}n${pm0(b)}. Write down the first four terms of the sequence.`,
      answer: terms.join(", "),
    };
  },
};
SUBTOPIC_BANK["arithmetic-series-find-n"] = {
  topic: "Sequences & Series (Advanced)", title: "Find the number of terms needed to reach a given sum", marks: 3,
  build(rng) {
    const a = seededInt(rng, 1, 6);
    const d = seededInt(rng, 1, 5);
    const n = seededInt(rng, 4, 12);
    const sum = (n / 2) * (2 * a + (n - 1) * d);
    return {
      prompt: `An arithmetic series has first term ${a} and common difference ${d}. The sum of the first n terms is ${sum}. Find n.`,
      answer: `n = ${n}`,
    };
  },
};

/* --- Linear Equations --- */
SUBTOPIC_BANK["form-equation-angles"] = {
  topic: "Forming Equations", title: "Form and solve an equation from an angle fact", marks: 3,
  build(rng) {
    const a = seededInt(rng, 2, 6), b = seededInt(rng, 1, 30);
    const x0 = seededInt(rng, 10, 50);
    const angle1 = a * x0 + b;
    const angle2 = 180 - angle1;
    const expr = `(${a}x ${b >= 0 ? "+" : "\u2212"} ${Math.abs(b)})\u00B0`;
    const first = rng() < 0.5;
    return {
      prompt: `The diagram shows two angles on a straight line. Form and solve an equation to find x.`,
      render: <AngleFactsSVG mode="line" angles={first ? [angle1, angle2] : [angle2, angle1]} unknownIndex={-1} labels={first ? [expr, `${angle2}\u00B0`] : [`${angle2}\u00B0`, expr]} />,
      accurateDiagram: true,
      answer: `${a}x ${pm(b)}${pm0(angle2)} = 180  ⟹  x = ${x0}`,
    };
  },
};
SUBTOPIC_BANK["form-equation-consecutive-integers"] = {
  topic: "Forming Equations", title: "Form and solve an equation using consecutive integers", marks: 3,
  build(rng) {
    const n = seededInt(rng, 1, 40);
    const sum = n + (n + 1) + (n + 2);
    return {
      prompt: `Three consecutive integers have a sum of ${sum}. Form and solve an equation to find the smallest of the three integers.`,
      answer: `n + (n+1) + (n+2) = ${sum}  ⟹  3n + 3 = ${sum}  ⟹  n = ${n}`,
    };
  },
};
SUBTOPIC_BANK["solve-equation-fractions"] = {
  topic: "Solving Linear Equations", title: "Solve a linear equation containing a fraction", marks: 3,
  build(rng) {
    const p = seededInt(rng, 2, 6);
    const m = seededInt(rng, -6, 6);
    const b = seededInt(rng, -9, 9);
    const xClean = p * m;
    const rhs = m + b;
    return {
      prompt: <>Solve <Frac n="x" d={p} /> {b !== 0 && pm(b)} = {rhs}</>,
      answer: `x = ${xClean}`,
    };
  },
};
SUBTOPIC_BANK["solve-equation-negative-coefficient"] = {
  topic: "Solving Linear Equations", title: "Solve a linear equation with a negative coefficient", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 9);
    const x0 = seededInt(rng, -8, 8);
    let b;
    do { b = seededInt(rng, -9, 9); } while (b === 0);
    const c = -a * x0 + b;
    return {
      prompt: `Solve -${a}x${pm0(b)} = ${c}`,
      answer: `x = ${x0}`,
    };
  },
};

/* --- Quadratic Equations --- */
SUBTOPIC_BANK["completing-square-non-monic"] = {
  topic: "Completing the Square", title: "Complete the square (coefficient of x² greater than 1)", marks: 4,
  build(rng) {
    const k = seededInt(rng, 2, 4);
    const p = seededInt(rng, 1, 6);
    let q;
    do { q = seededInt(rng, -20, 20); } while (q === 0);
    const b = 2 * k * p;
    const c = q + k * p * p;
    return {
      prompt: `Write ${k}x² ${pmX(b, "x")}${pm0(c)} in the form ${k}(x ${pm(p)})² + q`,
      answer: `${k}(x ${pm(p)})²${pm0(q)}`,
    };
  },
};
SUBTOPIC_BANK["solve-quadratic-square-rooting"] = {
  topic: "Solving Quadratics", title: "Solve a quadratic equation by square rooting", marks: 2,
  build(rng) {
    const a = seededInt(rng, 1, 5);
    const rootVal = seededInt(rng, 2, 12);
    const c = a * rootVal * rootVal;
    return {
      prompt: `Solve ${coefX(a, "x²")} = ${c}`,
      answer: `x = ±${rootVal}`,
    };
  },
};
SUBTOPIC_BANK["solve-quadratic-word-problem"] = {
  topic: "Solving Quadratics", title: "Form and solve a quadratic equation from a word problem", marks: 4,
  build(rng) {
    const a = seededInt(rng, 2, 8), b = seededInt(rng, 3, 10);
    const area = a * (a + b);
    return {
      prompt: `A rectangle has width x cm and length (x + ${b}) cm. The area of the rectangle is ${area} cm². Form and solve an equation to find x. (x must be positive.)`,
      answer: `x(x + ${b}) = ${area}  ⟹  x² + ${b}x - ${area} = 0  ⟹  x = ${a}`,
    };
  },
};

/* =====================================================================
   Number strand expansion — bringing every thin Number group up to a
   fuller Mr Barton-style skill breakdown (built from Mr Barton Maths's
   own Ultimate Retrieval Tool picker for the Number strand this round).
   ===================================================================== */

/* --- Fractions: Understanding Fractions --- */
SUBTOPIC_BANK["frac-simplify"] = {
  topic: "Fractions", title: "Simplify a fraction to its simplest form", marks: 1,
  build(rng) {
    const g = seededInt(rng, 2, 9);
    let num = seededInt(rng, 1, 8);
    let den = seededInt(rng, num + 1, 10);
    while (gcd(num, den) !== 1) { num = seededInt(rng, 1, 8); den = seededInt(rng, num + 1, 10); }
    return {
      prompt: <>Simplify <Frac n={num * g} d={den * g} /> fully.</>,
      answer: <Frac n={num} d={den} />,
    };
  },
};
SUBTOPIC_BANK["frac-compare-different-denom"] = {
  topic: "Fractions", title: "Compare two fractions with different denominators", marks: 2,
  build(rng) {
    const d1 = pick(rng, [3, 4, 5, 6, 7, 8, 9]);
    let d2 = pick(rng, [3, 4, 5, 6, 7, 8, 9]);
    while (d2 === d1) d2 = pick(rng, [3, 4, 5, 6, 7, 8, 9]);
    const n1 = seededInt(rng, 1, d1 - 1);
    const n2 = seededInt(rng, 1, d2 - 1);
    const cross1 = n1 * d2, cross2 = n2 * d1;
    const symbol = cross1 === cross2 ? "=" : cross1 > cross2 ? ">" : "<";
    return {
      prompt: <>Insert &lt;, &gt; or = to compare <Frac n={n1} d={d1} /> and <Frac n={n2} d={d2} /></>,
      answer: <><Frac n={n1} d={d1} /> {symbol} <Frac n={n2} d={d2} /> (compare {cross1} and {cross2})</>,
    };
  },
};
SUBTOPIC_BANK["frac-improper-mixed-convert"] = {
  topic: "Fractions", title: "Convert between an improper fraction and a mixed number", marks: 1,
  build(rng) {
    const direction = pick(rng, ["toMixed", "toImproper"]);
    const d = pick(rng, [3, 4, 5, 6, 7, 8]);
    const w = seededInt(rng, 1, 6);
    const n = seededInt(rng, 1, d - 1);
    const improperNum = w * d + n;
    if (direction === "toMixed") {
      return {
        prompt: <>Write <Frac n={improperNum} d={d} /> as a mixed number.</>,
        answer: <Mixed w={w} n={n} d={d} />,
      };
    }
    return {
      prompt: <>Write <Mixed w={w} n={n} d={d} /> as an improper fraction.</>,
      answer: <Frac n={improperNum} d={d} />,
    };
  },
};

/* --- Fractions: Adding & Subtracting Fractions --- */
SUBTOPIC_BANK["frac-add-same-denom"] = {
  topic: "Fractions", title: "Add fractions with the same denominator", marks: 1,
  build(rng) {
    const d = pick(rng, [5, 6, 7, 8, 9, 10, 12]);
    const a = seededInt(rng, 1, d - 2);
    const b = seededInt(rng, 1, d - a - 1);
    const sum = a + b;
    const g = gcd(sum, d);
    return {
      prompt: <>Work out <Frac n={a} d={d} /> + <Frac n={b} d={d} />. Give your answer in its simplest form.</>,
      answer: <Frac n={sum / g} d={d / g} />,
    };
  },
};
SUBTOPIC_BANK["frac-add-different-denom"] = {
  topic: "Fractions", title: "Add fractions with different denominators", marks: 2,
  build(rng) {
    const d1 = pick(rng, [2, 3, 4, 5, 6]);
    let d2 = pick(rng, [3, 4, 5, 6, 7]);
    while (d2 === d1) d2 = pick(rng, [3, 4, 5, 6, 7]);
    const n1 = seededInt(rng, 1, d1 - 1);
    const n2 = seededInt(rng, 1, d2 - 1);
    const commonDen = (d1 * d2) / gcd(d1, d2);
    const num = n1 * (commonDen / d1) + n2 * (commonDen / d2);
    const g = gcd(num, commonDen);
    const simpNum = num / g, simpDen = commonDen / g;
    return {
      prompt: <>Work out <Frac n={n1} d={d1} /> + <Frac n={n2} d={d2} />. Give your answer as a fraction in its simplest form.</>,
      answer: simpDen === 1 ? `${simpNum}` : <Frac n={simpNum} d={simpDen} />,
    };
  },
};
SUBTOPIC_BANK["frac-subtract-different-denom"] = {
  topic: "Fractions", title: "Subtract fractions with different denominators", marks: 2,
  build(rng) {
    const d1 = pick(rng, [2, 3, 4, 5, 6]);
    let d2 = pick(rng, [3, 4, 5, 6, 7]);
    while (d2 === d1) d2 = pick(rng, [3, 4, 5, 6, 7]);
    const commonDen = (d1 * d2) / gcd(d1, d2);
    let n1 = seededInt(rng, 1, d1 - 1);
    let n2 = seededInt(rng, 1, d2 - 1);
    let guard = 0;
    while (n1 * (commonDen / d1) <= n2 * (commonDen / d2) && guard < 40) {
      n1 = seededInt(rng, 1, d1 - 1);
      n2 = seededInt(rng, 1, d2 - 1);
      guard++;
    }
    const num = n1 * (commonDen / d1) - n2 * (commonDen / d2);
    const g = gcd(num, commonDen);
    const simpNum = num / g, simpDen = commonDen / g;
    return {
      prompt: <>Work out <Frac n={n1} d={d1} /> - <Frac n={n2} d={d2} />. Give your answer as a fraction in its simplest form.</>,
      answer: simpDen === 1 ? `${simpNum}` : <Frac n={simpNum} d={simpDen} />,
    };
  },
};
SUBTOPIC_BANK["frac-add-mixed-numbers"] = {
  topic: "Fractions", title: "Add mixed numbers", marks: 3,
  build(rng) {
    const d1 = pick(rng, [3, 4, 5, 6]);
    let d2 = pick(rng, [3, 4, 5, 6]);
    while (d2 === d1) d2 = pick(rng, [3, 4, 5, 6]);
    const w1 = seededInt(rng, 1, 5), w2 = seededInt(rng, 1, 5);
    const n1 = seededInt(rng, 1, d1 - 1), n2 = seededInt(rng, 1, d2 - 1);
    const commonDen = (d1 * d2) / gcd(d1, d2);
    const fracNum = n1 * (commonDen / d1) + n2 * (commonDen / d2);
    const wholeCarry = Math.floor(fracNum / commonDen);
    const remNum = fracNum % commonDen;
    const g = gcd(remNum, commonDen);
    const simpNum = remNum / g, simpDen = commonDen / g;
    const totalWhole = w1 + w2 + wholeCarry;
    return {
      prompt: <>Work out <Mixed w={w1} n={n1} d={d1} /> + <Mixed w={w2} n={n2} d={d2} />. Give your answer as a mixed number in its simplest form.</>,
      answer: remNum === 0 ? `${totalWhole}` : <Mixed w={totalWhole} n={simpNum} d={simpDen} />,
    };
  },
};
SUBTOPIC_BANK["frac-subtract-mixed-numbers-exchange"] = {
  topic: "Fractions", title: "Subtract mixed numbers (requiring exchange)", marks: 3,
  build(rng) {
    const d = pick(rng, [3, 4, 5, 6, 8]);
    const w1 = seededInt(rng, 4, 9);
    const w2 = seededInt(rng, 1, w1 - 2);
    const n1 = seededInt(rng, 1, d - 2);
    const n2 = seededInt(rng, n1 + 1, d - 1);
    const totalWhole = w1 - w2 - 1;
    const num = d + n1 - n2;
    const g = gcd(num, d);
    const simpNum = num / g, simpDen = d / g;
    return {
      prompt: <>Work out <Mixed w={w1} n={n1} d={d} /> − <Mixed w={w2} n={n2} d={d} />. Give your answer as a mixed number in its simplest form.</>,
      answer: simpDen === 1 ? `${totalWhole + simpNum}` : <Mixed w={totalWhole} n={simpNum} d={simpDen} />,
    };
  },
};

/* --- Fractions: Dividing Fractions --- */
SUBTOPIC_BANK["frac-divide-by-integer"] = {
  topic: "Fractions", title: "Divide a fraction by an integer", marks: 2,
  build(rng) {
    const num = seededInt(rng, 1, 8);
    const den = seededInt(rng, num + 1, 12);
    const divisor = seededInt(rng, 2, 6);
    const newDen = den * divisor;
    const g = gcd(num, newDen);
    return {
      prompt: <>Work out <Frac n={num} d={den} /> ÷ {divisor}. Give your answer in its simplest form.</>,
      answer: <Frac n={num / g} d={newDen / g} />,
    };
  },
};
SUBTOPIC_BANK["frac-divide-fraction-by-fraction"] = {
  topic: "Fractions", title: "Divide a fraction by a fraction", marks: 2,
  build(rng) {
    const n1 = seededInt(rng, 1, 8), d1 = seededInt(rng, n1 + 1, 10);
    const n2 = seededInt(rng, 1, 8), d2 = seededInt(rng, n2 + 1, 10);
    const num = n1 * d2, den = d1 * n2;
    const g = gcd(num, den);
    const simpNum = num / g, simpDen = den / g;
    return {
      prompt: <>Work out <Frac n={n1} d={d1} /> ÷ <Frac n={n2} d={d2} />. Give your answer as a fraction in its simplest form.</>,
      answer: simpDen === 1 ? `${simpNum}` : <Frac n={simpNum} d={simpDen} />,
    };
  },
};

/* --- Decimals: Operations with Decimals --- */
SUBTOPIC_BANK["decimal-add-different-dp"] = {
  topic: "Decimals", title: "Add decimals with a different number of decimal places", marks: 2,
  build(rng) {
    const a = seededInt(rng, 10, 999) / 10;
    const b = seededInt(rng, 100, 9999) / 100;
    const sum = Math.round((a + b) * 100) / 100;
    return { prompt: `Work out ${a.toFixed(1)} + ${b.toFixed(2)}`, answer: `${sum.toFixed(2)}` };
  },
};
SUBTOPIC_BANK["decimal-subtract-different-dp"] = {
  topic: "Decimals", title: "Subtract decimals with a different number of decimal places", marks: 2,
  build(rng) {
    const b = seededInt(rng, 10, 90) / 10;
    const extra = seededInt(rng, 1, 999) / 100;
    const a = Math.round((b + extra) * 100) / 100;
    return { prompt: `Work out ${a.toFixed(2)} - ${b.toFixed(1)}`, answer: `${extra.toFixed(2)}` };
  },
};
SUBTOPIC_BANK["decimal-divide-integer-by-decimal"] = {
  topic: "Decimals", title: "Divide an integer by a decimal", marks: 2,
  build(rng) {
    const k = seededInt(rng, 2, 9);
    const g = gcd(k, 10);
    const step = 10 / g;
    const mult = seededInt(rng, 2, 6);
    const quotient = step * mult;
    const divisor = k / 10;
    const dividend = Math.round(divisor * quotient);
    return {
      prompt: `Work out ${dividend} ÷ ${divisor}`,
      answer: `${dividend} ÷ ${divisor} = ${dividend * 10} ÷ ${k} = ${quotient}`,
    };
  },
};
SUBTOPIC_BANK["decimal-multiply-decimal-by-decimal"] = {
  topic: "Decimals", title: "Multiply a decimal by a decimal", marks: 2,
  build(rng) {
    const a = seededInt(rng, 11, 99) / 10;
    const b = seededInt(rng, 11, 99) / 10;
    const product = Math.round(a * b * 100) / 100;
    return {
      prompt: `Work out ${a.toFixed(1)} × ${b.toFixed(1)}`,
      answer: `${Math.round(a * 10)} × ${Math.round(b * 10)} = ${Math.round(a * 10 * (b * 10))}, so the answer is ${product.toFixed(2)}`,
    };
  },
};

/* --- Negative Numbers: Operations with Negatives --- */
SUBTOPIC_BANK["neg-multiply"] = {
  topic: "Negative Numbers", title: "Multiply with negative numbers", marks: 1,
  build(rng) {
    const a = seededInt(rng, 2, 12), b = seededInt(rng, 2, 12);
    const signs = pick(rng, [[-1, 1], [1, -1], [-1, -1]]);
    const x = a * signs[0], y = b * signs[1];
    return { prompt: `Work out ${x} × ${y}`, answer: `${x * y}` };
  },
};
SUBTOPIC_BANK["neg-divide"] = {
  topic: "Negative Numbers", title: "Divide with negative numbers", marks: 1,
  build(rng) {
    const b = seededInt(rng, 2, 12);
    const q = seededInt(rng, 2, 12);
    const a = b * q;
    const signs = pick(rng, [[-1, 1], [1, -1], [-1, -1]]);
    const x = a * signs[0], y = b * signs[1];
    return { prompt: `Work out ${x} ÷ ${y}`, answer: `${x / y}` };
  },
};
SUBTOPIC_BANK["neg-mixed-word-problem"] = {
  topic: "Negative Numbers", title: "Solve a word problem involving negative numbers", marks: 2,
  build(rng) {
    const start = seededInt(rng, -8, 8);
    const change = seededInt(rng, 3, 15);
    const goesUp = pick(rng, [true, false]);
    const end = goesUp ? start + change : start - change;
    return {
      prompt: `The temperature at midnight is ${start}°C. By morning it has ${goesUp ? "risen" : "fallen"} by ${change}°C. What is the temperature in the morning?`,
      answer: `${start} ${goesUp ? "+" : "-"} ${change} = ${end}°C`,
    };
  },
};

/* --- Factors, Multiples & Primes: Factors & Multiples Basics --- */
SUBTOPIC_BANK["fmp-list-factors"] = {
  topic: "Factors & Multiples", title: "List all the factors of a number", marks: 1,
  build(rng) {
    const n = pick(rng, [12, 18, 20, 24, 28, 30, 36, 40, 42, 45, 48, 50, 54, 56, 60]);
    const factors = [];
    for (let i = 1; i <= n; i++) if (n % i === 0) factors.push(i);
    return { prompt: `List all the factors of ${n}.`, answer: factors.join(", ") };
  },
};
SUBTOPIC_BANK["fmp-list-multiples"] = {
  topic: "Factors & Multiples", title: "List the first few multiples of a number", marks: 1,
  build(rng) {
    const n = seededInt(rng, 3, 15);
    const count = 5;
    const multiples = Array.from({ length: count }, (_, i) => n * (i + 1));
    return { prompt: `Write down the first ${count} multiples of ${n}.`, answer: multiples.join(", ") };
  },
};
SUBTOPIC_BANK["fmp-common-factors"] = {
  topic: "Factors & Multiples", title: "Find the common factors of two numbers", marks: 2,
  build(rng) {
    const pairs = [[12, 18], [16, 24], [20, 30], [18, 27], [24, 36], [15, 25], [28, 42], [32, 48]];
    const [a, b] = pick(rng, pairs);
    const factorsOf = (n) => { const f = []; for (let i = 1; i <= n; i++) if (n % i === 0) f.push(i); return f; };
    const fa = factorsOf(a), fb = factorsOf(b);
    const common = fa.filter((f) => fb.includes(f));
    return { prompt: `Find all the common factors of ${a} and ${b}.`, answer: common.join(", ") };
  },
};

/* --- Factors, Multiples & Primes: HCF & LCM --- */
SUBTOPIC_BANK["fmp-lcm"] = {
  topic: "Factors & Multiples", title: "Find the LCM of two numbers", marks: 2,
  build(rng) {
    const pairs = [[4, 6], [6, 8], [9, 12], [8, 10], [12, 18], [15, 20], [10, 15], [14, 21]];
    const [a, b] = pick(rng, pairs);
    const lcm = (a * b) / gcd(a, b);
    return { prompt: `Find the lowest common multiple (LCM) of ${a} and ${b}.`, answer: `LCM = ${lcm}` };
  },
};

/* --- Indices, Roots & Surds: Laws of Indices (numeric base) --- */
SUBTOPIC_BANK["indices-divide-same-base"] = {
  topic: "Powers & Roots", title: "Divide powers with the same base", marks: 1,
  build(rng) {
    const base = pick(rng, [2, 3, 4, 5, 6, 10]);
    const p = seededInt(rng, 5, 9), q = seededInt(rng, 1, 4);
    return { prompt: <>Simplify <Pow b={base} e={p} /> ÷ <Pow b={base} e={q} />. Leave your answer in index form.</>, answer: <Pow b={base} e={p - q} /> };
  },
};
SUBTOPIC_BANK["indices-power-of-power-numeric"] = {
  topic: "Powers & Roots", title: "Simplify a power raised to a power (numeric base)", marks: 1,
  build(rng) {
    const base = pick(rng, [2, 3, 4, 5, 6, 10]);
    const p = seededInt(rng, 2, 4), q = seededInt(rng, 2, 3);
    return { prompt: <>Simplify <Pow b={<>(<Pow b={base} e={p} />)</>} e={q} />. Leave your answer in index form.</>, answer: <Pow b={base} e={p * q} /> };
  },
};
SUBTOPIC_BANK["indices-negative-fractional-base"] = {
  topic: "Powers & Roots", title: "Evaluate a negative index with a fractional base", marks: 2,
  build(rng) {
    const pairs = [[2, 3], [3, 4], [2, 5], [3, 5], [4, 5], [1, 2], [1, 3], [2, 7], [3, 7], [5, 6]];
    const [n, d] = pick(rng, pairs);
    const power = pick(rng, [1, 2]);
    const flippedN = Math.pow(d, power), flippedD = Math.pow(n, power);
    return {
      prompt: <>Work out the value of <Pow tall b={<TallParens><Frac n={n} d={d} /></TallParens>} e={-power} /></>,
      answer: <Frac n={flippedN} d={flippedD} />,
    };
  },
};
SUBTOPIC_BANK["indices-non-unit-fractional"] = {
  topic: "Powers & Roots", title: "Evaluate a non-unit fractional index", marks: 3,
  build(rng) {
    const bases = [
      { base: 4, root: 2 }, { base: 8, root: 3 }, { base: 9, root: 2 },
      { base: 16, root: 2 }, { base: 16, root: 4 }, { base: 25, root: 2 },
      { base: 27, root: 3 }, { base: 32, root: 5 }, { base: 36, root: 2 },
      { base: 64, root: 2 }, { base: 64, root: 3 }, { base: 81, root: 2 }, { base: 81, root: 4 },
    ];
    const item = pick(rng, bases);
    const rooted = Math.round(Math.pow(item.base, 1 / item.root));
    // Simplest-form index only: the power shares no factor with the root and
    // isn't equal to it (so no 2/2, 3/3 or 2/4).
    const power = pick(rng, [2, 3, 4].filter((n) => n !== item.root && gcd(n, item.root) === 1));
    const answer = Math.pow(rooted, power);
    return {
      prompt: <>Work out the value of <Pow b={item.base} e={<IdxFrac n={power} d={item.root} />} /></>,
      answer: <><Pow b={<>(<Root n={item.root} x={item.base} />)</>} e={power} /> = <Pow b={rooted} e={power} /> = {answer}</>,
    };
  },
};

/* --- Indices, Roots & Surds: Standard Form --- */
SUBTOPIC_BANK["sf-small-to-sf"] = {
  topic: "Standard Form", title: "Convert a small ordinary number to standard form", marks: 1,
  build(rng) {
    const D0 = seededInt(rng, 1, 9);
    const D1 = seededInt(rng, 0, 9);
    const e = seededInt(rng, 2, 7);
    const digits = D1 === 0 ? `${D0}` : `${D0}${D1}`;
    const ordinaryStr = "0." + "0".repeat(e - 1) + digits;
    const coeff = D1 === 0 ? `${D0}` : `${D0}.${D1}`;
    return {
      prompt: `Write ${ordinaryStr} in standard form.`,
      answer: <>{coeff} × <Pow b={10} e={-e} /></>,
    };
  },
};
SUBTOPIC_BANK["sf-divide"] = {
  topic: "Standard Form", title: "Divide numbers in standard form", marks: 2,
  build(rng) {
    const d2 = pick(rng, [2, 3]);
    const c = seededInt(rng, 1, Math.floor(9 / d2));
    const d1 = c * d2;
    const e1 = seededInt(rng, 4, 9), e2 = seededInt(rng, 1, 3);
    return {
      prompt: <>Work out ({d1} × <Pow b={10} e={e1} />) ÷ ({d2} × <Pow b={10} e={e2} />). Give your answer in standard form.</>,
      answer: <>{c} × <Pow b={10} e={e1 - e2} /></>,
    };
  },
};
SUBTOPIC_BANK["sf-compare-order"] = {
  topic: "Standard Form", title: "Compare or order numbers written in standard form", marks: 2,
  build(rng) {
    const items = [];
    const used = new Set();
    while (items.length < 4) {
      const d = seededInt(rng, 1, 9) + seededInt(rng, 0, 9) / 10;
      const e = seededInt(rng, -4, 6);
      const key = `${d}_${e}`;
      if (used.has(key)) continue;
      used.add(key);
      items.push({ d, e, value: d * Math.pow(10, e) });
    }
    const sorted = [...items].sort((a, b) => a.value - b.value);
    const fmt = (it) => <>{it.d.toFixed(1)} × <Pow b={10} e={it.e} /></>;
    const list = (arr) => arr.map((it, i) => <React.Fragment key={i}>{i > 0 ? ", " : ""}{fmt(it)}</React.Fragment>);
    return {
      prompt: <>Write these numbers in order, starting with the smallest: {list(items)}</>,
      answer: <>{list(sorted)}</>,
    };
  },
};
SUBTOPIC_BANK["sf-add-subtract"] = {
  topic: "Standard Form", title: "Add or subtract numbers in standard form", marks: 3,
  build(rng) {
    const e = seededInt(rng, 3, 7);
    const d1 = seededInt(rng, 2, 9), d2 = seededInt(rng, 1, d1 - 1);
    const operation = pick(rng, ["add", "subtract"]);
    const rawResult = operation === "add" ? d1 + d2 : d1 - d2;
    let coeff = rawResult, exp = e;
    while (coeff >= 10) { coeff /= 10; exp += 1; }
    const symbol = operation === "add" ? "+" : "\u2212";
    return {
      prompt: <>Work out ({d1} × <Pow b={10} e={e} />) {symbol} ({d2} × <Pow b={10} e={e} />). Give your answer in standard form.</>,
      answer: <>{coeff} × <Pow b={10} e={exp} /></>,
    };
  },
};

/* --- Fraction, Decimal, Percentage Equivalence: Recurring Decimals --- */
SUBTOPIC_BANK["fdp-fraction-to-recurring"] = {
  topic: "Fraction, Decimal, Percentage Equivalence", title: "Convert a fraction to a recurring decimal", marks: 2,
  build(rng) {
    const items = [
      { n: 1, d: 3, dec: "0.3̇" }, { n: 2, d: 3, dec: "0.6̇" },
      { n: 1, d: 6, dec: "0.16̇" }, { n: 5, d: 6, dec: "0.83̇" },
      { n: 1, d: 9, dec: "0.1̇" }, { n: 2, d: 9, dec: "0.2̇" },
      { n: 4, d: 9, dec: "0.4̇" }, { n: 1, d: 11, dec: "0.0̇9̇" },
      { n: 2, d: 11, dec: "0.1̇8̇" }, { n: 1, d: 7, dec: "0.1̇42857̇" },
    ];
    const item = pick(rng, items);
    return {
      prompt: <>Write <Frac n={item.n} d={item.d} /> as a recurring decimal.</>,
      answer: item.dec,
    };
  },
};

/* --- Percentages: Percentage Change --- */
SUBTOPIC_BANK["percent-simple-interest"] = {
  topic: "Percentages", title: "Calculate simple interest", marks: 2,
  build(rng) {
    const P = seededInt(rng, 5, 40) * 100;
    const r = pick(rng, [2, 3, 4, 5, 6]);
    const t = seededInt(rng, 2, 6);
    const interest = (P * r * t) / 100;
    const total = P + interest;
    return {
      prompt: `£${P} is invested at ${r}% simple interest per year for ${t} years. Work out the total value of the investment at the end of ${t} years.`,
      answer: `Interest = £${P} × ${r}% × ${t} = £${interest}. Total = £${P} + £${interest} = £${total}`,
    };
  },
};
SUBTOPIC_BANK["percent-reverse-after-increase"] = {
  topic: "Percentages", title: "Find the original value after a percentage increase", marks: 3,
  build(rng) {
    const r = pick(rng, [5, 8, 10, 12, 15, 20, 25]);
    const original = seededInt(rng, 20, 80) * 10;
    const newVal = original * (1 + r / 100);
    return {
      prompt: `After a ${r}% increase, a value is £${newVal.toFixed(2)}. Find the original value.`,
      answer: `£${newVal.toFixed(2)} ÷ ${(1 + r / 100).toFixed(2)} = £${original.toFixed(2)}`,
    };
  },
};

/* --- Number Properties --- */
SUBTOPIC_BANK["number-properties-square-or-cube"] = {
  topic: "Number Properties", title: "Identify whether a number is a square number, a cube number, both, or neither", marks: 1,
  build(rng) {
    const pool = [
      { n: 16, ans: "Square number" }, { n: 27, ans: "Cube number" }, { n: 64, ans: "Both a square number and a cube number" },
      { n: 15, ans: "Neither" }, { n: 100, ans: "Square number" }, { n: 125, ans: "Cube number" },
      { n: 1, ans: "Both a square number and a cube number" }, { n: 50, ans: "Neither" },
      { n: 81, ans: "Square number" }, { n: 216, ans: "Cube number" }, { n: 45, ans: "Neither" }, { n: 729, ans: "Both a square number and a cube number" },
    ];
    const item = pick(rng, pool);
    return { prompt: `Is ${item.n} a square number, a cube number, both, or neither?`, answer: item.ans };
  },
};
SUBTOPIC_BANK["number-properties-prime-or-composite"] = {
  topic: "Number Properties", title: "Determine whether a number is prime, giving a reason", marks: 2,
  build(rng) {
    const pool = [
      { n: 51, factor: 3 }, { n: 91, factor: 7 }, { n: 57, factor: 3 }, { n: 87, factor: 3 },
      { n: 119, factor: 7 }, { n: 143, factor: 11 }, { n: 161, factor: 7 }, { n: 133, factor: 7 },
    ];
    const isPrimeCase = pick(rng, [true, false]);
    if (isPrimeCase) {
      const primes = [37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103];
      const p = pick(rng, primes);
      return { prompt: `Is ${p} a prime number? Explain your answer.`, answer: `Yes — ${p} has no factors other than 1 and itself.` };
    }
    const item = pick(rng, pool);
    return {
      prompt: `Is ${item.n} a prime number? Explain your answer.`,
      answer: `No — ${item.n} = ${item.factor} × ${item.n / item.factor}, so it has factors other than 1 and itself.`,
    };
  },
};

/* --- Calculator Skills --- */
SUBTOPIC_BANK["calculator-nested-rounding"] = {
  topic: "Calculator Use", title: "Use a calculator to evaluate a nested expression, rounding your answer", marks: 2,
  build(rng) {
    const a = seededInt(rng, 3, 15), b = seededInt(rng, 3, 15), c = seededInt(rng, 2, 9);
    const result = Math.sqrt(a * a + b * b) / c;
    return {
      prompt: `Use a calculator to work out √(${a}² + ${b}²) ÷ ${c}. Give your answer to 2 decimal places.`,
      answer: `${result.toFixed(2)}`,
    };
  },
};
SUBTOPIC_BANK["calculator-surd-to-decimal"] = {
  topic: "Calculator Use", title: "Use a calculator to convert a surd to a decimal", marks: 1,
  build(rng) {
    const n = pick(rng, [2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 15]);
    const result = Math.sqrt(n);
    return { prompt: `Use a calculator to work out √${n}. Give your answer to 3 significant figures.`, answer: `${result.toPrecision(3)}` };
  },
};

/* --- Mental Arithmetic: Order of Operations --- */
SUBTOPIC_BANK["bidmas-with-powers"] = {
  topic: "Order of Operations", title: "Evaluate an expression using BIDMAS, including a power", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 6), b = seededInt(rng, 2, 9), c = seededInt(rng, 2, 9);
    const result = a * a + b * c;
    return { prompt: `Work out ${a}² + ${b} × ${c}`, answer: `${a * a} + ${b * c} = ${result}` };
  },
};

/* =====================================================================
   Geometry & Measures strand expansion — bringing every thin Geometry
   group up to a fuller Mr Barton-style skill breakdown (built from Mr
   Barton Maths's own Ultimate Retrieval Tool picker for the Geometry
   strand this round). Angles was almost entirely empty beyond "angles on
   a line/about a point" — "Angles in Shapes" and "Angles in Parallel
   Lines" are brand-new groups here.
   ===================================================================== */

/* --- Angles: Basic Angle Facts (extra) --- */
SUBTOPIC_BANK["angles-vertically-opposite"] = {
  topic: "Angle Facts", title: "Vertically opposite angles", marks: 1,
  build(rng) {
    const a = seededInt(rng, 30, 150);
    const b = 180 - a;
    const angles = [a, b, a, b];
    const unknownIndex = pick(rng, [0, 1, 2, 3]);
    const knownIndex = (unknownIndex + 2) % 4;
    return {
      prompt: `Two straight lines cross, forming the angles shown. Find the size of the angle marked "?".`,
      render: <AngleFactsSVG mode="point" angles={angles} unknownIndex={unknownIndex} />,
      answer: `${angles[unknownIndex]}° (vertically opposite angles are equal, matching the ${angles[knownIndex]}° angle opposite it)`,
    };
  },
};

/* --- Angles: Angles in Shapes (new group) --- */
SUBTOPIC_BANK["angles-triangle-sum"] = {
  topic: "Angles in Shapes", title: "Angles in a triangle", marks: 2,
  build(rng) {
    let angleA = seededInt(rng, 35, 85);
    let angleB = seededInt(rng, 35, 85);
    let guard = 0;
    while (angleA + angleB > 155 && guard < 20) { angleB = seededInt(rng, 35, 85); guard++; }
    const angleC = 180 - angleA - angleB;
    const askIndex = pick(rng, [0, 1, 2]);
    const vals = [angleA, angleB, angleC];
    const labels = vals.map((v, i) => (i === askIndex ? "?" : `${v}°`));
    return {
      prompt: `Find the missing angle in the triangle shown.`,
      render: <GeneralTriangleSVG sideAB={140} angleA={angleA} angleB={angleB} labelA={labels[0]} labelB={labels[1]} labelC={labels[2]} />,
      answer: `${vals[askIndex]}° (angles in a triangle sum to 180°)`,
    };
  },
};
SUBTOPIC_BANK["angles-isosceles-triangle"] = {
  topic: "Angles in Shapes", title: "Angles in an isosceles triangle", marks: 2,
  build(rng) {
    const askApex = pick(rng, [true, false]);
    if (askApex) {
      const base = seededInt(rng, 40, 75);
      const apex = 180 - 2 * base;
      return {
        prompt: `The triangle shown is isosceles. Find the size of the angle marked "?".`,
        render: <GeneralTriangleSVG sideAB={140} angleA={base} angleB={base} labelA={`${base}°`} labelB={`${base}°`} labelC="?" />,
        answer: `${apex}° (base angles are equal: 180° - 2 × ${base}° = ${apex}°)`,
      };
    }
    const apex = seededInt(rng, 15, 50) * 2;
    const base = (180 - apex) / 2;
    return {
      prompt: `The triangle shown is isosceles. Find the size of the angle marked "?".`,
      render: <GeneralTriangleSVG sideAB={140} angleA={base} angleB={base} labelA="?" labelB={`${base}°`} labelC={`${apex}°`} />,
      answer: `${base}° ((180° - ${apex}°) ÷ 2 = ${base}°)`,
    };
  },
};
SUBTOPIC_BANK["angles-exterior-triangle"] = {
  topic: "Angles in Shapes", title: "Exterior angle of a triangle", marks: 2,
  build(rng) {
    let a, c;
    do { a = seededInt(rng, 30, 85); c = seededInt(rng, 30, 85); } while (a + c > 150);
    const exterior = a + c;
    return {
      prompt: `In triangle ABC, the side AB is extended to the point D as shown. Find the size of the exterior angle CBD.`,
      render: <GeneralTriangleSVG sideAB={140} angleA={a} angleB={180 - a - c} labelA={`${a}\u00B0`} labelC={`${c}\u00B0`} labelExt="?" />,
      answer: `Exterior angle = angle A + angle C = ${a}° + ${c}° = ${exterior}° (or 180° − ${180 - a - c}° = ${exterior}°)`,
    };
  },
};
SUBTOPIC_BANK["angles-quadrilateral-sum"] = {
  topic: "Angles in Shapes", title: "Angles in a quadrilateral", marks: 2,
  build(rng) {
    const a = seededInt(rng, 60, 110);
    const b = seededInt(rng, 60, 110);
    const c = seededInt(rng, 60, 110);
    const d = 360 - a - b - c;
    return {
      prompt: `A quadrilateral has three angles of ${a}°, ${b}° and ${c}°. Find the size of the fourth angle.`,
      answer: `360° - ${a}° - ${b}° - ${c}° = ${d}°`,
    };
  },
};
SUBTOPIC_BANK["angles-parallelogram"] = {
  topic: "Angles in Shapes", title: "Angles in a parallelogram", marks: 2,
  build(rng) {
    const a = seededInt(rng, 40, 140);
    const b = 180 - a;
    const askOpposite = pick(rng, [true, false]);
    if (askOpposite) {
      return {
        prompt: `In parallelogram ABCD, angle A = ${a}°. Find the size of angle C.`,
        render: <ParallelogramAnglesSVG angleA={a} ask="C" />,
        accurateDiagram: true,
        answer: `Opposite angles in a parallelogram are equal, so angle C = ${a}°`,
      };
    }
    return {
      prompt: `In parallelogram ABCD, angle A = ${a}°. Find the size of angle B.`,
      render: <ParallelogramAnglesSVG angleA={a} ask="B" />,
      accurateDiagram: true,
      answer: `Adjacent angles in a parallelogram sum to 180°, so angle B = 180° - ${a}° = ${b}°`,
    };
  },
};
SUBTOPIC_BANK["angles-trapezium"] = {
  topic: "Angles in Shapes", title: "Angles in a trapezium", marks: 2,
  build(rng) {
    const a = seededInt(rng, 50, 130);
    const b = 180 - a;
    return {
      prompt: `ABCD is a trapezium with AB parallel to DC. Angle A = ${a}°. Find the size of angle D, given that angles A and D are co-interior angles between the parallel sides.`,
      render: <TrapeziumAnglesSVG a={a} />,
      answer: `Co-interior angles sum to 180°, so angle D = 180° - ${a}° = ${b}°`,
    };
  },
};
SUBTOPIC_BANK["angles-kite"] = {
  topic: "Angles in Shapes", title: "Angles in a kite", marks: 2,
  build(rng) {
    let angleA, angleBD, angleC, guard = 0;
    do {
      angleA = seededInt(rng, 30, 100);
      angleBD = seededInt(rng, 40, 120);
      angleC = 360 - angleA - 2 * angleBD;
      guard++;
    } while ((angleC < 20 || angleC > 150) && guard < 40);
    return {
      prompt: `ABCD is a kite, with AB = AD and CB = CD. Angle A = ${angleA}° and angle B = angle D = ${angleBD}°. Find the size of angle C.`,
      render: <KiteAnglesSVG angleA={angleA} angleBD={angleBD} />,
      answer: `360° - ${angleA}° - 2 × ${angleBD}° = ${angleC}°`,
    };
  },
};
SUBTOPIC_BANK["angles-interior-polygon-sum"] = {
  topic: "Angles in Shapes", title: "Sum of interior angles of a polygon", marks: 2,
  build(rng) {
    const n = seededInt(rng, 5, 12);
    const sum = (n - 2) * 180;
    return {
      prompt: `Work out the sum of the interior angles of a polygon with ${n} sides.`,
      answer: `(${n} - 2) × 180° = ${sum}°`,
    };
  },
};
SUBTOPIC_BANK["angles-missing-in-polygon"] = {
  topic: "Angles in Shapes", title: "Find a missing angle in a polygon", marks: 3,
  build(rng) {
    const n = seededInt(rng, 5, 7);
    const sum = (n - 2) * 180;
    let knownAngles = [], total = 0, missing = 0, guard = 0;
    do {
      knownAngles = [];
      total = 0;
      for (let i = 0; i < n - 1; i++) {
        const a = seededInt(rng, 90, 140);
        knownAngles.push(a);
        total += a;
      }
      missing = sum - total;
      guard++;
    } while ((missing < 60 || missing > 170) && guard < 60);
    const unknownIndex = seededInt(rng, 0, n - 1);
    const angles = knownAngles.slice();
    angles.splice(unknownIndex, 0, missing);
    return {
      prompt: `The diagram shows a polygon with ${n} sides. Find the size of the angle marked "?".`,
      render: <PolygonAnglesSVG angles={angles} unknownIndex={unknownIndex} />,
      accurateDiagram: true,
      answer: `Sum of interior angles = (${n} − 2) × 180° = ${sum}°. Missing angle = ${sum}° − ${total}° = ${missing}°`,
    };
  },
};
SUBTOPIC_BANK["angles-exterior-regular-polygon"] = {
  topic: "Angles in Shapes", title: "Exterior angle of a regular polygon", marks: 1,
  build(rng) {
    const n = pick(rng, [3, 4, 5, 6, 8, 9, 10, 12, 15, 18, 20]);
    const ext = 360 / n;
    return {
      prompt: `Work out the size of the exterior angle of a regular polygon with ${n} sides.`,
      answer: `360° ÷ ${n} = ${ext}°`,
    };
  },
};
SUBTOPIC_BANK["angles-interior-regular-polygon"] = {
  topic: "Angles in Shapes", title: "Interior angle of a regular polygon", marks: 2,
  build(rng) {
    const n = pick(rng, [3, 4, 5, 6, 8, 9, 10, 12, 15, 18, 20]);
    const ext = 360 / n;
    const int = 180 - ext;
    return {
      prompt: `Work out the size of the interior angle of a regular polygon with ${n} sides.`,
      answer: `Exterior angle = 360° ÷ ${n} = ${ext}°. Interior angle = 180° - ${ext}° = ${int}°`,
    };
  },
};
SUBTOPIC_BANK["angles-polygon-sides-from-angle"] = {
  topic: "Angles in Shapes", title: "Find the number of sides from an angle", marks: 3,
  build(rng) {
    const n = pick(rng, [5, 6, 8, 9, 10, 12, 15, 18, 20]);
    const useInterior = pick(rng, [true, false]);
    const ext = 360 / n;
    const int = 180 - ext;
    if (useInterior) {
      return {
        prompt: `A regular polygon has an interior angle of ${int}°. Work out the number of sides it has.`,
        answer: `Exterior angle = 180° - ${int}° = ${ext}°. Number of sides = 360° ÷ ${ext}° = ${n}`,
      };
    }
    return {
      prompt: `A regular polygon has an exterior angle of ${ext}°. Work out the number of sides it has.`,
      answer: `Number of sides = 360° ÷ ${ext}° = ${n}`,
    };
  },
};

/* --- Angles: Angles in Parallel Lines (new group) --- */
// Given the value of angle a at (line, quad), the transversal angle phi.
const y7PhiFor = (quad, a) => (quad === "NE" || quad === "SW" ? a : 180 - a);
SUBTOPIC_BANK["angles-alternate"] = {
  topic: "Angles in Parallel Lines", title: "Alternate angles", marks: 1,
  build(rng) {
    const a = seededInt(rng, 30, 150);
    let pairs = [[["P", "SE"], ["Q", "NW"]], [["P", "SW"], ["Q", "NE"]]];
    let [pa, pb] = pick(rng, pairs);
    if (rng() < 0.5) [pa, pb] = [pb, pa];
    return {
      prompt: `Two parallel lines are crossed by a transversal. Angle a and angle b are alternate angles. Angle a = ${a}°. Find the size of angle b.`,
      render: <ParallelLinesSVG phi={y7PhiFor(pa[1], a)} marks={[{ line: pa[0], quad: pa[1], label: `${a}\u00B0` }, { line: pb[0], quad: pb[1], label: "b", bold: true }]} />,
      accurateDiagram: true,
      answer: `${a}° (alternate angles are equal)`,
    };
  },
};
SUBTOPIC_BANK["angles-corresponding"] = {
  topic: "Angles in Parallel Lines", title: "Corresponding angles", marks: 1,
  build(rng) {
    const a = seededInt(rng, 30, 150);
    const quad = pick(rng, ["NE", "NW", "SE", "SW"]);
    const aOnP = rng() < 0.5;
    return {
      prompt: `Two parallel lines are crossed by a transversal. Angle a and angle b are corresponding angles. Angle a = ${a}°. Find the size of angle b.`,
      render: <ParallelLinesSVG phi={y7PhiFor(quad, a)} marks={[{ line: aOnP ? "P" : "Q", quad, label: `${a}\u00B0` }, { line: aOnP ? "Q" : "P", quad, label: "b", bold: true }]} />,
      accurateDiagram: true,
      answer: `${a}° (corresponding angles are equal)`,
    };
  },
};
SUBTOPIC_BANK["angles-co-interior"] = {
  topic: "Angles in Parallel Lines", title: "Co-interior angles", marks: 2,
  build(rng) {
    const a = seededInt(rng, 30, 150);
    const b = 180 - a;
    let pairs = [[["P", "SE"], ["Q", "NE"]], [["P", "SW"], ["Q", "NW"]]];
    let [pa, pb] = pick(rng, pairs);
    if (rng() < 0.5) [pa, pb] = [pb, pa];
    return {
      prompt: `Two parallel lines are crossed by a transversal. Angle a and angle b are co-interior (allied) angles. Angle a = ${a}°. Find the size of angle b.`,
      render: <ParallelLinesSVG phi={y7PhiFor(pa[1], a)} marks={[{ line: pa[0], quad: pa[1], label: `${a}\u00B0` }, { line: pb[0], quad: pb[1], label: "b", bold: true }]} />,
      accurateDiagram: true,
      answer: `180° - ${a}° = ${b}° (co-interior angles sum to 180°)`,
    };
  },
};
SUBTOPIC_BANK["angles-parallel-lines-two-step"] = {
  topic: "Angles in Parallel Lines", title: "Two-step angle reasoning with parallel lines", marks: 3,
  build(rng) {
    const a = seededInt(rng, 40, 140);
    const b = 180 - a;
    const alt = [[["P", "SE"], ["Q", "NW"]], [["P", "SW"], ["Q", "NE"]]];
    let [pa, palt] = pick(rng, alt);
    if (rng() < 0.5) [pa, palt] = [palt, pa];
    const q = palt[1];
    const supp = { NE: ["NW", "SE"], NW: ["NE", "SW"], SW: ["NW", "SE"], SE: ["NE", "SW"] }[q];
    const bq = pick(rng, supp);
    return {
      prompt: `Two parallel lines are crossed by a transversal, forming angle a = ${a}°. Angle b is on the same straight line as the angle alternate to angle a. Find the size of angle b.`,
      render: <ParallelLinesSVG phi={y7PhiFor(pa[1], a)} marks={[{ line: pa[0], quad: pa[1], label: `${a}\u00B0` }, { line: palt[0], quad: bq, label: "b", bold: true }]} />,
      accurateDiagram: true,
      answer: `The angle alternate to a is also ${a}° (alternate angles are equal). Angle b = 180° - ${a}° = ${b}° (angles on a straight line sum to 180°)`,
    };
  },
};

/* --- Pythagoras' Theorem: Pythagoras (extra) --- */
SUBTOPIC_BANK["pythagoras-converse-test"] = {
  topic: "Pythagoras", title: "Use the converse of Pythagoras' theorem", marks: 3,
  build(rng) {
    const isRightAngled = pick(rng, [true, false]);
    const rightTriples = [[3, 4, 5], [5, 12, 13], [6, 8, 10], [8, 15, 17], [7, 24, 25], [9, 12, 15], [10, 24, 26], [12, 16, 20]];
    const nearTriples = [[5, 6, 8], [6, 7, 9], [7, 8, 11], [5, 7, 9], [8, 9, 13], [6, 9, 11], [9, 10, 14], [7, 9, 12]];
    const [a, b, c] = pick(rng, isRightAngled ? rightTriples : nearTriples);
    const lhs = a * a + b * b, rhs = c * c;
    const equal = lhs === rhs;
    return {
      prompt: `A triangle has sides ${a} cm, ${b} cm and ${c} cm. Determine whether the triangle is right-angled.`,
      answer: `${a}² + ${b}² = ${lhs}. ${c}² = ${rhs}. Since ${lhs} ${equal ? "=" : "≠"} ${rhs}, the triangle is ${equal ? "" : "not "}right-angled.`,
    };
  },
};
SUBTOPIC_BANK["pythagoras-distance-between-points"] = {
  topic: "Pythagoras", title: "Find the distance between two coordinates", marks: 3,
  build(rng) {
    const x1 = seededInt(rng, -8, 8), y1 = seededInt(rng, -8, 8);
    const dx = seededInt(rng, 3, 12), dy = seededInt(rng, 3, 12);
    const x2 = x1 + dx, y2 = y1 + dy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return {
      prompt: `Find the distance between the points (${x1}, ${y1}) and (${x2}, ${y2}). Give your answer to 1 decimal place.`,
      answer: `√(${dx}² + ${dy}²) = √(${dx * dx} + ${dy * dy}) = ${dist.toFixed(1)}`,
    };
  },
};
SUBTOPIC_BANK["pythagoras-isosceles-length"] = {
  topic: "Pythagoras", title: "Find the height of an isosceles triangle using Pythagoras", marks: 3,
  build(rng) {
    const halfBase = seededInt(rng, 3, 10);
    const height = seededInt(rng, 4, 12);
    const equalSide = Math.sqrt(halfBase * halfBase + height * height);
    return {
      prompt: `An isosceles triangle has a base of ${halfBase * 2} cm and two equal sides of length ${equalSide.toFixed(1)} cm. Find the height of the triangle, splitting it into two right-angled triangles. Give your answer to 1 decimal place.`,
      answer: `√(${equalSide.toFixed(1)}² - ${halfBase}²) = ${height.toFixed(1)} cm`,
    };
  },
};
SUBTOPIC_BANK["pythagoras-square-diagonal"] = {
  topic: "Pythagoras", title: "Find the diagonal of a square using Pythagoras", marks: 2,
  build(rng) {
    const side = seededInt(rng, 3, 15);
    const diag = side * Math.SQRT2;
    return {
      prompt: `A square has side length ${side} cm. Find the length of its diagonal. Give your answer to 1 decimal place.`,
      answer: `√(${side}² + ${side}²) = √${2 * side * side} = ${diag.toFixed(1)} cm`,
    };
  },
};
SUBTOPIC_BANK["pythagoras-surd-answer"] = {
  topic: "Pythagoras", title: "Pythagoras with a surd-form answer", marks: 3,
  build(rng) {
    let base, height, sumSquares, m, k, guard = 0;
    do {
      base = seededInt(rng, 3, 9); height = seededInt(rng, 3, 9);
      sumSquares = base * base + height * height;
      m = sumSquares; k = 1;
      for (let p = 2; p * p <= m; p++) { while (m % (p * p) === 0) { m /= p * p; k *= p; } }
      guard++;
    } while (m === 1 && guard < 30);
    const orientation = pick(rng, ORIENTATIONS);
    const surdStr = k === 1 ? `√${m}` : `${k}√${m}`;
    return {
      prompt: `Calculate the length of the hypotenuse. Give your answer as a surd in its simplest form.`,
      render: <RightTriangleSVG base={base} height={height} orientation={orientation} baseLabel={base} heightLabel={height} hypLabel="?" />,
      answer: `√(${base}² + ${height}²) = √${sumSquares} = ${surdStr}`,
    };
  },
};

/* --- Trigonometry: Right-Angled Trigonometry (extra) --- */
SUBTOPIC_BANK["trig-exact-values"] = {
  topic: "Trigonometry", title: "Recall an exact trigonometric value", marks: 1,
  build(rng) {
    const table = [
      { expr: "sin(30°)", val: <Frac n="1" d="2" /> },
      { expr: "cos(60°)", val: <Frac n="1" d="2" /> },
      { expr: "sin(45°)", val: <><Frac n="1" d="√2" /> (or <Frac n="√2" d="2" />)</> },
      { expr: "cos(45°)", val: <><Frac n="1" d="√2" /> (or <Frac n="√2" d="2" />)</> },
      { expr: "sin(60°)", val: <Frac n="√3" d="2" /> },
      { expr: "cos(30°)", val: <Frac n="√3" d="2" /> },
      { expr: "tan(30°)", val: <><Frac n="1" d="√3" /> (or <Frac n="√3" d="3" />)</> },
      { expr: "tan(45°)", val: "1" },
      { expr: "tan(60°)", val: "√3" },
      { expr: "sin(0°)", val: "0" },
      { expr: "cos(0°)", val: "1" },
      { expr: "sin(90°)", val: "1" },
      { expr: "cos(90°)", val: "0" },
    ];
    const item = pick(rng, table);
    return { prompt: `Write down the exact value of ${item.expr}.`, answer: item.val };
  },
};
SUBTOPIC_BANK["trig-elevation-depression"] = {
  topic: "Trigonometry", title: "Angles of elevation and depression", marks: 3,
  build(rng) {
    const angle = pick(rng, [20, 25, 30, 35, 40, 45, 50, 55]);
    const dist = seededInt(rng, 10, 60);
    const height = dist * Math.tan((angle * Math.PI) / 180);
    const isElevation = pick(rng, [true, false]);
    return {
      prompt: isElevation
        ? `From a point on the ground ${dist} m from the base of a tower, the angle of elevation to the top of the tower is ${angle}°. Find the height of the tower. Give your answer to 1 decimal place.`
        : `From the top of a cliff, the angle of depression to a boat is ${angle}°. The boat is ${dist} m from the base of the cliff. Find the height of the cliff. Give your answer to 1 decimal place.`,
      answer: <>tan({angle}°) = <Frac n="height" d={dist} /> → height = {dist} × tan({angle}°) = {height.toFixed(1)} m</>,
    };
  },
};
SUBTOPIC_BANK["trig-isosceles"] = {
  topic: "Trigonometry", title: "Use trigonometry in an isosceles triangle", marks: 3,
  build(rng) {
    const apex = pick(rng, [30, 40, 50, 60, 70, 80]);
    const equalSide = seededInt(rng, 6, 15);
    const base = 2 * equalSide * Math.sin(((apex / 2) * Math.PI) / 180);
    return {
      prompt: `An isosceles triangle has two equal sides of length ${equalSide} cm, with an angle of ${apex}° between them. Find the length of the base. Give your answer to 1 decimal place.`,
      answer: <>Split into two right triangles: base = 2 × {equalSide} × sin({apex}° ÷ 2) = {base.toFixed(1)} cm</>,
    };
  },
};

/* --- Volume & Surface Area: Volume (extra) --- */
SUBTOPIC_BANK["volume-pyramid"] = {
  topic: "Volume", title: "Volume of a pyramid", marks: 3,
  build(rng) {
    const baseArea = seededInt(rng, 4, 20) * 6;
    const height = seededInt(rng, 3, 15) * 3;
    const v = (baseArea * height) / 3;
    return {
      prompt: `A pyramid has a base area of ${baseArea} cm² and a perpendicular height of ${height} cm. Calculate the volume of the pyramid.`,
      answer: <>⅓ × {baseArea} × {height} = {v} cm³</>,
    };
  },
};
SUBTOPIC_BANK["volume-cone"] = {
  topic: "Volume", title: "Volume of a cone", marks: 3,
  build(rng) {
    const r = seededInt(rng, 2, 8), h = seededInt(rng, 4, 15);
    const v = (1 / 3) * Math.PI * r * r * h;
    return {
      prompt: `A cone has a base radius of ${r} cm and a perpendicular height of ${h} cm. Calculate the volume of the cone. Give your answer to 1 decimal place.`,
      answer: <>⅓ × π × {r}² × {h} = {v.toFixed(1)} cm³</>,
    };
  },
};
SUBTOPIC_BANK["volume-sphere"] = {
  topic: "Volume", title: "Volume of a sphere", marks: 2,
  build(rng) {
    const r = seededInt(rng, 2, 10);
    const v = (4 / 3) * Math.PI * r * r * r;
    return {
      prompt: `A sphere has a radius of ${r} cm. Calculate the volume of the sphere. Give your answer to 1 decimal place.`,
      answer: <>4/3 × π × {r}³ = {v.toFixed(1)} cm³</>,
    };
  },
};

/* --- Volume & Surface Area: Surface Area (extra) --- */
SUBTOPIC_BANK["surface-area-cylinder"] = {
  topic: "Surface Area", title: "Surface area of a cylinder", marks: 3,
  build(rng) {
    const r = seededInt(rng, 2, 8), h = seededInt(rng, 4, 15);
    const sa = 2 * Math.PI * r * r + 2 * Math.PI * r * h;
    return {
      prompt: `A cylinder has a base radius of ${r} cm and a height of ${h} cm. Calculate the total surface area of the cylinder. Give your answer to 1 decimal place.`,
      answer: <>2 × π × {r}² + 2 × π × {r} × {h} = {sa.toFixed(1)} cm²</>,
    };
  },
};
SUBTOPIC_BANK["surface-area-pyramid"] = {
  topic: "Surface Area", title: "Surface area of a square-based pyramid", marks: 3,
  build(rng) {
    const base = seededInt(rng, 2, 6) * 2;
    const slantHeight = seededInt(rng, 6, 15);
    const baseArea = base * base;
    const triangleArea = 0.5 * base * slantHeight;
    const sa = baseArea + 4 * triangleArea;
    return {
      prompt: `A square-based pyramid has a base of side ${base} cm and a slant height of ${slantHeight} cm (the height of each triangular face). Calculate the total surface area of the pyramid.`,
      answer: <>Base area = {base}² = {baseArea} cm². 4 triangular faces = 4 × ½ × {base} × {slantHeight} = {4 * triangleArea} cm². Total = {sa} cm²</>,
    };
  },
};
SUBTOPIC_BANK["surface-area-sphere"] = {
  topic: "Surface Area", title: "Surface area of a sphere", marks: 1,
  build(rng) {
    const r = seededInt(rng, 2, 10);
    const sa = 4 * Math.PI * r * r;
    return {
      prompt: `A sphere has a radius of ${r} cm. Calculate the surface area of the sphere. Give your answer to 1 decimal place.`,
      answer: <>4 × π × {r}² = {sa.toFixed(1)} cm²</>,
    };
  },
};

/* --- Circle Theorems (extra, described in words) --- */
SUBTOPIC_BANK["circle-theorem-same-segment"] = {
  topic: "Circle Theorems", title: "Angles in the same segment", marks: 2,
  build(rng) {
    const angle = seededInt(rng, 25, 75);
    return {
      prompt: `A, B, C and D are points on the circumference of a circle. Angles ACB and ADB are angles in the same segment, standing on the same arc AB. Angle ACB = ${angle}°. Find the size of angle ADB.`,
      answer: `${angle}° (angles in the same segment, standing on the same arc, are equal)`,
    };
  },
};
SUBTOPIC_BANK["circle-theorem-alternate-segment"] = {
  topic: "Circle Theorems", title: "Alternate segment theorem", marks: 3,
  build(rng) {
    const angle = seededInt(rng, 25, 80);
    return {
      prompt: `A tangent touches a circle at point T. A chord TP is drawn from T, making an angle of ${angle}° with the tangent. Using the alternate segment theorem, find the size of the angle in the alternate segment (the inscribed angle subtended by TP on the other side of the chord).`,
      answer: `${angle}° (the alternate segment theorem: the angle between a tangent and a chord equals the angle in the alternate segment)`,
    };
  },
};
SUBTOPIC_BANK["circle-theorem-equal-tangents"] = {
  topic: "Circle Theorems", title: "Equal tangents from an external point", marks: 2,
  build(rng) {
    const angleAPB = seededInt(rng, 20, 100);
    const angleAOB = 180 - angleAPB;
    const askOAB = pick(rng, [true, false]);
    if (askOAB) {
      return {
        prompt: `Two tangents are drawn from an external point P to a circle with centre O, touching the circle at A and B. Angle APB = ${angleAPB}°. Find the size of angle AOB (the angle at the centre between the two radii).`,
        answer: `PA = PB and OA ⊥ PA, OB ⊥ PB, so in quadrilateral OAPB: angle AOB = 360° - 90° - 90° - ${angleAPB}° = ${angleAOB}°`,
      };
    }
    return {
      prompt: `Two tangents are drawn from an external point P to a circle with centre O, touching the circle at A and B. Angle AOB = ${angleAOB}°. Find the size of angle APB.`,
      answer: `Angle APB = 360° - 90° - 90° - ${angleAOB}° = ${angleAPB}°`,
    };
  },
};
SUBTOPIC_BANK["circle-theorem-isosceles-radii"] = {
  topic: "Circle Theorems", title: "Isosceles triangle formed by two radii", marks: 2,
  build(rng) {
    const askCentre = pick(rng, [true, false]);
    if (askCentre) {
      const base = seededInt(rng, 20, 79);
      const centre = 180 - 2 * base;
      return {
        prompt: `O is the centre of a circle, and A and B are points on the circumference. OA and OB are radii, so triangle OAB is isosceles. Angle OAB = angle OBA = ${base}°. Find the size of angle AOB.`,
        answer: `180° - 2 × ${base}° = ${centre}° (base angles of the isosceles triangle are equal)`,
      };
    }
    const centre = seededInt(rng, 10, 70) * 2;
    const base = (180 - centre) / 2;
    return {
      prompt: `O is the centre of a circle, and A and B are points on the circumference. OA and OB are radii, so triangle OAB is isosceles. Angle AOB = ${centre}°. Find the size of angle OAB.`,
      answer: `(180° - ${centre}°) ÷ 2 = ${base}° (base angles of the isosceles triangle are equal)`,
    };
  },
};

/* --- Vectors: Vector Basics (new group) --- */
SUBTOPIC_BANK["vectors-magnitude"] = {
  topic: "Vectors", title: "Calculate the magnitude of a vector", marks: 2,
  build(rng) {
    const triples = [[3, 4, 5], [5, 12, 13], [6, 8, 10], [8, 15, 17], [7, 24, 25], [9, 12, 15], [20, 21, 29]];
    const [x, y, mag] = pick(rng, triples);
    const signX = pick(rng, [1, -1]), signY = pick(rng, [1, -1]);
    const vx = x * signX, vy = y * signY;
    return {
      prompt: `Find the magnitude of the vector (${vx}, ${vy}).`,
      answer: `√((${vx})² + (${vy})²) = √(${x * x} + ${y * y}) = ${mag}`,
    };
  },
};
SUBTOPIC_BANK["vectors-equal-parallel"] = {
  topic: "Vectors", title: "Determine if two vectors are equal, parallel, or neither", marks: 2,
  build(rng) {
    const x = seededInt(rng, 1, 6), y = seededInt(rng, 1, 6);
    const relationship = pick(rng, ["equal", "parallel", "neither"]);
    let vx, vy;
    if (relationship === "equal") { vx = x; vy = y; }
    else if (relationship === "parallel") { const k = pick(rng, [2, 3, -2, -3]); vx = x * k; vy = y * k; }
    else {
      let kx, ky, guard = 0;
      do { kx = seededInt(rng, 1, 6); ky = seededInt(rng, 1, 6); guard++; } while (kx * y === ky * x && guard < 30);
      vx = kx; vy = ky;
    }
    return {
      prompt: `a = (${x}, ${y}) and b = (${vx}, ${vy}). State whether vector b is equal to vector a, parallel to vector a, or neither.`,
      answer: relationship === "equal" ? "Equal (b is identical to a)" : relationship === "parallel" ? "Parallel (b is a scalar multiple of a)" : "Neither",
    };
  },
};
SUBTOPIC_BANK["vectors-negative-scalar-multiply"] = {
  topic: "Vectors", title: "Multiply a vector by a negative scalar", marks: 1,
  build(rng) {
    const x = seededInt(rng, -8, 8), y = seededInt(rng, -8, 8);
    const k = -seededInt(rng, 2, 5);
    return {
      prompt: `a = (${x}, ${y}). Find ${k}a as a column vector.`,
      answer: `(${k} × ${x}, ${k} × ${y}) = (${k * x}, ${k * y})`,
    };
  },
};

/* --- Bearings (extra) --- */
SUBTOPIC_BANK["bearings-back-bearing"] = {
  topic: "Bearings", title: "Find a back bearing", marks: 2,
  build(rng) {
    const bearing = seededInt(rng, 1, 35) * 10;
    const back = bearing < 180 ? bearing + 180 : bearing - 180;
    return {
      prompt: `The bearing of B from A is ${String(bearing).padStart(3, "0")}°. Find the bearing of A from B.`,
      answer: `${bearing} ${bearing < 180 ? "+" : "-"} 180 = ${String(back).padStart(3, "0")}°`,
    };
  },
};

/* --- Measures & Units: Converting Units (extra) --- */
SUBTOPIC_BANK["measures-convert-area-units"] = {
  topic: "Measures & Units", title: "Convert between units of area", marks: 2,
  build(rng) {
    const direction = pick(rng, ["cm2-to-m2", "m2-to-cm2", "mm2-to-cm2"]);
    if (direction === "cm2-to-m2") {
      const m2 = seededInt(rng, 2, 40);
      const cm2 = m2 * 10000;
      return { prompt: `Convert ${cm2.toLocaleString("en-GB")} cm² to m².`, answer: `${cm2} ÷ 10,000 = ${m2} m²` };
    }
    if (direction === "m2-to-cm2") {
      const m2 = seededInt(rng, 1, 20);
      const cm2 = m2 * 10000;
      return { prompt: `Convert ${m2} m² to cm².`, answer: `${m2} × 10,000 = ${cm2.toLocaleString("en-GB")} cm²` };
    }
    const cm2 = seededInt(rng, 2, 50);
    const mm2 = cm2 * 100;
    return { prompt: `Convert ${mm2.toLocaleString("en-GB")} mm² to cm².`, answer: `${mm2} ÷ 100 = ${cm2} cm²` };
  },
};

/* --- Properties of 2D Shapes: Naming & Identifying (extra) --- */
SUBTOPIC_BANK["shape-naming-polygon-by-sides"] = {
  topic: "Properties of 2D Shapes", title: "Name a polygon from its number of sides", marks: 1,
  build(rng) {
    const polygons = [
      { n: 3, name: "triangle" }, { n: 4, name: "quadrilateral" }, { n: 5, name: "pentagon" },
      { n: 6, name: "hexagon" }, { n: 7, name: "heptagon" }, { n: 8, name: "octagon" },
      { n: 9, name: "nonagon" }, { n: 10, name: "decagon" }, { n: 12, name: "dodecagon" },
    ];
    const item = pick(rng, polygons);
    return { prompt: `What is the name of a polygon with ${item.n} sides?`, answer: item.name };
  },
};

/* =====================================================================
   Year 7 build-out — new question types written for the Year 7 booklets
   (sequences, function machines, place value, four operations, FDP,
   directed number, amounts, area, speed/distance/time, properties of
   number, angles). Each is small and Year 7-friendly: whole-number or
   simple-decimal answers, short working in the mark scheme.
   ===================================================================== */
const y7num = (v) => String(Math.round(v * 1e8) / 1e8);
const y7sgn = (v) => (v < 0 ? "−" + y7num(Math.abs(v)) : y7num(v));
const y7par = (v) => (v < 0 ? "(" + y7sgn(v) + ")" : y7num(v));
const y7comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const y7shuffle = (rng, arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const Y7_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const Y7_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function y7Words(n) {
  if (n < 20) return Y7_ONES[n];
  if (n < 100) return Y7_TENS[Math.floor(n / 10)] + (n % 10 ? "-" + Y7_ONES[n % 10] : "");
  if (n < 1000) return Y7_ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " and " + y7Words(n % 100) : "");
  const scales = [[1e6, "million"], [1e3, "thousand"]];
  for (const [v, name] of scales) {
    if (n >= v) {
      const head = y7Words(Math.floor(n / v)) + " " + name;
      const rest = n % v;
      if (!rest) return head;
      return head + (rest < 100 ? " and " : " ") + y7Words(rest);
    }
  }
  return String(n);
}
const y7hm = (t) => {
  const h = Math.floor(t + 1e-9);
  const m = Math.round((t - h) * 60);
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minutes`);
  return parts.join(" ") || "0 minutes";
};
const y7rule = (d) => (d > 0 ? `add ${y7num(d)}` : `subtract ${y7num(-d)}`);

/* --- Year 7 diagram components: number machine, number line, polygon angles --- */
// Boxes with a pointed right-hand end joined by arrows, like an exam-paper
// number machine. A step label of "?" is the unknown box.
function FunctionMachineSVG({ steps, inLabel = "input", outLabel = "output" }) {
  const boxW = 104, boxH = 58, gap = 48, labW = 66, labOutW = 82, top = 14;
  const n = steps.length;
  const x0 = labW;
  const W = x0 + gap + n * boxW + (n - 1) * gap + gap + labOutW;
  const H = top * 2 + boxH;
  const yMid = top + boxH / 2;
  const font = "'Times New Roman', Times, serif";
  const arrow = (xa, xb, key) => (
    <g key={key}>
      <line x1={xa} y1={yMid} x2={xb - 8} y2={yMid} stroke="#000" strokeWidth="1.6" />
      <polygon points={`${xb},${yMid} ${xb - 10},${yMid - 4.5} ${xb - 10},${yMid + 4.5}`} fill="#000" />
    </g>
  );
  const boxes = steps.map((label, i) => {
    const l = x0 + gap + i * (boxW + gap);
    return (
      <g key={`b${i}`}>
        <polygon points={`${l},${top} ${l + boxW - 18},${top} ${l + boxW},${yMid} ${l + boxW - 18},${top + boxH} ${l},${top + boxH}`} fill="#fff" stroke="#000" strokeWidth="1.5" />
        <text x={l + (boxW - 9) / 2} y={yMid + 7} fontSize="22" fontFamily={font} textAnchor="middle" fill="#000">{label}</text>
      </g>
    );
  });
  const arrows = [arrow(x0 + 4, x0 + gap - 2, "a0")];
  steps.forEach((_, i) => {
    const l = x0 + gap + i * (boxW + gap);
    arrows.push(arrow(l + boxW + 6, l + boxW + gap - 2, `a${i + 1}`));
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={Math.min(W * 1.15, 540)} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <text x={x0 - 4} y={yMid + 6} fontSize="19" fontFamily={font} textAnchor="end" fill="#000">{inLabel}</text>
      {boxes}
      {arrows}
      <text x={W - labOutW + 4} y={yMid + 6} fontSize="19" fontFamily={font} fill="#000">{outLabel}</text>
    </svg>
  );
}

// A real number line: a tick at every interval, only the two ends labelled,
// and an arrow pointing at one tick for the pupil to read.
function NumberLineSVG({ L, U, k, m, fmt }) {
  const W = 480, H = 100, padX = 40, y = 62;
  const x = (i) => padX + (i / k) * (W - 2 * padX);
  const f = fmt || ((v) => String(v));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={500} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <line x1={padX - 20} y1={y} x2={W - padX + 20} y2={y} stroke="#000" strokeWidth="1.6" />
      {Array.from({ length: k + 1 }, (_, i) => {
        const end = i === 0 || i === k;
        return <line key={i} x1={x(i)} y1={y - (end ? 10 : 7)} x2={x(i)} y2={y + (end ? 10 : 7)} stroke="#000" strokeWidth={end ? 1.9 : 1.4} />;
      })}
      <text x={x(0)} y={y + 28} fontSize="14" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{f(L)}</text>
      <text x={x(k)} y={y + 28} fontSize="14" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{f(U)}</text>
      <line x1={x(m)} y1={y - 40} x2={x(m)} y2={y - 14} stroke="#b23b2e" strokeWidth="2.6" />
      <polygon points={`${x(m)},${y - 6} ${x(m) - 7},${y - 18} ${x(m) + 7},${y - 18}`} fill="#b23b2e" />
    </svg>
  );
}

// A convex polygon drawn to match the interior angles given (the last two
// side lengths are solved so it closes), with an arc and label in each corner.
function PolygonAnglesSVG({ angles, unknownIndex, labels }) {
  const n = angles.length;
  const rad = (d) => (d * Math.PI) / 180;
  const ext = angles.map((a) => 180 - a);
  const dirs = [0];
  for (let k = 1; k < n; k++) dirs.push(dirs[k - 1] + ext[k]);
  const u = dirs.map((d) => [Math.cos(rad(d)), Math.sin(rad(d))]);
  let sides = null;
  for (let phase = 0; phase < 120 && !sides; phase++) {
    const s = [];
    const amp = phase < 60 ? 0.18 : 0.32;
    for (let k = 0; k < n - 2; k++) s.push(1 + amp * Math.sin(1.7 * k + phase * 2.1 + angles[0] * 0.1));
    let Ax = 0, Ay = 0;
    for (let k = 0; k < n - 2; k++) { Ax += s[k] * u[k][0]; Ay += s[k] * u[k][1]; }
    const a = u[n - 2], b = u[n - 1];
    const det = a[0] * b[1] - a[1] * b[0];
    if (Math.abs(det) < 1e-6) continue;
    const s1 = (-Ax * b[1] + Ay * b[0]) / det;
    const s2 = (a[0] * -Ay - a[1] * -Ax) / det;
    if (s1 > 0.75 && s1 < 1.6 && s2 > 0.75 && s2 < 1.6) sides = s.concat([s1, s2]);
  }
  let pts = [];
  if (sides) {
    let x = 0, y = 0;
    pts.push([x, y]);
    for (let k = 0; k < n - 1; k++) { x += sides[k] * u[k][0]; y += sides[k] * u[k][1]; pts.push([x, y]); }
  } else {
    pts = Array.from({ length: n }, (_, i) => [Math.cos(rad(90 + (360 / n) * i)), Math.sin(rad(90 + (360 / n) * i))]);
  }
  pts = pts.map(([x, y]) => [x, -y]);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const longLabels = !!labels && labels.some((l) => String(l).length > 6);
  const boxW = longLabels ? 420 : 360, boxH = longLabels ? 330 : 290, pad = longLabels ? 62 : 40;
  const sc = Math.min((boxW - 2 * pad) / (maxX - minX || 1), (boxH - 2 * pad) / (maxY - minY || 1));
  const offX = (boxW - (maxX - minX) * sc) / 2, offY = (boxH - (maxY - minY) * sc) / 2;
  const V = pts.map(([x, y]) => [offX + (x - minX) * sc, offY + (y - minY) * sc]);
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width={longLabels ? 440 : 400} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <polygon points={V.map((q) => q.join(",")).join(" ")} fill="none" stroke="#000" strokeWidth="1.6" strokeLinejoin="round" />
      {V.map((q, i) => (
        <AngleMark key={i} V={q} P={V[(i + n - 1) % n]} Q={V[(i + 1) % n]} label={labels ? labels[i] : i === unknownIndex ? "?" : `${angles[i]}\u00B0`} arcR={17} outside={longLabels} bold={i === unknownIndex} fontSize={i === unknownIndex ? 15 : 12.5} />
      ))}
    </svg>
  );
}

/* --- Year 7 drawings: area shapes, parallel lines, parallelogram angles --- */
// SVG text with an italic serif x (so the variable never looks like a times sign).
function svgMath(t) {
  const parts = String(t).split(/(x)/g);
  return parts.map((q, i) => (q === "x" ? <tspan key={i} fontStyle="italic" fontFamily="'Times New Roman', Times, serif">x</tspan> : q));
}
function rightAngleMark(x, y, dirX, dirY, size = 9) {
  // square marker at (x, y); dirX/dirY (+1/-1) point along the two arms
  return <polyline points={`${x + dirX * size},${y} ${x + dirX * size},${y + dirY * size} ${x},${y + dirY * size}`} fill="none" stroke="#000" strokeWidth="1.2" />;
}
// Parallelogram, triangle or trapezium with a dashed perpendicular height.
function AreaShapeSVG({ kind, b, h, s, a }) {
  const W = 320, H = 190, padX = 46, padTop = 22, padBot = 34;
  let pts; // in maths units, y up; bottom edge on y = 0
  let dx = 0;
  if (kind === "parallelogram") { dx = Math.sqrt(Math.max(s * s - h * h, 0.25)); pts = [[0, 0], [b, 0], [b + dx, h], [dx, h]]; }
  else if (kind === "triangle") { dx = Math.sqrt(Math.max(s * s - h * h, 0.25)); pts = [[0, 0], [b, 0], [dx, h]]; }
  else { dx = (b - a) / 2; pts = [[0, 0], [b, 0], [dx + a, h], [dx, h]]; }
  const xs = pts.map((q) => q[0]).concat(kind === "triangle" || kind === "parallelogram" ? [dx] : []);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const sc = Math.min((W - 2 * padX) / (maxX - minX), (H - padTop - padBot) / h);
  const ox = (W - (maxX - minX) * sc) / 2 - minX * sc, oy = H - padBot;
  const X = (x) => ox + x * sc, Y = (y) => oy - y * sc;
  const foot = kind === "trapezium" ? dx : dx; // foot of the perpendicular from the top-left vertex / apex
  const topPt = kind === "triangle" ? [dx, h] : [dx, h];
  const tx = (v, extra) => <text {...extra} fontSize="13" fontFamily="Arial, sans-serif" fill="#000" stroke="#fff" strokeWidth="3" paintOrder="stroke">{v}</text>;
  const beyond = foot > b ? foot : null;
  const left = foot < 0 ? foot : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={340} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <polygon points={pts.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")} fill="none" stroke="#000" strokeWidth="1.6" strokeLinejoin="round" />
      {beyond !== null && <line x1={X(b)} y1={Y(0)} x2={X(beyond)} y2={Y(0)} stroke="#000" strokeWidth="1.2" strokeDasharray="4 3" />}
      {left !== null && <line x1={X(left)} y1={Y(0)} x2={X(0)} y2={Y(0)} stroke="#000" strokeWidth="1.2" strokeDasharray="4 3" />}
      <line x1={X(foot)} y1={Y(h)} x2={X(foot)} y2={Y(0)} stroke="#000" strokeWidth="1.3" strokeDasharray="5 3" />
      {rightAngleMark(X(foot), Y(0), foot + 0.0001 < b ? 1 : -1, -1)}
      {tx(`${b} cm`, { x: X(b / 2), y: Y(0) + 20, textAnchor: "middle" })}
      {tx(`${h} cm`, { x: X(foot) + (foot < b / 2 ? 7 : -7), y: Y(h / 2) + 4, textAnchor: foot < b / 2 ? "start" : "end" })}
      {kind === "parallelogram" && tx(`${s} cm`, { x: X(b + dx / 2) + 10, y: Y(h / 2) + 4 })}
      {kind === "triangle" && tx(`${s} cm`, { x: X(dx / 2) - 11, y: Y(h / 2) - 4, textAnchor: "end" })}
      {kind === "trapezium" && tx(`${a} cm`, { x: X(dx + a / 2), y: Y(h) - 7, textAnchor: "middle" })}
    </svg>
  );
}

// Two parallel lines cut by a transversal. `phi` is the angle (degrees, from
// the right-hand direction of the lines) of the transversal's upward ray.
// Angle positions: line "P" (upper) or "Q" (lower) and quadrant NE/NW/SE/SW.
function ParallelLinesSVG({ phi, marks }) {
  const W = 340, H = 210, yP = 78, yQ = 148;
  const rad = (d) => (d * Math.PI) / 180;
  const c = Math.cos(rad(phi)), sn = Math.sin(rad(phi));
  const cot = c / sn;
  const Px = 170 + (yQ - yP) * cot / 2, Qx = Px - (yQ - yP) * cot;
  const up = [c, -sn], down = [-c, sn];
  const V = { P: [Px, yP], Q: [Qx, yQ] };
  const dirs = { NE: [[1, 0], up], NW: [up, [-1, 0]], SW: [[-1, 0], down], SE: [down, [1, 0]] };
  const ray = (v, d, len = 60) => [v[0] + d[0] * len, v[1] + d[1] * len];
  const chev = (y) => <polyline points={`292,${y - 6} 300,${y} 292,${y + 6}`} fill="none" stroke="#000" strokeWidth="1.3" />;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={360} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <line x1={16} y1={yP} x2={W - 16} y2={yP} stroke="#000" strokeWidth="1.5" />
      <line x1={16} y1={yQ} x2={W - 16} y2={yQ} stroke="#000" strokeWidth="1.5" />
      {chev(yP)}{chev(yQ)}
      <line x1={Px + up[0] * 62} y1={yP + up[1] * 62} x2={Qx + down[0] * 62} y2={yQ + down[1] * 62} stroke="#000" strokeWidth="1.5" />
      {marks.map((m, i) => {
        const v = V[m.line], [d1, d2] = dirs[m.quad];
        return <AngleMark key={i} V={v} P={ray(v, d1)} Q={ray(v, d2)} label={m.label} arcR={20} bold={m.bold} fontSize={m.bold ? 15 : 13} />;
      })}
    </svg>
  );
}

// Parallelogram ABCD with the angle at A drawn to size, plus one marked angle.
function ParallelogramAnglesSVG({ angleA, ask }) {
  const rad = (d) => (d * Math.PI) / 180;
  const A = [0, 0], B = [1.5, 0], D = [Math.cos(rad(angleA)) * 0.95, Math.sin(rad(angleA)) * 0.95];
  const C = [B[0] + D[0], D[1]];
  const pts = [A, B, C, D];
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), maxY = Math.max(...ys);
  const boxW = 340, boxH = 200, padX = 50, padT = 34, padB = 34;
  const sc = Math.min((boxW - 2 * padX) / (maxX - minX), (boxH - padT - padB) / maxY);
  const ox = (boxW - (maxX - minX) * sc) / 2 - minX * sc, oy = boxH - padB;
  const Pt = pts.map(([x, y]) => [ox + x * sc, oy - y * sc]);
  const cen = [(Pt[0][0] + Pt[2][0]) / 2, (Pt[0][1] + Pt[2][1]) / 2];
  const letters = ["A", "B", "C", "D"];
  const labels = [`${angleA}\u00B0`, ask === "B" ? "?" : "", ask === "C" ? "?" : "", ""];
  return (
    <svg viewBox={`0 0 ${boxW} ${boxH}`} width={360} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <polygon points={Pt.map((q) => q.join(",")).join(" ")} fill="none" stroke="#000" strokeWidth="1.6" strokeLinejoin="round" />
      {Pt.map((q, i) => {
        const d = [q[0] - cen[0], q[1] - cen[1]], l = Math.hypot(d[0], d[1]) || 1;
        return <text key={`t${i}`} x={q[0] + (d[0] / l) * 15} y={q[1] + (d[1] / l) * 15 + 5} fontSize="14" fontFamily="Arial, sans-serif" fontWeight="700" textAnchor="middle" fill="#000">{letters[i]}</text>;
      })}
      {Pt.map((q, i) => labels[i] ? <AngleMark key={i} V={q} P={Pt[(i + 3) % 4]} Q={Pt[(i + 1) % 4]} label={labels[i]} arcR={20} bold={labels[i] === "?"} fontSize={labels[i] === "?" ? 15 : 13} /> : null)}
    </svg>
  );
}

/* --- Sequences: drawn pattern sequences (students continue the pattern) --- */
function y7PatternShape(kind, n, p) {
  const cells = [], sticks = [];
  if (kind === "row") { const len = p.s + (n - 1) * p.d; for (let i = 0; i < len; i++) cells.push([i, 0]); }
  else if (kind === "columns") { for (let i = 0; i < n; i++) for (let j = 0; j < p.r; j++) cells.push([i, j]); }
  else if (kind === "L") { for (let j = 0; j <= n; j++) cells.push([0, j]); for (let i = 1; i <= n; i++) cells.push([i, n]); }
  else if (kind === "cross") { cells.push([n, n]); for (let k = 1; k <= n; k++) cells.push([n - k, n], [n + k, n], [n, n - k], [n, n + k]); }
  else { for (let i = 0; i <= n; i++) sticks.push([i, 0, i, 1]); for (let i = 0; i < n; i++) sticks.push([i, 0, i + 1, 0], [i, 1, i + 1, 1]); }
  return { cells, sticks };
}
function y7PatternBox(sh) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  sh.cells.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); });
  sh.sticks.forEach(([a, b, c, d]) => { x0 = Math.min(x0, a, c); y0 = Math.min(y0, b, d); x1 = Math.max(x1, a, c); y1 = Math.max(y1, b, d); });
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}
// Draws the listed patterns side by side, bottom-aligned and labelled, and
// optionally a dashed empty box (labelled) where pupils draw the next one.
function PatternSVG({ kind, p, indices, blankIndex }) {
  const U = 24, GAP = 1.6, LABEL = 22;
  const items = indices.map((n) => ({ n, blank: false, sh: y7PatternShape(kind, n, p) }));
  if (blankIndex) items.push({ n: blankIndex, blank: true, sh: y7PatternShape(kind, blankIndex, p) });
  items.forEach((it) => { it.box = y7PatternBox(it.sh); });
  const maxH = Math.max(...items.map((it) => it.box.h)) + 0.4;
  let x = 0.4;
  const placed = items.map((it) => {
    const w = Math.max(it.box.w + (it.blank ? 0.8 : 0), 3);
    const o = { ...it, x, w };
    x += w + GAP;
    return o;
  });
  const W = (x - GAP + 0.4) * U, H = maxH * U + LABEL;
  const yBase = maxH * U;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={Math.min(W * (items.length > 1 ? 2.4 : 1.3), 600)} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      {placed.map((it) => {
        const ox = (it.x + (it.w - it.box.w) / 2 - it.box.x0) * U;
        const oy = yBase - 0.2 * U - (it.box.y0 + it.box.h) * U;
        return (
          <g key={it.n}>
            {it.blank && <rect x={it.x * U} y={yBase - (it.box.h + 0.4) * U} width={it.w * U} height={(it.box.h + 0.4) * U} fill="none" stroke="#777" strokeWidth="1.2" strokeDasharray="5 4" />}
            {!it.blank && it.sh.cells.map(([cx, cy], i) => <rect key={`c${i}`} x={ox + cx * U} y={oy + cy * U} width={U} height={U} fill="#cfe0f5" stroke="#1f3d66" strokeWidth="1.4" />)}
            {!it.blank && it.sh.sticks.map(([a, b, c, d], i) => <line key={`s${i}`} x1={ox + a * U} y1={oy + b * U} x2={ox + c * U} y2={oy + d * U} stroke="#a8641c" strokeWidth="3.6" strokeLinecap="round" />)}
            <text x={(it.x + it.w / 2) * U} y={yBase + 15} fontSize="12" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">Pattern {it.n}</text>
          </g>
        );
      })}
    </svg>
  );
}
function y7PatternSpec(rng) {
  const kind = pick(rng, ["row", "columns", "L", "cross", "sticks"]);
  let p = {};
  if (kind === "row") { do { p = { s: seededInt(rng, 1, 3), d: seededInt(rng, 1, 3) }; } while (p.s === 1 && p.d === 1); }
  if (kind === "columns") p = { r: seededInt(rng, 2, 4) };
  const unit = kind === "sticks" ? "matchsticks" : pick(rng, ["squares", "tiles"]);
  const count = (n) => { const sh = y7PatternShape(kind, n, p); return sh.cells.length + sh.sticks.length; };
  return { kind, p, unit, count };
}
SUBTOPIC_BANK["seq-pattern-draw-next"] = {
  topic: "Sequences", title: "Draw the next pattern in a sequence", marks: 3,
  build(rng) {
    const { kind, p, unit, count } = y7PatternSpec(rng);
    const d = count(2) - count(1);
    return {
      prompt: `Here are the first three patterns in a sequence. (a) Draw Pattern 4 in the dashed box. (b) How many ${unit} are needed for Pattern 10?`,
      render: <PatternSVG kind={kind} p={p} indices={[1, 2, 3]} blankIndex={4} />,
      accurateDiagram: true,
      answer: `(a) Pattern 4 uses ${count(4)} ${unit} (drawn below). (b) The number of ${unit} goes up by ${d} each time, so Pattern 10 uses ${count(1)} + 9 × ${d} = ${count(10)}.`,
      answerRender: <PatternSVG kind={kind} p={p} indices={[4]} />,
    };
  },
};
SUBTOPIC_BANK["seq-pattern-count-terms"] = {
  topic: "Sequences", title: "Count a pattern sequence and continue it as numbers", marks: 2,
  build(rng) {
    const { kind, p, unit, count } = y7PatternSpec(rng);
    const d = count(2) - count(1);
    return {
      prompt: `Here are the first three patterns in a sequence. Write down the number of ${unit} in each of Patterns 1, 2 and 3, then continue the number sequence to give the number of ${unit} in Patterns 4 and 5.`,
      render: <PatternSVG kind={kind} p={p} indices={[1, 2, 3]} />,
      accurateDiagram: true,
      answer: `${[1, 2, 3, 4, 5].map(count).join(", ")} (add ${d} each time)`,
    };
  },
};

/* --- Sequences: term-to-term rules, linear and non-linear --- */
SUBTOPIC_BANK["seq-continue-linear"] = {
  topic: "Sequences", title: "Continue a linear sequence", marks: 1,
  build(rng) {
    const style = pick(rng, ["up", "up", "down", "decimal", "negative"]);
    let first, d;
    if (style === "up") { first = seededInt(rng, 1, 20); d = seededInt(rng, 2, 9); }
    else if (style === "down") { d = -seededInt(rng, 2, 9); first = seededInt(rng, 30, 60); }
    else if (style === "decimal") { d = pick(rng, [0.2, 0.3, 0.5, 0.25]); first = seededInt(rng, 1, 9) / 10; }
    else { first = -seededInt(rng, 5, 20); d = seededInt(rng, 2, 6); }
    const t = (i) => first + d * i;
    return {
      prompt: `Here is a sequence: ${[0, 1, 2, 3].map((i) => y7sgn(t(i))).join(", ")}, ... Write down the next two terms.`,
      answer: `${y7sgn(t(4))}, ${y7sgn(t(5))} (the rule is ${y7rule(d)} each time)`,
    };
  },
};
SUBTOPIC_BANK["seq-term-to-term-rule"] = {
  topic: "Sequences", title: "Describe the term-to-term rule", marks: 1,
  build(rng) {
    const kind = pick(rng, ["add", "add", "subtract", "multiply", "divide"]);
    let terms, rule;
    if (kind === "add") { const d = seededInt(rng, 2, 12), f = seededInt(rng, 1, 15); terms = [0, 1, 2, 3].map((i) => f + d * i); rule = `Add ${d} each time`; }
    else if (kind === "subtract") { const d = seededInt(rng, 2, 9), f = seededInt(rng, 40, 70); terms = [0, 1, 2, 3].map((i) => f - d * i); rule = `Subtract ${d} each time`; }
    else if (kind === "multiply") { const k = pick(rng, [2, 3, 4, 5, 10]), f = seededInt(rng, 1, 5); terms = [0, 1, 2, 3].map((i) => f * k ** i); rule = `Multiply by ${k} each time`; }
    else { const k = pick(rng, [2, 3, 5]), f = seededInt(rng, 2, 6) * k ** 3; terms = [0, 1, 2, 3].map((i) => f / k ** i); rule = `Divide by ${k} each time`; }
    return {
      prompt: `Describe the term-to-term rule for the sequence ${terms.join(", ")}, ...`,
      answer: rule,
    };
  },
};
SUBTOPIC_BANK["seq-linear-or-not"] = {
  topic: "Sequences", title: "Decide whether a sequence is linear", marks: 2,
  build(rng) {
    const kind = pick(rng, ["linear", "linear", "geometric", "squares", "triangular"]);
    let terms;
    if (kind === "linear") { const d = pick(rng, [3, 4, 5, 6, 7, 8, -2, -5]); const f = d > 0 ? seededInt(rng, 1, 12) : seededInt(rng, 30, 50); terms = [0, 1, 2, 3, 4].map((i) => f + d * i); }
    else if (kind === "geometric") { const k = pick(rng, [2, 3]); const f = seededInt(rng, 1, 4); terms = [0, 1, 2, 3, 4].map((i) => f * k ** i); }
    else if (kind === "squares") { const s = seededInt(rng, 1, 4); terms = [0, 1, 2, 3, 4].map((i) => (s + i) ** 2); }
    else { const s = seededInt(rng, 1, 3); terms = [0, 1, 2, 3, 4].map((i) => ((s + i) * (s + i + 1)) / 2); }
    const diffs = terms.slice(1).map((v, i) => v - terms[i]);
    const constant = diffs.every((x) => x === diffs[0]);
    return {
      prompt: `Is the sequence ${terms.join(", ")}, ... linear? Give a reason.`,
      answer: constant
        ? `Yes. The difference is always ${y7sgn(diffs[0])}, so it is linear.`
        : `No. The differences are ${diffs.map(y7sgn).join(", ")}, which are not constant, so it is not linear.`,
    };
  },
};
SUBTOPIC_BANK["seq-predict-pattern-term"] = {
  topic: "Sequences", title: "Predict a term in a pattern sequence", marks: 2,
  build(rng) {
    const first = seededInt(rng, 3, 8), add = seededInt(rng, 2, 5);
    const target = pick(rng, [8, 10, 12, 15, 20]);
    const obj = pick(rng, ["matchsticks", "tiles", "counters", "dots"]);
    return {
      prompt: `Pattern 1 uses ${first} ${obj}. Each new pattern uses ${add} more ${obj} than the one before. How many ${obj} are in Pattern ${target}?`,
      answer: `${first} + ${target - 1} × ${add} = ${first + (target - 1) * add}`,
    };
  },
};
SUBTOPIC_BANK["seq-missing-terms-linear"] = {
  topic: "Sequences", title: "Find the missing terms of a linear sequence", marks: 2,
  build(rng) {
    const d = pick(rng, [2, 3, 4, 5, 6, 7, -3, -4, -5]);
    const f = d > 0 ? seededInt(rng, 1, 15) : seededInt(rng, 25, 50);
    const t = (i) => f + d * i;
    if (rng() < 0.5) {
      return {
        prompt: `Fill in the missing terms of this linear sequence: ${y7sgn(t(0))}, __, __, __, ${y7sgn(t(4))}`,
        answer: `The difference is (${y7sgn(t(4))} − ${y7sgn(t(0))}) ÷ 4 = ${y7sgn(d)}, so the missing terms are ${y7sgn(t(1))}, ${y7sgn(t(2))}, ${y7sgn(t(3))}`,
      };
    }
    return {
      prompt: `Fill in the missing terms of this linear sequence: ${y7sgn(t(0))}, ${y7sgn(t(1))}, __, __, ${y7sgn(t(4))}`,
      answer: `The difference is ${y7sgn(d)}, so the missing terms are ${y7sgn(t(2))}, ${y7sgn(t(3))}`,
    };
  },
};
SUBTOPIC_BANK["seq-geometric-next"] = {
  topic: "Sequences", title: "Continue a non-linear (multiplying) sequence", marks: 1,
  build(rng) {
    const kind = pick(rng, ["multiply", "multiply", "halve"]);
    if (kind === "halve") {
      const f = seededInt(rng, 2, 5) * 32;
      const t = [0, 1, 2, 3].map((i) => f / 2 ** i);
      return { prompt: `Write down the next two terms of the sequence ${t.join(", ")}, ...`, answer: `${f / 16}, ${f / 32} (halve each time)` };
    }
    const k = pick(rng, [2, 3, 4, 5, 10]);
    const f = seededInt(rng, 1, 5);
    const t = [0, 1, 2].map((i) => f * k ** i);
    return { prompt: `Write down the next two terms of the sequence ${t.join(", ")}, ...`, answer: `${f * k ** 3}, ${f * k ** 4} (multiply by ${k} each time)` };
  },
};

/* --- Algebra: function machines --- */
function y7Machine(rng, steps) {
  for (let t = 0; t < 30; t++) {
    const m = y7MachineOnce(rng, steps);
    if (steps === 1 || m.output !== m.input) return m;
  }
  return y7MachineOnce(rng, 1);
}
function y7MachineOnce(rng, steps) {
  const input = seededInt(rng, 2, 15);
  const list = [];
  let cur = input;
  const values = [input];
  for (let s = 0; s < steps; s++) {
    let op = pick(rng, ["+", "−", "×", "×", "÷"]);
    let k;
    if (op === "÷") {
      const ks = [2, 3, 4, 5, 6].filter((x) => cur % x === 0 && cur / x >= 1);
      if (ks.length) k = pick(rng, ks); else op = "+";
    }
    if (op === "−") { if (cur > 3) k = seededInt(rng, 1, Math.min(cur - 1, 9)); else op = "+"; }
    if (op === "+") k = seededInt(rng, 1, 12);
    if (op === "×") k = seededInt(rng, 2, 9);
    cur = op === "+" ? cur + k : op === "−" ? cur - k : op === "×" ? cur * k : cur / k;
    list.push({ op, k });
    values.push(cur);
  }
  return { input, list, values, output: cur };
}
const y7ruleText = (list) => list.map((s) => `${s.op} ${s.k}`).join(", then ");
SUBTOPIC_BANK["function-machine-output"] = {
  topic: "Function Machines", title: "Find the output of a function machine", marks: 1,
  build(rng) {
    const m = y7Machine(rng, pick(rng, [1, 2, 2]));
    const working = m.list.map((s, i) => `${m.values[i]} ${s.op} ${s.k} = ${m.values[i + 1]}`).join(", ");
    return {
      prompt: `The diagram shows a number machine. Find the output when the input is ${m.input}.`,
      render: <FunctionMachineSVG steps={m.list.map((s) => `${s.op} ${s.k}`)} />,
      accurateDiagram: true,
      answer: `${m.output} (${working})`,
    };
  },
};
SUBTOPIC_BANK["function-machine-input"] = {
  topic: "Function Machines", title: "Work backwards to find the input", marks: 2,
  build(rng) {
    const m = y7Machine(rng, pick(rng, [1, 2, 2]));
    const inv = { "+": "−", "−": "+", "×": "÷", "÷": "×" };
    const steps = [];
    for (let i = m.list.length - 1; i >= 0; i--) steps.push(`${m.values[i + 1]} ${inv[m.list[i].op]} ${m.list[i].k} = ${m.values[i]}`);
    return {
      prompt: `The diagram shows a number machine. Find the input when the output is ${m.output}.`,
      render: <FunctionMachineSVG steps={m.list.map((s) => `${s.op} ${s.k}`)} />,
      accurateDiagram: true,
      answer: `${m.input} (work backwards: ${steps.join(", ")})`,
    };
  },
};
SUBTOPIC_BANK["function-machine-expression"] = {
  topic: "Function Machines", title: "Write the output of a function machine as an expression", marks: 2,
  build(rng) {
    const v = pick(rng, ["n", "x", "a"]);
    const kind = pick(rng, ["mult", "add", "multAdd", "multSub", "addMult"]);
    const k = seededInt(rng, 2, 9), c = seededInt(rng, 1, 9);
    let steps, expr;
    if (kind === "mult") { steps = [`× ${k}`]; expr = `${k}${v}`; }
    else if (kind === "add") { steps = [`+ ${c}`]; expr = `${v} + ${c}`; }
    else if (kind === "multAdd") { steps = [`× ${k}`, `+ ${c}`]; expr = `${k}${v} + ${c}`; }
    else if (kind === "multSub") { steps = [`× ${k}`, `− ${c}`]; expr = `${k}${v} − ${c}`; }
    else { steps = [`+ ${c}`, `× ${k}`]; expr = `${k}(${v} + ${c})`; }
    return {
      prompt: `The diagram shows a number machine. The input is ${v}. Write an expression for the output.`,
      render: <FunctionMachineSVG steps={steps} inLabel={v === "x" ? "input" : "input"} />,
      accurateDiagram: true,
      answer: expr,
    };
  },
};
SUBTOPIC_BANK["function-machine-find-operation"] = {
  topic: "Function Machines", title: "Find the missing step in a two-step function machine", marks: 2,
  build(rng) {
    const x = seededInt(rng, 2, 9), a = seededInt(rng, 2, 6), b = seededInt(rng, 1, 9);
    const plus = rng() < 0.6;
    const mid = x * a;
    const out = plus ? mid + b : mid - b;
    return {
      prompt: `The diagram shows a number machine. When the input is ${x}, the output is ${out}. Find the missing step in the second box.`,
      render: <FunctionMachineSVG steps={[`× ${a}`, "?"]} />,
      accurateDiagram: true,
      answer: `${x} × ${a} = ${mid}, and ${mid} to ${out} is ${plus ? "+" : "−"} ${b}. The second box is ${plus ? "+" : "−"} ${b}.`,
    };
  },
};

/* --- Algebra: equality, equivalence and one-step equations --- */
SUBTOPIC_BANK["solve-one-step-equation"] = {
  topic: "Linear Equations", title: "Solve a one-step equation", marks: 1,
  build(rng) {
    const v = pick(rng, ["x", "y", "n", "a"]);
    const kind = pick(rng, ["add", "sub", "mult", "div"]);
    const val = seededInt(rng, 2, 15), k = seededInt(rng, 2, 9);
    if (kind === "add") return { prompt: `Solve ${v} + ${k} = ${val + k}`, answer: `${v} = ${val + k} − ${k} = ${val}` };
    if (kind === "sub") return { prompt: `Solve ${v} − ${k} = ${val}`, answer: `${v} = ${val} + ${k} = ${val + k}` };
    if (kind === "mult") return { prompt: `Solve ${k}${v} = ${k * val}`, answer: `${v} = ${k * val} ÷ ${k} = ${val}` };
    return { prompt: `Solve ${v} ÷ ${k} = ${val}`, answer: `${v} = ${val} × ${k} = ${val * k}` };
  },
};
SUBTOPIC_BANK["like-terms-identify"] = {
  topic: "Algebraic Expressions", title: "Identify like terms", marks: 2,
  build(rng) {
    const v = pick(rng, ["x", "y", "a", "p"]);
    const w = pick(rng, ["b", "m", "t"]);
    const coef = () => seededInt(rng, 2, 9);
    const base = `${coef()}${v}`;
    const likeCount = pick(rng, [2, 3]);
    const likes = [];
    const used = new Set();
    while (likes.length < likeCount) {
      const c = coef();
      if (used.has(c)) continue;
      used.add(c);
      likes.push(rng() < 0.25 ? `\u2212${c}${v}` : `${c}${v}`);
    }
    const unlikePool = [`${coef()}${w}`, `${coef()}${v}²`, `${coef()}${v}${w}`, `${coef()}`, `${coef()}${w}²`];
    const unlikes = y7shuffle(rng, unlikePool).slice(0, 5 - likeCount + 1);
    const all = y7shuffle(rng, likes.concat(unlikes));
    const box = { display: "inline-block", width: 16, height: 16, border: "1.6px solid #000", marginRight: 7, verticalAlign: "-3px", background: "#fff" };
    return {
      prompt: <>Tick the boxes next to all the terms that are like terms with {mathify(base)}.</>,
      render: (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 26px", justifyContent: "center", fontSize: "1.05em" }}>
          {all.map((t, i) => <span key={i} style={{ whiteSpace: "nowrap" }}><span style={box} />{mathify(t)}</span>)}
        </div>
      ),
      accurateDiagram: true,
      answer: `${likes.join(", ")} (they all contain exactly ${v}, with no other letters or powers)`,
    };
  },
};
SUBTOPIC_BANK["equivalent-expression-choose"] = {
  topic: "Algebraic Expressions", title: "Choose an equivalent expression", marks: 1,
  build(rng) {
    let a, b;
    do { a = seededInt(rng, 2, 6); b = seededInt(rng, 2, 9); } while (a === b || a * b === a + b || a * b === b);
    const v = pick(rng, ["x", "n", "y"]);
    const correct = `${a}${v} + ${a * b}`;
    const wrong = [`${a}${v} + ${b}`, `${a + b}${v}`, `${a}${v} + ${a + b}`];
    const opts = y7shuffle(rng, [correct].concat(wrong));
    const letters = ["A", "B", "C", "D"];
    return {
      prompt: `Which expression is equivalent to ${a}(${v} + ${b})?   ${opts.map((o, i) => `${letters[i]}: ${o}`).join(",   ")}`,
      answer: `${letters[opts.indexOf(correct)]}: ${correct} (multiply both ${v} and ${b} by ${a})`,
    };
  },
};

/* --- Number: place value, number lines and rounding --- */
SUBTOPIC_BANK["place-value-write-in-words"] = {
  topic: "Place Value", title: "Write a number in words or digits", marks: 1,
  build(rng) {
    const len = pick(rng, [5, 6, 7]);
    let s = String(seededInt(rng, 1, 9));
    for (let i = 1; i < len; i++) s += rng() < 0.3 ? "0" : String(seededInt(rng, 0, 9));
    const n = Number(s);
    if (rng() < 0.5) return { prompt: `Write ${y7comma(n)} in words.`, answer: y7Words(n) };
    return { prompt: `Write "${y7Words(n)}" in digits.`, answer: y7comma(n) };
  },
};
SUBTOPIC_BANK["number-line-interval-value"] = {
  topic: "Place Value", title: "Read a value from a number line", marks: 2,
  build(rng) {
    const s = pick(rng, [0.1, 0.2, 0.5, 2, 5, 10, 20, 25]);
    const k = pick(rng, [4, 5, 8, 10]);
    const L = Math.round(s * seededInt(rng, 2, 9) * 100) / 100;
    const U = Math.round((L + k * s) * 100) / 100;
    const m = seededInt(rng, 1, k - 1);
    const val = Math.round((L + m * s) * 100) / 100;
    return {
      prompt: `The arrow points to a number on the number line. What number does the arrow point to?`,
      render: <NumberLineSVG L={L} U={U} k={k} m={m} fmt={y7num} />,
      accurateDiagram: true,
      answer: `Each interval is (${y7num(U)} − ${y7num(L)}) ÷ ${k} = ${y7num(s)}. ${y7num(L)} + ${m} × ${y7num(s)} = ${y7num(val)}`,
    };
  },
};
SUBTOPIC_BANK["round-nearest-power-of-ten"] = {
  topic: "Rounding", title: "Round to the nearest 10, 100 or 1000", marks: 1,
  build(rng) {
    const p = pick(rng, [10, 100, 1000]);
    const n = seededInt(rng, p * 3 + 1, p * 40 + 9);
    const name = p === 10 ? "10" : p === 100 ? "100" : "1000";
    return {
      prompt: `Round ${y7comma(n)} to the nearest ${name}.`,
      answer: y7comma(Math.round(n / p) * p),
    };
  },
};
SUBTOPIC_BANK["estimate-over-under"] = {
  topic: "Estimation", title: "Estimate, then say if it is an over- or under-estimate", marks: 2,
  build(rng) {
    const r1 = (x) => Number(x.toPrecision(1));
    const pool = [2.6, 3.4, 4.7, 5.2, 6.8, 7.3, 8.4, 12.7, 38, 19, 62, 47, 3.7, 6.2, 8.9];
    for (let tries = 0; tries < 60; tries++) {
      const a = pick(rng, pool), b = pick(rng, pool);
      if (a === b) continue;
      const div = rng() < 0.3;
      const ea = r1(a), eb = r1(b);
      if (div && (a < b || !Number.isInteger(ea / eb))) continue;
      const est = div ? ea / eb : ea * eb;
      const exact = div ? a / b : a * b;
      if (Math.abs(est - exact) < 1e-9) continue;
      const over = est > exact;
      return {
        prompt: `Estimate ${a} ${div ? "÷" : "×"} ${b} by rounding each number to 1 significant figure. Is your estimate an overestimate or an underestimate?`,
        answer: `${ea} ${div ? "÷" : "×"} ${eb} = ${est}. The exact answer is ${Math.round(exact * 100) / 100}, so it is an ${over ? "overestimate" : "underestimate"}.`,
      };
    }
    return { prompt: "Estimate 3.7 × 6.2 by rounding each number to 1 significant figure. Is your estimate an overestimate or an underestimate?", answer: "4 × 6 = 24. The exact answer is 22.94, so it is an overestimate." };
  },
};

/* --- Number: four operations --- */
SUBTOPIC_BANK["multiply-divide-by-powers-of-10"] = {
  topic: "Decimals", title: "Multiply and divide by 10, 100 and 1000", marks: 1,
  build(rng) {
    const base = pick(rng, [() => seededInt(rng, 3, 999), () => seededInt(rng, 11, 999) / 10, () => seededInt(rng, 101, 999) / 100]);
    const a = base();
    const p = pick(rng, [10, 100, 1000]);
    const times = rng() < 0.5;
    const res = times ? a * p : a / p;
    return { prompt: `Work out ${y7num(a)} ${times ? "×" : "÷"} ${p}`, answer: y7num(res) };
  },
};
SUBTOPIC_BANK["multiply-divide-by-0.1-0.01"] = {
  topic: "Decimals", title: "Multiply and divide by 0.1 and 0.01", marks: 1,
  build(rng) {
    const a = pick(rng, [3, 7, 12, 45, 60, 0.5, 2.4, 8.5, 36, 9]);
    const dv = pick(rng, [0.1, 0.01]);
    const times = rng() < 0.5;
    const res = times ? a * dv : a / dv;
    const p = dv === 0.1 ? 10 : 100;
    return {
      prompt: `Work out ${y7num(a)} ${times ? "×" : "÷"} ${dv}`,
      answer: `${y7num(res)} (${times ? "multiplying" : "dividing"} by ${dv} is the same as ${times ? "dividing" : "multiplying"} by ${p})`,
    };
  },
};
SUBTOPIC_BANK["divide-integer-written"] = {
  topic: "Written Methods", title: "Divide integers using a written method", marks: 2,
  build(rng) {
    const b = seededInt(rng, 3, 15);
    const q = seededInt(rng, 12, 99);
    return { prompt: `Work out ${b * q} ÷ ${b}`, answer: String(q) };
  },
};
SUBTOPIC_BANK["decimal-divide-by-integer"] = {
  topic: "Decimals", title: "Divide a decimal by an integer", marks: 2,
  build(rng) {
    const b = seededInt(rng, 2, 9);
    const dp = pick(rng, [1, 2]);
    const q = seededInt(rng, 12, 99) / 10 ** dp;
    const dividend = Math.round(q * b * 100) / 100;
    return { prompt: `Work out ${y7num(dividend)} ÷ ${b}`, answer: y7num(q) };
  },
};

/* --- Statistics --- */
SUBTOPIC_BANK["averages-four-measures"] = {
  topic: "Averages & Range", title: "Find the mode, median, mean and range", marks: 4,
  build(rng) {
    let data = null;
    for (let tries = 0; tries < 300 && !data; tries++) {
      const m = seededInt(rng, 2, 9);
      const set = [m, m];
      while (set.length < 7) {
        const v = seededInt(rng, 1, 15);
        if (v !== m && !set.includes(v)) set.push(v);
      }
      if (set.reduce((s, v) => s + v, 0) % 7 === 0) data = { m, list: y7shuffle(rng, set) };
    }
    if (!data) data = { m: 4, list: [4, 9, 2, 4, 7, 11, 5] };
    const sorted = data.list.slice().sort((x, y) => x - y);
    const mean = data.list.reduce((s, v) => s + v, 0) / 7;
    return {
      prompt: `Here are seven numbers: ${data.list.join(", ")}. Work out the mode, median, mean and range.`,
      answer: `Mode ${data.m}; median ${sorted[3]} (ordered: ${sorted.join(", ")}); mean ${mean}; range ${sorted[6]} − ${sorted[0]} = ${sorted[6] - sorted[0]}`,
    };
  },
};
SUBTOPIC_BANK["pie-chart-angle-from-frequency"] = {
  topic: "Pie Charts", title: "Work out the angle for a pie chart sector", marks: 2,
  build(rng) {
    const total = pick(rng, [20, 24, 30, 36, 40, 45, 60, 72, 90, 120]);
    const f = seededInt(rng, 1, Math.min(total - 1, 15));
    const sport = pick(rng, ["football", "netball", "swimming", "tennis", "gymnastics"]);
    const per = 360 / total;
    return {
      prompt: `${total} pupils are asked for their favourite sport. ${f} of them choose ${sport}. What angle should be used for ${sport} on a pie chart?`,
      answer: `360 ÷ ${total} = ${per}° for each pupil, so ${f} × ${per} = ${f * per}°`,
    };
  },
};

/* --- Fractions, decimals and percentages --- */
const Y7_FDP_POOL = [[1, 2], [1, 4], [3, 4], [1, 5], [2, 5], [3, 5], [4, 5], [1, 10], [3, 10], [7, 10], [9, 10], [1, 8], [3, 8], [5, 8], [7, 8], [1, 20], [3, 20], [7, 20], [9, 20], [17, 20], [1, 25], [3, 25], [7, 25], [1, 50], [3, 50]];
SUBTOPIC_BANK["fdp-convert-fraction-decimal-percentage"] = {
  topic: "Fractions, Decimals & Percentages", title: "Convert between fractions, decimals and percentages", marks: 2,
  build(rng) {
    const [n, d] = pick(rng, Y7_FDP_POOL);
    const dec = n / d;
    const pct = Math.round(dec * 1e6) / 1e4;
    const mode = pick(rng, ["fraction", "decimal", "percentage"]);
    if (mode === "fraction") {
      return {
        prompt: <>Write <Frac n={n} d={d} /> as a decimal and as a percentage.</>,
        answer: <>{n} ÷ {d} = {y7num(dec)} = {y7num(pct)}%</>,
      };
    }
    if (mode === "decimal") {
      return {
        prompt: <>Write {y7num(dec)} as a fraction in its simplest form and as a percentage.</>,
        answer: <><Frac n={n} d={d} /> and {y7num(pct)}%</>,
      };
    }
    return {
      prompt: <>Write {y7num(pct)}% as a fraction in its simplest form and as a decimal.</>,
      answer: <><Frac n={n} d={d} /> and {y7num(dec)}</>,
    };
  },
};
SUBTOPIC_BANK["equivalent-fraction-missing"] = {
  topic: "Fractions", title: "Find a missing number in equivalent fractions", marks: 1,
  build(rng) {
    let n, d;
    do { d = seededInt(rng, 3, 12); n = seededInt(rng, 1, d - 1); } while (gcd(n, d) !== 1);
    const k = seededInt(rng, 2, 9);
    if (rng() < 0.5) {
      return {
        prompt: <><Frac n={n} d={d} /> = <Frac n="?" d={d * k} /> Find the missing numerator.</>,
        answer: <>{n} × {k} = {n * k}</>,
      };
    }
    return {
      prompt: <><Frac n={n} d={d} /> = <Frac n={n * k} d="?" /> Find the missing denominator.</>,
      answer: <>{d} × {k} = {d * k}</>,
    };
  },
};
SUBTOPIC_BANK["fraction-as-division"] = {
  topic: "Fractions, Decimals & Percentages", title: "Write a division as a fraction and a decimal", marks: 2,
  build(rng) {
    const d = pick(rng, [2, 4, 5, 8, 10, 20, 25]);
    const n = seededInt(rng, 1, d * 2);
    if (n % d === 0) return this.build(rng);
    return {
      prompt: <>Write {n} ÷ {d} as a fraction, then as a decimal.</>,
      answer: <><Frac n={n} d={d} /> = {y7num(n / d)}</>,
    };
  },
};

/* --- Directed number --- */
SUBTOPIC_BANK["neg-add-subtract"] = {
  topic: "Negative Numbers", title: "Add and subtract directed numbers", marks: 1,
  build(rng) {
    const kind = pick(rng, ["addNeg", "subNeg", "negAdd", "negSub", "subPos"]);
    const p = seededInt(rng, 1, 12), q = seededInt(rng, 1, 12);
    if (kind === "addNeg") return { prompt: `Work out ${p} + (${y7sgn(-q)})`, answer: `${y7sgn(p - q)} (adding a negative is the same as subtracting)` };
    if (kind === "subNeg") return { prompt: `Work out ${p} − (${y7sgn(-q)})`, answer: `${y7sgn(p + q)} (subtracting a negative is the same as adding)` };
    if (kind === "negAdd") return { prompt: `Work out ${y7sgn(-p)} + ${q}`, answer: y7sgn(q - p) };
    if (kind === "negSub") return { prompt: `Work out ${y7sgn(-p)} − ${q}`, answer: y7sgn(-p - q) };
    return { prompt: `Work out ${y7sgn(-p)} − (${y7sgn(-q)})`, answer: `${y7sgn(q - p)} (subtracting a negative is the same as adding)` };
  },
};
SUBTOPIC_BANK["neg-missing-number"] = {
  topic: "Negative Numbers", title: "Find the missing directed number", marks: 1,
  build(rng) {
    const a = seededInt(rng, -9, 9);
    let c;
    do { c = seededInt(rng, -9, 9); } while (c === a);
    const form = pick(rng, [0, 1, 2]);
    if (form === 0) return { prompt: `Find the missing number: ${y7sgn(a)} + □ = ${y7sgn(c)}`, answer: `${y7sgn(c - a)}` };
    if (form === 1) return { prompt: `Find the missing number: □ + ${y7par(a)} = ${y7sgn(c)}`, answer: `${y7sgn(c - a)}` };
    return { prompt: `Find the missing number: ${y7sgn(a)} − □ = ${y7sgn(c)}`, answer: `${y7sgn(a - c)}` };
  },
};
SUBTOPIC_BANK["neg-bidmas"] = {
  topic: "Negative Numbers", title: "Use the order of operations with directed numbers", marks: 2,
  build(rng) {
    const t = pick(rng, [1, 2, 3]);
    if (t === 1) {
      const a = pick(rng, [-5, -4, -3, -2, 2, 3, 4, 5]);
      let b, c;
      do { b = seededInt(rng, -6, 8); c = seededInt(rng, -6, 8); } while (b === c);
      return { prompt: `Work out ${y7sgn(a)} × (${y7sgn(b)} − ${y7par(c)})`, answer: `${y7sgn(a)} × ${y7sgn(b - c)} = ${y7sgn(a * (b - c))}` };
    }
    if (t === 2) {
      const a = seededInt(rng, -9, 9);
      const b = seededInt(rng, -6, -2), c = seededInt(rng, 2, 6);
      return { prompt: `Work out ${y7sgn(a)} + ${y7par(b)} × ${c}`, answer: `${y7par(b)} × ${c} = ${y7sgn(b * c)}, then ${y7sgn(a)} + ${y7par(b * c)} = ${y7sgn(a + b * c)}` };
    }
    const c = seededInt(rng, 2, 4), q = seededInt(rng, -6, 6), b = seededInt(rng, -8, 8);
    const a = q * c + b;
    return { prompt: `Work out (${y7sgn(a)} − ${y7par(b)}) ÷ ${c}`, answer: `${y7sgn(a - b)} ÷ ${c} = ${y7sgn(q)}` };
  },
};

/* --- Fractions and percentages of amounts --- */
SUBTOPIC_BANK["fraction-find-whole"] = {
  topic: "Fractions", title: "Find the whole from a fraction of it", marks: 2,
  build(rng) {
    const d = seededInt(rng, 3, 9);
    const n = seededInt(rng, 1, Math.min(4, d - 1));
    const k = seededInt(rng, 2, 12);
    return {
      prompt: <><Frac n={n} d={d} /> of a number is {n * k}. What is the number?</>,
      answer: <>{n * k} ÷ {n} = {k}, then {k} × {d} = {d * k}</>,
    };
  },
};
SUBTOPIC_BANK["percent-of-amount-mental"] = {
  topic: "Percentages", title: "Find a percentage of an amount without a calculator", marks: 1,
  build(rng) {
    const p = pick(rng, [10, 5, 20, 25, 50, 15, 30, 40, 75]);
    const amt = seededInt(rng, 1, 20) * 20;
    const unit = pick(rng, ["", "£", "£"]);
    const val = (amt * p) / 100;
    const hint = {
      10: "divide by 10", 5: "10% is " + amt / 10 + ", so 5% is half of that", 20: "divide by 10, then double", 25: "divide by 4", 50: "halve it",
      15: "10% + 5%", 30: "find 10%, then multiply by 3", 40: "find 10%, then multiply by 4", 75: "find 25%, then multiply by 3",
    }[p];
    return { prompt: `Work out ${p}% of ${unit}${amt}`, answer: `${unit}${y7num(val)} (${hint})` };
  },
};
SUBTOPIC_BANK["percent-increase-decrease"] = {
  topic: "Percentages", title: "Increase or decrease an amount by a percentage", marks: 2,
  build(rng) {
    const p = pick(rng, [5, 10, 15, 20, 25, 30, 40, 50]);
    const amt = seededInt(rng, 2, 20) * 20;
    const up = rng() < 0.5;
    const change = (amt * p) / 100;
    const res = up ? amt + change : amt - change;
    const item = pick(rng, ["jacket", "bike", "games console", "pair of trainers", "coat"]);
    return {
      prompt: up
        ? `A ${item} costs £${amt}. The price goes up by ${p}%. Work out the new price.`
        : `A ${item} costs £${amt}. In a sale the price is reduced by ${p}%. Work out the sale price.`,
      answer: `${p}% of £${amt} = £${y7num(change)}; £${amt} ${up ? "+" : "−"} £${y7num(change)} = £${y7num(res)}`,
    };
  },
};
SUBTOPIC_BANK["percent-above-100"] = {
  topic: "Percentages", title: "Find a percentage greater than 100% of an amount", marks: 1,
  build(rng) {
    const p = pick(rng, [110, 120, 125, 150, 175, 200, 250]);
    const amt = seededInt(rng, 1, 15) * 20;
    return {
      prompt: `Work out ${p}% of ${amt}`,
      answer: `${y7num((amt * p) / 100)} (100% is ${amt} and ${p - 100}% is ${y7num((amt * (p - 100)) / 100)})`,
    };
  },
};
SUBTOPIC_BANK["percent-find-whole"] = {
  topic: "Percentages", title: "Use a percentage to find the whole", marks: 2,
  build(rng) {
    const p = pick(rng, [5, 10, 20, 25, 30, 40, 50, 60, 75, 80]);
    const whole = seededInt(rng, 2, 20) * 20;
    const part = (whole * p) / 100;
    return {
      prompt: `${p}% of a number is ${y7num(part)}. Work out the number.`,
      answer: `${p}% = ${y7num(part)}, so 1% = ${y7num(part / p)} and 100% = ${whole}`,
    };
  },
};

/* --- Perimeter and area --- */
SUBTOPIC_BANK["perimeter-polygon-calc"] = {
  topic: "Perimeter & Area", title: "Work out a perimeter", marks: 2,
  build(rng) {
    const kind = pick(rng, ["regular", "rectangle", "irregular"]);
    if (kind === "regular") {
      const n = pick(rng, [5, 6, 8]);
      const name = { 5: "pentagon", 6: "hexagon", 8: "octagon" }[n];
      const s = seededInt(rng, 3, 12);
      return { prompt: `A regular ${name} has sides of length ${s} cm. Work out its perimeter.`, answer: `${n} × ${s} = ${n * s} cm` };
    }
    if (kind === "rectangle") {
      const l = seededInt(rng, 6, 15), w = seededInt(rng, 3, l - 1);
      return { prompt: `A rectangle has length ${l} cm and perimeter ${2 * (l + w)} cm. Work out its width.`, answer: `${2 * (l + w)} ÷ 2 = ${l + w}, so the width is ${l + w} − ${l} = ${w} cm` };
    }
    const sides = [seededInt(rng, 4, 12), seededInt(rng, 4, 12), seededInt(rng, 4, 12), seededInt(rng, 4, 12)];
    return { prompt: `A quadrilateral has sides of length ${sides.join(" cm, ")} cm. Work out its perimeter.`, answer: `${sides.join(" + ")} = ${sides.reduce((s, v) => s + v, 0)} cm` };
  },
};
SUBTOPIC_BANK["area-parallelogram"] = {
  topic: "Perimeter & Area", title: "Area of a parallelogram", marks: 2,
  build(rng) {
    const b = seededInt(rng, 5, 15), h = seededInt(rng, 3, 12), s = h + seededInt(rng, 1, 4);
    return {
      prompt: `The diagram shows a parallelogram. Work out its area.`,
      render: <AreaShapeSVG kind="parallelogram" b={b} h={h} s={s} />,
      accurateDiagram: true,
      answer: `${b} × ${h} = ${b * h} cm² (use the perpendicular height, not the slanted side)`,
    };
  },
};
SUBTOPIC_BANK["area-triangle-base-height"] = {
  topic: "Perimeter & Area", title: "Area of a triangle", marks: 2,
  build(rng) {
    let b, h;
    do { b = seededInt(rng, 4, 16); h = seededInt(rng, 3, 12); } while ((b * h) % 2 !== 0);
    const s = h + seededInt(rng, 1, 4);
    return {
      prompt: `The diagram shows a triangle. Work out its area.`,
      render: <AreaShapeSVG kind="triangle" b={b} h={h} s={s} />,
      accurateDiagram: true,
      answer: `½ × ${b} × ${h} = ${(b * h) / 2} cm² (use the perpendicular height, not the slanted side)`,
    };
  },
};
SUBTOPIC_BANK["area-trapezium"] = {
  topic: "Perimeter & Area", title: "Area of a trapezium", marks: 2,
  build(rng) {
    let a, b, h;
    do { a = seededInt(rng, 3, 10); b = seededInt(rng, a + 1, 16); h = seededInt(rng, 3, 10); } while (((a + b) * h) % 2 !== 0);
    return {
      prompt: `The diagram shows a trapezium. Work out its area.`,
      render: <AreaShapeSVG kind="trapezium" b={b} h={h} a={a} />,
      accurateDiagram: true,
      answer: `½ × (${a} + ${b}) × ${h} = ${((a + b) * h) / 2} cm²`,
    };
  },
};

/* --- Speed, distance and time --- */
SUBTOPIC_BANK["time-units-convert"] = {
  topic: "Time", title: "Convert between units of time", marks: 1,
  build(rng) {
    const kind = pick(rng, ["h2m", "m2hm", "hm2m", "s2ms", "m2h"]);
    if (kind === "h2m") { const h = pick(rng, [1.5, 2.5, 3.5, 0.5, 2.25, 1.75, 4.5]); return { prompt: `Convert ${h} hours to minutes.`, answer: `${h * 60} minutes` }; }
    if (kind === "m2hm") { const m = pick(rng, [75, 95, 130, 145, 200, 250, 85]); return { prompt: `Write ${m} minutes in hours and minutes.`, answer: y7hm(m / 60) }; }
    if (kind === "hm2m") { const h = seededInt(rng, 1, 4), m = pick(rng, [10, 15, 20, 25, 40, 45]); return { prompt: `Convert ${h} hour${h === 1 ? "" : "s"} ${m} minutes to minutes.`, answer: `${h * 60 + m} minutes` }; }
    if (kind === "s2ms") { const s = pick(rng, [90, 150, 210, 270, 330, 400]); return { prompt: `Write ${s} seconds in minutes and seconds.`, answer: `${Math.floor(s / 60)} minutes ${s % 60} seconds` }; }
    const m = pick(rng, [15, 30, 45, 20, 40, 12]);
    return { prompt: `Write ${m} minutes as a fraction of an hour in its simplest form.`, answer: `${m}/60 = ${m / gcd(m, 60)}/${60 / gcd(m, 60)} of an hour` };
  },
};
SUBTOPIC_BANK["speed-calc"] = {
  topic: "Speed, Distance & Time", title: "Calculate a speed", marks: 2,
  build(rng) {
    if (rng() < 0.7) {
      const s = pick(rng, [12, 15, 20, 24, 30, 36, 40, 45, 48, 50, 60, 64, 72]);
      const t = seededInt(rng, 2, 6);
      const v = pick(rng, ["car", "coach", "train", "lorry"]);
      return { prompt: `A ${v} travels ${s * t} km in ${t} hours. Work out its average speed in km/h.`, answer: `speed = distance ÷ time = ${s * t} ÷ ${t} = ${s} km/h` };
    }
    const s = seededInt(rng, 3, 12), t = seededInt(rng, 4, 12);
    return { prompt: `A cyclist travels ${s * t} metres in ${t} seconds. Work out the speed in m/s.`, answer: `${s * t} ÷ ${t} = ${s} m/s` };
  },
};
SUBTOPIC_BANK["distance-calc"] = {
  topic: "Speed, Distance & Time", title: "Calculate a distance", marks: 2,
  build(rng) {
    const s = pick(rng, [20, 24, 32, 40, 48, 60, 64, 72, 80]);
    const t = pick(rng, [0.5, 1.5, 2, 2.5, 3, 0.75, 1.25, 4]);
    return {
      prompt: `A train travels at an average speed of ${s} km/h for ${y7hm(t)}. How far does it travel?`,
      answer: `distance = speed × time = ${s} × ${y7num(t)} = ${y7num(s * t)} km`,
    };
  },
};
SUBTOPIC_BANK["time-calc"] = {
  topic: "Speed, Distance & Time", title: "Calculate a time", marks: 2,
  build(rng) {
    const s = pick(rng, [20, 24, 32, 40, 48, 60, 64, 72, 80]);
    const t = pick(rng, [0.5, 1.5, 2, 2.5, 3, 0.75, 1.25, 4]);
    return {
      prompt: `A coach travels ${y7num(s * t)} km at an average speed of ${s} km/h. How long does the journey take? Give your answer in hours and minutes.`,
      answer: `time = distance ÷ speed = ${y7num(s * t)} ÷ ${s} = ${y7num(t)} hours${Number.isInteger(t) ? "" : " = " + y7hm(t)}`,
    };
  },
};

/* --- Properties of number --- */
SUBTOPIC_BANK["roots-evaluate"] = {
  topic: "Number Properties", title: "Work out squares, cubes, square roots and cube roots", marks: 1,
  build(rng) {
    const kind = pick(rng, ["sq", "cube", "sqrt", "cbrt"]);
    if (kind === "sq") { const n = seededInt(rng, 2, 15); return { prompt: `Work out ${n}²`, answer: String(n * n) }; }
    if (kind === "cube") { const n = seededInt(rng, 2, 10); return { prompt: `Work out ${n}³`, answer: String(n ** 3) }; }
    if (kind === "sqrt") { const n = seededInt(rng, 2, 15); return { prompt: `Work out √${n * n}`, answer: String(n) }; }
    const n = seededInt(rng, 2, 10);
    return { prompt: `Work out ∛${n ** 3}`, answer: String(n) };
  },
};
SUBTOPIC_BANK["triangular-numbers"] = {
  topic: "Number Properties", title: "Triangular numbers", marks: 1,
  build(rng) {
    const tri = (n) => (n * (n + 1)) / 2;
    const kind = pick(rng, ["list", "nth", "is"]);
    if (kind === "list") {
      const k = seededInt(rng, 5, 8);
      return { prompt: `Write down the first ${k} triangular numbers.`, answer: Array.from({ length: k }, (_, i) => tri(i + 1)).join(", ") };
    }
    if (kind === "nth") {
      const n = seededInt(rng, 6, 12);
      return { prompt: `What is the ${n}th triangular number?`, answer: `1 + 2 + ... + ${n} = ${tri(n)}` };
    }
    const isTri = rng() < 0.5;
    const n = seededInt(rng, 5, 11);
    const v = isTri ? tri(n) : tri(n) + pick(rng, [1, 2]);
    return { prompt: `Is ${v} a triangular number? Give a reason.`, answer: isTri ? `Yes: ${v} is the ${n}th triangular number (1 + 2 + ... + ${n}).` : `No: the triangular numbers near ${v} are ${tri(n)} and ${tri(n + 1)}.` };
  },
};

/* --- Angles and polygons --- */
SUBTOPIC_BANK["angle-type-name"] = {
  topic: "Angles", title: "Name the type of angle", marks: 1,
  build(rng) {
    const kind = pick(rng, ["acute", "acute", "right", "obtuse", "obtuse", "straight", "reflex", "reflex"]);
    let a;
    if (kind === "acute") a = seededInt(rng, 10, 89);
    else if (kind === "right") a = 90;
    else if (kind === "obtuse") a = seededInt(rng, 91, 179);
    else if (kind === "straight") a = 180;
    else a = seededInt(rng, 181, 359);
    return {
      prompt: `Is an angle of ${a}° acute, a right angle, obtuse, a straight line or reflex?`,
      answer: kind === "right" ? "A right angle (exactly 90°)" : kind === "straight" ? "A straight line (exactly 180°)" : kind,
    };
  },
};
SUBTOPIC_BANK["triangle-classify"] = {
  topic: "Properties of Shapes", title: "Classify a triangle from its angles", marks: 2,
  build(rng) {
    const sets = [
      [[50, 50, 80], "isosceles (two equal angles)", "acute-angled (all angles are less than 90°)"],
      [[60, 60, 60], "equilateral (three equal angles)", "acute-angled (all angles are less than 90°)"],
      [[90, 45, 45], "isosceles (two equal angles)", "right-angled (one angle is 90°)"],
      [[90, 30, 60], "scalene (all angles different)", "right-angled (one angle is 90°)"],
      [[30, 30, 120], "isosceles (two equal angles)", "obtuse-angled (one angle is more than 90°)"],
      [[20, 40, 120], "scalene (all angles different)", "obtuse-angled (one angle is more than 90°)"],
      [[50, 60, 70], "scalene (all angles different)", "acute-angled (all angles are less than 90°)"],
    ];
    const [angles, byAngle, byType] = pick(rng, sets);
    const shown = y7shuffle(rng, angles);
    return {
      prompt: `A triangle has angles of ${shown[0]}°, ${shown[1]}° and ${shown[2]}°. Give two names that describe this triangle.`,
      answer: `${byAngle[0].toUpperCase() + byAngle.slice(1)} and ${byType}`,
    };
  },
};

/* =====================================================================
   Year 8 build-out — diagram components. Every geometry or number-line
   question gets a drawing; these are the shared renderers.
   ===================================================================== */
const Y8_RED = "#b23b2e";
const y8lab = (v) => (v < 0 ? "−" + Math.abs(v) : String(v));

// Number line for inequalities. segs: [{ a, b, aClosed, bClosed }] where a/b
// of null means the line runs off that end with an arrow. dots: integers to
// mark with a filled dot (for "list the integers" answers).
function InequalityLineSVG({ lo, hi, segs = [], dots = [] }) {
  const W = 500, H = 86, padX = 34, y = 36;
  const span = hi - lo;
  const x = (v) => padX + ((v - lo) / span) * (W - 2 * padX);
  const step = span > 14 ? 2 : 1;
  const ticks = [];
  for (let v = lo; v <= hi; v++) ticks.push(v);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={500} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <line x1={x(lo) - 18} y1={y} x2={x(hi) + 18} y2={y} stroke="#000" strokeWidth="1.5" />
      <polygon points={`${x(hi) + 22},${y} ${x(hi) + 12},${y - 4} ${x(hi) + 12},${y + 4}`} fill="#000" />
      <polygon points={`${x(lo) - 22},${y} ${x(lo) - 12},${y - 4} ${x(lo) - 12},${y + 4}`} fill="#000" />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={x(v)} y1={y - 6} x2={x(v)} y2={y + 6} stroke="#000" strokeWidth="1.3" />
          {(v - lo) % step === 0 && <text x={x(v)} y={y + 24} fontSize="12.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{y8lab(v)}</text>}
        </g>
      ))}
      {segs.map((sg, i) => {
        const x1 = sg.a === null ? x(lo) - 12 : x(sg.a);
        const x2 = sg.b === null ? x(hi) + 12 : x(sg.b);
        return (
          <g key={`s${i}`}>
            <line x1={x1} y1={y} x2={x2} y2={y} stroke={Y8_RED} strokeWidth="4" />
            {sg.a === null && <polygon points={`${x1 - 8},${y} ${x1 + 2},${y - 6} ${x1 + 2},${y + 6}`} fill={Y8_RED} />}
            {sg.b === null && <polygon points={`${x2 + 8},${y} ${x2 - 2},${y - 6} ${x2 - 2},${y + 6}`} fill={Y8_RED} />}
            {sg.a !== null && <circle cx={x1} cy={y} r="6" fill={sg.aClosed ? Y8_RED : "#fff"} stroke={Y8_RED} strokeWidth="2.2" />}
            {sg.b !== null && <circle cx={x2} cy={y} r="6" fill={sg.bClosed ? Y8_RED : "#fff"} stroke={Y8_RED} strokeWidth="2.2" />}
          </g>
        );
      })}
      {dots.map((v) => <circle key={`d${v}`} cx={x(v)} cy={y} r="5.5" fill={Y8_RED} />)}
    </svg>
  );
}

// Probability scale from 0 to 1 with optional arrows/marks above the line.
function ProbabilityScaleSVG({ marks = [] }) {
  const W = 500, H = 112, padX = 40, y = 62;
  const x = (p) => padX + p * (W - 2 * padX);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={500} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <line x1={x(0)} y1={y} x2={x(1)} y2={y} stroke="#000" strokeWidth="1.6" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={i} x1={x(i / 10)} y1={y - (i % 5 === 0 ? 9 : 5)} x2={x(i / 10)} y2={y + (i % 5 === 0 ? 9 : 5)} stroke="#000" strokeWidth={i % 5 === 0 ? 1.8 : 1.2} />
      ))}
      {[[0, "0"], [0.5, "0.5"], [1, "1"]].map(([p, t]) => <text key={t} x={x(p)} y={y + 26} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{t}</text>)}
      {[[0, "Impossible"], [0.5, "Even chance"], [1, "Certain"]].map(([p, t]) => <text key={t} x={x(p)} y={y + 44} fontSize="12" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#333">{t}</text>)}
      {marks.map((m, i) => (
        <g key={i}>
          <line x1={x(m.p)} y1={y - 38} x2={x(m.p)} y2={y - 12} stroke={Y8_RED} strokeWidth="2.6" />
          <polygon points={`${x(m.p)},${y - 5} ${x(m.p) - 6},${y - 16} ${x(m.p) + 6},${y - 16}`} fill={Y8_RED} />
          {m.label && <text x={x(m.p)} y={y - 44} fontSize="15" fontWeight="700" fontFamily="Arial, sans-serif" textAnchor="middle" fill={Y8_RED}>{m.label}</text>}
        </g>
      ))}
    </svg>
  );
}

// Sample-space / two-way grid. cell(r, c) returns the text in each cell.
function SampleSpaceSVG({ corner = "", rows, cols, cell, totals }) {
  const cw = 54, ch = 32, W = (cols.length + 1 + (totals ? 1 : 0)) * cw + 8, H = (rows.length + 1 + (totals ? 1 : 0)) * ch + 8;
  const allCols = totals ? cols.concat(["Total"]) : cols;
  const allRows = totals ? rows.concat(["Total"]) : rows;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={Math.min(W * 1.15, 520)} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      {Array.from({ length: allRows.length + 2 }, (_, i) => <line key={`h${i}`} x1={4} y1={4 + i * ch} x2={4 + (allCols.length + 1) * cw} y2={4 + i * ch} stroke="#000" strokeWidth="1.2" />)}
      {Array.from({ length: allCols.length + 2 }, (_, i) => <line key={`v${i}`} x1={4 + i * cw} y1={4} x2={4 + i * cw} y2={4 + (allRows.length + 1) * ch} stroke="#000" strokeWidth="1.2" />)}
      <rect x={4} y={4} width={cw} height={ch} fill="#eee" stroke="#000" strokeWidth="1.2" />
      <text x={4 + cw / 2} y={4 + ch / 2 + 5} fontSize="12" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{corner}</text>
      {allCols.map((c, j) => <text key={`c${j}`} x={4 + (j + 1) * cw + cw / 2} y={4 + ch / 2 + 5} fontSize="13.5" fontWeight="700" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{c}</text>)}
      {allRows.map((r, i) => <text key={`r${i}`} x={4 + cw / 2} y={4 + (i + 1) * ch + ch / 2 + 5} fontSize="13.5" fontWeight="700" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{r}</text>)}
      {allRows.map((r, i) => allCols.map((c, j) => (
        <text key={`x${i}-${j}`} x={4 + (j + 1) * cw + cw / 2} y={4 + (i + 1) * ch + ch / 2 + 5} fontSize="13.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{cell(i, j)}</text>
      )))}
    </svg>
  );
}

// Circle diagrams. mode "parts": highlight one part and label it A.
// mode "measure": radius or diameter labelled. mode "sector": shaded sector.
function CircleDiagramSVG({ mode, part, label = "r", value, angle, radiusLabel, showCentre = true }) {
  const W = 260, H = 220, cx = 130, cy = 110, R = 80;
  const pt = (deg, r = R) => [cx + r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)];
  const txt = (x, y, t, extra) => <text x={x} y={y} fontSize="14" fontFamily="Arial, sans-serif" fontWeight="700" fill={Y8_RED} textAnchor="middle" {...extra}>{t}</text>;
  const items = [];
  if (mode === "parts") {
    if (part === "radius") { const [x, y] = pt(35); items.push(<line key="a" x1={cx} y1={cy} x2={x} y2={y} stroke={Y8_RED} strokeWidth="3" />); const [lx, ly] = pt(35, R * 0.5); items.push(txt(lx - 8, ly - 8, "A")); }
    if (part === "diameter") { const [x1, y1] = pt(160), [x2, y2] = pt(340); items.push(<line key="a" x1={x1} y1={y1} x2={x2} y2={y2} stroke={Y8_RED} strokeWidth="3" />); items.push(txt(cx + 4, cy - 10, "A")); }
    if (part === "chord") { const [x1, y1] = pt(205), [x2, y2] = pt(330); items.push(<line key="a" x1={x1} y1={y1} x2={x2} y2={y2} stroke={Y8_RED} strokeWidth="3" />); items.push(txt(cx, y1 + 18, "A")); }
    if (part === "tangent") { const [tx, ty] = pt(60); const dx = Math.sin((60 * Math.PI) / 180), dy = Math.cos((60 * Math.PI) / 180); items.push(<line key="a" x1={tx - dx * 70} y1={ty - dy * 70} x2={tx + dx * 70} y2={ty + dy * 70} stroke={Y8_RED} strokeWidth="3" />); items.push(txt(tx + dx * 62 + 8, ty + dy * 62 + 14, "A")); }
    if (part === "arc") { const [x1, y1] = pt(15), [x2, y2] = pt(105); items.push(<path key="a" d={`M${x1},${y1} A${R},${R} 0 0 0 ${x2},${y2}`} fill="none" stroke={Y8_RED} strokeWidth="5" />); const [lx, ly] = pt(60, R + 16); items.push(txt(lx, ly + 4, "A")); }
    if (part === "sector") { const [x1, y1] = pt(10), [x2, y2] = pt(100); items.push(<path key="a" d={`M${cx},${cy} L${x1},${y1} A${R},${R} 0 0 0 ${x2},${y2} Z`} fill="#f2b9b0" stroke={Y8_RED} strokeWidth="2.4" />); const [lx, ly] = pt(55, R * 0.55); items.push(txt(lx, ly + 5, "A")); }
    if (part === "segment") { const [x1, y1] = pt(25), [x2, y2] = pt(155); items.push(<path key="a" d={`M${x1},${y1} A${R},${R} 0 0 0 ${x2},${y2} Z`} fill="#f2b9b0" stroke={Y8_RED} strokeWidth="2.4" />); const [lx, ly] = pt(90, R * 0.82); items.push(txt(lx, ly + 5, "A")); }
    if (part === "circumference") { items.push(<circle key="a" cx={cx} cy={cy} r={R} fill="none" stroke={Y8_RED} strokeWidth="4.5" />); items.push(txt(cx + R * 0.75 + 18, cy - R * 0.75 - 6, "A")); }
  }
  if (mode === "measure") {
    if (label === "r") { const [x, y] = pt(30); items.push(<line key="a" x1={cx} y1={cy} x2={x} y2={y} stroke="#000" strokeWidth="1.6" />); const [lx, ly] = pt(30, R * 0.5); items.push(<text key="t" x={lx} y={ly - 8} fontSize="14" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000" stroke="#fff" strokeWidth="3" paintOrder="stroke">{value}</text>); }
    else { const [x1, y1] = pt(150), [x2, y2] = pt(330); items.push(<line key="a" x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000" strokeWidth="1.6" />); items.push(<text key="t" x={cx} y={cy - 9} fontSize="14" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000" stroke="#fff" strokeWidth="3" paintOrder="stroke">{value}</text>); }
  }
  if (mode === "sector") {
    const half = angle / 2;
    const a1 = 90 - half, a2 = 90 + half;
    const [x1, y1] = pt(a1), [x2, y2] = pt(a2);
    const large = angle > 180 ? 1 : 0;
    items.push(<path key="s" d={`M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${large} 0 ${x2},${y2} Z`} fill="#f2d4cf" stroke="#000" strokeWidth="1.8" />);
    const arcR = 22;
    const [ax1, ay1] = pt(a1, arcR), [ax2, ay2] = pt(a2, arcR);
    items.push(<path key="arc" d={`M${ax1},${ay1} A${arcR},${arcR} 0 ${large} 0 ${ax2},${ay2}`} fill="none" stroke="#000" strokeWidth="1.1" />);
    const [lx, ly] = pt(90, angle < 100 ? 44 : 38);
    items.push(<text key="ang" x={lx} y={ly + 4} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{angle}{"°"}</text>);
    if (radiusLabel) { const [mx, my] = pt(a1, R * 0.5); const nx = Math.cos(((a1 - 90) * Math.PI) / 180), ny = -Math.sin(((a1 - 90) * Math.PI) / 180); items.push(<text key="rl" x={mx + nx * 22} y={my + ny * 14 + 4} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000" stroke="#fff" strokeWidth="3" paintOrder="stroke">{radiusLabel}</text>); }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={300} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      {mode !== "sector" && <circle cx={cx} cy={cy} r={R} fill="none" stroke="#000" strokeWidth="1.8" />}
      {mode === "sector" && <circle cx={cx} cy={cy} r={R} fill="none" stroke="#000" strokeWidth="1.2" strokeDasharray="4 4" />}
      {items}
      {showCentre && <circle cx={cx} cy={cy} r="2.6" fill="#000" />}
    </svg>
  );
}

// Rectangle with a semicircle on one end (compound shape).
function SemicircleRectSVG({ w, h, wLabel, hLabel }) {
  const W = 300, H = 190, rectW = 120, rectH = 70, x0 = 70, y0 = 78;
  const rad = rectW / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={320} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <path d={`M${x0},${y0} L${x0},${y0 + rectH} L${x0 + rectW},${y0 + rectH} L${x0 + rectW},${y0} A${rad},${rad} 0 0 0 ${x0},${y0} Z`} fill="none" stroke="#000" strokeWidth="1.7" />
      <line x1={x0} y1={y0} x2={x0 + rectW} y2={y0} stroke="#000" strokeWidth="1.1" strokeDasharray="4 3" />
      <text x={x0 + rectW / 2} y={y0 + rectH + 20} fontSize="14" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{wLabel}</text>
      <text x={x0 - 10} y={y0 + rectH / 2 + 5} fontSize="14" fontFamily="Arial, sans-serif" textAnchor="end" fill="#000">{hLabel}</text>
    </svg>
  );
}

// Named shapes with optional mirror lines (dashed) for symmetry questions.
function SymmetryShapeSVG({ kind, sides, showLines }) {
  const C = 50;
  const regular = (n) => Array.from({ length: n }, (_, i) => { const a = ((90 + (360 / n) * i) * Math.PI) / 180; return [C + 40 * Math.cos(a), C - 40 * Math.sin(a)]; });
  const shapes = {
    square: [[20, 20], [80, 20], [80, 80], [20, 80]],
    rectangle: [[8, 28], [92, 28], [92, 72], [8, 72]],
    rhombus: [[50, 8], [90, 50], [50, 92], [10, 50]],
    parallelogram: [[24, 30], [94, 30], [76, 70], [6, 70]],
    "isosceles triangle": [[50, 12], [86, 88], [14, 88]],
    "equilateral triangle": [[50, 12], [89, 80], [11, 80]],
    kite: [[50, 6], [84, 38], [50, 94], [16, 38]],
    "isosceles trapezium": [[30, 30], [70, 30], [94, 72], [6, 72]],
  };
  const pts = kind === "regular" ? regular(sides) : shapes[kind];
  let lines = [];
  if (kind === "square") lines = [[50, 8, 50, 92], [8, 50, 92, 50], [14, 14, 86, 86], [86, 14, 14, 86]];
  else if (kind === "rectangle") lines = [[50, 18, 50, 82], [2, 50, 98, 50]];
  else if (kind === "rhombus") lines = [[50, 0, 50, 100], [0, 50, 100, 50]];
  else if (kind === "isosceles triangle") lines = [[50, 4, 50, 96]];
  else if (kind === "kite") lines = [[50, 0, 50, 100]];
  else if (kind === "isosceles trapezium") lines = [[50, 22, 50, 80]];
  else if (kind === "equilateral triangle") { const g = [(pts[0][0] + pts[1][0] + pts[2][0]) / 3, (pts[0][1] + pts[1][1] + pts[2][1]) / 3]; lines = pts.map((p) => [p[0] + (p[0] - g[0]) * 0.12, p[1] + (p[1] - g[1]) * 0.12, g[0] - (p[0] - g[0]) * 0.62, g[1] - (p[1] - g[1]) * 0.62]); }
  else if (kind === "regular") { for (let k = 0; k < sides; k++) { const a = ((90 + (180 / sides) * k) * Math.PI) / 180; lines.push([C + 46 * Math.cos(a), C - 46 * Math.sin(a), C - 46 * Math.cos(a), C + 46 * Math.sin(a)]); } }
  return (
    <svg viewBox="0 0 100 100" width={190} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <polygon points={pts.map((q) => q.join(",")).join(" ")} fill="none" stroke="#000" strokeWidth="1.8" strokeLinejoin="round" />
      {showLines && lines.map((l, i) => <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke={Y8_RED} strokeWidth="1.3" strokeDasharray="4 3" />)}
    </svg>
  );
}

// Regular polygon with one interior or exterior angle marked.
function RegularPolygonAnglesSVG({ sides, mode, label = "?" }) {
  const W = 300, H = 240, cx = 150, cy = 120, R = 82;
  const off = sides % 2 === 0 ? 90 + 180 / sides : 90;
  const pts = Array.from({ length: sides }, (_, i) => { const a = ((off + (360 / sides) * i) * Math.PI) / 180; return [cx + R * Math.cos(a), cy - R * Math.sin(a)]; });
  // choose a vertex on the right-hand side to mark
  let vi = 0, best = -1e9;
  pts.forEach((p, i) => { const score = p[0] - Math.abs(p[1] - cy) * 0.3; if (score > best) { best = score; vi = i; } });
  const V = pts[vi], prev = pts[(vi + sides - 1) % sides], next = pts[(vi + 1) % sides];
  const ext = [V[0] + (V[0] - prev[0]) * 0.95, V[1] + (V[1] - prev[1]) * 0.95];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={320} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <polygon points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#000" strokeWidth="1.7" strokeLinejoin="round" />
      {mode === "exterior" && <line x1={V[0]} y1={V[1]} x2={ext[0]} y2={ext[1]} stroke="#000" strokeWidth="1.7" />}
      {mode === "exterior"
        ? <AngleMark V={V} P={ext} Q={next} label={label} arcR={32} bold={label === "?"} fontSize={label === "?" ? 15 : 13} />
        : <AngleMark V={V} P={prev} Q={next} label={label} arcR={22} bold={label === "?"} fontSize={label === "?" ? 15 : 13} />}
    </svg>
  );
}
// One corner of a regular polygon with its exterior angle marked (number of sides unknown).
function PolygonCornerSVG({ ext }) {
  const W = 320, H = 190, V = [150, 120];
  const P = [V[0] - 110, V[1]], E = [V[0] + 90, V[1]];
  const rad = (ext * Math.PI) / 180;
  const Q = [V[0] + 100 * Math.cos(rad), V[1] - 100 * Math.sin(rad)];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={340} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <polyline points={`${P[0]},${P[1]} ${V[0]},${V[1]} ${Q[0]},${Q[1]}`} fill="none" stroke="#000" strokeWidth="1.7" strokeLinejoin="round" />
      <line x1={V[0]} y1={V[1]} x2={E[0]} y2={E[1]} stroke="#000" strokeWidth="1.7" />
      <line x1={P[0]} y1={P[1]} x2={P[0] - 22} y2={P[1] - 7} stroke="#000" strokeWidth="1.3" strokeDasharray="3 3" />
      <line x1={Q[0]} y1={Q[1]} x2={Q[0] + 7} y2={Q[1] - 20} stroke="#000" strokeWidth="1.3" strokeDasharray="3 3" />
      <AngleMark V={V} P={E} Q={Q} label={`${ext}°`} arcR={28} fontSize={13} />
      <text x={W - 8} y={H - 8} fontSize="10.5" fontFamily="Arial, sans-serif" textAnchor="end" fill="#555">part of a regular polygon</text>
    </svg>
  );
}

// Dot plot on a number line (for outliers).
function DotPlotSVG({ values, lo, hi }) {
  const W = 500, H = 130, padX = 30, base = 92;
  const x = (v) => padX + ((v - lo) / (hi - lo)) * (W - 2 * padX);
  const counts = {};
  const dots = values.map((v) => { counts[v] = (counts[v] || 0) + 1; return { v, k: counts[v] }; });
  const step = (hi - lo) > 20 ? 5 : (hi - lo) > 12 ? 2 : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={500} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <line x1={x(lo) - 10} y1={base} x2={x(hi) + 10} y2={base} stroke="#000" strokeWidth="1.5" />
      {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((v) => (
        <g key={v}>
          <line x1={x(v)} y1={base - 5} x2={x(v)} y2={base + 5} stroke="#000" strokeWidth="1.2" />
          {(v - lo) % step === 0 && <text x={x(v)} y={base + 22} fontSize="12.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{v}</text>}
        </g>
      ))}
      {dots.map((d, i) => <circle key={i} cx={x(d.v)} cy={base - 9 - (d.k - 1) * 14} r="5.5" fill="#1f3d66" />)}
    </svg>
  );
}

// Bar model: one bar split into equal-width parts, labelled with the ratio.
function BarModelSVG({ parts, labels, totalLabel }) {
  const W = 420, H = 100, x0 = 20, bw = 380, y0 = 38, bh = 36;
  const total = parts.reduce((s, v) => s + v, 0);
  let acc = 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={420} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      {totalLabel && <text x={W / 2} y={18} fontSize="14" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{totalLabel}</text>}
      {parts.map((p, i) => {
        const x = x0 + (acc / total) * bw, w = (p / total) * bw;
        acc += p;
        return (
          <g key={i}>
            {Array.from({ length: p }, (_, k) => <rect key={k} x={x + (k / p) * w} y={y0} width={w / p} height={bh} fill={i % 2 ? "#f4e3c1" : "#cfe0f5"} stroke="#000" strokeWidth="1.2" />)}
            <text x={x + w / 2} y={y0 + bh + 20} fontSize="14" fontFamily="Arial, sans-serif" fontWeight="700" textAnchor="middle" fill="#000">{labels[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Simple map: two labelled points joined by a line with its measured length.
function MapDistanceSVG({ aLabel, bLabel, lengthLabel }) {
  const W = 360, H = 190;
  const A = [70, 130], B = [290, 56];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={360} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <rect x="4" y="4" width={W - 8} height={H - 8} fill="#f3f7ee" stroke="#777" strokeWidth="1.2" />
      {[1, 2, 3, 4, 5, 6, 7].map((i) => <line key={`v${i}`} x1={4 + i * 44} y1="4" x2={4 + i * 44} y2={H - 4} stroke="#dfe7d5" strokeWidth="1" />)}
      {[1, 2, 3].map((i) => <line key={`h${i}`} x1="4" y1={4 + i * 45} x2={W - 4} y2={4 + i * 45} stroke="#dfe7d5" strokeWidth="1" />)}
      <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke="#000" strokeWidth="1.8" />
      <circle cx={A[0]} cy={A[1]} r="4.5" fill="#000" /><circle cx={B[0]} cy={B[1]} r="4.5" fill="#000" />
      <text x={A[0] - 6} y={A[1] + 20} fontSize="15" fontWeight="700" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{aLabel}</text>
      <text x={B[0] + 4} y={B[1] - 10} fontSize="15" fontWeight="700" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000">{bLabel}</text>
      <text x={(A[0] + B[0]) / 2 - 8} y={(A[1] + B[1]) / 2 - 12} fontSize="14" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000" stroke="#f3f7ee" strokeWidth="3" paintOrder="stroke">{lengthLabel}</text>
    </svg>
  );
}

// Solids: cube/cuboid/cylinder/prism reuse the existing drawings; cone,
// sphere and square pyramid are drawn here.
function SolidSVG({ kind, labels = {} }) {
  const stroke = { fill: "none", stroke: "#000", strokeWidth: 1.7, strokeLinejoin: "round" };
  const dash = { fill: "none", stroke: "#000", strokeWidth: 1.1, strokeDasharray: "3 3" };
  if (kind === "cube") return <CuboidSVG l={4} w={4} h={4} showL={labels.l || ""} showW={labels.w || ""} showH={labels.h || ""} />;
  if (kind === "cuboid") return <CuboidSVG l={7} w={4} h={5} showL={labels.l || ""} showW={labels.w || ""} showH={labels.h || ""} />;
  if (kind === "cylinder") return <CylinderSVG r={3} h={7} showR={labels.r || ""} showH={labels.h || ""} />;
  if (kind === "triangular prism") return <TriangularPrismSVG base={5} height={4} length={8} showBase={labels.base || ""} showHeight={labels.height || ""} showLength={labels.length || ""} />;
  if (kind === "cone") {
    const st = { ...stroke, strokeWidth: 1.2 }, ds = { ...dash, strokeWidth: 0.8 };
    const halo = { fill: "#000", stroke: "#fff", strokeWidth: 3, paintOrder: "stroke", fontSize: 12.5, fontFamily: "Arial, sans-serif" };
    return (
      <svg viewBox="0 0 280 270" width={266} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
        <g transform="scale(1.4)">
          <path d="M100,24 L36,150 A64,20 0 0 0 164,150 Z" {...st} />
          <path d="M36,150 A64,20 0 0 1 164,150" {...ds} />
          <line x1="100" y1="24" x2="100" y2="150" {...ds} />
          {labels.r && <line x1="100" y1="150" x2="164" y2="150" {...ds} />}
          {labels.r && <polyline points="100,141 109,141 109,150" fill="none" stroke="#000" strokeWidth="0.8" />}
        </g>
        {labels.h && <text x="136" y="129" textAnchor="end" {...halo}>{labels.h}</text>}
        {labels.r && <text x="185" y="226" textAnchor="middle" {...halo}>{labels.r}</text>}
      </svg>
    );
  }
  if (kind === "sphere") {
    return (
      <svg viewBox="0 0 200 200" width={180} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
        <circle cx="100" cy="100" r="68" {...stroke} />
        <path d="M32,100 A68,18 0 0 0 168,100" {...stroke} strokeWidth="1.2" />
        <path d="M32,100 A68,18 0 0 1 168,100" {...dash} />
        {labels.r && <><line x1="100" y1="100" x2="168" y2="100" stroke="#000" strokeWidth="1.2" /><text x="136" y="97" fontSize="12.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000" stroke="#fff" strokeWidth="3" paintOrder="stroke">{labels.r}</text></>}
      </svg>
    );
  }
  // square-based pyramid
  const st = { ...stroke, strokeWidth: 1.2 }, ds = { ...dash, strokeWidth: 0.8 };
  const halo = { fill: "#000", stroke: "#fff", strokeWidth: 4, paintOrder: "stroke", fontSize: 12.5, fontFamily: "Arial, sans-serif" };
  return (
    <svg viewBox="0 0 308 250" width={294} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <g transform="scale(1.4)">
        <polygon points="40,140 140,140 186,112 86,112" {...ds} fill="none" />
        <line x1="40" y1="140" x2="86" y2="112" {...ds} /><line x1="86" y1="112" x2="186" y2="112" {...ds} />
        <polygon points="40,140 140,140 112,26" {...st} />
        <polygon points="140,140 186,112 112,26" {...st} />
        <line x1="40" y1="140" x2="112" y2="26" {...st} />
        <line x1="86" y1="112" x2="112" y2="26" {...ds} />
        {labels.height && <line x1="112" y1="26" x2="112" y2="126" {...ds} />}
        {labels.height && <polyline points="112,117 121,117 121,126" fill="none" stroke="#000" strokeWidth="0.8" />}
        {labels.slant && <line x1="112" y1="26" x2="90" y2="140" stroke="#000" strokeWidth="0.9" strokeDasharray="2.5 2.5" />}
      </g>
      {labels.slant && <text x="162" y="150" textAnchor="middle" {...halo}>{labels.slant}</text>}
      {labels.base && <text x="126" y="226" textAnchor="middle" {...halo} stroke="none">{labels.base}</text>}
      {labels.height && <text x="157" y="134" textAnchor="middle" {...halo}>{labels.height}</text>}
    </svg>
  );
}

// Clip an infinite line (through two points) to a box; returns [x1,y1,x2,y2] or null.
function y8ClipLine(x1, y1, x2, y2, xMin, xMax, yMin, yMax) {
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = -1e4, t1 = 1e4;
  const test = (p, q) => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (test(-dx, x1 - xMin) && test(dx, xMax - x1) && test(-dy, y1 - yMin) && test(dy, yMax - y1)) return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
  return null;
}

// One angle drawn from a horizontal ray, for naming acute / right / obtuse / straight / reflex.
function AngleTypeSVG({ angle, label }) {
  const W = 300, H = 190, V = [110, 120], R = 90;
  const rad = (d) => (d * Math.PI) / 180;
  const pt = (d, r) => [V[0] + r * Math.cos(rad(d)), V[1] - r * Math.sin(rad(d))];
  const E = pt(0, R), T = pt(angle, R);
  const arcR = 28;
  const a1 = pt(0, arcR), a2 = pt(angle, arcR);
  const large = angle > 180 ? 1 : 0;
  const lp = pt(angle / 2, angle > 180 ? 46 : 50);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={320} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <line x1={V[0]} y1={V[1]} x2={E[0]} y2={E[1]} stroke="#000" strokeWidth="1.7" />
      <line x1={V[0]} y1={V[1]} x2={T[0]} y2={T[1]} stroke="#000" strokeWidth="1.7" />
      {angle === 90
        ? <polyline points={`${V[0] + 16},${V[1]} ${V[0] + 16},${V[1] - 16} ${V[0]},${V[1] - 16}`} fill="none" stroke="#000" strokeWidth="1.2" />
        : <path d={`M${a1[0]},${a1[1]} A${arcR},${arcR} 0 ${large} 0 ${a2[0]},${a2[1]}`} fill="none" stroke="#000" strokeWidth="1.2" />}
      {angle !== 90 && <text x={lp[0]} y={lp[1] + 4} fontSize="13" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#000" stroke="#fff" strokeWidth="3" paintOrder="stroke">{label}</text>}
      {angle === 90 && <text x={V[0] + 32} y={V[1] - 22} fontSize="13" fontFamily="Arial, sans-serif" fill="#000">{label}</text>}
      <circle cx={V[0]} cy={V[1]} r="2.4" fill="#000" />
    </svg>
  );
}

// A quadrilateral with each side labelled (for perimeter questions).
function QuadSidesSVG({ sides }) {
  const W = 320, H = 190;
  const P = [[60, 150], [250, 150], [284, 70], [96, 38]];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const off = [[0, 18], [18, 6], [0, -10], [-16, 4]];
  const anchors = ["middle", "start", "middle", "end"];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={340} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>
      <polygon points={P.map((q) => q.join(",")).join(" ")} fill="none" stroke="#000" strokeWidth="1.7" strokeLinejoin="round" />
      {sides.map((s, i) => {
        const m = mid(P[i], P[(i + 1) % 4]);
        return <text key={i} x={m[0] + off[i][0]} y={m[1] + off[i][1]} fontSize="14" fontFamily="Arial, sans-serif" textAnchor={anchors[i]} fill="#000">{s}</text>;
      })}
    </svg>
  );
}

// Helper: line-graph on the coordinate grid for y = mx + c with lattice points marked.
function y8LineOnGrid(m, c, extra = []) {
  const pts = [];
  for (let x = -5; x <= 5; x++) { const y = m * x + c; if (Math.abs(y) <= 6) pts.push({ x, y, label: "" }); }
  return <CoordinateGridSVG points={pts.concat(extra)} lines={[{ x1: 0, y1: c, x2: 1, y2: m + c }]} />;
}
// Solution of x ? t drawn on a number line centred on t.
function y8SolutionLine(t, symbol) {
  const lo = Math.round(t) - 6, hi = Math.round(t) + 6;
  const closed = symbol === "≤" || symbol === "≥";
  const seg = symbol === ">" || symbol === "≥" ? { a: t, aClosed: closed, b: null } : { a: null, b: t, bClosed: closed };
  return <InequalityLineSVG lo={lo} hi={hi} segs={[seg]} />;
}

/* =====================================================================
   Year 8 build-out — new question types, and drawn versions of existing
   geometry / number-line questions.
   ===================================================================== */
const y8pm = (v) => (v < 0 ? `− ${Math.abs(v)}` : `+ ${v}`);
const y8term = (a, v = "x") => (a === 1 ? v : a === -1 ? "−" + v : a < 0 ? "−" + Math.abs(a) + v : a + v);
const y8lin = (a, b, v = "x") => `${y8term(a, v)}${b === 0 ? "" : " " + y8pm(b)}`;
const Y8_NAMES = [["Asha", "Ben"], ["Priya", "Tom"], ["Zara", "Luke"], ["Maya", "Jack"], ["Ella", "Sam"]];

/* --- Ratio and proportion --- */
SUBTOPIC_BANK["ratio-bar-model"] = {
  topic: "Ratio", title: "Share an amount using a bar model", marks: 2,
  build(rng) {
    const [a, b] = pick(rng, [[1, 2], [2, 3], [3, 4], [2, 5], [1, 4], [3, 5], [1, 3], [4, 5]]);
    const unit = seededInt(rng, 2, 12) * pick(rng, [1, 5]);
    const total = (a + b) * unit;
    const [n1, n2] = pick(rng, Y8_NAMES);
    return {
      prompt: `${n1} and ${n2} share £${total} in the ratio ${a} : ${b}. The bar model shows the ratio. Work out how much each person gets.`,
      render: <BarModelSVG parts={[a, b]} labels={[n1, n2]} totalLabel={`£${total}`} />,
      accurateDiagram: true,
      answer: `${a + b} equal parts = £${total}, so 1 part = £${unit}. ${n1}: ${a} × £${unit} = £${a * unit}; ${n2}: ${b} × £${unit} = £${b * unit}`,
    };
  },
};
SUBTOPIC_BANK["ratio-one-to-n"] = {
  topic: "Ratio", title: "Write a ratio in the form 1 : n", marks: 2,
  build(rng) {
    const a = pick(rng, [2, 4, 5, 8, 10]);
    const b = seededInt(rng, 3, 40);
    if (b % a === 0) return this.build(rng);
    const n = Math.round((b / a) * 1000) / 1000;
    return { prompt: `Write the ratio ${a} : ${b} in the form 1 : n.`, answer: `${a} : ${b} = 1 : ${y7num(n)} (divide both parts by ${a})` };
  },
};
SUBTOPIC_BANK["currency-convert"] = {
  topic: "Proportion", title: "Convert between currencies", marks: 2,
  build(rng) {
    const [cur, sym, rate] = pick(rng, [["euros", "€", 1.15], ["US dollars", "$", 1.25], ["euros", "€", 1.2], ["Australian dollars", "A$", 1.9], ["Swiss francs", "CHF ", 1.1]]);
    if (rng() < 0.5) {
      const gbp = seededInt(rng, 2, 30) * 10;
      return { prompt: `The exchange rate is £1 = ${sym}${rate}. Convert £${gbp} into ${cur}.`, answer: `${gbp} × ${rate} = ${sym}${y7num(Math.round(gbp * rate * 100) / 100)}` };
    }
    const k = seededInt(rng, 3, 40) * 5;
    const amount = Math.round(k * rate * 100) / 100;
    return { prompt: `The exchange rate is £1 = ${sym}${rate}. Convert ${sym}${y7num(amount)} into pounds (£).`, answer: `${y7num(amount)} ÷ ${rate} = £${k}` };
  },
};
SUBTOPIC_BANK["scale-map-distance"] = {
  topic: "Scale", title: "Use a map scale", marks: 2,
  build(rng) {
    const scale = pick(rng, [20000, 25000, 50000, 100000]);
    const cm = pick(rng, [2, 2.5, 3, 4, 4.5, 5, 6, 7.5, 8]);
    const km = (cm * scale) / 100000;
    if (rng() < 0.6) {
      return {
        prompt: `The map has a scale of 1 : ${y7comma(scale)}. The distance between towns A and B on the map is ${y7num(cm)} cm. Work out the real distance between the towns, in km.`,
        render: <MapDistanceSVG aLabel="A" bLabel="B" lengthLabel={`${y7num(cm)} cm`} />,
        accurateDiagram: true,
        answer: `${y7num(cm)} × ${y7comma(scale)} = ${y7comma(cm * scale)} cm = ${y7num(km)} km`,
      };
    }
    return {
      prompt: `The map has a scale of 1 : ${y7comma(scale)}. The real distance between towns A and B is ${y7num(km)} km. How far apart are the towns on the map, in cm?`,
      render: <MapDistanceSVG aLabel="A" bLabel="B" lengthLabel="? cm" />,
      accurateDiagram: true,
      answer: `${y7num(km)} km = ${y7comma(Math.round(km * 100000))} cm; ${y7comma(Math.round(km * 100000))} ÷ ${y7comma(scale)} = ${y7num(cm)} cm`,
    };
  },
};

/* --- Algebraic manipulation --- */
SUBTOPIC_BANK["alg-classify-type"] = {
  topic: "Algebraic Expressions", title: "Expression, equation, formula or identity?", marks: 1,
  build(rng) {
    const a = seededInt(rng, 2, 9), b = seededInt(rng, 1, 9), c = seededInt(rng, 10, 40);
    const kind = pick(rng, ["expression", "equation", "formula", "identity"]);
    let stmt, why;
    if (kind === "expression") { stmt = pick(rng, [`${a}x + ${b}`, `${a}(x − ${b})`, `${a}y² − ${b}y`]); why = "it has no equals sign and nothing to solve"; }
    else if (kind === "equation") { stmt = `${a}x + ${b} = ${c}`; why = "it can be solved to find a particular value of x"; }
    else if (kind === "formula") { stmt = pick(rng, ["A = l × w", "P = 2l + 2w", "v = u + at", "C = 2πr", `F = ${a}m`]); why = "it links different quantities (variables) using an equals sign"; }
    else { stmt = `${a}(x + ${b}) ≡ ${a}x + ${a * b}`; why = "both sides are always equal, whatever the value of x"; }
    return { prompt: `Is ${stmt} an expression, an equation, a formula or an identity?`, answer: `${kind.charAt(0).toUpperCase() + kind.slice(1)} (${why})` };
  },
};
SUBTOPIC_BANK["form-expression-perimeter"] = {
  topic: "Algebraic Expressions", title: "Write an expression for the perimeter of a shape", marks: 2,
  build(rng) {
    if (rng() < 0.55) {
      const a = seededInt(rng, 1, 5), b = seededInt(rng, 1, 9), c = seededInt(rng, 1, 4), d = seededInt(rng, 1, 8);
      const A = 2 * (a + c), B = 2 * (b + d);
      return {
        prompt: `The diagram shows a rectangle. Write an expression for the perimeter of the rectangle. Give your answer in its simplest form.`,
        render: <RectangleSVG w={1} h={1} wLabel={`(${y8lin(a, b)}) cm`} hLabel={`(${y8lin(c, d)}) cm`} />,
        accurateDiagram: true,
        answer: `2(${y8lin(a, b)}) + 2(${y8lin(c, d)}) = ${y8term(A)} + ${B} (cm)`.replace("+ -", "−"),
      };
    }
    const a = seededInt(rng, 2, 5), b = seededInt(rng, 1, 6), c = seededInt(rng, 1, 4);
    return {
      prompt: `The diagram shows an isosceles triangle. Write an expression for its perimeter. Give your answer in its simplest form.`,
      render: <GeneralTriangleSVG sideAB={140} angleA={68} angleB={68} sideALabel={`${y8lin(a, b)}`} sideBLabel={`${y8lin(a, b)}`} sideCLabel={`${y8lin(c, 0)}`} />,
      accurateDiagram: true,
      answer: `2(${y8lin(a, b)}) + ${y8term(c)} = ${y8term(2 * a + c)} + ${2 * b}`,
    };
  },
};
SUBTOPIC_BANK["alg-directed-simplify"] = {
  topic: "Algebraic Expressions", title: "Simplify with directed numbers", marks: 2,
  build(rng) {
    const v = pick(rng, ["a", "x", "y", "p"]);
    const kind = pick(rng, [1, 2, 3, 4]);
    const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9);
    if (kind === 1) return { prompt: `Simplify −${a}${v} + ${b}${v}`, answer: y8term(b - a, v) === "0" ? "0" : `${y8term(b - a, v)}` };
    if (kind === 2) return { prompt: `Simplify ${a}${v} − ${a + b}${v}`, answer: y8term(-b, v) };
    if (kind === 3) return { prompt: `Simplify −${a}${v} − (−${b}${v})`, answer: `${y8term(b - a, v)} (subtracting a negative is the same as adding)` };
    return { prompt: `Simplify −${a}${v} × ${b}`, answer: y8term(-a * b, v) };
  },
};

/* --- Coordinates and graphs --- */
SUBTOPIC_BANK["coord-fourth-vertex"] = {
  topic: "Coordinates", title: "Find the fourth vertex of a rectangle or parallelogram", marks: 2,
  build(rng) {
    const rect = rng() < 0.6;
    const x1 = seededInt(rng, -5, -2), x2 = seededInt(rng, 2, 5), y1 = seededInt(rng, -5, -2), y2 = seededInt(rng, 2, 5);
    if (rect) {
      return {
        prompt: `The diagram shows three vertices of a rectangle ABCD. Write down the coordinates of vertex D.`,
        render: <CoordinateGridSVG points={[{ x: x1, y: y1, label: "A" }, { x: x2, y: y1, label: "B" }, { x: x2, y: y2, label: "C" }]} segments={[{ x1, y1, x2, y2: y1 }, { x1: x2, y1, x2, y2 }]} />,
        accurateDiagram: true,
        answer: `D = (${x1}, ${y2}) (it has the same x-coordinate as A and the same y-coordinate as C)`,
        answerRender: <CoordinateGridSVG points={[{ x: x1, y: y1, label: "A" }, { x: x2, y: y1, label: "B" }, { x: x2, y: y2, label: "C" }, { x: x1, y: y2, label: "D" }]} polygon={[{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }]} />,
      };
    }
    const sh = seededInt(rng, 1, 3);
    const A = [x1, y1], B = [x2 - 1, y1], C = [x2 - 1 + sh, y2], D = [x1 + sh, y2];
    return {
      prompt: `The diagram shows three vertices of a parallelogram ABCD. Write down the coordinates of vertex D.`,
      render: <CoordinateGridSVG points={[{ x: A[0], y: A[1], label: "A" }, { x: B[0], y: B[1], label: "B" }, { x: C[0], y: C[1], label: "C" }]} segments={[{ x1: A[0], y1: A[1], x2: B[0], y2: B[1] }, { x1: B[0], y1: B[1], x2: C[0], y2: C[1] }]} />,
      accurateDiagram: true,
      answer: `D = (${D[0]}, ${D[1]}) (AD is parallel and equal to BC, so D is ${sh} to the right of A and ${y2 - y1} up)`,
      answerRender: <CoordinateGridSVG points={[{ x: A[0], y: A[1], label: "A" }, { x: B[0], y: B[1], label: "B" }, { x: C[0], y: C[1], label: "C" }, { x: D[0], y: D[1], label: "D" }]} polygon={[{ x: A[0], y: A[1] }, { x: B[0], y: B[1] }, { x: C[0], y: C[1] }, { x: D[0], y: D[1] }]} />,
    };
  },
};
SUBTOPIC_BANK["line-equation-axis-parallel"] = {
  topic: "Coordinates", title: "Write the equation of a line parallel to an axis", marks: 1,
  build(rng) {
    let k = seededInt(rng, -5, 5);
    if (k === 0) k = 3;
    const horizontal = rng() < 0.5;
    const line = horizontal ? { x1: -6, y1: k, x2: 6, y2: k } : { x1: k, y1: -6, x2: k, y2: 6 };
    const pts = [-2, 0, 2].map((t) => (horizontal ? { x: t * 2, y: k, label: "" } : { x: k, y: t * 2, label: "" }));
    return {
      prompt: `Write down the equation of the line shown on the grid.`,
      render: <CoordinateGridSVG points={pts} lines={[line]} />,
      accurateDiagram: true,
      answer: horizontal ? `y = ${k} (every point on the line has y-coordinate ${k})` : `x = ${k} (every point on the line has x-coordinate ${k})`,
    };
  },
};
function y8LineParams(rng) {
  let m, c;
  do { m = pick(rng, [-3, -2, -1, 1, 2, 3]); c = seededInt(rng, -3, 3); } while (Math.abs(m * 2 + c) > 6 || Math.abs(-2 * m + c) > 6);
  return { m, c };
}
SUBTOPIC_BANK["line-gradient-intercept-read"] = {
  topic: "Coordinates", title: "Read the gradient and y-intercept from a graph", marks: 2,
  build(rng) {
    const { m, c } = y8LineParams(rng);
    return {
      prompt: `Write down the gradient and the y-intercept of the line shown on the grid.`,
      render: y8LineOnGrid(m, c),
      accurateDiagram: true,
      answer: `Gradient = ${y7sgn(m)} (${m > 0 ? "up" : "down"} ${Math.abs(m)} for every 1 across); y-intercept = ${y7sgn(c)}`,
    };
  },
};
SUBTOPIC_BANK["line-equation-from-graph"] = {
  topic: "Coordinates", title: "Write the equation of a straight line from its graph", marks: 2,
  build(rng) {
    const { m, c } = y8LineParams(rng);
    return {
      prompt: `Write down the equation of the line shown on the grid, in the form y = mx + c.`,
      render: y8LineOnGrid(m, c),
      accurateDiagram: true,
      answer: `y = ${m === 1 ? "" : m === -1 ? "−" : y7sgn(m)}x${c === 0 ? "" : " " + y8pm(c)}  (gradient ${y7sgn(m)}, y-intercept ${y7sgn(c)})`,
    };
  },
};
SUBTOPIC_BANK["line-table-of-values"] = {
  topic: "Coordinates", title: "Complete a table of values for a straight line", marks: 2,
  build(rng) {
    const m = pick(rng, [-3, -2, -1, 1, 2, 3]), c = seededInt(rng, -4, 4);
    const xs = [-2, -1, 0, 1, 2];
    const shown = pick(rng, [[0, 2], [1, 3], [0, 4]]);
    return {
      prompt: `Complete the table of values for y = ${y8lin(m, c)}.`,
      render: <SampleSpaceSVG corner="x" rows={["y"]} cols={xs.map(y8lab)} cell={(i, j) => (shown.includes(j) ? y8lab(m * xs[j] + c) : "")} />,
      accurateDiagram: true,
      answer: `y = ${xs.map((x) => y8lab(m * x + c)).join(", ")} (for x = ${xs.map(y8lab).join(", ")})`,
    };
  },
};

/* --- Multiplying and dividing fractions --- */
SUBTOPIC_BANK["frac-multiply-integer"] = {
  topic: "Fractions", title: "Multiply a fraction by an integer", marks: 2,
  build(rng) {
    let a, b;
    do { b = seededInt(rng, 3, 9); a = seededInt(rng, 1, b - 1); } while (gcd(a, b) !== 1);
    const k = seededInt(rng, 2, 8);
    const num = a * k, g = gcd(num, b), sn = num / g, sd = b / g;
    const answer = sd === 1 ? <>{sn}</> : sn > sd ? <><Frac n={sn} d={sd} /> = <Mixed w={Math.floor(sn / sd)} n={sn % sd} d={sd} /></> : <Frac n={sn} d={sd} />;
    return { prompt: <>Work out <Frac n={a} d={b} /> × {k}. Give your answer in its simplest form.</>, answer: <>{answer}</> };
  },
};
SUBTOPIC_BANK["frac-multiply-two"] = {
  topic: "Fractions", title: "Multiply two fractions", marks: 2,
  build(rng) {
    let a, b, c, d;
    do { b = seededInt(rng, 2, 9); a = seededInt(rng, 1, b - 1); d = seededInt(rng, 2, 9); c = seededInt(rng, 1, d - 1); } while (gcd(a, b) !== 1 || gcd(c, d) !== 1);
    const n = a * c, den = b * d, g = gcd(n, den);
    return { prompt: <>Work out <Frac n={a} d={b} /> × <Frac n={c} d={d} />. Give your answer in its simplest form.</>, answer: <><Frac n={n} d={den} />{g > 1 && <> = <Frac n={n / g} d={den / g} /></>}</> };
  },
};
SUBTOPIC_BANK["frac-reciprocal"] = {
  topic: "Fractions", title: "Find a reciprocal", marks: 1,
  build(rng) {
    if (rng() < 0.6) {
      let a, b;
      do { b = seededInt(rng, 2, 11); a = seededInt(rng, 1, 11); } while (a === b || gcd(a, b) !== 1);
      return { prompt: <>Write down the reciprocal of <Frac n={a} d={b} />.</>, answer: <><Frac n={b} d={a} />{b % a === 0 && <> = {b / a}</>}</> };
    }
    const n = seededInt(rng, 2, 12);
    return { prompt: `Write down the reciprocal of ${n}.`, answer: <><Frac n={1} d={n} /> (a number multiplied by its reciprocal gives 1)</> };
  },
};

/* --- Symmetry and reflection --- */
const Y8_SYM = [
  { kind: "rectangle", name: "rectangle", lines: 2, rot: 2 }, { kind: "square", name: "square", lines: 4, rot: 4 },
  { kind: "rhombus", name: "rhombus", lines: 2, rot: 2 }, { kind: "parallelogram", name: "parallelogram", lines: 0, rot: 2 },
  { kind: "isosceles triangle", name: "isosceles triangle", lines: 1, rot: 1 }, { kind: "equilateral triangle", name: "equilateral triangle", lines: 3, rot: 3 },
  { kind: "kite", name: "kite", lines: 1, rot: 1 }, { kind: "isosceles trapezium", name: "isosceles trapezium", lines: 1, rot: 1 },
  { kind: "regular", sides: 5, name: "regular pentagon", lines: 5, rot: 5 }, { kind: "regular", sides: 6, name: "regular hexagon", lines: 6, rot: 6 },
];
SUBTOPIC_BANK["symmetry-lines-rotation"] = {
  topic: "2D Shapes", title: "Lines of symmetry and order of rotational symmetry", marks: 2,
  build(rng) {
    const s = pick(rng, Y8_SYM);
    return {
      prompt: `The diagram shows a shape. Write down (a) the number of lines of symmetry and (b) the order of rotational symmetry.`,
      render: <SymmetryShapeSVG kind={s.kind} sides={s.sides} />,
      accurateDiagram: true,
      answer: `(a) ${s.lines} line${s.lines === 1 ? "" : "s"} of symmetry; (b) order of rotational symmetry ${s.rot}${s.rot === 1 ? " (it has none)" : ""}`,
      answerRender: s.lines > 0 ? <SymmetryShapeSVG kind={s.kind} sides={s.sides} showLines /> : undefined,
    };
  },
};
SUBTOPIC_BANK["describe-reflection"] = {
  topic: "Transformations", title: "Describe a reflection", marks: 2,
  build(rng) {
    const kind = pick(rng, ["x", "y", "diag"]);
    const k = seededInt(rng, 1, 2);
    let mirror, mapPt, rule, pickBase, okFn;
    if (kind === "x") { mirror = { x1: k, y1: -6, x2: k, y2: 6 }; mapPt = ([x, y]) => [2 * k - x, y]; rule = `x = ${k}`; pickBase = () => [seededInt(rng, -5, -1), seededInt(rng, 1, 4)]; okFn = (pts) => pts.every(([x]) => x < k - 0.5); }
    else if (kind === "y") { mirror = { x1: -6, y1: k, x2: 6, y2: k }; mapPt = ([x, y]) => [x, 2 * k - y]; rule = `y = ${k}`; pickBase = () => [seededInt(rng, 1, 4), seededInt(rng, -5, -1)]; okFn = (pts) => pts.every(([, y]) => y < k - 0.5); }
    else { mirror = { x1: -6, y1: -6, x2: 6, y2: 6 }; mapPt = ([x, y]) => [y, x]; rule = "y = x"; pickBase = () => [seededInt(rng, -5, -2), seededInt(rng, 2, 5)]; okFn = (pts) => pts.every(([x, y]) => y > x + 0.5); }
    let pts = null;
    for (let tries = 0; tries < 200 && !pts; tries++) {
      const o = pickBase();
      const cand = [o, [o[0] + seededInt(rng, 2, 3), o[1]], [o[0], o[1] + seededInt(rng, 2, 3)]];
      const all = cand.concat(cand.map(mapPt));
      if (all.every(([x, y]) => Math.abs(x) <= 6 && Math.abs(y) <= 6) && okFn(cand)) pts = cand;
    }
    if (!pts) pts = kind === "diag" ? [[-4, 3], [-3, 3], [-4, 4]] : kind === "x" ? [[-4, 2], [-3, 2], [-4, 3]] : [[2, -4], [3, -4], [2, -3]];
    const img = pts.map(mapPt);
    const mk = (arr, lab, fill, stroke) => ({ points: arr.map(([x, y], i) => ({ x, y, label: i === 0 ? lab : "" })), fill, stroke });
    return {
      prompt: `Shape A is reflected to give shape B. Describe fully the single transformation that maps A onto B.`,
      render: <ShapeGridSVG shapes={[mk(pts, "A", "#cfe0f5", "#1f3d66"), mk(img, "B", "#f2d4cf", Y8_RED)]} />,
      accurateDiagram: true,
      answer: `A reflection in the line ${rule} (each point and its image are the same distance from the mirror line)`,
      answerRender: <ShapeGridSVG shapes={[mk(pts, "A", "#cfe0f5", "#1f3d66"), mk(img, "B", "#f2d4cf", Y8_RED)]} lines={[{ ...mirror, dashed: true }]} />,
    };
  },
};

/* --- Area, volume and density --- */
const Y8_SOLIDS = [
  { kind: "cube", name: "cube" }, { kind: "cuboid", name: "cuboid" }, { kind: "cylinder", name: "cylinder" },
  { kind: "cone", name: "cone" }, { kind: "sphere", name: "sphere" }, { kind: "square pyramid", name: "square-based pyramid" }, { kind: "triangular prism", name: "triangular prism" },
];
SUBTOPIC_BANK["solid-name-identify"] = {
  topic: "Properties of 3D Shapes", title: "Name a 3D shape from its diagram", marks: 1,
  build(rng) {
    const s = pick(rng, Y8_SOLIDS);
    return { prompt: `Write down the mathematical name of this 3D shape.`, render: <SolidSVG kind={s.kind} />, accurateDiagram: true, answer: s.name };
  },
};
SUBTOPIC_BANK["three-d-faces-edges-vertices"] = {
  topic: "Properties of 3D Shapes", title: "State the faces, edges and vertices of a 3D shape", marks: 3,
  build(rng) {
    const s = pick(rng, [
      { name: "cube", kind: "cube", f: 6, e: 12, v: 8 }, { name: "cuboid", kind: "cuboid", f: 6, e: 12, v: 8 },
      { name: "triangular prism", kind: "triangular prism", f: 5, e: 9, v: 6 }, { name: "square-based pyramid", kind: "square pyramid", f: 5, e: 8, v: 5 },
    ]);
    const ask = pick(rng, ["all", "faces", "edges", "vertices"]);
    const render = <SolidSVG kind={s.kind} />;
    if (ask === "all") return { prompt: `The diagram shows a ${s.name}. State the number of faces, edges and vertices.`, render, accurateDiagram: true, answer: `Faces = ${s.f}, edges = ${s.e}, vertices = ${s.v}` };
    const val = ask === "faces" ? s.f : ask === "edges" ? s.e : s.v;
    return { prompt: `The diagram shows a ${s.name}. State the number of ${ask}.`, render, accurateDiagram: true, answer: `${val}` };
  },
};
SUBTOPIC_BANK["density-calc"] = {
  topic: "Compound Measures", title: "Calculate a density", marks: 3,
  build(rng) {
    const l = seededInt(rng, 3, 10), w = seededInt(rng, 2, 8), h = seededInt(rng, 2, 8);
    const V = l * w * h;
    const d = pick(rng, [2, 3, 4, 5, 6, 8, 9, 2.5]);
    const dd = d === 2.5 && V % 2 !== 0 ? 3 : d;
    const mass = dd * V;
    return {
      prompt: `The diagram shows a solid cuboid with a mass of ${y7comma(mass)} g. Work out the density of the material, in g/cm³.`,
      render: <SolidSVG kind="cuboid" labels={{ l: `${l} cm`, w: `${w} cm`, h: `${h} cm` }} />,
      accurateDiagram: true,
      answer: `Volume = ${l} × ${w} × ${h} = ${V} cm³; density = mass ÷ volume = ${y7comma(mass)} ÷ ${V} = ${y7num(dd)} g/cm³`,
    };
  },
};
SUBTOPIC_BANK["density-find-mass-volume"] = {
  topic: "Compound Measures", title: "Use density to find a mass or a volume", marks: 3,
  build(rng) {
    const l = seededInt(rng, 3, 10), w = seededInt(rng, 2, 8), h = seededInt(rng, 2, 8);
    const V = l * w * h;
    const d = pick(rng, [2, 3, 4, 5, 6, 8, 9]);
    if (rng() < 0.5) {
      return {
        prompt: `The diagram shows a cuboid made of a material with density ${d} g/cm³. Work out the mass of the cuboid.`,
        render: <SolidSVG kind="cuboid" labels={{ l: `${l} cm`, w: `${w} cm`, h: `${h} cm` }} />,
        accurateDiagram: true,
        answer: `Volume = ${l} × ${w} × ${h} = ${V} cm³; mass = density × volume = ${d} × ${V} = ${y7comma(d * V)} g`,
      };
    }
    return {
      prompt: `The diagram shows a solid block with a mass of ${y7comma(d * V)} g. The material has density ${d} g/cm³. Work out the volume of the block.`,
      render: <SolidSVG kind="cuboid" />,
      accurateDiagram: true,
      answer: `volume = mass ÷ density = ${y7comma(d * V)} ÷ ${d} = ${V} cm³`,
    };
  },
};
SUBTOPIC_BANK["capacity-mass-convert"] = {
  topic: "Measures & Units", title: "Convert units of mass and capacity", marks: 1,
  build(rng) {
    const kind = pick(rng, ["kg2g", "g2kg", "l2ml", "ml2l", "t2kg", "kg2t"]);
    const v = pick(rng, [2, 3, 4, 5, 1.5, 2.5, 0.5, 0.25, 3.5]);
    if (kind === "kg2g") return { prompt: `Convert ${v} kg to grams.`, answer: `${y7num(v * 1000)} g` };
    if (kind === "g2kg") return { prompt: `Convert ${y7num(v * 1000)} g to kilograms.`, answer: `${v} kg` };
    if (kind === "l2ml") return { prompt: `Convert ${v} litres to millilitres.`, answer: `${y7num(v * 1000)} ml` };
    if (kind === "ml2l") return { prompt: `Convert ${y7num(v * 1000)} ml to litres.`, answer: `${v} litres` };
    if (kind === "t2kg") return { prompt: `Convert ${v} tonnes to kilograms.`, answer: `${y7num(v * 1000)} kg` };
    return { prompt: `Convert ${y7num(v * 1000)} kg to tonnes.`, answer: `${v} tonnes` };
  },
};

/* --- Equations and inequalities (number lines are always drawn) --- */
SUBTOPIC_BANK["solve-linear-brackets"] = {
  topic: "Solving Linear Equations", title: "Solve an equation with brackets", marks: 3,
  build(rng) {
    const x0 = seededInt(rng, -5, 9), a = seededInt(rng, 2, 6), b = seededInt(rng, -6, 8);
    if (b === 0) return this.build(rng);
    const c = a * (x0 + b);
    return { prompt: `Solve ${a}(x ${y8pm(b)}) = ${c}`, answer: `x ${y8pm(b)} = ${c} ÷ ${a} = ${c / a}, so x = ${y7sgn(x0)}` };
  },
};
function y8IneqSpec(rng) {
  const kind = pick(rng, ["gt", "ge", "lt", "le", "between"]);
  const t = seededInt(rng, -4, 4);
  if (kind === "between") {
    const lo = seededInt(rng, -5, 0), hi = lo + seededInt(rng, 2, 6);
    const loC = rng() < 0.5, hiC = rng() < 0.5;
    return { text: `${y7sgn(lo)} ${loC ? "≤" : "<"} x ${hiC ? "≤" : "<"} ${y7sgn(hi)}`, segs: [{ a: lo, aClosed: loC, b: hi, bClosed: hiC }] };
  }
  const sym = { gt: ">", ge: "≥", lt: "<", le: "≤" }[kind];
  const seg = kind === "gt" || kind === "ge" ? { a: t, aClosed: kind === "ge", b: null } : { a: null, b: t, bClosed: kind === "le" };
  return { text: `x ${sym} ${y7sgn(t)}`, segs: [seg] };
}
SUBTOPIC_BANK["ineq-represent-number-line"] = {
  topic: "Inequalities", title: "Show an inequality on a number line", marks: 2,
  build(rng) {
    const sp = y8IneqSpec(rng);
    return {
      prompt: `Show the inequality ${sp.text} on the number line. Use an open circle for < or > and a closed circle for ≤ or ≥.`,
      render: <InequalityLineSVG lo={-7} hi={7} />,
      accurateDiagram: true,
      answer: `Draw the line and circles as shown in the answer diagram.`,
      answerRender: <InequalityLineSVG lo={-7} hi={7} segs={sp.segs} />,
    };
  },
};
SUBTOPIC_BANK["inequality-from-number-line"] = {
  topic: "Inequalities", title: "Write down the inequality shown on a number line", marks: 1,
  build(rng) {
    const t = seededInt(rng, -5, 5);
    const closed = pick(rng, [true, false]);
    const greater = pick(rng, [true, false]);
    const sym = greater ? (closed ? "≥" : ">") : (closed ? "≤" : "<");
    const seg = greater ? { a: t, aClosed: closed, b: null } : { a: null, b: t, bClosed: closed };
    return {
      prompt: `The number line shows an inequality for x. Write down the inequality.`,
      render: <InequalityLineSVG lo={-7} hi={7} segs={[seg]} />,
      accurateDiagram: true,
      answer: `x ${sym} ${y7sgn(t)}`,
    };
  },
};
SUBTOPIC_BANK["inequality-double-sided"] = {
  topic: "Inequalities", title: "Write a double-sided inequality shown on a number line", marks: 2,
  build(rng) {
    const lo = seededInt(rng, -6, -1);
    const hi = lo + seededInt(rng, 2, 8);
    const loC = pick(rng, [true, false]), hiC = pick(rng, [true, false]);
    return {
      prompt: `The number line shows an inequality for x. Write down the inequality.`,
      render: <InequalityLineSVG lo={-8} hi={Math.max(hi + 1, 6)} segs={[{ a: lo, aClosed: loC, b: hi, bClosed: hiC }]} />,
      accurateDiagram: true,
      answer: `${y7sgn(lo)} ${loC ? "≤" : "<"} x ${hiC ? "≤" : "<"} ${y7sgn(hi)}`,
    };
  },
};
SUBTOPIC_BANK["inequality-list-integers"] = {
  topic: "Inequalities", title: "List integer values satisfying an inequality", marks: 1,
  build(rng) {
    const lo = seededInt(rng, -8, -1);
    const hi = seededInt(rng, 1, 8);
    const values = [];
    for (let n = lo + 1; n <= hi; n++) values.push(n);
    return {
      prompt: `n is an integer such that ${y7sgn(lo)} < n ≤ ${hi}. The number line shows the range of values. List all the possible values of n.`,
      render: <InequalityLineSVG lo={-9} hi={9} segs={[{ a: lo, aClosed: false, b: hi, bClosed: true }]} />,
      accurateDiagram: true,
      answer: `n = ${values.map(y7sgn).join(", ")}`,
      answerRender: <InequalityLineSVG lo={-9} hi={9} segs={[{ a: lo, aClosed: false, b: hi, bClosed: true }]} dots={values} />,
    };
  },
};
SUBTOPIC_BANK["inequality-linear-twostep"] = {
  topic: "Inequalities", title: "Solve a two-step linear inequality", marks: 2,
  build(rng) {
    const negCoef = pick(rng, [true, false]);
    const a = seededInt(rng, 2, 6) * (negCoef ? -1 : 1);
    const x0 = seededInt(rng, -8, 8);
    const b = seededInt(rng, -9, 9);
    const c = a * x0 + b;
    const symbol = pick(rng, ["<", ">"]);
    const flipped = negCoef ? (symbol === "<" ? ">" : "<") : symbol;
    return {
      prompt: `Solve the inequality ${y8term(a)} ${y8pm(b)} ${symbol} ${y7sgn(c)}, then show the solution on a number line.`,
      answer: `${y8term(a)} ${symbol} ${y7sgn(c - b)}; x ${flipped} ${y7sgn(x0)}${negCoef ? " (the inequality sign flips when dividing by a negative)" : ""}`,
      answerRender: y8SolutionLine(x0, flipped),
    };
  },
};
SUBTOPIC_BANK["inequality-both-sides"] = {
  topic: "Inequalities", title: "Solve an inequality with the unknown on both sides", marks: 3,
  build(rng) {
    const p = seededInt(rng, 3, 7);
    const q = seededInt(rng, 1, p - 1);
    const x0 = seededInt(rng, -6, 6);
    const b = seededInt(rng, -9, 9);
    const d = b + (p - q) * x0;
    const symbol = pick(rng, ["<", ">"]);
    return {
      prompt: `Solve the inequality ${p}x ${y8pm(b)} ${symbol} ${q}x ${y8pm(d)}, then show the solution on a number line.`,
      answer: `${p - q}x ${symbol} ${y7sgn(d - b)}; x ${symbol} ${y7sgn(x0)}`,
      answerRender: y8SolutionLine(x0, symbol),
    };
  },
};

/* --- Percentages --- */
SUBTOPIC_BANK["percent-multiplier"] = {
  topic: "Percentages", title: "Use a multiplier for a percentage change", marks: 2,
  build(rng) {
    const p = pick(rng, [5, 10, 12, 15, 20, 25, 30, 35, 40]);
    const up = rng() < 0.5;
    const mult = Math.round((1 + (up ? p : -p) / 100) * 1000) / 1000;
    if (rng() < 0.5) return { prompt: `Write down the multiplier for a ${p}% ${up ? "increase" : "decrease"}.`, answer: `${y7num(mult)} (${up ? "100% + " : "100% − "}${p}% = ${100 + (up ? p : -p)}% = ${y7num(mult)})` };
    const amt = seededInt(rng, 2, 40) * 10;
    return { prompt: `Use a multiplier to ${up ? "increase" : "decrease"} £${amt} by ${p}%.`, answer: `${amt} × ${y7num(mult)} = £${y7num(Math.round(amt * mult * 100) / 100)}` };
  },
};
SUBTOPIC_BANK["percent-change-find"] = {
  topic: "Percentages", title: "Work out a percentage change", marks: 3,
  build(rng) {
    const old = seededInt(rng, 2, 20) * 20;
    const p = pick(rng, [5, 10, 15, 20, 25, 30, 40, 50]);
    const up = rng() < 0.5;
    const nw = old + (up ? 1 : -1) * (old * p) / 100;
    const item = pick(rng, ["price", "population", "number of members"]);
    return {
      prompt: `The ${item} changes from ${item === "price" ? "£" : ""}${old} to ${item === "price" ? "£" : ""}${nw}. Work out the percentage ${up ? "increase" : "decrease"}.`,
      answer: `change = ${Math.abs(nw - old)}; ${Math.abs(nw - old)} ÷ ${old} × 100 = ${p}% ${up ? "increase" : "decrease"}`,
    };
  },
};

/* --- Indices and standard form --- */
SUBTOPIC_BANK["index-notation-evaluate"] = {
  topic: "Indices", title: "Evaluate a number written in index form", marks: 1,
  build(rng) {
    const b = seededInt(rng, 2, 9), e = b > 5 ? seededInt(rng, 2, 3) : seededInt(rng, 2, 5);
    return { prompt: <>Work out <Pow b={b} e={e} />.</>, answer: `${b ** e} (${Array(e).fill(b).join(" × ")})` };
  },
};
SUBTOPIC_BANK["indices-simplify-algebra"] = {
  topic: "Indices", title: "Simplify expressions with indices", marks: 2,
  build(rng) {
    const v = pick(rng, ["x", "y", "a", "m"]);
    const kind = pick(rng, ["mult", "div", "power", "coef"]);
    const p = seededInt(rng, 2, 8), q = seededInt(rng, 2, 5);
    if (kind === "mult") return { prompt: <>Simplify <Pow b={v} e={p} /> × <Pow b={v} e={q} /></>, answer: <><Pow b={v} e={p + q} /> (add the powers)</> };
    if (kind === "div") return { prompt: <>Simplify <Pow b={v} e={p + q} /> ÷ <Pow b={v} e={q} /></>, answer: <><Pow b={v} e={p} /> (subtract the powers)</> };
    if (kind === "power") return { prompt: <>Simplify (<Pow b={v} e={p} />)<sup>{q}</sup></>, answer: <><Pow b={v} e={p * q} /> (multiply the powers)</> };
    const c1 = seededInt(rng, 2, 5), c2 = seededInt(rng, 2, 5);
    return { prompt: <>Simplify {c1}<Pow b={v} e={p} /> × {c2}<Pow b={v} e={q} /></>, answer: <>{c1 * c2}<Pow b={v} e={p + q} /></> };
  },
};
SUBTOPIC_BANK["sf-large-to-ordinary"] = {
  topic: "Standard Form", title: "Write a number in standard form as an ordinary number", marks: 1,
  build(rng) {
    const a = seededInt(rng, 11, 99) / 10;
    const e = seededInt(rng, 3, 7);
    return { prompt: <>Write {y7num(a)} × <Pow b={10} e={e} /> as an ordinary number.</>, answer: y7comma(Math.round(a * 10 ** e)) };
  },
};

/* --- Interpreting data --- */
SUBTOPIC_BANK["outlier-dotplot"] = {
  topic: "Averages & Range", title: "Spot an outlier on a dot plot", marks: 2,
  build(rng) {
    const base = seededInt(rng, 8, 14);
    const vals = [];
    while (vals.length < 7) vals.push(base + seededInt(rng, 0, 5));
    const high = rng() < 0.5;
    const out = high ? base + seededInt(rng, 13, 16) : Math.max(1, base - seededInt(rng, 7, 9));
    const all = vals.concat([out]);
    const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const m1 = Math.round(mean(all) * 10) / 10, m2 = Math.round(mean(vals) * 10) / 10;
    const lo = Math.max(0, Math.min(...all) - 1), hi = Math.max(...all) + 1;
    return {
      prompt: `The dot plot shows 8 values. (a) Write down the outlier. (b) The outlier is removed. Does the mean increase or decrease?`,
      render: <DotPlotSVG values={all} lo={lo} hi={hi} />,
      accurateDiagram: true,
      answer: `(a) ${out}; (b) the mean goes from ${y7num(m1)} to ${y7num(m2)}, so it ${m2 > m1 ? "increases" : "decreases"}`,
    };
  },
};
SUBTOPIC_BANK["compare-distributions"] = {
  topic: "Averages & Range", title: "Compare two distributions", marks: 2,
  build(rng) {
    const mA = seededInt(rng, 40, 70), mB = mA + seededInt(rng, 3, 10) * (rng() < 0.5 ? 1 : -1);
    const rA = seededInt(rng, 8, 20), rB = rA + seededInt(rng, 6, 15);
    const swap = rng() < 0.5;
    const [m1, r1, m2, r2] = swap ? [mB, rB, mA, rA] : [mA, rA, mB, rB];
    return {
      prompt: `Class P has a mean test score of ${m1} and a range of ${r1}. Class Q has a mean test score of ${m2} and a range of ${r2}. Compare the two classes' scores, making one comment about the average and one about the spread.`,
      answer: `Average: Class ${m1 > m2 ? "P" : "Q"} did better on average (higher mean). Spread: Class ${r1 < r2 ? "P" : "Q"}'s scores were more consistent (smaller range).`,
    };
  },
};

/* --- Angles: polygons and parallel lines, all drawn --- */
SUBTOPIC_BANK["angles-quadrilateral-sum"] = {
  topic: "Angles in Shapes", title: "Angles in a quadrilateral", marks: 2,
  build(rng) {
    let a, b, c, d;
    do { a = seededInt(rng, 60, 120); b = seededInt(rng, 60, 120); c = seededInt(rng, 60, 120); d = 360 - a - b - c; } while (d < 50 || d > 140);
    const angles = [a, b, c, d];
    const unknownIndex = seededInt(rng, 0, 3);
    const known = angles.filter((_, i) => i !== unknownIndex);
    return {
      prompt: `The diagram shows a quadrilateral. Find the size of the angle marked "?".`,
      render: <PolygonAnglesSVG angles={angles} unknownIndex={unknownIndex} />,
      accurateDiagram: true,
      answer: `360° − ${known.join("° − ")}° = ${angles[unknownIndex]}° (angles in a quadrilateral sum to 360°)`,
    };
  },
};
SUBTOPIC_BANK["angles-interior-polygon-sum"] = {
  topic: "Angles in Shapes", title: "Sum of interior angles of a polygon", marks: 2,
  build(rng) {
    const n = seededInt(rng, 5, 10);
    const names = { 5: "pentagon", 6: "hexagon", 7: "heptagon", 8: "octagon", 9: "nonagon", 10: "decagon" };
    const sum = (n - 2) * 180;
    return {
      prompt: `The diagram shows a ${names[n]}. Work out the sum of its interior angles.`,
      render: <RegularPolygonSVG sides={n} />,
      accurateDiagram: true,
      answer: `(${n} − 2) × 180° = ${sum}° (a ${names[n]} splits into ${n - 2} triangles)`,
    };
  },
};
SUBTOPIC_BANK["angles-exterior-regular-polygon"] = {
  topic: "Angles in Shapes", title: "Exterior angle of a regular polygon", marks: 1,
  build(rng) {
    const n = pick(rng, [3, 4, 5, 6, 8, 9, 10, 12]);
    return {
      prompt: `The diagram shows a regular polygon with ${n} sides. Work out the size of the exterior angle marked "?".`,
      render: <RegularPolygonAnglesSVG sides={n} mode="exterior" />,
      accurateDiagram: true,
      answer: `360° ÷ ${n} = ${360 / n}°`,
    };
  },
};
SUBTOPIC_BANK["angles-interior-regular-polygon"] = {
  topic: "Angles in Shapes", title: "Interior angle of a regular polygon", marks: 2,
  build(rng) {
    const n = pick(rng, [5, 6, 8, 9, 10, 12]);
    const sum = (n - 2) * 180;
    return {
      prompt: `The diagram shows a regular polygon with ${n} sides. Work out the size of the interior angle marked "?".`,
      render: <RegularPolygonAnglesSVG sides={n} mode="interior" />,
      accurateDiagram: true,
      answer: `Exterior angle = 360° ÷ ${n} = ${360 / n}°, so interior angle = 180° − ${360 / n}° = ${180 - 360 / n}° (or ${sum}° ÷ ${n})`,
    };
  },
};
SUBTOPIC_BANK["angles-polygon-sides-from-angle"] = {
  topic: "Angles in Shapes", title: "Find the number of sides from an angle", marks: 2,
  build(rng) {
    const n = pick(rng, [5, 6, 8, 9, 10, 12, 15, 18, 20]);
    const ext = 360 / n;
    return {
      prompt: `The diagram shows part of a regular polygon. The exterior angle is ${ext}°. Work out the number of sides of the polygon.`,
      render: <PolygonCornerSVG ext={ext} />,
      accurateDiagram: true,
      answer: `360° ÷ ${ext}° = ${n} sides`,
    };
  },
};
SUBTOPIC_BANK["angles-parallel-algebra"] = {
  topic: "Angles in Parallel Lines", title: "Form and solve an equation with angles in parallel lines", marks: 3,
  build(rng) {
    const type = pick(rng, ["alternate", "corresponding", "co-interior"]);
    const pairs = type === "alternate" ? [[["P", "SE"], ["Q", "NW"]], [["P", "SW"], ["Q", "NE"]]]
      : type === "corresponding" ? ["NE", "NW", "SE", "SW"].map((q) => [["P", q], ["Q", q]])
      : [[["P", "SE"], ["Q", "NE"]], [["P", "SW"], ["Q", "NW"]]];
    let [pa, pb] = pick(rng, pairs);
    if (rng() < 0.5) [pa, pb] = [pb, pa];
    let x0, a, c, b, d, v, tries = 0;
    do {
      x0 = seededInt(rng, 8, 25); a = seededInt(rng, 2, 5); c = seededInt(rng, 1, 4); b = seededInt(rng, 5, 40);
      v = a * x0 + b;
      d = type === "co-interior" ? 180 - v - c * x0 : v - c * x0;
      tries++;
    } while (tries < 400 && (Math.abs(d) > 40 || v < 35 || v > 145 || (type !== "co-interior" && c === a) || d === 0 || (type === "co-interior" && 180 - v < 35)));
    const e1 = `(${y8lin(a, b)})°`, e2 = `(${y8lin(c, d)})°`;
    const eq = type === "co-interior" ? `${y8lin(a, b)} + ${y8lin(c, d)} = 180; ${a + c}x ${y8pm(b + d)} = 180; ${a + c}x = ${180 - b - d}; x = ${x0}`
      : `${y8lin(a, b)} = ${y8lin(c, d)}; ${a - c}x = ${d - b}; x = ${x0}`;
    return {
      prompt: `Two parallel lines are crossed by a transversal. The two angles marked are ${type} angles. Form and solve an equation to find x.`,
      render: <ParallelLinesSVG phi={y7PhiFor(pa[1], v)} marks={[{ line: pa[0], quad: pa[1], label: e1 }, { line: pb[0], quad: pb[1], label: e2 }]} />,
      accurateDiagram: true,
      answer: type === "co-interior" ? `Co-interior angles sum to 180°: ${eq}` : `${type[0].toUpperCase() + type.slice(1)} angles are equal: ${eq}`,
    };
  },
};
SUBTOPIC_BANK["angles-polygon-algebra"] = {
  topic: "Angles in Shapes", title: "Form and solve an equation with angles in a polygon", marks: 3,
  build(rng) {
    const n = pick(rng, [4, 5]);
    const sum = (n - 2) * 180;
    for (let tries = 0; tries < 600; tries++) {
      const x0 = seededInt(rng, 10, 24);
      const ex = [];
      let total = 0, ok = true;
      for (let i = 0; i < n - 1 && ok; i++) {
        let found = false;
        for (let k = 0; k < 30 && !found; k++) {
          const a = seededInt(rng, 1, 3), v = seededInt(rng, 65, 135), bb = v - a * x0;
          if (Math.abs(bb) <= 35 && bb !== 0) { ex.push({ a, b: bb, v }); total += v; found = true; }
        }
        if (!found) ok = false;
      }
      if (!ok) continue;
      const last = sum - total;
      if (last < 45 || last > 160) continue;
      const pos = seededInt(rng, 0, n - 1);
      const angles = ex.map((e) => e.v); angles.splice(pos, 0, last);
      const labels = ex.map((e) => `(${y8lin(e.a, e.b)})\u00B0`); labels.splice(pos, 0, `${last}\u00B0`);
      const A = ex.reduce((s2, e) => s2 + e.a, 0), B = ex.reduce((s2, e) => s2 + e.b, 0);
      return {
        prompt: `The diagram shows a ${n === 4 ? "quadrilateral" : "pentagon"}. Form and solve an equation to find x.`,
        render: <PolygonAnglesSVG angles={angles} labels={labels} unknownIndex={-1} />,
        accurateDiagram: true,
        answer: `${A}x ${y8pm(B)} + ${last} = ${sum}; ${A}x = ${sum - last - B}; x = ${x0}`,
      };
    }
    const angles = [80, 100, 70, 110];
    return { prompt: `The diagram shows a quadrilateral. Find the size of the angle marked "?".`, render: <PolygonAnglesSVG angles={angles} unknownIndex={3} />, accurateDiagram: true, answer: "360° − 80° − 100° − 70° = 110°" };
  },
};

/* --- Probability: scales, sample spaces and tables --- */
SUBTOPIC_BANK["probability-scale-words"] = {
  topic: "Probability Scale", title: "Describe a probability using words", marks: 1,
  build(rng) {
    const items = [
      { p: 0, word: "impossible" }, { p: 0.05, word: "very unlikely" }, { p: 0.25, word: "unlikely" },
      { p: 0.5, word: "evens (equally likely)" }, { p: 0.75, word: "likely" }, { p: 0.95, word: "very likely" }, { p: 1, word: "certain" },
    ];
    const item = pick(rng, items);
    return {
      prompt: `The arrow on the probability scale shows the probability of an event. Describe this probability using one word or phrase (for example impossible, unlikely, evens, likely, certain).`,
      render: <ProbabilityScaleSVG marks={[{ p: item.p, label: "" }]} />,
      accurateDiagram: true,
      answer: `${item.word} (probability ${item.p})`,
    };
  },
};
SUBTOPIC_BANK["probability-scale-compare"] = {
  topic: "Probability Scale", title: "Compare the likelihood of events using probabilities", marks: 2,
  build(rng) {
    const pA = seededInt(rng, 1, 9) / 10;
    let pB = seededInt(rng, 1, 9) / 10;
    while (pB === pA) pB = seededInt(rng, 1, 9) / 10;
    const more = pA > pB ? "A" : "B";
    return {
      prompt: `The probabilities of two events, A and B, are marked on the probability scale. Which event is more likely to happen? Write down both probabilities.`,
      render: <ProbabilityScaleSVG marks={[{ p: pA, label: "A" }, { p: pB, label: "B" }]} />,
      accurateDiagram: true,
      answer: `Event ${more} (A = ${pA}, B = ${pB}; ${Math.max(pA, pB)} > ${Math.min(pA, pB)})`,
    };
  },
};
SUBTOPIC_BANK["sample-space-spinners"] = {
  topic: "Probability", title: "Use a sample space for two spinners", marks: 3,
  build(rng) {
    const s1 = [1, 2, 3], s2 = [1, 2, 3, 4];
    const op = pick(rng, ["+", "×"]);
    const val = (a, b) => (op === "+" ? a + b : a * b);
    const all = [];
    s1.forEach((a) => s2.forEach((b) => all.push(val(a, b))));
    const askKind = pick(rng, ["equal", "greater", "even"]);
    const uniq = [...new Set(all)];
    const target = pick(rng, uniq.filter((v) => (askKind === "equal" ? true : askKind === "greater" ? v < Math.max(...all) && v > Math.min(...all) : true)));
    let count, text;
    if (askKind === "equal") { count = all.filter((v) => v === target).length; text = `the total is ${target}`.replace("total", op === "+" ? "total" : "product"); }
    else if (askKind === "greater") { count = all.filter((v) => v > target).length; text = `the ${op === "+" ? "total" : "product"} is greater than ${target}`; }
    else { count = all.filter((v) => v % 2 === 0).length; text = `the ${op === "+" ? "total" : "product"} is even`; }
    const g = gcd(count || 1, 12);
    return {
      prompt: `Spinner 1 has the numbers 1, 2, 3 and spinner 2 has the numbers 1, 2, 3, 4. Both spinners are spun and the scores are ${op === "+" ? "added" : "multiplied"}. The sample space is shown. Find the probability that ${text}.`,
      render: <SampleSpaceSVG corner={op} rows={s1} cols={s2} cell={(i, j) => String(val(s1[i], s2[j]))} />,
      accurateDiagram: true,
      answer: count === 0 ? "0" : <><Frac n={count} d={12} />{g > 1 && <> = <Frac n={count / g} d={12 / g} /></>} ({count} of the 12 outcomes)</>,
    };
  },
};
SUBTOPIC_BANK["two-way-table-probability"] = {
  topic: "Probability", title: "Find a probability from a two-way table", marks: 2,
  build(rng) {
    const rows = pick(rng, [["Year 8", "Year 9"], ["Boys", "Girls"]]);
    const cols = pick(rng, [["Walk", "Bus", "Car"], ["Pizza", "Pasta", "Salad"]]);
    const cells = rows.map(() => cols.map(() => seededInt(rng, 5, 30)));
    const rt = cells.map((r) => r.reduce((s, v) => s + v, 0));
    const ct = cols.map((_, j) => cells.reduce((s, r) => s + r[j], 0));
    const total = rt[0] + rt[1];
    const cell = (i, j) => (i < 2 && j < 3 ? String(cells[i][j]) : i === 2 && j < 3 ? String(ct[j]) : j === 3 && i < 2 ? String(rt[i]) : String(total));
    const ri = seededInt(rng, 0, 1), ci = seededInt(rng, 0, 2);
    const kind = pick(rng, ["col", "cell", "rowGiven"]);
    let n, d, text;
    if (kind === "col") { n = ct[ci]; d = total; text = `chose ${cols[ci]}`; }
    else if (kind === "cell") { n = cells[ri][ci]; d = total; text = `is in ${rows[ri]} and chose ${cols[ci]}`; }
    else { n = cells[ri][ci]; d = rt[ri]; text = null; }
    const g = gcd(n, d);
    const prompt = text
      ? `The two-way table shows information about ${total} students. A student is chosen at random. Find the probability that the student ${text}.`
      : `The two-way table shows information about ${total} students. A student from ${rows[ri]} is chosen at random. Find the probability that they chose ${cols[ci]}.`;
    return {
      prompt,
      render: <SampleSpaceSVG corner="" rows={rows} cols={cols} cell={cell} totals />,
      accurateDiagram: true,
      answer: <><Frac n={n} d={d} />{g > 1 && <> = <Frac n={n / g} d={d / g} /></>}</>,
    };
  },
};

/* --- Circles --- */
const Y8_CIRCLE_PARTS = [
  { part: "radius", term: "radius", def: "a line from the centre to the circumference" },
  { part: "diameter", term: "diameter", def: "a line across the circle through the centre" },
  { part: "chord", term: "chord", def: "a line joining two points on the circumference (not through the centre)" },
  { part: "tangent", term: "tangent", def: "a line that touches the circle at exactly one point" },
  { part: "arc", term: "arc", def: "part of the circumference" },
  { part: "sector", term: "sector", def: "the region between two radii and an arc" },
  { part: "segment", term: "segment", def: "the region between a chord and an arc" },
  { part: "circumference", term: "circumference", def: "the distance (perimeter) around the circle" },
];
SUBTOPIC_BANK["circle-facts-parts"] = {
  topic: "Circle Facts", title: "Name the part of a circle", marks: 1,
  build(rng) {
    const t = pick(rng, Y8_CIRCLE_PARTS);
    return {
      prompt: `The diagram shows a circle with one part labelled A. Write down the mathematical name for A.`,
      render: <CircleDiagramSVG mode="parts" part={t.part} />,
      accurateDiagram: true,
      answer: `${t.term} (${t.def})`,
    };
  },
};
SUBTOPIC_BANK["circle-facts-circumference-area"] = {
  topic: "Circle Facts", title: "Circumference or area from the radius or diameter", marks: 2,
  build(rng) {
    const r = seededInt(rng, 3, 12);
    const useD = rng() < 0.4;
    const wantArea = rng() < 0.5;
    const dim = useD ? 2 * r : r;
    return {
      prompt: `The diagram shows a circle with ${useD ? "diameter" : "radius"} ${dim} cm. Calculate its ${wantArea ? "area" : "circumference"}. Give your answer in terms of π.`,
      render: <CircleDiagramSVG mode="measure" label={useD ? "d" : "r"} value={`${dim} cm`} />,
      accurateDiagram: true,
      answer: wantArea
        ? `π × ${r}² = ${r * r}π cm² (≈ ${(Math.PI * r * r).toFixed(1)} cm²)`
        : `${useD ? "π × " + dim : "2 × π × " + r} = ${2 * r}π cm (≈ ${(2 * Math.PI * r).toFixed(1)} cm)`,
    };
  },
};
SUBTOPIC_BANK["circle-arc-sector"] = {
  topic: "Circle Facts", title: "Arc length and sector area", marks: 3,
  build(rng) {
    for (let tries = 0; tries < 200; tries++) {
      const r = pick(rng, [6, 8, 9, 10, 12, 15]);
      const angle = pick(rng, [30, 45, 60, 90, 120, 180, 270, 72, 40]);
      const area = rng() < 0.5;
      const k = area ? (angle * r * r) / 360 : (angle * 2 * r) / 360;
      if ((k * 4) % 1 !== 0) continue;
      return {
        prompt: `The diagram shows a sector of a circle with radius ${r} cm and angle ${angle}°. Work out the ${area ? "area of the sector" : "length of the arc"}. Give your answer in terms of π.`,
        render: <CircleDiagramSVG mode="sector" angle={angle} radiusLabel={`${r} cm`} showCentre={false} />,
        accurateDiagram: true,
        answer: area
          ? `(${angle}/360) × π × ${r}² = ${y7num(k)}π cm² (≈ ${(k * Math.PI).toFixed(1)} cm²)`
          : `(${angle}/360) × 2 × π × ${r} = ${y7num(k)}π cm (≈ ${(k * Math.PI).toFixed(1)} cm)`,
      };
    }
    return { prompt: "A semicircle has radius 10 cm. Find the length of its arc in terms of π.", answer: "10π cm" };
  },
};
SUBTOPIC_BANK["circle-compound"] = {
  topic: "Circle Facts", title: "Area or perimeter of a rectangle with a semicircle", marks: 3,
  build(rng) {
    const w = pick(rng, [6, 8, 10, 12, 14]);
    const h = seededInt(rng, 4, 12);
    const area = rng() < 0.5;
    const val = area ? w * h + (Math.PI * (w / 2) ** 2) / 2 : w + 2 * h + (Math.PI * w) / 2;
    return {
      prompt: `The diagram shows a rectangle with a semicircle on one end. Work out the ${area ? "area" : "perimeter"} of the shape. Give your answer to 1 decimal place.`,
      render: <SemicircleRectSVG wLabel={`${w} cm`} hLabel={`${h} cm`} />,
      accurateDiagram: true,
      answer: area
        ? `${w} × ${h} + ½ × π × ${w / 2}² = ${w * h} + ${((Math.PI * (w / 2) ** 2) / 2).toFixed(2)} = ${val.toFixed(1)} cm²`
        : `${w} + ${h} + ${h} + ½ × π × ${w} = ${w + 2 * h} + ${((Math.PI * w) / 2).toFixed(2)} = ${val.toFixed(1)} cm`,
    };
  },
};

/* --- Graphs and charts --- */
SUBTOPIC_BANK["misleading-bar-chart"] = {
  topic: "Bar Charts", title: "Spot why a bar chart is misleading", marks: 2,
  build(rng) {
    const a = seededInt(rng, 34, 42), b = a + seededInt(rng, 4, 8);
    const yStart = 30;
    return {
      prompt: `The bar chart shows the number of phones sold by two shops in one week. A newspaper says "Shop B sold about three times as many phones as Shop A". Explain why this chart is misleading.`,
      render: <BarChartSVG categories={["Shop A", "Shop B"]} values={[a, b]} yLabel="Phones sold" yStart={yStart} />,
      accurateDiagram: true,
      answer: `The vertical axis starts at ${yStart}, not 0, so Shop B's bar looks much taller. In fact B sold only ${b} compared with ${a} (about ${Math.round((b / a - 1) * 100)}% more).`,
    };
  },
};

/* --- Sequences: nth term from a drawn pattern --- */
SUBTOPIC_BANK["seq-pattern-nth-term"] = {
  topic: "Sequences", title: "Find the nth term of a pattern sequence", marks: 3,
  build(rng) {
    const { kind, p, unit, count } = y7PatternSpec(rng);
    const d = count(2) - count(1), k = count(1) - d;
    const expr = `${d === 1 ? "" : d}n${k === 0 ? "" : " " + y8pm(k)}`;
    return {
      prompt: `The diagram shows the first three patterns in a sequence. Find an expression, in terms of n, for the number of ${unit} in Pattern n.`,
      render: <PatternSVG kind={kind} p={p} indices={[1, 2, 3]} />,
      accurateDiagram: true,
      answer: `${[1, 2, 3].map(count).join(", ")}, ... goes up by ${d} each time, so the nth term is ${expr}`,
    };
  },
};
SUBTOPIC_BANK["seq-is-term-of-sequence"] = {
  topic: "Sequences", title: "Is a number in the sequence?", marks: 2,
  build(rng) {
    const a = seededInt(rng, 2, 8), b = seededInt(rng, -3, 9);
    const n = seededInt(rng, 8, 30);
    const isTerm = rng() < 0.5;
    const target = a * n + b + (isTerm ? 0 : seededInt(rng, 1, a - 1));
    const nn = (target - b) / a;
    return {
      prompt: `The nth term of a sequence is ${y8lin(a, b, "n")}. Is ${target} a term of the sequence? Show your working.`,
      answer: Number.isInteger(nn) ? `${y8lin(a, b, "n")} = ${target} gives n = ${nn}, a whole number, so yes (it is term ${nn})` : `${y8lin(a, b, "n")} = ${target} gives n = ${y7num(Math.round(nn * 100) / 100)}, which is not a whole number, so no`,
    };
  },
};

/* --- Year 7 geometry questions, now drawn --- */
SUBTOPIC_BANK["angle-type-name"] = {
  topic: "Angles", title: "Name the type of angle", marks: 1,
  build(rng) {
    const kind = pick(rng, ["acute", "acute", "right", "obtuse", "obtuse", "straight", "reflex", "reflex"]);
    let a;
    if (kind === "acute") a = seededInt(rng, 10, 89);
    else if (kind === "right") a = 90;
    else if (kind === "obtuse") a = seededInt(rng, 91, 179);
    else if (kind === "straight") a = 180;
    else a = seededInt(rng, 181, 350);
    return {
      prompt: `Is the angle marked on the diagram acute, a right angle, obtuse, a straight line or reflex?`,
      render: <AngleTypeSVG angle={a} label={`${a}°`} />,
      accurateDiagram: true,
      answer: kind === "right" ? "A right angle (exactly 90°)" : kind === "straight" ? "A straight line (exactly 180°)" : kind,
    };
  },
};
SUBTOPIC_BANK["triangle-classify"] = {
  topic: "Properties of Shapes", title: "Classify a triangle from its angles", marks: 2,
  build(rng) {
    const sets = [
      [[50, 50, 80], "isosceles (two equal angles)", "acute-angled (all angles are less than 90°)"],
      [[60, 60, 60], "equilateral (three equal angles)", "acute-angled (all angles are less than 90°)"],
      [[90, 45, 45], "isosceles (two equal angles)", "right-angled (one angle is 90°)"],
      [[90, 30, 60], "scalene (all angles different)", "right-angled (one angle is 90°)"],
      [[30, 30, 120], "isosceles (two equal angles)", "obtuse-angled (one angle is more than 90°)"],
      [[20, 40, 120], "scalene (all angles different)", "obtuse-angled (one angle is more than 90°)"],
      [[50, 60, 70], "scalene (all angles different)", "acute-angled (all angles are less than 90°)"],
    ];
    const [angles, byAngle, byType] = pick(rng, sets);
    const shown = y7shuffle(rng, angles);
    return {
      prompt: `The diagram shows a triangle. Give two names that describe this triangle.`,
      render: <GeneralTriangleSVG sideAB={140} angleA={shown[0]} angleB={shown[1]} labelA={`${shown[0]}°`} labelB={`${shown[1]}°`} labelC={`${shown[2]}°`} />,
      accurateDiagram: true,
      answer: `${byAngle[0].toUpperCase() + byAngle.slice(1)} and ${byType}`,
    };
  },
};
SUBTOPIC_BANK["perimeter-polygon-calc"] = {
  topic: "Perimeter & Area", title: "Work out a perimeter", marks: 2,
  build(rng) {
    const kind = pick(rng, ["regular", "rectangle", "irregular"]);
    if (kind === "regular") {
      const n = pick(rng, [5, 6, 8]);
      const name = { 5: "pentagon", 6: "hexagon", 8: "octagon" }[n];
      const s = seededInt(rng, 3, 12);
      return { prompt: `The diagram shows a regular ${name}. Each side is ${s} cm. Work out its perimeter.`, render: <RegularPolygonSVG sides={n} sideLabel={`${s} cm`} />, accurateDiagram: true, answer: `${n} × ${s} = ${n * s} cm` };
    }
    if (kind === "rectangle") {
      const l = seededInt(rng, 6, 15), w = seededInt(rng, 3, l - 1);
      return { prompt: `The diagram shows a rectangle with perimeter ${2 * (l + w)} cm. Work out the missing width.`, render: <RectangleSVG w={l} h={w} wLabel={`${l} cm`} hLabel="? cm" />, accurateDiagram: true, answer: `${2 * (l + w)} ÷ 2 = ${l + w}, so the width is ${l + w} − ${l} = ${w} cm` };
    }
    const sides = [seededInt(rng, 4, 12), seededInt(rng, 4, 12), seededInt(rng, 4, 12), seededInt(rng, 4, 12)];
    return { prompt: `The diagram shows a quadrilateral. Work out its perimeter.`, render: <QuadSidesSVG sides={sides.map((v) => `${v} cm`)} />, accurateDiagram: true, answer: `${sides.join(" + ")} = ${sides.reduce((s, v) => s + v, 0)} cm` };
  },
};
SUBTOPIC_BANK["shape-naming-polygon-by-sides"] = {
  topic: "2D Shapes", title: "Name a polygon from its diagram", marks: 1,
  build(rng) {
    const polygons = [{ n: 3, name: "triangle" }, { n: 4, name: "quadrilateral" }, { n: 5, name: "pentagon" }, { n: 6, name: "hexagon" }, { n: 7, name: "heptagon" }, { n: 8, name: "octagon" }, { n: 9, name: "nonagon" }, { n: 10, name: "decagon" }];
    const item = pick(rng, polygons);
    return { prompt: `What is the mathematical name of this polygon?`, render: <RegularPolygonSVG sides={item.n} />, accurateDiagram: true, answer: `${item.name} (${item.n} sides)` };
  },
};

/* ---------- Year 10/11 geometry build-out — every geometry question gets a drawing.
   Components: VectorGridSVG, VectorTriangleSVG, VectorLatticeSVG, SSSTriangleSVG,
   IsoscelesSVG, SquareDiagonalSVG, ExactTrigSVG, ElevationSVG, TrigGraphSVG,
   BackBearingSVG, SameSegmentSVG, AlternateSegmentSVG, TangentsSVG, RadiiTriangleSVG,
   PolyhedronSVG. Callers resolve the geometry, these only draw it. ---------- */
const Y10_BLUE = "#1f3d66";
const Y10_GREEN = "#2a7a3b";
function y10T(x, y, t, o = {}) {
  return <text key={o.key} x={x} y={y} fontSize={o.size || 13} fontFamily="Arial, sans-serif" fontWeight={o.bold ? 700 : 400} textAnchor={o.anchor || "middle"} fill={o.fill || "#000"} stroke="#fff" strokeWidth="3" paintOrder="stroke">{svgMath(t)}</text>;
}
function y10RightMark(V, P, Q, size = 9) {
  const nrm = (a) => { const l = Math.hypot(a[0] - V[0], a[1] - V[1]) || 1; return [(a[0] - V[0]) / l, (a[1] - V[1]) / l]; };
  const u = nrm(P), w = nrm(Q);
  const p1 = [V[0] + u[0] * size, V[1] + u[1] * size], p3 = [V[0] + w[0] * size, V[1] + w[1] * size];
  const p2 = [p1[0] + w[0] * size, p1[1] + w[1] * size];
  return <polyline points={`${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${p3[0]},${p3[1]}`} fill="none" stroke="#000" strokeWidth="1.2" />;
}
function y10Arrow(x1, y1, x2, y2, color, w = 2.2, key) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  if (L < 1e-6) return <circle key={key} cx={x1} cy={y1} r="3" fill={color} />;
  const ux = dx / L, uy = dy / L, h = Math.min(10, L * 0.45), hw = h * 0.42;
  const bx = x2 - ux * h, by = y2 - uy * h;
  return (
    <g key={key}>
      <line x1={x1} y1={y1} x2={bx} y2={by} stroke={color} strokeWidth={w} />
      <polygon points={`${x2},${y2} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}`} fill={color} />
    </g>
  );
}
function y10Circle(cx, cy, R) { return <circle cx={cx} cy={cy} r={R} fill="none" stroke="#000" strokeWidth="1.6" />; }
function y10Svg(W, H, width, children) {
  return <svg viewBox={`0 0 ${W} ${H}`} width={width} style={{ maxWidth: "100%", height: "auto", display: "block", margin: "0 auto" }}>{children}</svg>;
}

// Column vectors drawn as arrows on an auto-scaled coordinate grid.
function VectorGridSVG({ vecs, comps = false }) {
  const W = 300, H = 300, pad = 30;
  const pts = [[0, 0]];
  vecs.forEach((v) => { pts.push(v.from, v.to); });
  let xMin = Math.min(...pts.map((p) => p[0])), xMax = Math.max(...pts.map((p) => p[0]));
  let yMin = Math.min(...pts.map((p) => p[1])), yMax = Math.max(...pts.map((p) => p[1]));
  const span0 = Math.max(xMax - xMin, yMax - yMin, 4);
  const step = span0 <= 12 ? 1 : span0 <= 24 ? 2 : span0 <= 60 ? 5 : 10;
  xMin = Math.floor((xMin - 1) / step) * step; yMin = Math.floor((yMin - 1) / step) * step;
  xMax = Math.ceil((xMax + 1) / step) * step; yMax = Math.ceil((yMax + 1) / step) * step;
  const span = Math.max(xMax - xMin, yMax - yMin);
  const padTo = (lo, hi) => { const down = Math.floor((span - (hi - lo)) / 2 / step) * step; return [lo - down, lo - down + span]; };
  [xMin, xMax] = padTo(xMin, xMax); [yMin, yMax] = padTo(yMin, yMax);
  const s = (W - 2 * pad) / span;
  const px = (x) => pad + (x - xMin) * s, py = (y) => H - pad - (y - yMin) * s;
  const gx = [], gy = [];
  for (let x = xMin; x <= xMax; x += step) gx.push(x);
  for (let y = yMin; y <= yMax; y += step) gy.push(y);
  const lab = (v) => (v < 0 ? "−" + Math.abs(v) : String(v));
  return y10Svg(W, H, 320, <>
    {gx.map((x) => <line key={`gx${x}`} x1={px(x)} y1={pad} x2={px(x)} y2={H - pad} stroke="#e2e2e2" strokeWidth="1" />)}
    {gy.map((y) => <line key={`gy${y}`} x1={pad} y1={py(y)} x2={W - pad} y2={py(y)} stroke="#e2e2e2" strokeWidth="1" />)}
    <line x1={pad} y1={py(0)} x2={W - pad} y2={py(0)} stroke="#000" strokeWidth="1.4" />
    <line x1={px(0)} y1={pad} x2={px(0)} y2={H - pad} stroke="#000" strokeWidth="1.4" />
    {gx.filter((x) => x !== 0).map((x) => <text key={`tx${x}`} x={px(x)} y={py(0) + 12} fontSize="9.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#555">{lab(x)}</text>)}
    {gy.filter((y) => y !== 0).map((y) => <text key={`ty${y}`} x={px(0) - 5} y={py(y) + 3.5} fontSize="9.5" fontFamily="Arial, sans-serif" textAnchor="end" fill="#555">{lab(y)}</text>)}
    {comps && vecs.map((v, i) => v.comps && <polyline key={`c${i}`} points={`${px(v.from[0])},${py(v.from[1])} ${px(v.to[0])},${py(v.from[1])} ${px(v.to[0])},${py(v.to[1])}`} fill="none" stroke="#777" strokeWidth="1.3" strokeDasharray="5 4" />)}
    {vecs.map((v, i) => y10Arrow(px(v.from[0]), py(v.from[1]), px(v.to[0]), py(v.to[1]), v.color, 2.6, `v${i}`))}
    {vecs.map((v, i) => {
      const mx = (px(v.from[0]) + px(v.to[0])) / 2, my = (py(v.from[1]) + py(v.to[1])) / 2;
      const dx = px(v.to[0]) - px(v.from[0]), dy = py(v.to[1]) - py(v.from[1]), L = Math.hypot(dx, dy) || 1;
      let nx = dy / L, ny = -dx / L;
      if (ny > 0.1 || (Math.abs(ny) <= 0.1 && nx < 0)) { nx = -nx; ny = -ny; }
      return y10T(mx + nx * 14, my + ny * 14 + 4, v.label, { bold: true, size: 14, fill: v.color, key: `l${i}` });
    })}
  </>);
}

// Triangle OAB with OA = a, OB = b and P on AB (not to scale).
function VectorTriangleSVG({ m, n, showOP = false }) {
  const W = 300, H = 200;
  const O = [44, 168], A = [96, 40], B = [256, 138];
  const f = m / (m + n);
  const P = [A[0] + f * (B[0] - A[0]), A[1] + f * (B[1] - A[1])];
  const ab = [B[0] - A[0], B[1] - A[1]], abl = Math.hypot(ab[0], ab[1]);
  const nrm = [ab[1] / abl, -ab[0] / abl];
  return y10Svg(W, H, 320, <>
    <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke="#000" strokeWidth="1.8" />
    {y10Arrow(O[0], O[1], A[0], A[1], Y10_BLUE, 2.4, "a")}
    {y10Arrow(O[0], O[1], B[0], B[1], Y10_BLUE, 2.4, "b")}
    {showOP && y10Arrow(O[0], O[1], P[0], P[1], Y8_RED, 2.4, "op")}
    <circle cx={P[0]} cy={P[1]} r="3.6" fill="#000" />
    {y10T(66, 108, "a", { bold: true, size: 15, fill: Y10_BLUE, anchor: "end" })}
    {y10T(150, 168, "b", { bold: true, size: 15, fill: Y10_BLUE })}
    {y10T(O[0] - 8, O[1] + 16, "O", { bold: true, anchor: "end" })}
    {y10T(A[0] - 2, A[1] - 9, "A", { bold: true })}
    {y10T(B[0] + 10, B[1] + 6, "B", { bold: true, anchor: "start" })}
    {y10T(P[0] + nrm[0] * 15, P[1] + nrm[1] * 15 + 4, "P", { bold: true })}
    {showOP && y10T((O[0] + P[0]) / 2 + 14, (O[1] + P[1]) / 2 + 14, "OP", { bold: true, fill: Y8_RED, anchor: "start" })}
  </>);
}

// Basis vectors a and b, with O, A and C plotted on the lattice they generate.
function VectorLatticeSVG({ p, q, k, showLine = false }) {
  const W = 320, H = 220, bx = 0.4, by = 0.9;
  const sc = (i, j) => [i + j * bx, j * by];
  const A = sc(p, q), C = sc(k * p, k * q);
  const maxX = Math.max(C[0], 1.2), maxY = Math.max(C[1], by);
  const s = Math.min(34, (W - 90) / maxX, (H - 70) / maxY);
  const ox = 40, oy = H - 36;
  const X = (u) => ox + u * s, Y = (v) => oy - v * s;
  const dots = [];
  if ((k * p + 1) * (k * q + 1) <= 340) for (let i = 0; i <= k * p; i++) for (let j = 0; j <= k * q; j++) { const c = sc(i, j); dots.push(<circle key={`${i}-${j}`} cx={X(c[0])} cy={Y(c[1])} r="1.8" fill="#bbb" />); }
  return y10Svg(W, H, 340, <>
    {dots}
    {showLine && <line x1={X(0)} y1={Y(0)} x2={X(C[0])} y2={Y(C[1])} stroke={Y8_RED} strokeWidth="1.6" strokeDasharray="5 4" />}
    {y10Arrow(X(0), Y(0), X(1), Y(0), Y10_BLUE, 2.6, "a")}
    {y10Arrow(X(0), Y(0), X(bx), Y(by), Y10_BLUE, 2.6, "b")}
    {y10T(X(0.5), Y(0) + 16, "a", { bold: true, size: 15, fill: Y10_BLUE })}
    {y10T(X(bx) - 8, Y(by) - 2, "b", { bold: true, size: 15, fill: Y10_BLUE, anchor: "end" })}
    {[["O", [0, 0]], ["A", A], ["C", C]].map(([t, c]) => <g key={t}><circle cx={X(c[0])} cy={Y(c[1])} r="3.8" fill="#000" />{y10T(X(c[0]) + 8, Y(c[1]) - 8, t, { bold: true, anchor: "start" })}</g>)}
  </>);
}

// Triangle drawn from its three side lengths (SSS), longest side as the base.
function SSSTriangleSVG({ sides }) {
  const W = 330, H = 210;
  const sorted = sides.slice().sort((u, v) => v.len - u.len);
  const [b, l, r] = sorted;
  const x = (b.len * b.len + l.len * l.len - r.len * r.len) / (2 * b.len);
  const y = Math.sqrt(Math.max(l.len * l.len - x * x, 0.01));
  const sc = Math.min(250 / b.len, 120 / y);
  const baseY = H - 52, left = (W - b.len * sc) / 2;
  const P0 = [left, baseY], P1 = [left + b.len * sc, baseY], P2 = [left + x * sc, baseY - y * sc];
  const cen = [(P0[0] + P1[0] + P2[0]) / 3, (P0[1] + P1[1] + P2[1]) / 3];
  const edge = (p, q, text) => {
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    let nx = -(q[1] - p[1]), ny = q[0] - p[0];
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    if (nx * (m[0] - cen[0]) + ny * (m[1] - cen[1]) < 0) { nx = -nx; ny = -ny; }
    return y10T(m[0] + nx * 18, m[1] + ny * 18 + 4, text, { key: text });
  };
  return y10Svg(W, H, 340, <>
    <polygon points={`${P0.join(",")} ${P1.join(",")} ${P2.join(",")}`} fill="none" stroke="#000" strokeWidth="1.8" strokeLinejoin="round" />
    {edge(P0, P1, b.label)}{edge(P0, P2, l.label)}{edge(P1, P2, r.label)}
  </>);
}

// Isosceles triangle: base, equal sides, optional dashed height and apex angle.
function IsoscelesSVG({ halfBase, height, baseLabel, sideLabel, heightLabel, apexLabel }) {
  const W = 330, H = 215;
  const s = Math.min(230 / (2 * halfBase), 125 / height);
  const baseY = (H + height * s) / 2 + 6;
  const A = [W / 2, baseY - height * s], L = [W / 2 - halfBase * s, baseY], R = [W / 2 + halfBase * s, baseY], M = [W / 2, baseY];
  const tick = (p, q) => {
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
    const nx = -dy / l * 5, ny = dx / l * 5;
    return <line key={`${p}-${q}`} x1={m[0] - nx} y1={m[1] - ny} x2={m[0] + nx} y2={m[1] + ny} stroke="#000" strokeWidth="1.6" />;
  };
  return y10Svg(W, H, 350, <>
    <polygon points={`${A.join(",")} ${L.join(",")} ${R.join(",")}`} fill="none" stroke="#000" strokeWidth="1.8" strokeLinejoin="round" />
    {tick(A, L)}{tick(A, R)}
    {heightLabel && <line x1={A[0]} y1={A[1]} x2={M[0]} y2={M[1]} stroke="#000" strokeWidth="1.2" strokeDasharray="4 3" />}
    {heightLabel && y10RightMark(M, [M[0] + 1, M[1]], [M[0], M[1] - 1], 9)}
    {heightLabel && y10T(M[0] + 8, (A[1] + M[1]) / 2 + 4, heightLabel, { anchor: "start" })}
    {y10T(M[0], baseY + 20, baseLabel)}
    {sideLabel && y10T((A[0] + L[0]) / 2 - 12, (A[1] + L[1]) / 2 - 2, sideLabel, { anchor: "end" })}
    {sideLabel && y10T((A[0] + R[0]) / 2 + 12, (A[1] + R[1]) / 2 - 2, sideLabel, { anchor: "start" })}
    {apexLabel && <AngleMark V={A} P={L} Q={R} label={apexLabel} arcR={24} />}
  </>);
}

function SquareDiagonalSVG({ sideLabel, diagLabel = "?" }) {
  const W = 260, H = 220, x0 = 60, y0 = 24, S = 130;
  return y10Svg(W, H, 260, <>
    <rect x={x0} y={y0} width={S} height={S} fill="none" stroke="#000" strokeWidth="1.8" />
    <line x1={x0} y1={y0 + S} x2={x0 + S} y2={y0} stroke="#000" strokeWidth="1.5" strokeDasharray="5 4" />
    {y10RightMark([x0 + S, y0 + S], [x0 + S - 1, y0 + S], [x0 + S, y0 + S - 1], 10)}
    {y10T(x0 + S / 2, y0 + S + 22, sideLabel)}
    {y10T(x0 + S / 2 - 14, y0 + S / 2 - 8, diagLabel, { bold: true })}
  </>);
}

// Exact trig values: the 30-60-90 and 45-45-90 triangles, or a unit quarter circle for 0 and 90.
function ExactTrigSVG({ angle }) {
  const W = 300, H = 200;
  if (angle === 0 || angle === 90) {
    const ox = 60, oy = 170, R = 120;
    const tx = ox + R * Math.cos((angle * Math.PI) / 180), ty = oy - R * Math.sin((angle * Math.PI) / 180);
    return y10Svg(W, H, 310, <>
      <line x1={ox} y1={oy} x2={ox + R + 24} y2={oy} stroke="#000" strokeWidth="1.3" />
      <line x1={ox} y1={oy} x2={ox} y2={oy - R - 24} stroke="#000" strokeWidth="1.3" />
      <path d={`M${ox + R},${oy} A${R},${R} 0 0 0 ${ox},${oy - R}`} fill="none" stroke="#888" strokeWidth="1.4" strokeDasharray="5 4" />
      <line x1={ox} y1={oy} x2={tx} y2={ty} stroke={Y8_RED} strokeWidth="2.6" />
      <circle cx={tx} cy={ty} r="4" fill={Y8_RED} />
      <circle cx={ox} cy={oy} r="2.6" fill="#000" />
      {angle === 0 ? y10T((ox + tx) / 2, oy - 10, "1", { bold: true }) : y10T(ox + 10, (oy + ty) / 2, "1", { bold: true, anchor: "start" })}
      {y10T(ox + 150, oy - 100, `θ = ${angle}°`, { bold: true, size: 15 })}
      {y10T(ox + 150, oy - 78, "unit circle (radius 1)", { size: 11.5, fill: "#555" })}
    </>);
  }
  const u = angle === 45 ? 118 : 84;
  const bx = angle === 45 ? u : Math.sqrt(3) * u, by = u;
  const R0 = [56, 168], B = [56 + bx, 168], T = [56, 168 - by];
  const base = angle === 45 ? "1" : "√3", hyp = angle === 45 ? "√2" : "2";
  return y10Svg(W, H, 320, <>
    <polygon points={`${R0.join(",")} ${B.join(",")} ${T.join(",")}`} fill="none" stroke="#000" strokeWidth="1.8" strokeLinejoin="round" />
    {y10RightMark(R0, B, T, 11)}
    {y10T((R0[0] + B[0]) / 2, 168 + 20, base)}
    {y10T(R0[0] - 10, (R0[1] + T[1]) / 2 + 4, "1", { anchor: "end" })}
    {y10T((B[0] + T[0]) / 2 + 14, (B[1] + T[1]) / 2 - 6, hyp, { anchor: "start" })}
    {angle === 60 ? <AngleMark V={T} P={R0} Q={B} label="60°" arcR={24} /> : <AngleMark V={B} P={R0} Q={T} label={`${angle}°`} arcR={26} />}
  </>);
}

// Angle of elevation / depression, drawn with the true proportions.
function ElevationSVG({ mode, angle, distLabel, heightLabel = "?" }) {
  const W = 330, H = 210, gy = 172;
  const r = Math.tan((angle * Math.PI) / 180);
  const Lpx = Math.min(210, 125 / r), Hpx = Lpx * r;
  const ground = <line x1="14" y1={gy} x2="318" y2={gy} stroke="#000" strokeWidth="1.6" />;
  if (mode === "elevation") {
    const ox = 40, bx = ox + Lpx, ty = gy - Hpx;
    return y10Svg(W, H, 350, <>
      {ground}
      <rect x={bx - 6} y={ty} width="12" height={Hpx} fill="#e4e4e4" stroke="#000" strokeWidth="1.5" />
      <line x1={ox} y1={gy} x2={bx} y2={ty} stroke="#000" strokeWidth="1.4" strokeDasharray="5 4" />
      <circle cx={ox} cy={gy} r="3.4" fill="#000" />
      {y10RightMark([bx, gy], [bx - 1, gy], [bx, gy - 1], 9)}
      <AngleMark V={[ox, gy]} P={[bx, gy]} Q={[bx, ty]} label={`${angle}°`} arcR={30} />
      {y10T((ox + bx) / 2, gy + 20, distLabel)}
      {y10T(bx + 14, (ty + gy) / 2 + 4, heightLabel, { anchor: "start", bold: heightLabel === "?" })}
    </>);
  }
  const cx0 = 84, bx = cx0 + Lpx, ty = gy - Hpx;
  return y10Svg(W, H, 350, <>
    {ground}
    <rect x={cx0 - 36} y={ty} width="36" height={Hpx} fill="#e4e4e4" stroke="#000" strokeWidth="1.5" />
    <line x1={cx0} y1={ty} x2={cx0 + Lpx + 10} y2={ty} stroke="#000" strokeWidth="1.2" strokeDasharray="5 4" />
    <line x1={cx0} y1={ty} x2={bx} y2={gy} stroke="#000" strokeWidth="1.4" strokeDasharray="5 4" />
    <polygon points={`${bx - 13},${gy - 9} ${bx + 13},${gy - 9} ${bx + 8},${gy} ${bx - 8},${gy}`} fill="#fff" stroke="#000" strokeWidth="1.5" />
    {y10RightMark([cx0, gy], [cx0 + 1, gy], [cx0, gy - 1], 9)}
    <AngleMark V={[cx0, ty]} P={[cx0 + Lpx, ty]} Q={[bx, gy]} label={`${angle}°`} arcR={34} />
    {y10T((cx0 + bx) / 2, gy + 20, distLabel)}
    {y10T(cx0 - 42, (ty + gy) / 2 + 4, heightLabel, { anchor: "end", bold: heightLabel === "?" })}
  </>);
}

// Graph of y = amp·sin(x) or amp·cos(x) for 0° ≤ x ≤ 360°, with an optional horizontal line and marked points.
function TrigGraphSVG({ func, amp = 1, hLine = null, pts = [] }) {
  const W = 440, H = 250, L = 56, R = 20, T = 22, B = 40;
  const top = amp * 1.3;
  const px = (x) => L + (x / 360) * (W - L - R);
  const py = (y) => T + ((top - y) / (2 * top)) * (H - T - B);
  const f = (x) => amp * (func === "sin" ? Math.sin((x * Math.PI) / 180) : Math.cos((x * Math.PI) / 180));
  let d = "";
  for (let x = 0; x <= 360; x += 3) d += `${x === 0 ? "M" : "L"}${px(x).toFixed(1)},${py(f(x)).toFixed(1)} `;
  const yt = [];
  for (let v = -Math.floor(amp); v <= Math.floor(amp); v++) yt.push(v);
  return y10Svg(W, H, 460, <>
    {[0, 90, 180, 270, 360].map((x) => <g key={x}><line x1={px(x)} y1={T} x2={px(x)} y2={H - B} stroke="#e2e2e2" strokeWidth="1" /><text x={px(x)} y={H - B + 17} fontSize="11.5" fontFamily="Arial, sans-serif" textAnchor="middle" fill="#333">{x}°</text></g>)}
    {yt.map((v) => <g key={v}><line x1={L} y1={py(v)} x2={W - R} y2={py(v)} stroke="#e2e2e2" strokeWidth="1" /><text x={L - 7} y={py(v) + 4} fontSize="11.5" fontFamily="Arial, sans-serif" textAnchor="end" fill="#333">{y8lab(v)}</text></g>)}
    <line x1={L} y1={py(0)} x2={W - R} y2={py(0)} stroke="#000" strokeWidth="1.4" />
    <line x1={L} y1={T - 6} x2={L} y2={H - B} stroke="#000" strokeWidth="1.4" />
    <path d={d} fill="none" stroke={Y10_BLUE} strokeWidth="2.4" />
    {hLine && <line x1={L} y1={py(hLine.y)} x2={W - R} y2={py(hLine.y)} stroke={Y8_RED} strokeWidth="1.8" strokeDasharray="6 4" />}
    {hLine && y10T(L - 7, py(hLine.y) + 4, hLine.label, { anchor: "end", bold: true, fill: Y8_RED })}
    {pts.map((q, i) => <g key={i}><circle cx={px(q.x)} cy={py(q.y)} r="4.4" fill={Y8_RED} />{y10T(px(q.x) + (q.x === 0 ? 8 : q.x === 360 ? -8 : 0), py(q.y) + (q.y >= 0 ? -10 : 18), q.label, { bold: true, fill: Y8_RED, anchor: q.x === 0 ? "start" : q.x === 360 ? "end" : "middle" })}</g>)}
  </>);
}

// Bearing of B from A is given; the bearing of A from B is the unknown.
function BackBearingSVG({ bearing, labelB = "?" }) {
  const W = 320, H = 290, cx = 160, cy = 158, half = 58;
  const rad = (bearing * Math.PI) / 180;
  const ux = Math.sin(rad), uy = -Math.cos(rad);
  const A = [cx - ux * half, cy - uy * half], B = [cx + ux * half, cy + uy * half];
  const back = (bearing + 180) % 360;
  const pad3 = (v) => String(v).padStart(3, "0");
  const arc = (V, deg, r, label, bold) => {
    const e = [V[0] + r * Math.sin((deg * Math.PI) / 180), V[1] - r * Math.cos((deg * Math.PI) / 180)];
    const lp = [V[0] + (r + 19) * Math.sin((deg / 2 * Math.PI) / 180), V[1] - (r + 19) * Math.cos((deg / 2 * Math.PI) / 180)];
    return <g>
      <path d={`M${V[0]},${V[1] - r} A${r},${r} 0 ${deg > 180 ? 1 : 0} 1 ${e[0]},${e[1]}`} fill="none" stroke="#000" strokeWidth="1.2" />
      {y10T(lp[0], lp[1] + 4, label, { bold, size: 12.5 })}
    </g>;
  };
  const north = (V) => <g>
    <line x1={V[0]} y1={V[1]} x2={V[0]} y2={V[1] - 70} stroke="#000" strokeWidth="1.2" strokeDasharray="4 3" />
    <polygon points={`${V[0]},${V[1] - 76} ${V[0] - 4},${V[1] - 66} ${V[0] + 4},${V[1] - 66}`} fill="#000" />
    {y10T(V[0], V[1] - 82, "N", { size: 12 })}
  </g>;
  return y10Svg(W, H, 330, <>
    {north(A)}{north(B)}
    <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke="#000" strokeWidth="1.8" />
    {arc(A, bearing, 30, `${pad3(bearing)}°`, false)}
    {arc(B, back, 30, labelB === "?" ? "?" : labelB, labelB === "?")}
    <circle cx={A[0]} cy={A[1]} r="3" fill="#000" /><circle cx={B[0]} cy={B[1]} r="3" fill="#000" />
    {y10T(A[0] - ux * 15, A[1] - uy * 15 + 5, "A", { bold: true })}
    {y10T(B[0] + ux * 15, B[1] + uy * 15 + 5, "B", { bold: true })}
  </>);
}

// Angles in the same segment: A, B on the bottom arc, C and D on the major arc.
function SameSegmentSVG({ angle, labelC, labelD }) {
  const W = 260, H = 240, cx = 130, cy = 112, R = 78;
  const pol = (deg, r = R) => [cx + r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)];
  const A = pol(270 - angle), B = pol(270 + angle), C = pol(122), D = pol(50);
  const seg = (p, q) => <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="#000" strokeWidth="1.5" />;
  return y10Svg(W, H, 300, <>
    {y10Circle(cx, cy, R)}
    {seg(C, A)}{seg(C, B)}{seg(D, A)}{seg(D, B)}
    <AngleMark V={C} P={A} Q={B} label={labelC} arcR={24} />
    <AngleMark V={D} P={A} Q={B} label={labelD} arcR={24} bold={labelD === "?"} />
    {[["A", 270 - angle], ["B", 270 + angle], ["C", 122], ["D", 50]].map(([t, a]) => { const p = pol(a, R + 14); return <g key={t}>{y10T(p[0], p[1] + 5, t, { bold: true })}</g>; })}
  </>);
}

// Tangent at T, chord TP, and the inscribed angle at Q in the alternate segment.
function AlternateSegmentSVG({ theta, labelT, labelQ }) {
  const W = 260, H = 235, cx = 130, cy = 98, R = 70;
  const pol = (deg) => [cx + R * Math.cos((deg * Math.PI) / 180), cy - R * Math.sin((deg * Math.PI) / 180)];
  const T = pol(270), P = pol(270 + 2 * theta), Q = pol(90 + theta);
  const seg = (p, q) => <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="#000" strokeWidth="1.5" />;
  const out = (p, d) => [p[0] + ((p[0] - cx) / R) * d, p[1] + ((p[1] - cy) / R) * d];
  return y10Svg(W, H, 300, <>
    {y10Circle(cx, cy, R)}
    <line x1={cx - 112} y1={T[1]} x2={cx + 112} y2={T[1]} stroke="#000" strokeWidth="1.6" />
    {seg(T, P)}{seg(Q, T)}{seg(Q, P)}
    <AngleMark V={T} P={[T[0] + 60, T[1]]} Q={P} label={labelT} arcR={26} />
    <AngleMark V={Q} P={T} Q={P} label={labelQ} arcR={24} bold={labelQ === "?"} />
    {y10T(T[0], T[1] + 18, "T", { bold: true })}
    {y10T(out(P, 13)[0], out(P, 13)[1] + 5, "P", { bold: true })}
    {y10T(out(Q, 13)[0], out(Q, 13)[1] + 5, "Q", { bold: true })}
  </>);
}

// Two tangents from P touching the circle (centre O) at A and B.
function TangentsSVG({ aob, labelO, labelP }) {
  const W = 300, H = 230, cy = 115;
  const al = ((aob / 2) * Math.PI) / 180;
  const R = Math.min(72, 215 / (1 + 1 / Math.cos(al)));
  const d = R / Math.cos(al);
  const ox = (W - d) / 2;
  const O = [ox, cy], A = [ox + R * Math.cos(al), cy - R * Math.sin(al)], B = [ox + R * Math.cos(al), cy + R * Math.sin(al)], P = [ox + d, cy];
  const pOut = 180 - aob > 70;
  const seg = (p, q) => <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="#000" strokeWidth="1.5" />;
  return y10Svg(W, H, 320, <>
    {y10Circle(ox, cy, R)}
    {seg(O, A)}{seg(O, B)}{seg(A, P)}{seg(B, P)}
    {y10RightMark(A, O, P, 8)}{y10RightMark(B, O, P, 8)}
    <circle cx={O[0]} cy={O[1]} r="2.6" fill="#000" />
    <AngleMark V={O} P={A} Q={B} label={labelO} arcR={14} bold={labelO === "?"} />
    <AngleMark V={P} P={A} Q={B} label={labelP} arcR={12} bold={labelP === "?"} outside={pOut} />
    {y10T(O[0] - 12, O[1] + 5, "O", { bold: true, anchor: "end" })}
    {y10T(A[0] - 2, A[1] - 9, "A", { bold: true })}
    {y10T(B[0] - 2, B[1] + 19, "B", { bold: true })}
    {pOut ? y10T(P[0], P[1] - 16, "P", { bold: true }) : y10T(P[0] + 10, P[1] + 5, "P", { bold: true, anchor: "start" })}
  </>);
}

// Triangle OAB where OA and OB are radii (A and B on the circle).
function RadiiTriangleSVG({ centre, labelO, labelA, labelB }) {
  const W = 260, H = 235, cx = 130, cy = 82, R = 76;
  const pol = (deg, r = R) => [cx + r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)];
  const O = [cx, cy], A = pol(270 - centre / 2), B = pol(270 + centre / 2);
  const seg = (p, q) => <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="#000" strokeWidth="1.6" />;
  const tick = (p) => { const m = [(O[0] + p[0]) / 2, (O[1] + p[1]) / 2], dx = p[0] - O[0], dy = p[1] - O[1], l = Math.hypot(dx, dy); return <line x1={m[0] - (-dy / l) * 5} y1={m[1] - (dx / l) * 5} x2={m[0] + (-dy / l) * 5} y2={m[1] + (dx / l) * 5} stroke="#000" strokeWidth="1.6" />; };
  const lp = (p, d) => [p[0] + ((p[0] - cx) / R) * d, p[1] + ((p[1] - cy) / R) * d];
  return y10Svg(W, H, 300, <>
    {y10Circle(cx, cy, R)}
    {seg(O, A)}{seg(O, B)}{seg(A, B)}
    {tick(A)}{tick(B)}
    <circle cx={O[0]} cy={O[1]} r="2.6" fill="#000" />
    <AngleMark V={O} P={A} Q={B} label={labelO} arcR={12} bold={labelO === "?"} />
    {labelA && <AngleMark V={A} P={O} Q={B} label={labelA} arcR={16} bold={labelA === "?"} outside />}
    {labelB && <AngleMark V={B} P={O} Q={A} label={labelB} arcR={16} bold={labelB === "?"} outside />}
    {y10T(O[0] + 10, O[1] - 8, "O", { bold: true, anchor: "start" })}
    {y10T(A[0] - 9, A[1] - 8, "A", { bold: true, anchor: "end" })}
    {y10T(B[0] + 9, B[1] - 8, "B", { bold: true, anchor: "start" })}
  </>);
}

// Tetrahedron, octahedron and regular-polygon prisms (hidden edges dashed).
function PolyhedronSVG({ kind }) {
  const solid = { stroke: "#000", strokeWidth: 1.7, strokeLinecap: "round" };
  const hid = { stroke: "#000", strokeWidth: 1.1, strokeDasharray: "3 3" };
  const seg = (p, q, style, key) => <line key={key} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} {...style} />;
  if (kind === "tetrahedron") {
    const A = [40, 152], B = [182, 152], C = [208, 116], D = [100, 26];
    return y10Svg(240, 190, 230, <>
      {seg(A, B, solid, 1)}{seg(A, D, solid, 2)}{seg(B, D, solid, 3)}{seg(B, C, solid, 4)}{seg(D, C, solid, 5)}{seg(A, C, hid, 6)}
    </>);
  }
  if (kind === "octahedron") {
    const E1 = [30, 104], E2 = [112, 130], E3 = [194, 104], E4 = [112, 78], T = [112, 18], U = [112, 188];
    return y10Svg(224, 205, 220, <>
      {seg(E1, E2, solid, 1)}{seg(E2, E3, solid, 2)}{seg(E3, E4, hid, 3)}{seg(E4, E1, hid, 4)}
      {seg(T, E1, solid, 5)}{seg(T, E2, solid, 6)}{seg(T, E3, solid, 7)}{seg(T, E4, hid, 8)}
      {seg(U, E1, solid, 9)}{seg(U, E2, solid, 10)}{seg(U, E3, solid, 11)}{seg(U, E4, hid, 12)}
    </>);
  }
  const n = kind === "pentagonal prism" ? 5 : 6;
  const c = [74, 128], rho = 44, s = [52, -34];
  const F = [];
  for (let k = 0; k < n; k++) { const a = ((270 - 180 / n + (360 * k) / n) * Math.PI) / 180; F.push([c[0] + rho * Math.cos(a), c[1] - rho * Math.sin(a)]); }
  const Bk = F.map((p) => [p[0] + s[0], p[1] + s[1]]);
  const vis = F.map((p, i) => {
    const q = F[(i + 1) % n], e = [q[0] - p[0], q[1] - p[1]];
    let nx = e[1], ny = -e[0];
    const m = [(p[0] + q[0]) / 2 - c[0], (p[1] + q[1]) / 2 - c[1]];
    if (nx * m[0] + ny * m[1] < 0) { nx = -nx; ny = -ny; }
    return nx * s[0] + ny * s[1] > 0;
  });
  return y10Svg(230, 205, 230, <>
    {F.map((p, i) => seg(Bk[i], Bk[(i + 1) % n], vis[i] ? solid : hid, `b${i}`))}
    {F.map((p, i) => seg(p, Bk[i], vis[i] || vis[(i + n - 1) % n] ? solid : hid, `c${i}`))}
    <polygon points={F.map((p) => p.join(",")).join(" ")} fill="none" {...solid} strokeLinejoin="round" />
  </>);
}
function y10SolidFor(name) {
  const k = { "cube": "cube", "triangular prism": "triangular prism", "square-based pyramid": "square pyramid" }[name];
  return k ? <SolidSVG kind={k} /> : <PolyhedronSVG kind={name} />;
}

/* ---- Vectors ---- */
SUBTOPIC_BANK["vectors-column-arithmetic"] = {
  topic: "Vectors", title: "Column vector arithmetic", marks: 2,
  build(rng) {
    const a1 = seededInt(rng, -6, 6), a2 = seededInt(rng, -6, 6);
    const b1 = seededInt(rng, -6, 6), b2 = seededInt(rng, -6, 6);
    const p = seededInt(rng, 2, 4), q = seededInt(rng, 2, 4);
    const r1 = p * a1 - q * b1, r2 = p * a2 - q * b2;
    const va = { from: [0, 0], to: [a1, a2], label: "a", color: Y10_BLUE }, vb = { from: [0, 0], to: [b1, b2], label: "b", color: Y8_RED };
    return {
      prompt: `a = (${a1}, ${a2}) and b = (${b1}, ${b2}), drawn on the grid. Find ${p}a − ${q}b as a column vector.`,
      render: <VectorGridSVG vecs={[va, vb]} />, accurateDiagram: true,
      answer: `(${p}×${a1} − ${q}×${b1}, ${p}×${a2} − ${q}×${b2}) = (${r1}, ${r2})`,
      answerRender: <VectorGridSVG vecs={[va, vb, { from: [0, 0], to: [r1, r2], label: `${p}a − ${q}b`, color: Y10_GREEN }]} />,
    };
  },
};
SUBTOPIC_BANK["vectors-route-midpoint"] = {
  topic: "Vectors", title: "Vector routes — dividing a line in a ratio", marks: 3,
  build(rng) {
    const m = seededInt(rng, 1, 3), n = seededInt(rng, 1, 3);
    return {
      prompt: `OAB is a triangle with OA = a and OB = b. P lies on AB such that AP : PB = ${m} : ${n}. Find the vector OP in terms of a and b.`,
      render: <VectorTriangleSVG m={m} n={n} />,
      answer: <>OP = a + <Frac n={m} d={m + n} />(b − a) = <Frac n={n} d={m + n} />a + <Frac n={m} d={m + n} />b</>,
      answerRender: <VectorTriangleSVG m={m} n={n} showOP />,
    };
  },
};
SUBTOPIC_BANK["vectors-parallel-proof"] = {
  topic: "Vectors", title: "Show that two vectors are parallel", marks: 2,
  build(rng) {
    const p = seededInt(rng, 1, 3), q = seededInt(rng, 1, 3);
    const k = seededInt(rng, 2, 3);
    return {
      prompt: `a and b are shown on the diagram. OA = ${p}a + ${q}b and OC = ${p * k}a + ${q * k}b. Show that OA and OC are parallel.`,
      render: <VectorLatticeSVG p={p} q={q} k={k} />, accurateDiagram: true,
      answer: `OC = ${k}(${p}a + ${q}b) = ${k} × OA, so OC is a scalar multiple of OA — the vectors are parallel.`,
      answerRender: <VectorLatticeSVG p={p} q={q} k={k} showLine />,
    };
  },
};
SUBTOPIC_BANK["vectors-magnitude"] = {
  topic: "Vectors", title: "Calculate the magnitude of a vector", marks: 2,
  build(rng) {
    const triples = [[3, 4, 5], [5, 12, 13], [6, 8, 10], [8, 15, 17], [7, 24, 25], [9, 12, 15], [20, 21, 29]];
    const [x, y, mag] = pick(rng, triples);
    const vx = x * pick(rng, [1, -1]), vy = y * pick(rng, [1, -1]);
    return {
      prompt: `The vector v = (${vx}, ${vy}) is drawn on the grid. Find the magnitude of v.`,
      render: <VectorGridSVG vecs={[{ from: [0, 0], to: [vx, vy], label: "v", color: Y8_RED, comps: true }]} comps />, accurateDiagram: true,
      answer: `√((${vx})² + (${vy})²) = √(${x * x} + ${y * y}) = ${mag}`,
    };
  },
};
SUBTOPIC_BANK["vectors-equal-parallel"] = {
  topic: "Vectors", title: "Determine if two vectors are equal, parallel, or neither", marks: 2,
  build(rng) {
    const x = seededInt(rng, 1, 6), y = seededInt(rng, 1, 6);
    const relationship = pick(rng, ["equal", "parallel", "neither"]);
    let vx, vy;
    if (relationship === "equal") { vx = x; vy = y; }
    else if (relationship === "parallel") { const k = pick(rng, [2, 3, -2, -3]); vx = x * k; vy = y * k; }
    else {
      let kx, ky, guard = 0;
      do { kx = seededInt(rng, 1, 6); ky = seededInt(rng, 1, 6); guard++; } while (kx * y === ky * x && guard < 30);
      vx = kx; vy = ky;
    }
    const start = [x + 1, 0];
    return {
      prompt: `a = (${x}, ${y}) and b = (${vx}, ${vy}) are drawn on the grid. State whether vector b is equal to vector a, parallel to vector a, or neither.`,
      render: <VectorGridSVG vecs={[{ from: [0, 0], to: [x, y], label: "a", color: Y10_BLUE }, { from: start, to: [start[0] + vx, start[1] + vy], label: "b", color: Y8_RED }]} />, accurateDiagram: true,
      answer: relationship === "equal" ? "Equal (b is identical to a)" : relationship === "parallel" ? "Parallel (b is a scalar multiple of a)" : "Neither",
    };
  },
};
SUBTOPIC_BANK["vectors-negative-scalar-multiply"] = {
  topic: "Vectors", title: "Multiply a vector by a negative scalar", marks: 1,
  build(rng) {
    let x = seededInt(rng, -8, 8), y = seededInt(rng, -8, 8);
    if (x === 0 && y === 0) x = 3;
    const k = -seededInt(rng, 2, 5);
    const va = { from: [0, 0], to: [x, y], label: "a", color: Y10_BLUE };
    return {
      prompt: `a = (${x}, ${y}) is drawn on the grid. Find ${k}a as a column vector.`,
      render: <VectorGridSVG vecs={[va]} />, accurateDiagram: true,
      answer: `(${k} × ${x}, ${k} × ${y}) = (${k * x}, ${k * y})`,
      answerRender: <VectorGridSVG vecs={[va, { from: [0, 0], to: [k * x, k * y], label: `${k}a`.replace("-", "−"), color: Y10_GREEN }]} />,
    };
  },
};

/* ---- Pythagoras ---- */
SUBTOPIC_BANK["pythagoras-converse-test"] = {
  topic: "Pythagoras", title: "Use the converse of Pythagoras' theorem", marks: 3,
  build(rng) {
    const isRightAngled = pick(rng, [true, false]);
    const rightTriples = [[3, 4, 5], [5, 12, 13], [6, 8, 10], [8, 15, 17], [7, 24, 25], [9, 12, 15], [10, 24, 26], [12, 16, 20]];
    const nearTriples = [[5, 6, 8], [6, 7, 9], [7, 8, 11], [5, 7, 9], [8, 9, 13], [6, 9, 11], [9, 10, 14], [7, 9, 12]];
    const [a, b, c] = pick(rng, isRightAngled ? rightTriples : nearTriples);
    const lhs = a * a + b * b, rhs = c * c;
    const equal = lhs === rhs;
    return {
      prompt: `A triangle has sides ${a} cm, ${b} cm and ${c} cm. Determine whether the triangle is right-angled.`,
      render: <SSSTriangleSVG sides={[{ len: a, label: `${a} cm` }, { len: b, label: `${b} cm` }, { len: c, label: `${c} cm` }]} />, accurateDiagram: true,
      answer: `${a}² + ${b}² = ${lhs}. ${c}² = ${rhs}. Since ${lhs} ${equal ? "=" : "≠"} ${rhs}, the triangle is ${equal ? "" : "not "}right-angled.`,
    };
  },
};
SUBTOPIC_BANK["pythagoras-distance-between-points"] = {
  topic: "Pythagoras", title: "Find the distance between two coordinates", marks: 3,
  build(rng) {
    const x1 = seededInt(rng, -8, 8), y1 = seededInt(rng, -8, 8);
    const dx = seededInt(rng, 3, 12), dy = seededInt(rng, 3, 12);
    const x2 = x1 + dx, y2 = y1 + dy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const lo = Math.min(0, x1, y1) - 2, hi = Math.max(0, x2, y2) + 3;
    const span0 = hi - lo;
    const step = span0 <= 14 ? 1 : span0 <= 30 ? 2 : 5;
    const gMin = Math.floor(lo / step) * step, gMax = gMin + Math.ceil(span0 / step) * step;
    const lab = (v) => (v < 0 ? "−" + Math.abs(v) : String(v));
    return {
      prompt: `Find the distance between the points (${x1}, ${y1}) and (${x2}, ${y2}). Give your answer to 1 decimal place.`,
      render: <CoordinateGridSVG xMin={gMin} xMax={gMax} yMin={gMin} yMax={gMax} step={step}
        points={[{ x: x1, y: y1, label: `(${lab(x1)}, ${lab(y1)})` }, { x: x2, y: y2, label: `(${lab(x2)}, ${lab(y2)})` }]}
        segments={[{ x1, y1, x2, y2 }, { x1, y1, x2: x2, y2: y1, dash: true, color: "#777" }, { x1: x2, y1, x2, y2, dash: true, color: "#777" }]} />,
      accurateDiagram: true,
      answer: `√(${dx}² + ${dy}²) = √(${dx * dx} + ${dy * dy}) = ${dist.toFixed(1)}`,
    };
  },
};
SUBTOPIC_BANK["pythagoras-isosceles-length"] = {
  topic: "Pythagoras", title: "Find the height of an isosceles triangle using Pythagoras", marks: 3,
  build(rng) {
    const halfBase = seededInt(rng, 3, 10);
    const height = seededInt(rng, 4, 12);
    const equalSide = Math.sqrt(halfBase * halfBase + height * height);
    return {
      prompt: `An isosceles triangle has a base of ${halfBase * 2} cm and two equal sides of length ${equalSide.toFixed(1)} cm. Find the height of the triangle, splitting it into two right-angled triangles. Give your answer to 1 decimal place.`,
      render: <IsoscelesSVG halfBase={halfBase} height={height} baseLabel={`${halfBase * 2} cm`} sideLabel={`${equalSide.toFixed(1)} cm`} heightLabel="h" />, accurateDiagram: true,
      answer: `√(${equalSide.toFixed(1)}² − ${halfBase}²) = ${height.toFixed(1)} cm`,
    };
  },
};
SUBTOPIC_BANK["pythagoras-square-diagonal"] = {
  topic: "Pythagoras", title: "Find the diagonal of a square using Pythagoras", marks: 2,
  build(rng) {
    const side = seededInt(rng, 3, 15);
    const diag = side * Math.SQRT2;
    return {
      prompt: `A square has side length ${side} cm. Find the length of its diagonal. Give your answer to 1 decimal place.`,
      render: <SquareDiagonalSVG sideLabel={`${side} cm`} />, accurateDiagram: true,
      answer: `√(${side}² + ${side}²) = √${2 * side * side} = ${diag.toFixed(1)} cm`,
    };
  },
};

/* ---- Trigonometry ---- */
SUBTOPIC_BANK["trig-exact-values"] = {
  topic: "Trigonometry", title: "Recall an exact trigonometric value", marks: 1,
  build(rng) {
    const table = [
      { expr: "sin(30°)", deg: 30, val: <Frac n="1" d="2" /> },
      { expr: "cos(60°)", deg: 60, val: <Frac n="1" d="2" /> },
      { expr: "sin(45°)", deg: 45, val: <><Frac n="1" d="√2" /> (or <Frac n="√2" d="2" />)</> },
      { expr: "cos(45°)", deg: 45, val: <><Frac n="1" d="√2" /> (or <Frac n="√2" d="2" />)</> },
      { expr: "sin(60°)", deg: 60, val: <Frac n="√3" d="2" /> },
      { expr: "cos(30°)", deg: 30, val: <Frac n="√3" d="2" /> },
      { expr: "tan(30°)", deg: 30, val: <><Frac n="1" d="√3" /> (or <Frac n="√3" d="3" />)</> },
      { expr: "tan(45°)", deg: 45, val: "1" },
      { expr: "tan(60°)", deg: 60, val: "√3" },
      { expr: "sin(0°)", deg: 0, val: "0" },
      { expr: "cos(0°)", deg: 0, val: "1" },
      { expr: "sin(90°)", deg: 90, val: "1" },
      { expr: "cos(90°)", deg: 90, val: "0" },
    ];
    const item = pick(rng, table);
    return { prompt: `Write down the exact value of ${item.expr}. Use the diagram to help.`, render: <ExactTrigSVG angle={item.deg} />, accurateDiagram: true, answer: item.val };
  },
};
SUBTOPIC_BANK["trig-elevation-depression"] = {
  topic: "Trigonometry", title: "Angles of elevation and depression", marks: 3,
  build(rng) {
    const angle = pick(rng, [20, 25, 30, 35, 40, 45, 50, 55]);
    const dist = seededInt(rng, 10, 60);
    const height = dist * Math.tan((angle * Math.PI) / 180);
    const isElevation = pick(rng, [true, false]);
    return {
      prompt: isElevation
        ? `From a point on the ground ${dist} m from the base of a tower, the angle of elevation to the top of the tower is ${angle}°. Find the height of the tower. Give your answer to 1 decimal place.`
        : `From the top of a cliff, the angle of depression to a boat is ${angle}°. The boat is ${dist} m from the base of the cliff. Find the height of the cliff. Give your answer to 1 decimal place.`,
      render: <ElevationSVG mode={isElevation ? "elevation" : "depression"} angle={angle} distLabel={`${dist} m`} />, accurateDiagram: true,
      answer: <>tan({angle}°) = <Frac n="height" d={dist} /> → height = {dist} × tan({angle}°) = {height.toFixed(1)} m</>,
    };
  },
};
SUBTOPIC_BANK["trig-isosceles"] = {
  topic: "Trigonometry", title: "Use trigonometry in an isosceles triangle", marks: 3,
  build(rng) {
    const apex = pick(rng, [30, 40, 50, 60, 70, 80]);
    const equalSide = seededInt(rng, 6, 15);
    const base = 2 * equalSide * Math.sin(((apex / 2) * Math.PI) / 180);
    const halfBase = equalSide * Math.sin(((apex / 2) * Math.PI) / 180), height = equalSide * Math.cos(((apex / 2) * Math.PI) / 180);
    return {
      prompt: `An isosceles triangle has two equal sides of length ${equalSide} cm, with an angle of ${apex}° between them. Find the length of the base. Give your answer to 1 decimal place.`,
      render: <IsoscelesSVG halfBase={halfBase} height={height} baseLabel="?" sideLabel={`${equalSide} cm`} apexLabel={`${apex}°`} />, accurateDiagram: true,
      answer: <>Split into two right triangles: base = 2 × {equalSide} × sin({apex}° ÷ 2) = {base.toFixed(1)} cm</>,
    };
  },
};
SUBTOPIC_BANK["trig-equation-sin-cos"] = {
  topic: "Trigonometric Equations", title: "Solve a trigonometric equation for 0° ≤ x ≤ 360°", marks: 3,
  build(rng) {
    const func = pick(rng, ["sin", "cos"]);
    const base = pick(rng, TRIG_REF_ANGLES);
    const valueJSX =
      base === 45 ? <Frac n="√2" d="2" /> :
      (func === "sin") === (base === 30) ? "0.5" : <Frac n="√3" d="2" />;
    const valueTxt = base === 45 ? "√2/2" : (func === "sin") === (base === 30) ? "0.5" : "√3/2";
    const yv = func === "sin" ? Math.sin((base * Math.PI) / 180) : Math.cos((base * Math.PI) / 180);
    const sol1 = base;
    const sol2 = func === "sin" ? 180 - base : 360 - base;
    return {
      prompt: <>Solve {func}(x) = {valueJSX} for 0° ≤ x ≤ 360°. Give both solutions. The graph of y = {func}(x) is shown with the line y = {valueJSX}.</>,
      render: <TrigGraphSVG func={func} hLine={{ y: yv, label: valueTxt }} />, accurateDiagram: true,
      answer: `x = ${sol1}° or x = ${sol2}°`,
      answerRender: <TrigGraphSVG func={func} hLine={{ y: yv, label: valueTxt }} pts={[{ x: sol1, y: yv, label: `${sol1}°` }, { x: sol2, y: yv, label: `${sol2}°` }]} />,
    };
  },
};
SUBTOPIC_BANK["trig-graph-max-min"] = {
  topic: "Trigonometric Graphs", title: "Key features of a sine or cosine graph", marks: 2,
  build(rng) {
    const func = pick(rng, ["sin", "cos"]);
    const a = seededInt(rng, 2, 5);
    const extremum = pick(rng, ["max", "min"]);
    const xVal = func === "sin" ? (extremum === "max" ? 90 : 270) : (extremum === "max" ? 0 : 180);
    const yVal = extremum === "max" ? a : -a;
    return {
      prompt: `The graph of y = ${a}${func}(x°) is drawn for 0° ≤ x < 360°. Write down the coordinates of its ${extremum === "max" ? "maximum" : "minimum"} point.`,
      render: <TrigGraphSVG func={func} amp={a} />, accurateDiagram: true,
      answer: `(${xVal}, ${yVal})`,
      answerRender: <TrigGraphSVG func={func} amp={a} pts={[{ x: xVal, y: yVal, label: `(${xVal}°, ${yVal < 0 ? "−" + (-yVal) : yVal})` }]} />,
    };
  },
};

/* ---- Volume & surface area ---- */
SUBTOPIC_BANK["volume-pyramid"] = {
  topic: "Volume", title: "Volume of a pyramid", marks: 3,
  build(rng) {
    const baseArea = seededInt(rng, 4, 20) * 6;
    const height = seededInt(rng, 3, 15) * 3;
    const v = (baseArea * height) / 3;
    return {
      prompt: `A pyramid has a base area of ${baseArea} cm² and a perpendicular height of ${height} cm. Calculate the volume of the pyramid.`,
      render: <SolidSVG kind="square pyramid" labels={{ base: `Base area ${baseArea} cm²`, height: `${height} cm` }} />, accurateDiagram: true,
      answer: <>⅓ × {baseArea} × {height} = {v} cm³</>,
    };
  },
};
SUBTOPIC_BANK["volume-cone"] = {
  topic: "Volume", title: "Volume of a cone", marks: 3,
  build(rng) {
    const r = seededInt(rng, 2, 8), h = seededInt(rng, 4, 15);
    const v = (1 / 3) * Math.PI * r * r * h;
    return {
      prompt: `A cone has a base radius of ${r} cm and a perpendicular height of ${h} cm. Calculate the volume of the cone. Give your answer to 1 decimal place.`,
      render: <SolidSVG kind="cone" labels={{ r: `${r} cm`, h: `${h} cm` }} />, accurateDiagram: true,
      answer: <>⅓ × π × {r}² × {h} = {v.toFixed(1)} cm³</>,
    };
  },
};
SUBTOPIC_BANK["volume-sphere"] = {
  topic: "Volume", title: "Volume of a sphere", marks: 2,
  build(rng) {
    const r = seededInt(rng, 2, 10);
    const v = (4 / 3) * Math.PI * r * r * r;
    return {
      prompt: `A sphere has a radius of ${r} cm. Calculate the volume of the sphere. Give your answer to 1 decimal place.`,
      render: <SolidSVG kind="sphere" labels={{ r: `${r} cm` }} />, accurateDiagram: true,
      answer: <>4/3 × π × {r}³ = {v.toFixed(1)} cm³</>,
    };
  },
};
SUBTOPIC_BANK["surface-area-cylinder"] = {
  topic: "Surface Area", title: "Surface area of a cylinder", marks: 3,
  build(rng) {
    const r = seededInt(rng, 2, 8), h = seededInt(rng, 4, 15);
    const sa = 2 * Math.PI * r * r + 2 * Math.PI * r * h;
    return {
      prompt: `A cylinder has a base radius of ${r} cm and a height of ${h} cm. Calculate the total surface area of the cylinder. Give your answer to 1 decimal place.`,
      render: <SolidSVG kind="cylinder" labels={{ r: `${r} cm`, h: `${h} cm` }} />, accurateDiagram: true,
      answer: <>2 × π × {r}² + 2 × π × {r} × {h} = {sa.toFixed(1)} cm²</>,
    };
  },
};
SUBTOPIC_BANK["surface-area-pyramid"] = {
  topic: "Surface Area", title: "Surface area of a square-based pyramid", marks: 3,
  build(rng) {
    const base = seededInt(rng, 2, 6) * 2;
    const slantHeight = seededInt(rng, 6, 15);
    const baseArea = base * base;
    const triangleArea = 0.5 * base * slantHeight;
    const sa = baseArea + 4 * triangleArea;
    return {
      prompt: `A square-based pyramid has a base of side ${base} cm and a slant height of ${slantHeight} cm (the height of each triangular face). Calculate the total surface area of the pyramid.`,
      render: <SolidSVG kind="square pyramid" labels={{ base: `${base} cm`, slant: `${slantHeight} cm` }} />, accurateDiagram: true,
      answer: <>Base area = {base}² = {baseArea} cm². 4 triangular faces = 4 × ½ × {base} × {slantHeight} = {4 * triangleArea} cm². Total = {sa} cm²</>,
    };
  },
};
SUBTOPIC_BANK["surface-area-sphere"] = {
  topic: "Surface Area", title: "Surface area of a sphere", marks: 1,
  build(rng) {
    const r = seededInt(rng, 2, 10);
    const sa = 4 * Math.PI * r * r;
    return {
      prompt: `A sphere has a radius of ${r} cm. Calculate the surface area of the sphere. Give your answer to 1 decimal place.`,
      render: <SolidSVG kind="sphere" labels={{ r: `${r} cm` }} />, accurateDiagram: true,
      answer: <>4 × π × {r}² = {sa.toFixed(1)} cm²</>,
    };
  },
};
SUBTOPIC_BANK["three-d-name-from-properties"] = {
  topic: "Properties of 3D Shapes", title: "Name a 3D shape from its faces, edges and vertices", marks: 2,
  build(rng) {
    const s = pick(rng, UNIQUE_POLYHEDRA);
    return { prompt: `A polyhedron has ${s.f} faces, ${s.e} edges and ${s.v} vertices. Name the shape.`, answer: s.name, answerRender: y10SolidFor(s.name) };
  },
};

/* ---- Circle theorems ---- */
SUBTOPIC_BANK["circle-theorem-same-segment"] = {
  topic: "Circle Theorems", title: "Angles in the same segment", marks: 2,
  build(rng) {
    const angle = seededInt(rng, 25, 75);
    return {
      prompt: `A, B, C and D are points on the circumference of a circle. Angles ACB and ADB are angles in the same segment, standing on the same arc AB. Angle ACB = ${angle}°. Find the size of angle ADB.`,
      render: <SameSegmentSVG angle={angle} labelC={`${angle}°`} labelD="?" />, accurateDiagram: true,
      answer: `${angle}° (angles in the same segment, standing on the same arc, are equal)`,
    };
  },
};
SUBTOPIC_BANK["circle-theorem-alternate-segment"] = {
  topic: "Circle Theorems", title: "Alternate segment theorem", marks: 3,
  build(rng) {
    const angle = seededInt(rng, 25, 80);
    return {
      prompt: `A tangent touches a circle at point T. A chord TP is drawn from T, making an angle of ${angle}° with the tangent. Using the alternate segment theorem, find the size of the angle in the alternate segment (the inscribed angle subtended by TP on the other side of the chord).`,
      render: <AlternateSegmentSVG theta={angle} labelT={`${angle}°`} labelQ="?" />, accurateDiagram: true,
      answer: `${angle}° (the alternate segment theorem: the angle between a tangent and a chord equals the angle in the alternate segment)`,
    };
  },
};
SUBTOPIC_BANK["circle-theorem-equal-tangents"] = {
  topic: "Circle Theorems", title: "Equal tangents from an external point", marks: 2,
  build(rng) {
    const angleAPB = seededInt(rng, 30, 100);
    const angleAOB = 180 - angleAPB;
    const askOAB = pick(rng, [true, false]);
    if (askOAB) {
      return {
        prompt: `Two tangents are drawn from an external point P to a circle with centre O, touching the circle at A and B. Angle APB = ${angleAPB}°. Find the size of angle AOB (the angle at the centre between the two radii).`,
        render: <TangentsSVG aob={angleAOB} labelO="?" labelP={`${angleAPB}°`} />, accurateDiagram: true,
        answer: `PA = PB and OA ⊥ PA, OB ⊥ PB, so in quadrilateral OAPB: angle AOB = 360° − 90° − 90° − ${angleAPB}° = ${angleAOB}°`,
      };
    }
    return {
      prompt: `Two tangents are drawn from an external point P to a circle with centre O, touching the circle at A and B. Angle AOB = ${angleAOB}°. Find the size of angle APB.`,
      render: <TangentsSVG aob={angleAOB} labelO={`${angleAOB}°`} labelP="?" />, accurateDiagram: true,
      answer: `Angle APB = 360° − 90° − 90° − ${angleAOB}° = ${angleAPB}°`,
    };
  },
};
SUBTOPIC_BANK["circle-theorem-isosceles-radii"] = {
  topic: "Circle Theorems", title: "Isosceles triangle formed by two radii", marks: 2,
  build(rng) {
    const askCentre = pick(rng, [true, false]);
    if (askCentre) {
      const base = seededInt(rng, 30, 75);
      const centre = 180 - 2 * base;
      return {
        prompt: `O is the centre of a circle, and A and B are points on the circumference. OA and OB are radii, so triangle OAB is isosceles. Angle OAB = angle OBA = ${base}°. Find the size of angle AOB.`,
        render: <RadiiTriangleSVG centre={centre} labelO="?" labelA={`${base}°`} labelB={`${base}°`} />, accurateDiagram: true,
        answer: `180° − 2 × ${base}° = ${centre}° (base angles of the isosceles triangle are equal)`,
      };
    }
    const centre = seededInt(rng, 15, 60) * 2;
    const base = (180 - centre) / 2;
    return {
      prompt: `O is the centre of a circle, and A and B are points on the circumference. OA and OB are radii, so triangle OAB is isosceles. Angle AOB = ${centre}°. Find the size of angle OAB.`,
      render: <RadiiTriangleSVG centre={centre} labelO={`${centre}°`} labelA="?" />, accurateDiagram: true,
      answer: `(180° − ${centre}°) ÷ 2 = ${base}° (base angles of the isosceles triangle are equal)`,
    };
  },
};

/* ---- Bearings ---- */
SUBTOPIC_BANK["bearings-back-bearing"] = {
  topic: "Bearings", title: "Find a back bearing", marks: 2,
  build(rng) {
    const bearing = seededInt(rng, 1, 35) * 10;
    const back = bearing < 180 ? bearing + 180 : bearing - 180;
    const p3 = (v) => String(v).padStart(3, "0");
    return {
      prompt: `The bearing of B from A is ${p3(bearing)}°. Find the bearing of A from B.`,
      render: <BackBearingSVG bearing={bearing} />, accurateDiagram: true,
      answer: `${bearing} ${bearing < 180 ? "+" : "−"} 180 = ${p3(back)}°`,
      answerRender: <BackBearingSVG bearing={bearing} labelB={`${p3(back)}°`} />,
    };
  },
};

/* ---- Number-line answers for the remaining inequality questions ---- */
SUBTOPIC_BANK["inequality-quadratic-solve"] = {
  topic: "Inequalities", title: "Solve a quadratic inequality by factorising", marks: 3,
  build(rng) {
    const r1 = seededInt(rng, -7, -1);
    const r2 = seededInt(rng, 1, 7);
    const b = -(r1 + r2), c = r1 * r2;
    const wantOutside = pick(rng, [true, false]);
    const symbol = wantOutside ? ">" : "<";
    return {
      prompt: `Solve the inequality x² ${pmX(b, "x")} ${pm(c)} ${symbol} 0`,
      answer: wantOutside
        ? `(x − ${r2})(x + ${-r1}) ${symbol} 0, roots at x = ${r1} and x = ${r2}; x < ${r1} or x > ${r2}`
        : `(x − ${r2})(x + ${-r1}) ${symbol} 0, roots at x = ${r1} and x = ${r2}; ${r1} < x < ${r2}`,
      answerRender: <InequalityLineSVG lo={-9} hi={9} segs={wantOutside ? [{ a: null, b: r1, bClosed: false }, { a: r2, aClosed: false, b: null }] : [{ a: r1, aClosed: false, b: r2, bClosed: false }]} />,
    };
  },
};
SUBTOPIC_BANK["solve-inequality-fraction"] = {
  topic: "Inequalities", title: "Solve an inequality involving a fraction", marks: 2,
  build(rng) {
    const p = seededInt(rng, 2, 6);
    const m = seededInt(rng, -6, 6);
    const b = seededInt(rng, -9, 9);
    const symbol = pick(rng, ["<", ">"]);
    const rhs = m + b;
    const xThreshold = p * m;
    return {
      prompt: <>Solve <Frac n="x" d={p} /> {b !== 0 && pm(b)} {symbol} {rhs}</>,
      answer: `x ${symbol} ${xThreshold}`,
      answerRender: y8SolutionLine(xThreshold, symbol),
    };
  },
};

/* ---------- full GCSE spec tree (Edexcel Higher + Foundation, via Dr Frost's
   skill breakdown), grouped Strand → Domain → Group in the style of Mr Barton
   Maths's Ultimate Retrieval Tool, so teachers can see every topic that
   exists, not just the ones built so far. Groups with no subtopics built yet
   show as greyed-out. ---------- */
const FULL_SPEC = {
  "Statistics & Probability": {
    "Averages & Spread": ["Averages from a List", "Averages from Tables and Charts", "Quartiles, Deciles and Percentiles"],
    "Scatter Graphs & Correlation": ["Scatter Graphs"],
    "Collecting & Organising Data": ["Sampling Methods", "Frequency Tables", "Two-Way Tables and Frequency Trees", "Reading Timetables"],
    "Probability": ["Experimental Probability and Expected Outcomes", "Basic Probability", "Venn Diagrams and Set Notation in Probability", "Tree Diagrams"],
    "Representing Data": ["Histograms and Frequency Polygons", "Bar Charts and Vertical Line Charts", "Pie Charts", "Line Graphs and Time Series", "Cumulative Frequency and Box Plots"],
  },
  "Algebra": {
    "Algebraic Fractions": ["Adding & Subtracting Algebraic Fractions", "Multiplying & Dividing Algebraic Fractions", "Simplifying Algebraic Fractions"],
    "Introduction to Algebra": ["Algebraic Notation", "Collecting Like Terms & Simplifying", "Substitution", "Function Machines"],
    "Algebraic Proof": ["Algebraic Proof"],
    "Formulae": ["Rearranging Formulae"],
    "Quadratic & Other Graphs": ["Advanced Graph Skills", "Quadratic Graphs", "Other Graph Types"],
    "Brackets": ["Expanding Brackets", "Factorising"],
    "Functions": ["Functions"],
    "Inequalities": ["Representing Inequalities", "Solving Inequalities"],
    "Indices, Roots & Surds": ["Laws of Indices"],
    "Straight-Line Graphs": ["Parallel & Perpendicular", "Gradient & Equation"],
    "Other Equations": ["Iteration", "Simultaneous Equations"],
    "Sequences": ["Position-to-Term (nth Term)", "Arithmetic Series", "Continuing & Describing Sequences"],
    "Linear Equations": ["Forming Equations", "Solving Linear Equations"],
    "Quadratic Equations": ["Completing the Square", "Solving Quadratics"],
  },
  "Number": {
    "Addition & Subtraction": ["Word Problems"],
    "Calculator Skills": ["Calculator Skills"],
    "Factors, Multiples & Primes": ["Systematic Listing", "HCF & LCM", "Prime Numbers", "Factors & Multiples Basics"],
    "Decimals": ["Operations with Decimals"],
    "Rounding & Estimation": ["Estimation", "Bounds and Error Intervals", "Rounding and Truncating"],
    "Fraction, Decimal, Percentage Equivalence": ["Comparing Across Forms", "Converting Between Forms", "Recurring Decimals"],
    "Fractions": ["Multiplying Fractions", "Fractions of an Amount", "Understanding Fractions", "Adding & Subtracting Fractions", "Dividing Fractions"],
    "British Money": ["Operations with British Money"],
    "Written Methods": ["Written Division", "Written Multiplication"],
    "Negative Numbers": ["Operations with Negatives", "Understanding Negatives"],
    "Number Properties": ["Number Properties"],
    "Mental Arithmetic": ["Order of Operations"],
    "Percentages": ["Percentage Change", "Finding Percentages"],
    "Place Value": ["Comparing and Ordering", "Understanding Place Value"],
    "Indices, Roots & Surds": ["Laws of Indices", "Standard Form", "Surds"],
    "Counting & Number Sense": ["Counting"],
    "Venn Diagrams & Sets": ["Venn Diagrams & Set Notation"],
  },
  "Geometry & Measures": {
    "Angles": ["Basic Angle Facts", "Angles in Shapes", "Angles in Parallel Lines"],
    "Bearings": ["Bearings"],
    "Perimeter & Area": ["Area of Basic Shapes", "Area of Compound Shapes", "Area of Circles"],
    "Circle Theorems": ["Circle Theorems"],
    "Coordinates": ["Reading & Plotting", "Coordinate Geometry"],
    "Geometric Notation": ["Geometric Notation"],
    "Properties of 2D Shapes": ["Naming & Identifying", "Symmetry"],
    "Properties of 3D Shapes": ["Naming & Properties"],
    "Pythagoras' Theorem": ["Pythagoras"],
    "Volume & Surface Area": ["Surface Area", "Volume"],
    "Time": ["Telling the Time", "Calculating with Time"],
    "Transformations": ["Enlargement", "Reflection", "Rotation", "Translation"],
    "Trigonometry": ["Trigonometric Graphs & Equations", "Non-Right-Angled Trigonometry", "Right-Angled Trigonometry"],
    "Measures & Units": ["Converting Units"],
    "Vectors": ["Vector Arithmetic", "Vector Geometry", "Vector Basics"],
    "Constructions & Loci": ["Constructions & Loci"],
    "Scale Drawings & Isometric Drawings": ["Scale Drawings & Isometric Drawings"],
  },
  "Ratio & Proportion": {
    "Direct & Inverse Proportion": ["Direct & Inverse Proportion", "Interpreting Proportion Graphs"],
    "Compound Measures": ["Compound Measures", "Real-Life Graphs"],
    "Scale, Value & Recipes": ["Best Value", "Recipes"],
    "Ratio": ["Using Ratio", "Understanding Ratio"],
    "Similarity": ["Congruence", "Similarity"],
  },
};

const SUBTOPIC_TO_SPEC = {
  "histogram-freq-density": "Statistics & Probability → Representing Data → Histograms and Frequency Polygons",
  "histogram-read-bar": "Statistics & Probability → Representing Data → Histograms and Frequency Polygons",
  "histogram-total-frequency": "Statistics & Probability → Representing Data → Histograms and Frequency Polygons",
  "circle-facts-parts": "Geometry & Measures → Perimeter & Area → Area of Circles",
  "circle-facts-circumference-area": "Geometry & Measures → Perimeter & Area → Area of Circles",
  "expanding-triple-brackets": "Algebra → Brackets → Expanding Brackets",
  "fac-quadratic-agt1": "Algebra → Brackets → Factorising",
  "solve-quadratic-factorise": "Algebra → Quadratic Equations → Solving Quadratics",
  "solve-quadratic-factorise-agt1": "Algebra → Quadratic Equations → Solving Quadratics",
  "solve-quadratic-rearrange": "Algebra → Quadratic Equations → Solving Quadratics",
  "completing-the-square": "Algebra → Quadratic Equations → Completing the Square",
  "completing-the-square-odd-b": "Algebra → Quadratic Equations → Completing the Square",
  "solve-completing-square": "Algebra → Quadratic Equations → Completing the Square",
  "solve-quadratic-formula": "Algebra → Quadratic Equations → Solving Quadratics",
  "plot-nonlinear-graph": "Algebra → Quadratic & Other Graphs → Quadratic Graphs",
  "plot-cubic-graph": "Algebra → Quadratic & Other Graphs → Other Graph Types",
  "significant-points": "Algebra → Quadratic & Other Graphs → Quadratic Graphs",
  "simultaneous-linear-basic": "Algebra → Other Equations → Simultaneous Equations",
  "simultaneous-linear-scale-one": "Algebra → Other Equations → Simultaneous Equations",
  "simultaneous-linear-scaling": "Algebra → Other Equations → Simultaneous Equations",
  "quadratic-simultaneous": "Algebra → Other Equations → Simultaneous Equations",
  "quadratic-simultaneous-circle": "Algebra → Other Equations → Simultaneous Equations",
  "functions-substitution-solving": "Algebra → Functions → Functions",
  "functions-substitute-expression": "Algebra → Functions → Functions",
  "composite-functions": "Algebra → Functions → Functions",
  "inverse-functions": "Algebra → Functions → Functions",
  "changing-subject-expand": "Algebra → Formulae → Rearranging Formulae",
  "changing-subject-factorise": "Algebra → Formulae → Rearranging Formulae",
  "quadratic-sequences": "Algebra → Sequences → Position-to-Term (nth Term)",
  "algebraic-fractions-simplify": "Algebra → Algebraic Fractions → Simplifying Algebraic Fractions",
  "algebraic-fractions-muldiv": "Algebra → Algebraic Fractions → Multiplying & Dividing Algebraic Fractions",
  "algebraic-fractions-addsub": "Algebra → Algebraic Fractions → Adding & Subtracting Algebraic Fractions",
  "surds-simplify": "Number → Indices, Roots & Surds → Surds",
  "surds-add-subtract": "Number → Indices, Roots & Surds → Surds",
  "surds-multiply-expand": "Number → Indices, Roots & Surds → Surds",
  "surds-basic-rationalising": "Number → Indices, Roots & Surds → Surds",
  "surds-rationalising-harder": "Number → Indices, Roots & Surds → Surds",
  "pythagoras-hypotenuse": "Geometry & Measures → Pythagoras' Theorem → Pythagoras",
  "pythagoras-shorter-side": "Geometry & Measures → Pythagoras' Theorem → Pythagoras",
  "percent-of-amount": "Number → Percentages → Finding Percentages",
  "percent-one-of-another": "Number → Percentages → Finding Percentages",
  "percent-compound-increase": "Number → Percentages → Percentage Change",
  "percent-reverse": "Number → Percentages → Percentage Change",
  "sf-large-to-sf": "Number → Indices, Roots & Surds → Standard Form",
  "sf-small-to-ordinary": "Number → Indices, Roots & Surds → Standard Form",
  "sf-multiply": "Number → Indices, Roots & Surds → Standard Form",
  "round-decimal-places": "Number → Rounding & Estimation → Rounding and Truncating",
  "round-significant-figures": "Number → Rounding & Estimation → Rounding and Truncating",
  "round-error-interval": "Number → Rounding & Estimation → Bounds and Error Intervals",
  "estimation-calculation": "Number → Rounding & Estimation → Estimation",
  "fmp-prime-factorisation": "Number → Factors, Multiples & Primes → Prime Numbers",
  "fmp-hcf-lcm": "Number → Factors, Multiples & Primes → HCF & LCM",
  "powers-laws-multiply": "Number → Indices, Roots & Surds → Laws of Indices",
  "powers-zero-and-fractional": "Number → Indices, Roots & Surds → Laws of Indices",
  "frac-of-amount": "Number → Fractions → Fractions of an Amount",
  "frac-multiply-mixed": "Number → Fractions → Multiplying Fractions",
  "frac-recurring-to-fraction": "Number → Fraction, Decimal, Percentage Equivalence → Recurring Decimals",
  "neg-order": "Number → Negative Numbers → Understanding Negatives",
  "neg-difference": "Number → Negative Numbers → Operations with Negatives",
  "bidmas-two-operations": "Number → Mental Arithmetic → Order of Operations",
  "indices-negative": "Algebra → Indices, Roots & Surds → Laws of Indices",
  "indices-fractional": "Algebra → Indices, Roots & Surds → Laws of Indices",
  "bounds-intro": "Number → Rounding & Estimation → Bounds and Error Intervals",
  "bounds-multiply": "Number → Rounding & Estimation → Bounds and Error Intervals",
  "bounds-accuracy": "Number → Rounding & Estimation → Bounds and Error Intervals",
  "direct-proportion": "Ratio & Proportion → Direct & Inverse Proportion → Direct & Inverse Proportion",
  "inverse-proportion": "Ratio & Proportion → Direct & Inverse Proportion → Direct & Inverse Proportion",
  "applied-proportion-graph": "Ratio & Proportion → Direct & Inverse Proportion → Interpreting Proportion Graphs",
  "sine-rule-side": "Geometry & Measures → Trigonometry → Non-Right-Angled Trigonometry",
  "sine-rule-angle": "Geometry & Measures → Trigonometry → Non-Right-Angled Trigonometry",
  "cosine-rule-side": "Geometry & Measures → Trigonometry → Non-Right-Angled Trigonometry",
  "cosine-rule-angle": "Geometry & Measures → Trigonometry → Non-Right-Angled Trigonometry",
  "area-rule": "Geometry & Measures → Trigonometry → Non-Right-Angled Trigonometry",
  "circle-theorem-centre-circumference": "Geometry & Measures → Circle Theorems → Circle Theorems",
  "circle-theorem-semicircle": "Geometry & Measures → Circle Theorems → Circle Theorems",
  "circle-theorem-tangent-kite": "Geometry & Measures → Circle Theorems → Circle Theorems",
  "circle-theorem-cyclic-quadrilateral": "Geometry & Measures → Circle Theorems → Circle Theorems",
  "congruence-criteria": "Ratio & Proportion → Similarity → Congruence",
  "similar-shapes-find-length": "Ratio & Proportion → Similarity → Similarity",
  "similar-shapes-identify": "Ratio & Proportion → Similarity → Similarity",
  "similar-shapes-area-scale": "Ratio & Proportion → Similarity → Similarity",
  "similar-shapes-volume-scale": "Ratio & Proportion → Similarity → Similarity",
  "iterations-fixed-point": "Algebra → Other Equations → Iteration",
  "circle-eq-radius-from-eq": "Algebra → Quadratic & Other Graphs → Advanced Graph Skills",
  "circle-eq-write-given-radius": "Algebra → Quadratic & Other Graphs → Advanced Graph Skills",
  "linear-graph-two-points": "Algebra → Straight-Line Graphs → Gradient & Equation",
  "linear-graph-parallel": "Algebra → Straight-Line Graphs → Parallel & Perpendicular",
  "linear-graph-perpendicular": "Algebra → Straight-Line Graphs → Parallel & Perpendicular",
  "inequality-list-integers": "Algebra → Inequalities → Representing Inequalities",
  "inequality-linear-twostep": "Algebra → Inequalities → Solving Inequalities",
  "inequality-both-sides": "Algebra → Inequalities → Solving Inequalities",
  "inequality-quadratic-solve": "Algebra → Inequalities → Solving Inequalities",
  "vectors-column-arithmetic": "Geometry & Measures → Vectors → Vector Arithmetic",
  "vectors-route-midpoint": "Geometry & Measures → Vectors → Vector Geometry",
  "vectors-parallel-proof": "Geometry & Measures → Vectors → Vector Geometry",
  "algebraic-proof-odd-even": "Algebra → Algebraic Proof → Algebraic Proof",
  "algebraic-proof-multiple": "Algebra → Algebraic Proof → Algebraic Proof",
  "addsub-word-problem": "Number → Addition & Subtraction → Word Problems",
  "multiply-two-two-digit": "Number → Written Methods → Written Multiplication",
  "divide-with-remainder-decimal": "Number → Written Methods → Written Division",
  "decimal-multiply-by-integer": "Number → Decimals → Operations with Decimals",
  "decimal-divide-by-decimal": "Number → Decimals → Operations with Decimals",
  "place-value-digit-value": "Number → Place Value → Understanding Place Value",
  "order-decimals": "Number → Place Value → Comparing and Ordering",
  "number-properties-classify": "Number → Number Properties → Number Properties",
  "number-properties-next-even-odd": "Number → Number Properties → Number Properties",
  "money-change-due": "Number → British Money → Operations with British Money",
  "money-cost-per-item": "Number → British Money → Operations with British Money",
  "fdp-percent-to-decimal": "Number → Fraction, Decimal, Percentage Equivalence → Converting Between Forms",
  "fdp-recurring-partial-nonrecurring": "Number → Fraction, Decimal, Percentage Equivalence → Recurring Decimals",
  "fdp-order-mixed": "Number → Fraction, Decimal, Percentage Equivalence → Comparing Across Forms",
  "calculator-fractions": "Number → Calculator Skills → Calculator Skills",
  "calculator-powers-roots": "Number → Calculator Skills → Calculator Skills",
  "combinations-list-two-groups": "Number → Factors, Multiples & Primes → Systematic Listing",
  "combinations-choose-two": "Number → Factors, Multiples & Primes → Systematic Listing",
  /* --- Number strand expansion --- */
  "frac-simplify": "Number → Fractions → Understanding Fractions",
  "frac-compare-different-denom": "Number → Fractions → Understanding Fractions",
  "frac-improper-mixed-convert": "Number → Fractions → Understanding Fractions",
  "frac-add-same-denom": "Number → Fractions → Adding & Subtracting Fractions",
  "frac-add-different-denom": "Number → Fractions → Adding & Subtracting Fractions",
  "frac-subtract-different-denom": "Number → Fractions → Adding & Subtracting Fractions",
  "frac-add-mixed-numbers": "Number → Fractions → Adding & Subtracting Fractions",
  "frac-subtract-mixed-numbers-exchange": "Number → Fractions → Adding & Subtracting Fractions",
  "frac-divide-by-integer": "Number → Fractions → Dividing Fractions",
  "frac-divide-fraction-by-fraction": "Number → Fractions → Dividing Fractions",
  "decimal-add-different-dp": "Number → Decimals → Operations with Decimals",
  "decimal-subtract-different-dp": "Number → Decimals → Operations with Decimals",
  "decimal-divide-integer-by-decimal": "Number → Decimals → Operations with Decimals",
  "decimal-multiply-decimal-by-decimal": "Number → Decimals → Operations with Decimals",
  "neg-multiply": "Number → Negative Numbers → Operations with Negatives",
  "neg-divide": "Number → Negative Numbers → Operations with Negatives",
  "neg-mixed-word-problem": "Number → Negative Numbers → Operations with Negatives",
  "fmp-list-factors": "Number → Factors, Multiples & Primes → Factors & Multiples Basics",
  "fmp-list-multiples": "Number → Factors, Multiples & Primes → Factors & Multiples Basics",
  "fmp-common-factors": "Number → Factors, Multiples & Primes → Factors & Multiples Basics",
  "fmp-lcm": "Number → Factors, Multiples & Primes → HCF & LCM",
  "indices-divide-same-base": "Number → Indices, Roots & Surds → Laws of Indices",
  "indices-power-of-power-numeric": "Number → Indices, Roots & Surds → Laws of Indices",
  "indices-negative-fractional-base": "Number → Indices, Roots & Surds → Laws of Indices",
  "indices-non-unit-fractional": "Number → Indices, Roots & Surds → Laws of Indices",
  "sf-small-to-sf": "Number → Indices, Roots & Surds → Standard Form",
  "sf-divide": "Number → Indices, Roots & Surds → Standard Form",
  "sf-compare-order": "Number → Indices, Roots & Surds → Standard Form",
  "sf-add-subtract": "Number → Indices, Roots & Surds → Standard Form",
  "fdp-fraction-to-recurring": "Number → Fraction, Decimal, Percentage Equivalence → Recurring Decimals",
  "percent-simple-interest": "Number → Percentages → Percentage Change",
  "percent-reverse-after-increase": "Number → Percentages → Percentage Change",
  "number-properties-square-or-cube": "Number → Number Properties → Number Properties",
  "number-properties-prime-or-composite": "Number → Number Properties → Number Properties",
  "calculator-nested-rounding": "Number → Calculator Skills → Calculator Skills",
  "calculator-surd-to-decimal": "Number → Calculator Skills → Calculator Skills",
  "bidmas-with-powers": "Number → Mental Arithmetic → Order of Operations",
  "collect-like-terms-multi": "Algebra → Introduction to Algebra → Collecting Like Terms & Simplifying",
  "multiply-algebraic-terms": "Algebra → Introduction to Algebra → Collecting Like Terms & Simplifying",
  "algebraic-notation-write": "Algebra → Introduction to Algebra → Algebraic Notation",
  "substitution-one-variable": "Algebra → Introduction to Algebra → Substitution",
  "substitution-formula-negatives": "Algebra → Introduction to Algebra → Substitution",
  "solve-two-step-equation": "Algebra → Linear Equations → Solving Linear Equations",
  "solve-equation-both-sides-brackets": "Algebra → Linear Equations → Solving Linear Equations",
  "form-solve-perimeter-equation": "Algebra → Linear Equations → Forming Equations",
  "arithmetic-sequence-nth-term-value": "Algebra → Sequences → Position-to-Term (nth Term)",
  "arithmetic-series-sum": "Algebra → Sequences → Arithmetic Series",
  "probability-scale-words": "Statistics & Probability → Probability → Basic Probability",
  "probability-scale-compare": "Statistics & Probability → Probability → Basic Probability",
  "theoretical-probability-single": "Statistics & Probability → Probability → Basic Probability",
  "theoretical-probability-not-event": "Statistics & Probability → Probability → Basic Probability",
  "mutually-exclusive-missing-probability": "Statistics & Probability → Probability → Basic Probability",
  "averages-range-listed": "Statistics & Probability → Averages & Spread → Averages from a List",
  "averages-missing-value-given-mean": "Statistics & Probability → Averages & Spread → Averages from a List",
  "mean-from-grouped-table": "Statistics & Probability → Averages & Spread → Averages from Tables and Charts",
  "grouped-table-modal-median-class": "Statistics & Probability → Averages & Spread → Averages from Tables and Charts",
  "ungrouped-frequency-table-mean": "Statistics & Probability → Averages & Spread → Averages from Tables and Charts",
  "stratified-sample-one-category": "Statistics & Probability → Collecting & Organising Data → Sampling Methods",
  "capture-recapture": "Statistics & Probability → Collecting & Organising Data → Sampling Methods",
  "expected-value-biased": "Statistics & Probability → Probability → Experimental Probability and Expected Outcomes",
  "relative-frequency-from-data": "Statistics & Probability → Probability → Experimental Probability and Expected Outcomes",
  "venn-prob-set-notation": "Statistics & Probability → Probability → Venn Diagrams and Set Notation in Probability",
  "venn-independence-check": "Statistics & Probability → Probability → Venn Diagrams and Set Notation in Probability",
  "two-way-table-complete": "Statistics & Probability → Collecting & Organising Data → Two-Way Tables and Frequency Trees",
  "frequency-tree-complete": "Statistics & Probability → Collecting & Organising Data → Two-Way Tables and Frequency Trees",
  "bar-chart-read-frequency": "Statistics & Probability → Representing Data → Bar Charts and Vertical Line Charts",
  "pie-chart-angle-to-frequency": "Statistics & Probability → Representing Data → Pie Charts",
  "timetable-read": "Statistics & Probability → Collecting & Organising Data → Reading Timetables",
  "ungrouped-freq-table-form": "Statistics & Probability → Collecting & Organising Data → Frequency Tables",
  "angles-on-a-line": "Geometry & Measures → Angles → Basic Angle Facts",
  "angles-about-a-point": "Geometry & Measures → Angles → Basic Angle Facts",
  "bearings-find": "Geometry & Measures → Bearings → Bearings",
  "area-rectangle-triangle": "Geometry & Measures → Perimeter & Area → Area of Basic Shapes",
  "composite-rectilinear-area-perimeter": "Geometry & Measures → Perimeter & Area → Area of Compound Shapes",
  "coordinates-identify-point": "Geometry & Measures → Coordinates → Reading & Plotting",
  "coordinates-midpoint-calc": "Geometry & Measures → Coordinates → Coordinate Geometry",
  "shape-properties-quadrilateral-name": "Geometry & Measures → Properties of 2D Shapes → Naming & Identifying",
  "shape-properties-symmetry": "Geometry & Measures → Properties of 2D Shapes → Symmetry",
  "trig-find-side": "Geometry & Measures → Trigonometry → Right-Angled Trigonometry",
  "trig-find-angle": "Geometry & Measures → Trigonometry → Right-Angled Trigonometry",
  "metric-conversion": "Geometry & Measures → Measures & Units → Converting Units",
  "suitable-unit-estimate": "Geometry & Measures → Measures & Units → Converting Units",
  "conversion-graph-read": "Geometry & Measures → Measures & Units → Converting Units",
  "compound-measures-calc": "Ratio & Proportion → Compound Measures → Compound Measures",
  "distance-time-graph-read": "Ratio & Proportion → Compound Measures → Real-Life Graphs",
  "multiplicative-best-value": "Ratio & Proportion → Scale, Value & Recipes → Best Value",
  "multiplicative-recipe-scaling": "Ratio & Proportion → Scale, Value & Recipes → Recipes",
  "ratio-simplify": "Ratio & Proportion → Ratio → Understanding Ratio",
  "ratio-share-amount": "Ratio & Proportion → Ratio → Using Ratio",
  "volume-cuboid": "Geometry & Measures → Volume & Surface Area → Volume",
  "volume-cylinder": "Geometry & Measures → Volume & Surface Area → Volume",
  "surface-area-cuboid": "Geometry & Measures → Volume & Surface Area → Surface Area",
  "volume-triangular-prism": "Geometry & Measures → Volume & Surface Area → Volume",
  "three-d-faces-edges-vertices": "Geometry & Measures → Properties of 3D Shapes → Naming & Properties",
  "three-d-name-from-properties": "Geometry & Measures → Properties of 3D Shapes → Naming & Properties",
  "transform-reflect-shape": "Geometry & Measures → Transformations → Reflection",
  "transform-translate-shape": "Geometry & Measures → Transformations → Translation",
  "transform-rotate-shape": "Geometry & Measures → Transformations → Rotation",
  "transform-enlarge-shape": "Geometry & Measures → Transformations → Enlargement",
  "time-duration-calc": "Geometry & Measures → Time → Calculating with Time",
  "clock-reading": "Geometry & Measures → Time → Telling the Time",
  "trig-equation-sin-cos": "Geometry & Measures → Trigonometry → Trigonometric Graphs & Equations",
  "trig-graph-max-min": "Geometry & Measures → Trigonometry → Trigonometric Graphs & Equations",
  "geometric-notation-naming": "Geometry & Measures → Geometric Notation → Geometric Notation",
  /* --- Geometry & Measures strand expansion --- */
  "angles-vertically-opposite": "Geometry & Measures → Angles → Basic Angle Facts",
  "angles-triangle-sum": "Geometry & Measures → Angles → Angles in Shapes",
  "angles-isosceles-triangle": "Geometry & Measures → Angles → Angles in Shapes",
  "angles-exterior-triangle": "Geometry & Measures → Angles → Angles in Shapes",
  "angles-quadrilateral-sum": "Geometry & Measures → Angles → Angles in Shapes",
  "angles-parallelogram": "Geometry & Measures → Angles → Angles in Shapes",
  "angles-trapezium": "Geometry & Measures → Angles → Angles in Shapes",
  "angles-kite": "Geometry & Measures → Angles → Angles in Shapes",
  "angles-interior-polygon-sum": "Geometry & Measures → Angles → Angles in Shapes",
  "angles-missing-in-polygon": "Geometry & Measures → Angles → Angles in Shapes",
  "angles-exterior-regular-polygon": "Geometry & Measures → Angles → Angles in Shapes",
  "angles-interior-regular-polygon": "Geometry & Measures → Angles → Angles in Shapes",
  "angles-polygon-sides-from-angle": "Geometry & Measures → Angles → Angles in Shapes",
  "angles-alternate": "Geometry & Measures → Angles → Angles in Parallel Lines",
  "angles-corresponding": "Geometry & Measures → Angles → Angles in Parallel Lines",
  "angles-co-interior": "Geometry & Measures → Angles → Angles in Parallel Lines",
  "angles-parallel-lines-two-step": "Geometry & Measures → Angles → Angles in Parallel Lines",
  "pythagoras-converse-test": "Geometry & Measures → Pythagoras' Theorem → Pythagoras",
  "pythagoras-distance-between-points": "Geometry & Measures → Pythagoras' Theorem → Pythagoras",
  "pythagoras-isosceles-length": "Geometry & Measures → Pythagoras' Theorem → Pythagoras",
  "pythagoras-square-diagonal": "Geometry & Measures → Pythagoras' Theorem → Pythagoras",
  "pythagoras-surd-answer": "Geometry & Measures → Pythagoras' Theorem → Pythagoras",
  "trig-exact-values": "Geometry & Measures → Trigonometry → Right-Angled Trigonometry",
  "trig-elevation-depression": "Geometry & Measures → Trigonometry → Right-Angled Trigonometry",
  "trig-isosceles": "Geometry & Measures → Trigonometry → Right-Angled Trigonometry",
  "volume-pyramid": "Geometry & Measures → Volume & Surface Area → Volume",
  "volume-cone": "Geometry & Measures → Volume & Surface Area → Volume",
  "volume-sphere": "Geometry & Measures → Volume & Surface Area → Volume",
  "surface-area-cylinder": "Geometry & Measures → Volume & Surface Area → Surface Area",
  "surface-area-pyramid": "Geometry & Measures → Volume & Surface Area → Surface Area",
  "surface-area-sphere": "Geometry & Measures → Volume & Surface Area → Surface Area",
  "circle-theorem-same-segment": "Geometry & Measures → Circle Theorems → Circle Theorems",
  "circle-theorem-alternate-segment": "Geometry & Measures → Circle Theorems → Circle Theorems",
  "circle-theorem-equal-tangents": "Geometry & Measures → Circle Theorems → Circle Theorems",
  "circle-theorem-isosceles-radii": "Geometry & Measures → Circle Theorems → Circle Theorems",
  "vectors-magnitude": "Geometry & Measures → Vectors → Vector Basics",
  "vectors-equal-parallel": "Geometry & Measures → Vectors → Vector Basics",
  "vectors-negative-scalar-multiply": "Geometry & Measures → Vectors → Vector Basics",
  "bearings-back-bearing": "Geometry & Measures → Bearings → Bearings",
  "measures-convert-area-units": "Geometry & Measures → Measures & Units → Converting Units",
  "shape-naming-polygon-by-sides": "Geometry & Measures → Properties of 2D Shapes → Naming & Identifying",
  "scatter-correlation-type": "Statistics & Probability → Scatter Graphs & Correlation → Scatter Graphs",
  "line-of-best-fit-estimate": "Statistics & Probability → Scatter Graphs & Correlation → Scatter Graphs",
  "moving-average-calc": "Statistics & Probability → Representing Data → Line Graphs and Time Series",
  "trapezium-rule-area": "Algebra → Quadratic & Other Graphs → Advanced Graph Skills",
  "exponential-graph-features": "Algebra → Quadratic & Other Graphs → Other Graph Types",
  "curve-transform-translate": "Algebra → Quadratic & Other Graphs → Advanced Graph Skills",

  /* --- Recovered subtopics: these were already built (in the original
     SUBTOPIC_BANK literal block) but got left out of the picker when the
     topic tree was restructured into the Mr Barton-style layout. Restoring
     them here so they're selectable again. --- */
  "venn-shade": "Number → Venn Diagrams & Sets → Venn Diagrams & Set Notation",
  "venn-complete": "Number → Venn Diagrams & Sets → Venn Diagrams & Set Notation",
  "venn-missing": "Number → Venn Diagrams & Sets → Venn Diagrams & Set Notation",
  "venn-prob-only": "Statistics & Probability → Probability → Venn Diagrams and Set Notation in Probability",
  "venn-prob-union": "Statistics & Probability → Probability → Venn Diagrams and Set Notation in Probability",
  "set-notation-list": "Number → Venn Diagrams & Sets → Venn Diagrams & Set Notation",
  "set-notation-membership": "Number → Venn Diagrams & Sets → Venn Diagrams & Set Notation",
  "eb-single-pos": "Algebra → Brackets → Expanding Brackets",
  "eb-single-neg": "Algebra → Brackets → Expanding Brackets",
  "eb-single-term-outside": "Algebra → Brackets → Expanding Brackets",
  "eb-double-pos": "Algebra → Brackets → Expanding Brackets",
  "eb-double-mixed": "Algebra → Brackets → Expanding Brackets",
  "eb-double-neg": "Algebra → Brackets → Expanding Brackets",
  "eb-squared": "Algebra → Brackets → Expanding Brackets",
  "fac-common": "Algebra → Brackets → Factorising",
  "fac-quadratic": "Algebra → Brackets → Factorising",
  "fac-dots": "Algebra → Brackets → Factorising",
  "fac-hcf-lookalike": "Algebra → Brackets → Factorising",
  "product-rule-counting": "Number → Factors, Multiples & Primes → Systematic Listing",
  "tree-replacement": "Statistics & Probability → Probability → Tree Diagrams",
  "tree-no-replacement": "Statistics & Probability → Probability → Tree Diagrams",
  "boxplot-range": "Statistics & Probability → Representing Data → Cumulative Frequency and Box Plots",
  "boxplot-iqr": "Statistics & Probability → Representing Data → Cumulative Frequency and Box Plots",
  "cf-table-complete": "Statistics & Probability → Representing Data → Cumulative Frequency and Box Plots",
  "cf-median-class": "Statistics & Probability → Representing Data → Cumulative Frequency and Box Plots",

  /* --- Factorising: new skills matching Mr Barton's full "Factorising" list --- */
  "fac-common-algebraic": "Algebra → Brackets → Factorising",
  "fac-monic-neg": "Algebra → Brackets → Factorising",
  "fac-monic-perfect-square": "Algebra → Brackets → Factorising",
  "fac-nonmonic-neg": "Algebra → Brackets → Factorising",
  "fac-nonmonic-perfect-square": "Algebra → Brackets → Factorising",
  "fac-dots-nonmonic": "Algebra → Brackets → Factorising",
  "fac-common-then-simplify": "Algebra → Brackets → Factorising",
  "fac-negative-leading": "Algebra → Brackets → Factorising",
  "fac-common-bracket": "Algebra → Brackets → Factorising",
  "fac-grouping": "Algebra → Brackets → Factorising",
  "fac-two-variables": "Algebra → Brackets → Factorising",

  /* --- Using Ratio: new skills matching Mr Barton's full "Using ratio" list --- */
  "ratio-total-parts": "Ratio & Proportion → Ratio → Using Ratio",
  "ratio-quantity-one-part-given": "Ratio & Proportion → Ratio → Using Ratio",
  "ratio-quantity-difference-given": "Ratio & Proportion → Ratio → Using Ratio",
  "ratio-to-fraction": "Ratio & Proportion → Ratio → Using Ratio",
  "fraction-to-ratio": "Ratio & Proportion → Ratio → Using Ratio",
  "ratio-to-percentage": "Ratio & Proportion → Ratio → Using Ratio",
  "percentage-to-ratio": "Ratio & Proportion → Ratio → Using Ratio",
  "ratio-combine-two": "Ratio & Proportion → Ratio → Using Ratio",

  /* --- Algebra strand expansion --- */
  "algebraic-fractions-simplify-basic": "Algebra → Algebraic Fractions → Simplifying Algebraic Fractions",
  "algebraic-fractions-simplify-factorise": "Algebra → Algebraic Fractions → Simplifying Algebraic Fractions",
  "algebraic-fractions-divide": "Algebra → Algebraic Fractions → Multiplying & Dividing Algebraic Fractions",
  "algebraic-fractions-addsub-diffvars": "Algebra → Algebraic Fractions → Adding & Subtracting Algebraic Fractions",
  "algebraic-fractions-solve-equation": "Algebra → Algebraic Fractions → Adding & Subtracting Algebraic Fractions",
  "algebraic-notation-index-form": "Algebra → Introduction to Algebra → Algebraic Notation",
  "divide-algebraic-terms": "Algebra → Introduction to Algebra → Collecting Like Terms & Simplifying",
  "divide-algebraic-terms-basic": "Algebra → Introduction to Algebra → Collecting Like Terms & Simplifying",
  "collect-like-terms-brackets": "Algebra → Introduction to Algebra → Collecting Like Terms & Simplifying",
  "expand-two-single-brackets": "Algebra → Brackets → Expanding Brackets",
  "substitution-two-variables": "Algebra → Introduction to Algebra → Substitution",
  "substitution-square-root-formula": "Algebra → Introduction to Algebra → Substitution",
  "algebraic-proof-counterexample": "Algebra → Algebraic Proof → Algebraic Proof",
  "rearrange-square-root": "Algebra → Formulae → Rearranging Formulae",
  "rearrange-square": "Algebra → Formulae → Rearranging Formulae",
  "estimate-gradient-tangent": "Algebra → Quadratic & Other Graphs → Advanced Graph Skills",
  "quadratic-roots-and-intercept": "Algebra → Quadratic & Other Graphs → Quadratic Graphs",
  "turning-point-from-completed-square": "Algebra → Quadratic & Other Graphs → Quadratic Graphs",
  "sketch-quadratic-a1": "Algebra → Quadratic & Other Graphs → Quadratic Graphs",
  "sketch-quadratic-agt1": "Algebra → Quadratic & Other Graphs → Quadratic Graphs",
  "cubic-graph-features": "Algebra → Quadratic & Other Graphs → Other Graph Types",
  "reciprocal-graph-features": "Algebra → Quadratic & Other Graphs → Other Graph Types",
  "solve-function-equation": "Algebra → Functions → Functions",
  "inequality-from-number-line": "Algebra → Inequalities → Representing Inequalities",
  "inequality-double-sided": "Algebra → Inequalities → Representing Inequalities",
  "solve-inequality-fraction": "Algebra → Inequalities → Solving Inequalities",
  "indices-power-of-a-power": "Algebra → Indices, Roots & Surds → Laws of Indices",
  "indices-combined-negative-fractional": "Algebra → Indices, Roots & Surds → Laws of Indices",
  "parallel-or-perpendicular-classify": "Algebra → Straight-Line Graphs → Parallel & Perpendicular",
  "equation-from-gradient-and-point": "Algebra → Straight-Line Graphs → Gradient & Equation",
  "x-and-y-intercepts-from-equation": "Algebra → Straight-Line Graphs → Gradient & Equation",
  "iteration-rearrange-first": "Algebra → Other Equations → Iteration",
  "simultaneous-equations-word-problem": "Algebra → Other Equations → Simultaneous Equations",
  "find-nth-term-linear": "Algebra → Sequences → Position-to-Term (nth Term)",
  "generate-terms-from-nth-term": "Algebra → Sequences → Position-to-Term (nth Term)",
  "arithmetic-series-find-n": "Algebra → Sequences → Arithmetic Series",
  "form-equation-angles": "Algebra → Linear Equations → Forming Equations",
  "form-equation-consecutive-integers": "Algebra → Linear Equations → Forming Equations",
  "solve-equation-fractions": "Algebra → Linear Equations → Solving Linear Equations",
  "solve-equation-negative-coefficient": "Algebra → Linear Equations → Solving Linear Equations",
  "completing-square-non-monic": "Algebra → Quadratic Equations → Completing the Square",
  "solve-quadratic-square-rooting": "Algebra → Quadratic Equations → Solving Quadratics",
  "solve-quadratic-word-problem": "Algebra → Quadratic Equations → Solving Quadratics",  /* --- Year 7 build-out --- */
  "ratio-bar-model": "Ratio & Proportion → Ratio → Using Ratio",
  "ratio-one-to-n": "Ratio & Proportion → Ratio → Understanding Ratio",
  "currency-convert": "Ratio & Proportion → Direct & Inverse Proportion → Direct & Inverse Proportion",
  "scale-map-distance": "Geometry & Measures → Scale Drawings & Isometric Drawings → Scale Drawings & Isometric Drawings",
  "alg-classify-type": "Algebra → Introduction to Algebra → Algebraic Notation",
  "form-expression-perimeter": "Algebra → Introduction to Algebra → Algebraic Notation",
  "alg-directed-simplify": "Algebra → Introduction to Algebra → Collecting Like Terms & Simplifying",
  "coord-fourth-vertex": "Geometry & Measures → Coordinates → Reading & Plotting",
  "line-equation-axis-parallel": "Algebra → Straight-Line Graphs → Gradient & Equation",
  "line-gradient-intercept-read": "Algebra → Straight-Line Graphs → Gradient & Equation",
  "line-equation-from-graph": "Algebra → Straight-Line Graphs → Gradient & Equation",
  "line-table-of-values": "Algebra → Straight-Line Graphs → Gradient & Equation",
  "frac-multiply-integer": "Number → Fractions → Multiplying Fractions",
  "frac-multiply-two": "Number → Fractions → Multiplying Fractions",
  "frac-reciprocal": "Number → Fractions → Dividing Fractions",
  "symmetry-lines-rotation": "Geometry & Measures → Properties of 2D Shapes → Symmetry",
  "describe-reflection": "Geometry & Measures → Transformations → Reflection",
  "solid-name-identify": "Geometry & Measures → Properties of 3D Shapes → Naming & Properties",
  "density-calc": "Ratio & Proportion → Compound Measures → Compound Measures",
  "density-find-mass-volume": "Ratio & Proportion → Compound Measures → Compound Measures",
  "capacity-mass-convert": "Geometry & Measures → Measures & Units → Converting Units",
  "solve-linear-brackets": "Algebra → Linear Equations → Solving Linear Equations",
  "ineq-represent-number-line": "Algebra → Inequalities → Representing Inequalities",
  "percent-multiplier": "Number → Percentages → Percentage Change",
  "percent-change-find": "Number → Percentages → Percentage Change",
  "index-notation-evaluate": "Algebra → Indices, Roots & Surds → Laws of Indices",
  "indices-simplify-algebra": "Algebra → Indices, Roots & Surds → Laws of Indices",
  "sf-large-to-ordinary": "Number → Indices, Roots & Surds → Standard Form",
  "outlier-dotplot": "Statistics & Probability → Averages & Spread → Averages from a List",
  "compare-distributions": "Statistics & Probability → Averages & Spread → Averages from a List",
  "angles-parallel-algebra": "Geometry & Measures → Angles → Angles in Parallel Lines",
  "angles-polygon-algebra": "Geometry & Measures → Angles → Angles in Shapes",
  "sample-space-spinners": "Statistics & Probability → Probability → Basic Probability",
  "two-way-table-probability": "Statistics & Probability → Collecting & Organising Data → Two-Way Tables and Frequency Trees",
  "circle-arc-sector": "Geometry & Measures → Perimeter & Area → Area of Circles",
  "circle-compound": "Geometry & Measures → Perimeter & Area → Area of Circles",
  "misleading-bar-chart": "Statistics & Probability → Representing Data → Bar Charts and Vertical Line Charts",
  "seq-pattern-nth-term": "Algebra → Sequences → Position-to-Term (nth Term)",
  "seq-is-term-of-sequence": "Algebra → Sequences → Position-to-Term (nth Term)",
  "seq-continue-linear": "Algebra → Sequences → Continuing & Describing Sequences",
  "seq-term-to-term-rule": "Algebra → Sequences → Continuing & Describing Sequences",
  "seq-linear-or-not": "Algebra → Sequences → Continuing & Describing Sequences",
  "seq-predict-pattern-term": "Algebra → Sequences → Continuing & Describing Sequences",
  "seq-missing-terms-linear": "Algebra → Sequences → Continuing & Describing Sequences",
  "seq-geometric-next": "Algebra → Sequences → Continuing & Describing Sequences",
  "seq-pattern-draw-next": "Algebra → Sequences → Continuing & Describing Sequences",
  "seq-pattern-count-terms": "Algebra → Sequences → Continuing & Describing Sequences",
  "function-machine-output": "Algebra → Introduction to Algebra → Function Machines",
  "function-machine-input": "Algebra → Introduction to Algebra → Function Machines",
  "function-machine-expression": "Algebra → Introduction to Algebra → Function Machines",
  "function-machine-find-operation": "Algebra → Introduction to Algebra → Function Machines",
  "solve-one-step-equation": "Algebra → Linear Equations → Solving Linear Equations",
  "like-terms-identify": "Algebra → Introduction to Algebra → Collecting Like Terms & Simplifying",
  "equivalent-expression-choose": "Algebra → Introduction to Algebra → Collecting Like Terms & Simplifying",
  "place-value-write-in-words": "Number → Place Value → Understanding Place Value",
  "number-line-interval-value": "Number → Place Value → Understanding Place Value",
  "round-nearest-power-of-ten": "Number → Rounding & Estimation → Rounding and Truncating",
  "estimate-over-under": "Number → Rounding & Estimation → Estimation",
  "multiply-divide-by-powers-of-10": "Number → Decimals → Operations with Decimals",
  "multiply-divide-by-0.1-0.01": "Number → Decimals → Operations with Decimals",
  "decimal-divide-by-integer": "Number → Decimals → Operations with Decimals",
  "divide-integer-written": "Number → Written Methods → Written Division",
  "averages-four-measures": "Statistics & Probability → Averages & Spread → Averages from a List",
  "pie-chart-angle-from-frequency": "Statistics & Probability → Representing Data → Pie Charts",
  "fdp-convert-fraction-decimal-percentage": "Number → Fraction, Decimal, Percentage Equivalence → Converting Between Forms",
  "fraction-as-division": "Number → Fraction, Decimal, Percentage Equivalence → Converting Between Forms",
  "equivalent-fraction-missing": "Number → Fractions → Understanding Fractions",
  "neg-add-subtract": "Number → Negative Numbers → Operations with Negatives",
  "neg-missing-number": "Number → Negative Numbers → Operations with Negatives",
  "neg-bidmas": "Number → Negative Numbers → Operations with Negatives",
  "fraction-find-whole": "Number → Fractions → Fractions of an Amount",
  "percent-of-amount-mental": "Number → Percentages → Finding Percentages",
  "percent-above-100": "Number → Percentages → Finding Percentages",
  "percent-increase-decrease": "Number → Percentages → Percentage Change",
  "percent-find-whole": "Number → Percentages → Percentage Change",
  "perimeter-polygon-calc": "Geometry & Measures → Perimeter & Area → Area of Basic Shapes",
  "area-parallelogram": "Geometry & Measures → Perimeter & Area → Area of Basic Shapes",
  "area-triangle-base-height": "Geometry & Measures → Perimeter & Area → Area of Basic Shapes",
  "area-trapezium": "Geometry & Measures → Perimeter & Area → Area of Basic Shapes",
  "time-units-convert": "Geometry & Measures → Time → Calculating with Time",
  "speed-calc": "Ratio & Proportion → Compound Measures → Compound Measures",
  "distance-calc": "Ratio & Proportion → Compound Measures → Compound Measures",
  "time-calc": "Ratio & Proportion → Compound Measures → Compound Measures",
  "roots-evaluate": "Number → Number Properties → Number Properties",
  "triangular-numbers": "Number → Number Properties → Number Properties",
  "angle-type-name": "Geometry & Measures → Angles → Basic Angle Facts",
  "triangle-classify": "Geometry & Measures → Properties of 2D Shapes → Naming & Identifying",
};

function seedFor(idsKey, version, salt) {
  let s = salt;
  for (const ch of idsKey + version) s = (s * 31 + ch.charCodeAt(0)) | 0;
  return s >>> 0;
}

/* ---------- persistent quiz codes (feature 1): the whole app is a static
   file with no backend/database, so a code can't be a short DB lookup key
   the way a server-backed tool's would be — instead it self-encodes the
   exact state needed to reproduce the quiz (which subtopics, practice mode,
   fixed length, regeneration salt, and active version) as a compact string.
   Decoding it is a pure function of the bank itself, so a code keeps working
   even if this file is opened fresh with no server round-trip, and can be
   shared as a "?code=" link too.
   The subtopic body used to store positional indices into
   ALL_SUBTOPIC_IDS = Object.keys(SUBTOPIC_BANK) — compact, but silently
   wrong for any code saved before a new subtopic got inserted anywhere in
   the middle of SUBTOPIC_BANK's definition (which reshuffles every index
   after it), rather than appended at the very end. A teacher who saved a
   code, then this file gained a mid-list subtopic, would reload that code
   into different subtopics without any error. Codes are now written with
   the literal subtopic ID strings instead (format version 2, below), which
   can never be invalidated by later edits to this file — only ids that no
   longer exist get silently dropped. ALL_SUBTOPIC_IDS/the index scheme is
   kept only so old, already-shared codes keep decoding as before. ---------- */
const ALL_SUBTOPIC_IDS = Object.keys(SUBTOPIC_BANK);
// No subtopic id uses "~", so it's a safe delimiter for the id-string body
// (ids themselves are hyphenated, e.g. "solve-quadratic-rearrange", so "-"
// can't be reused as the separator the way the old index-based body did).
const ID_BODY_SEP = "~";

// formatVersion 3 (superseded by 4 below, still decodable): each subtopic id
// packed down to a short, FIXED-LENGTH hash instead of its full slug (e.g.
// "circle-theorem-cyclic-quadrilateral" -> 5 base36 chars) — a full-length id
// per question made a 6-question Weekly Quiz code ~160 chars and a
// 60-question Custom one 1300+, way too long to read aloud, type, or fit
// comfortably in a shared link.
// Deliberately NOT a positional index (see the block comment above this one
// for why that broke every previously-shared code the moment a subtopic got
// inserted mid-bank) — the hash is a pure function of the id's own text, so
// it can never shift when other subtopics are added. It's also deliberately
// NOT a dynamic-length scheme with runtime collision-bumping: that would
// still let inserting a new, colliding id silently reassign an *existing*
// id's short code later, breaking old shared codes the same way. A fixed
// N-char hash accepts a fixed, vanishingly small collision risk instead —
// the same trade-off short git hashes/YouTube IDs make.
//
// formatVersion 4 shortens this further still (4 chars instead of 5, still
// zero collisions across the current bank) and drops the "~" separator
// entirely in favour of fixed-width chunking, and packs the header's three
// small fields (mode/length-code/version) into a single base36 digit instead
// of three underscore-joined ones — a 6-question code: 163 chars (full
// slugs) -> 47 (v3) -> 32 (v4). formatVersion is deliberately kept as its
// own always-last, never-repacked header field (see encode/decode) so a
// *future* format 5 can still change how the other fields are packed
// without breaking the ability to even recognise which format a code is.
const SHORT_ID_CODE_LEN_V3 = 5;
const SHORT_ID_CODE_LEN = 4;
function fnv1aHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const _idShortCodeMapsByLen = new Map();
function getIdShortCodeMaps(len = SHORT_ID_CODE_LEN) {
  if (_idShortCodeMapsByLen.has(len)) return _idShortCodeMapsByLen.get(len);
  const idToCode = new Map();
  const codeToId = new Map();
  const space = Math.pow(36, len);
  for (const id of Object.keys(SUBTOPIC_BANK)) {
    const code = (fnv1aHash(id) % space).toString(36).padStart(len, "0");
    idToCode.set(id, code);
    if (!codeToId.has(code)) codeToId.set(code, id); // first-write-wins on the accepted rare collision
  }
  const maps = { idToCode, codeToId };
  _idShortCodeMapsByLen.set(len, maps);
  return maps;
}

/* ---------- quiz codes, format 5 (current) ----------
   Problems with the earlier punctuated codes ("8_1_0_4.vb8bh0gx.0-1-1"): a
   double-click only selected one chunk of them, chat apps wrapped lines at
   the hyphens, trailing punctuation/"Code:" prefixes were read as part of the
   code (silently loading a different quiz), mixed case failed, and nothing
   noticed a mistyped character. The question order a teacher dragged into
   place also wasn't saved.
   Format 5 is one unbroken run of letters and digits (Crockford base32: no
   I, L, O or U, so it can be read aloud or typed from print without 0/O or
   1/I/L mix-ups). It is case-insensitive, ignores spaces/dashes/punctuation
   and surrounding words when read back, and ends with a 2-character check
   value that catches any single wrong character or swapped pair — so a bad
   copy is reported instead of loading the wrong quiz.
   Layout (every field is base32 characters):
     meta (1)   mode + length mode + version, 0..17. Values 18..31 are reserved
                for any future format, so a newer code is recognised as such.
     salt       varint        nid  varint (number of subtopic ids)
     ids        nid x 5 chars (hash of the id text; never a list position, so
                adding subtopics can't shift an old code)
     nonces     varint count, then per entry: version (1), index, count — the
                per-question "new numbers" presses
     order      varint 0 = natural order, else the length followed by the
                underlying question index shown in each position (drag-reorder)
     check (2)  weighted sum mod 1021 of everything before it
   varint = little-endian 4-bit groups, bit 16 of each char = "more follows".
   Older formats (2, 3, 4, positional-index) still decode — see
   decodeLegacyQuizCode below. ---------- */
const QC_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const QC_ID_LEN = 5;
const QC_MOD = 1021;
function qcNormalise(text) {
  return String(text)
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .split("")
    .filter((c) => QC_ALPHABET.indexOf(c) !== -1)
    .join("");
}
function qcPutVar(n) {
  let v = Math.max(0, Math.floor(Number(n) || 0));
  let out = "";
  do {
    const d = v % 16;
    v = Math.floor(v / 16);
    out += QC_ALPHABET[d | (v > 0 ? 16 : 0)];
  } while (v > 0);
  return out;
}
function qcCheck(payload) {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) sum = (sum + (i + 1) * QC_ALPHABET.indexOf(payload[i])) % QC_MOD;
  return QC_ALPHABET[sum >> 5] + QC_ALPHABET[sum & 31];
}
let _qcIdMaps = null;
function getQcIdMaps() {
  if (_qcIdMaps) return _qcIdMaps;
  const idToCode = new Map();
  const codeToId = new Map();
  for (const id of Object.keys(SUBTOPIC_BANK)) {
    let h = fnv1aHash(id);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    const n = h & 0x1ffffff; // 25 bits = 5 base32 chars
    let code = "";
    for (let k = QC_ID_LEN - 1; k >= 0; k--) code += QC_ALPHABET[(n >>> (5 * k)) & 31];
    if (codeToId.has(code) && codeToId.get(code) !== id && typeof console !== "undefined") {
      console.error(`Quiz code collision: "${id}" and "${codeToId.get(code)}" both hash to ${code}`);
    }
    idToCode.set(id, code);
    if (!codeToId.has(code)) codeToId.set(code, id);
  }
  _qcIdMaps = { idToCode, codeToId };
  return _qcIdMaps;
}

function encodeQuizCode({ ids, mode, length, lengthMode, salt, version, nonces, order }) {
  const validIds = ids.filter((id) => Object.prototype.hasOwnProperty.call(SUBTOPIC_BANK, id));
  if (validIds.length === 0) return "";
  // lengthMode (not the numeric length) decides Do Now / Weekly / Custom, so a
  // Custom quiz with exactly 4 or 6 questions can never reload as a preset.
  // A Custom quiz's length is simply the number of ids, so it isn't stored.
  const lengthCode = lengthMode === "donow" ? 0 : lengthMode === "weekly" ? 1 : 2;
  const versionNum = { V1: 0, V2: 1, V3: 2 }[version] || 0;
  const meta = (mode === "blocked" ? 1 : 0) + lengthCode * 2 + versionNum * 6;
  const { idToCode } = getQcIdMaps();
  let p = QC_ALPHABET[meta] + qcPutVar(salt) + qcPutVar(validIds.length) + validIds.map((id) => idToCode.get(id)).join("");
  const nonceEntries = nonces
    ? Object.entries(nonces)
        .filter(([, n]) => n > 0)
        .map(([key, n]) => {
          const [v, i] = key.split("-");
          return [{ V1: 0, V2: 1, V3: 2 }[v] ?? 0, Math.max(0, i | 0), n];
        })
        .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    : [];
  p += qcPutVar(nonceEntries.length);
  for (const [v, i, n] of nonceEntries) p += QC_ALPHABET[v] + qcPutVar(i) + qcPutVar(n);
  const reordered = Array.isArray(order) && order.length > 0 && order.some((v, i) => v !== i);
  p += reordered ? qcPutVar(order.length) + order.map(qcPutVar).join("") : qcPutVar(0);
  return p + qcCheck(p);
}

// Decodes one already-normalised format-5 string. Returns { ok, data } or
// { ok: false, reason } where reason is "check" | "newer" | "ids" | "shape".
function decodeQuizCodeV5(norm) {
  if (norm.length < 9) return { ok: false, reason: "shape" };
  const payload = norm.slice(0, -2);
  if (qcCheck(payload) !== norm.slice(-2)) return { ok: false, reason: "check" };
  const val = (c) => QC_ALPHABET.indexOf(c);
  let pos = 0;
  const getVar = () => {
    let v = 0, mult = 1;
    for (let k = 0; k < 8; k++) {
      if (pos >= payload.length) return null;
      const c = val(payload[pos++]);
      v += (c & 15) * mult;
      mult *= 16;
      if (!(c & 16)) return v;
    }
    return null;
  };
  const meta = val(payload[pos++]);
  if (meta > 17) return { ok: false, reason: "newer" };
  const salt = getVar();
  const nid = getVar();
  if (salt === null || nid === null || nid < 1 || nid > 200) return { ok: false, reason: "shape" };
  const { codeToId } = getQcIdMaps();
  const ids = [];
  for (let i = 0; i < nid; i++) {
    const chunk = payload.slice(pos, pos + QC_ID_LEN);
    pos += QC_ID_LEN;
    const id = chunk.length === QC_ID_LEN ? codeToId.get(chunk) : undefined;
    if (!id) return { ok: false, reason: "ids" };
    ids.push(id);
  }
  const nonceCount = getVar();
  if (nonceCount === null || nonceCount > 400) return { ok: false, reason: "shape" };
  const nonces = {};
  for (let k = 0; k < nonceCount; k++) {
    if (pos >= payload.length) return { ok: false, reason: "shape" };
    const v = val(payload[pos++]);
    const idx = getVar();
    const n = getVar();
    if (v > 2 || idx === null || n === null) return { ok: false, reason: "shape" };
    nonces[`${["V1", "V2", "V3"][v]}-${idx}`] = n;
  }
  const orderLen = getVar();
  if (orderLen === null || orderLen > 400) return { ok: false, reason: "shape" };
  const order = [];
  for (let k = 0; k < orderLen; k++) {
    const v = getVar();
    if (v === null) return { ok: false, reason: "shape" };
    order.push(v);
  }
  if (pos !== payload.length) return { ok: false, reason: "shape" };
  if (orderLen > 0 && (new Set(order).size !== orderLen || order.some((v) => v >= orderLen))) return { ok: false, reason: "shape" };
  const modeBit = meta % 2;
  const lengthCode = Math.floor(meta / 2) % 3;
  const versionNum = Math.floor(meta / 6) % 3;
  return {
    ok: true,
    data: {
      mode: modeBit ? "blocked" : "interleaved",
      length: lengthCode === 0 ? 4 : lengthCode === 1 ? 6 : ids.length,
      lengthMode: lengthCode === 0 ? "donow" : lengthCode === 1 ? "weekly" : "custom",
      version: ["V1", "V2", "V3"][versionNum],
      salt,
      ids,
      nonces,
      order,
      dropped: 0,
    },
  };
}

// The one entry point for anything a teacher pastes: a bare code, a code with
// spaces/dashes or surrounding words ("Quiz code: ..."), a full shareable
// link, or an older-format code. Returns { ok: true, data } or
// { ok: false, message } with a plain-English reason.
function parseQuizCode(input) {
  const text = String(input == null ? "" : input).trim();
  if (!text) return { ok: false, message: "Paste a quiz code or link first." };
  let src = text;
  const linkMatch = src.match(/[?&]code=([^&#\s]+)/i);
  if (linkMatch) {
    try { src = decodeURIComponent(linkMatch[1]); } catch (e) { src = linkMatch[1]; }
  }
  // Older codes are punctuated (header_with_underscores.body[.nonces]); pull
  // one out of whatever surrounds it before trying the current format.
  const legacy = src.toLowerCase().match(/[0-9a-z]+(?:_[0-9a-z]+)+\.[0-9a-z~-]+(?:\.[0-9a-z,-]+)?/);
  if (legacy) {
    const data = decodeLegacyQuizCode(legacy[0].replace(/[-,~]+$/, ""));
    if (data) return { ok: true, data };
    return { ok: false, message: "That older-style code looks incomplete — copy it again in full." };
  }
  const tokens = src.split(/\s+/).filter(Boolean);
  const candidates = [src];
  for (let i = 0; i < tokens.length && i < 40; i++) {
    let joined = "";
    for (let j = i; j < tokens.length && j < i + 12; j++) {
      joined += tokens[j];
      candidates.push(joined);
    }
  }
  let bestReason = null;
  let longest = 0;
  const tried = new Set();
  for (const c of candidates) {
    const norm = qcNormalise(c);
    if (norm.length < 9 || tried.has(norm)) continue;
    tried.add(norm);
    longest = Math.max(longest, norm.length);
    const res = decodeQuizCodeV5(norm);
    if (res.ok) return res;
    if (res.reason === "newer" || res.reason === "ids") bestReason = res.reason;
  }
  if (longest < 14) return { ok: false, message: "That doesn't look like a quiz code. Use the Copy button next to your quiz code, then paste it here." };
  if (bestReason === "newer") return { ok: false, message: "This code was made with a newer version of the engine. Refresh this page and try again." };
  if (bestReason === "ids") return { ok: false, message: "This code uses question types this copy of the engine doesn't have yet. Refresh the page and try again." };
  return { ok: false, message: "This code has a missing or mistyped character. Copy it again with the Copy button, or paste the shareable link instead." };
}
// Back-compat wrapper (used to read ?code= on page load).
function decodeQuizCode(code) {
  const res = parseQuizCode(code);
  return res.ok ? res.data : null;
}

/* ---------- older code formats (2, 3, 4 and positional-index) — still readable ---------- */
function decodeLegacyQuizCode(code) {
  try {
    let raw = String(code).trim();
    // Be forgiving of pasting the whole "Copy shareable link" URL instead of
    // just the bare code from the "Copy" button — pull the code param out of
    // it if that's what we were given.
    const linkMatch = raw.match(/[?&]code=([^&#\s]+)/);
    if (linkMatch) raw = decodeURIComponent(linkMatch[1]);
    // Strip any stray whitespace/newlines a copy-paste (especially on mobile)
    // can introduce. Split on up to two "."s: header.body[.nonces] — no
    // subtopic id or short code ever contains a literal ".", so an older
    // 2-part code (no nonces segment) is still split correctly.
    raw = raw.replace(/\s+/g, "");
    const dotIdx = raw.indexOf(".");
    if (dotIdx === -1) return null;
    const header = raw.slice(0, dotIdx);
    const rest = raw.slice(dotIdx + 1);
    const dot2Idx = rest.indexOf(".");
    const body = dot2Idx === -1 ? rest : rest.slice(0, dot2Idx);
    const noncesRaw = dot2Idx === -1 ? "" : rest.slice(dot2Idx + 1);
    if (!header || !body) return null;
    // formatVersion 4's header packs mode/lengthCode/version into one field
    // (4 header fields total) instead of format <=3's six separate ones —
    // branch on field count, since formatVersion itself lives inside the
    // packed field for the old layout and can't be read until unpacked.
    const headerParts = header.split("_").map((s) => parseInt(s, 36));
    // Any non-numeric header field means the code was mangled in transit (a
    // stray prefix/suffix glued on, a mistyped character) — refuse it rather
    // than decode a different quiz from garbage.
    if (headerParts.some((n) => Number.isNaN(n))) return null;
    let modeBit, lengthCode, versionNum, salt, customLen, formatVersion;
    if (headerParts.length === 4) {
      const [packedMeta, saltV, customLenV, fv] = headerParts;
      formatVersion = fv;
      salt = saltV;
      customLen = customLenV;
      modeBit = packedMeta % 2;
      lengthCode = Math.floor(packedMeta / 2) % 3;
      versionNum = Math.floor(packedMeta / 6) % 3;
    } else {
      [modeBit, lengthCode, versionNum, salt, customLen, formatVersion] = headerParts;
    }
    // Every field has a small known range; anything outside it means extra
    // characters got glued onto the code (e.g. "Code2_7_0_4...").
    if (headerParts.length === 4 ? headerParts[0] > 17 : !(modeBit <= 1 && lengthCode <= 2 && versionNum <= 2)) return null;
    // formatVersion 4 = fixed-width, separator-free hashed codes (current);
    // 3 = hashed codes with a "~" separator; 2 = literal id strings (still
    // shareable from before the hashing fix); anything else = the legacy
    // positional-index scheme — best-effort only, since a code saved under
    // that scheme may already have been invalidated by a later mid-list
    // subtopic insertion; there's no way to recover that after the fact, but
    // at least codes saved under 2, 3 or 4 can never break again this way.
    let ids;
    let total = 0; // how many subtopic slots the body claimed, so unknown ones can be reported
    if (formatVersion === 4) {
      const { codeToId } = getIdShortCodeMaps(SHORT_ID_CODE_LEN);
      const chunks = [];
      for (let i = 0; i < body.length; i += SHORT_ID_CODE_LEN) chunks.push(body.slice(i, i + SHORT_ID_CODE_LEN));
      total = chunks.length;
      ids = chunks.map((c) => codeToId.get(c)).filter((id) => id && Object.prototype.hasOwnProperty.call(SUBTOPIC_BANK, id));
    } else if (formatVersion === 3) {
      const { codeToId } = getIdShortCodeMaps(SHORT_ID_CODE_LEN_V3);
      total = body.split(ID_BODY_SEP).length;
      ids = body.split(ID_BODY_SEP).map((c) => codeToId.get(c)).filter((id) => id && Object.prototype.hasOwnProperty.call(SUBTOPIC_BANK, id));
    } else if (formatVersion === 2) {
      total = body.split(ID_BODY_SEP).length;
      ids = body.split(ID_BODY_SEP).filter((id) => Object.prototype.hasOwnProperty.call(SUBTOPIC_BANK, id));
    } else {
      total = body.split("-").length;
      ids = body.split("-").map((s) => parseInt(s, 36)).map((i) => ALL_SUBTOPIC_IDS[i]).filter(Boolean);
    }
    if (ids.length === 0) return null;
    // A code saved before Custom took an arbitrary count has no 5th field
    // (customLen parses to NaN) — length falls back to null exactly like
    // before, and loadCode's own fallback matches it to the ticked subtopics.
    const length = lengthCode === 0 ? 4 : lengthCode === 1 ? 6 : Number.isFinite(customLen) && customLen > 0 ? customLen : null;
    // lengthMode is derived from lengthCode directly, not by sniffing the
    // numeric length value — a Custom quiz whose count happens to be exactly
    // 4 or 6 would otherwise be misread as Do Now/Weekly Quiz on reload.
    const lengthMode = lengthCode === 0 ? "donow" : lengthCode === 1 ? "weekly" : "custom";
    // A Custom-mode code saved under the original positional-index scheme
    // (only unique ids, with the actual quiz reconstructed by cycling them
    // to fill customLen) needs that cycling reproduced explicitly now, since
    // Custom no longer cycles at all — it treats `ids` as the exact quiz
    // already (see effectiveIds). Without this, an older saved code with
    // e.g. 3 ticked subtopics cycled up to 5 questions would reload as just
    // those 3 subtopics/questions.
    if (formatVersion !== 2 && formatVersion !== 3 && formatVersion !== 4 && lengthCode === 2 && length && length > ids.length) {
      const cycled = [];
      for (let i = 0; i < length; i++) cycled.push(ids[i % ids.length]);
      ids = cycled;
    }
    const nonces = {};
    if (noncesRaw) {
      for (const entry of noncesRaw.split(",")) {
        const [vStr, iStr, nStr] = entry.split("-");
        const vName = ["V1", "V2", "V3"][parseInt(vStr, 36)];
        const idx = parseInt(iStr, 36), n = parseInt(nStr, 36);
        if (vName && Number.isFinite(idx) && Number.isFinite(n)) nonces[`${vName}-${idx}`] = n;
      }
    }
    return {
      mode: modeBit ? "blocked" : "interleaved",
      length,
      lengthMode,
      version: ["V1", "V2", "V3"][versionNum] || "V1",
      salt: Number.isFinite(salt) ? salt : 1,
      ids,
      nonces,
      order: [],
      dropped: Math.max(0, total - ids.length),
    };
  } catch (e) {
    return null;
  }
}

/* ---------- shared online quiz library (optional) ----------
   One shared sign-in (the department password) unlocks one shared list of
   saved quizzes, stored in a small Supabase database, so a quiz saved on one
   computer can be opened from any other. A saved quiz is just its name, the
   author's typed name, and its quiz code (see formatVersion 5 above), so no
   pupil data is ever stored. Until LIBRARY_CONFIG is filled in (see
   LIBRARY_SETUP.md) the whole feature stays hidden and the page behaves
   exactly as before.
   Talks to Supabase's standard REST endpoints with plain fetch (no client
   library, nothing extra to load): password sign-in at /auth/v1/token and the
   `quizzes` table at /rest/v1/quizzes. Row Level Security on that table, not
   this page, is what keeps strangers out; the anon key below is public by
   design and useless without the shared sign-in. ---------- */
const LIBRARY_CONFIG = { url: "", anonKey: "", email: "" };
const LIB_SESSION_KEY = "quizEngineLibrarySession";
function libConfig() {
  const c = (typeof window !== "undefined" && window.QE_LIBRARY_CONFIG) || LIBRARY_CONFIG;
  return c && c.url && c.anonKey && c.email ? { url: String(c.url).replace(/\/+$/, ""), anonKey: c.anonKey, email: c.email } : null;
}
function libLoadSession() {
  try {
    const s = JSON.parse(window.localStorage.getItem(LIB_SESSION_KEY));
    return s && s.refresh_token ? s : null;
  } catch (e) {
    return null;
  }
}
function libStoreSession(session) {
  try {
    if (session) window.localStorage.setItem(LIB_SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(LIB_SESSION_KEY);
  } catch (e) {}
}
async function libAuth(grant, body) {
  const c = libConfig();
  const res = await fetch(`${c.url}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: c.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error(res.status === 400 && grant === "password" ? "That password isn't right." : data.error_description || data.msg || data.message || "Couldn't sign in.");
    err.status = res.status;
    throw err;
  }
  const session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  libStoreSession(session);
  return session;
}
const libSignIn = (password) => libAuth("password", { email: libConfig().email, password });
const libSignOut = () => libStoreSession(null);
async function libToken() {
  let s = libLoadSession();
  if (!s) throw Object.assign(new Error("Please sign in to the library."), { status: 401 });
  if (s.expires_at - Date.now() < 60000) {
    try {
      s = await libAuth("refresh_token", { refresh_token: s.refresh_token });
    } catch (e) {
      libStoreSession(null);
      throw Object.assign(new Error("Your library sign-in has expired. Please sign in again."), { status: 401 });
    }
  }
  return s.access_token;
}
async function libRest(path, { method = "GET", body, prefer } = {}) {
  const c = libConfig();
  const token = await libToken();
  const res = await fetch(`${c.url}/rest/v1/${path}`, {
    method,
    headers: { apikey: c.anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : null) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    libStoreSession(null);
    throw Object.assign(new Error("Your library sign-in has expired. Please sign in again."), { status: 401 });
  }
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.message || `The library couldn't complete that (error ${res.status}).`);
  }
  return res.status === 204 ? null : res.json();
}
const LIB_COLUMNS = "id,name,author,notes,code,created_at,updated_at";
const libList = () => libRest(`quizzes?select=${LIB_COLUMNS}&deleted_at=is.null&order=created_at.desc&limit=500`);
const libSave = (row) => libRest("quizzes", { method: "POST", body: row, prefer: "return=representation" }).then((r) => r && r[0]);
const libUpdate = (id, patch) =>
  libRest(`quizzes?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: patch, prefer: "return=representation" }).then((r) => {
    if (!r || r.length === 0) throw new Error("That quiz no longer exists in the library.");
    return r[0];
  });
// Quizzes are only ever hidden, never destroyed (the database has no delete
// permission at all), so a mistaken delete can be undone from the dashboard.
const libHide = (id) => libUpdate(id, { deleted_at: new Date().toISOString() });

// Split a quiz's questions across printed pages so each page renders as a
// fixed 1-column x 3-row (3-cell) table. Pages fill front-to-back — page 1
// takes up to 3 questions, page 2 takes the next up to 3, and so on — so
// only the final page can come up short, in which case it gets blank filler
// cells to keep the table shape (2 -> [2], 3 -> [3], 4 -> [3, 1], etc).
function distributeQuestionsAcrossPages(total, perPage = 3) {
  if (total === 0) return [0];
  const sizes = [];
  let remaining = total;
  while (remaining > 0) {
    const take = Math.min(perPage, remaining);
    sizes.push(take);
    remaining -= take;
  }
  return sizes;
}

// ---------- Negative Numbers Speed Check ----------
// A fixed-structure, 24-question mental-maths fluency sheet — deliberately
// separate from the subtopic system (it isn't built or selected like an
// ordinary SUBTOPIC_BANK entry; see the sidebar's "Speed Checks" section and
// the speedCheckOpen view below). Covers, in a fixed order, all 23
// sign/operation "variations" for a calculation involving at least one
// negative number across +, −, × and ÷ (7 addition + 7 subtraction + 5
// multiplication + 4 division), plus one extra question of a common GCSE
// type (adding a positive to a negative for a positive result — the classic
// "temperature rises" pattern) to round the sheet out to 24. Fresh numbers
// every time it's generated; division is always constructed to divide
// exactly, since this is meant to be answered mentally in about 3 minutes.
function buildNegativeSpeedCheck(rng) {
  const item = (expr, answer) => ({ expr, answer });
  const items = [];

  // Addition (7 variations). Negative numbers are written bare (−3, not
  // (−3)) at the user's request — this does mean an addition/subtraction
  // sign can sit directly next to a negative sign (e.g. "4 + −9"), which is
  // deliberate here rather than an oversight.
  { const b = seededInt(rng, 2, 9), a = b + seededInt(rng, 1, 9); items.push(item(`${a} + −${b}`, a - b)); } // 1. pos + neg -> positive
  { const a = seededInt(rng, 2, 9), b = a + seededInt(rng, 1, 9); items.push(item(`−${a} + ${b}`, b - a)); } // 2. neg + pos -> positive
  { const a = seededInt(rng, 2, 12); items.push(item(`${a} + −${a}`, 0)); } // 3. pos + neg -> zero
  { const a = seededInt(rng, 2, 12); items.push(item(`−${a} + ${a}`, 0)); } // 4. neg + pos -> zero
  { const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9); items.push(item(`−${a} + −${b}`, -(a + b))); } // 5. neg + neg -> negative
  { const a = seededInt(rng, 2, 9), b = a + seededInt(rng, 1, 9); items.push(item(`${a} + −${b}`, a - b)); } // 6. pos + neg -> negative
  { const b = seededInt(rng, 2, 9), a = b + seededInt(rng, 1, 9); items.push(item(`−${a} + ${b}`, b - a)); } // 7. neg + pos -> negative

  // Subtraction (7 variations)
  { const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9); items.push(item(`${a} − −${b}`, a + b)); } // 8. pos - neg -> positive (bigger)
  { const a = seededInt(rng, 2, 9), b = a + seededInt(rng, 1, 9); items.push(item(`−${a} − −${b}`, b - a)); } // 9. neg - (more negative) -> positive
  { const a = seededInt(rng, 2, 12); items.push(item(`${a} − ${a}`, 0)); } // 10. pos - pos (equal) -> zero
  { const a = seededInt(rng, 2, 12); items.push(item(`−${a} − −${a}`, 0)); } // 11. neg - neg (equal) -> zero
  { const x = seededInt(rng, 2, 9), y = x + seededInt(rng, 1, 9); items.push(item(`${x} − ${y}`, x - y)); } // 12. pos - pos, crosses zero -> negative
  { const b = seededInt(rng, 2, 9), a = b + seededInt(rng, 1, 9); items.push(item(`−${a} − −${b}`, b - a)); } // 13. neg - (less negative) -> negative
  { const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9); items.push(item(`−${a} − ${b}`, -(a + b))); } // 14. neg - pos -> more negative

  // Multiplication (5 variations)
  { const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9); items.push(item(`−${a} × −${b}`, a * b)); } // 15. neg × neg -> positive
  { const a = seededInt(rng, 2, 9); items.push(item(`−${a} × 0`, 0)); } // 16. neg × 0 -> zero
  { const a = seededInt(rng, 2, 9); items.push(item(`0 × −${a}`, 0)); } // 17. 0 × neg -> zero
  { const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9); items.push(item(`${a} × −${b}`, -(a * b))); } // 18. pos × neg -> negative
  { const a = seededInt(rng, 2, 9), b = seededInt(rng, 2, 9); items.push(item(`−${a} × ${b}`, -(a * b))); } // 19. neg × pos -> negative

  // Division (4 variations) — divisor/quotient chosen so every division is exact
  { const b = seededInt(rng, 2, 6), qn = seededInt(rng, 2, 6), a = b * qn; items.push(item(`−${a} ÷ −${b}`, a / b)); } // 20. neg ÷ neg -> positive
  { const a = seededInt(rng, 2, 9); items.push(item(`0 ÷ −${a}`, 0)); } // 21. 0 ÷ neg -> zero
  { const b = seededInt(rng, 2, 6), qn = seededInt(rng, 2, 6), a = b * qn; items.push(item(`${a} ÷ −${b}`, -(a / b))); } // 22. pos ÷ neg -> negative
  { const b = seededInt(rng, 2, 6), qn = seededInt(rng, 2, 6), a = b * qn; items.push(item(`−${a} ÷ ${b}`, -(a / b))); } // 23. neg ÷ pos -> negative

  // Bonus: one extra question of a common GCSE type (neg + pos -> positive,
  // e.g. the "temperature rises" pattern) to round the sheet out to 24.
  { const a = seededInt(rng, 2, 9), b = a + seededInt(rng, 1, 9); items.push(item(`−${a} + ${b}`, b - a)); } // 24. bonus

  return items;
}

// ---------- FDP Speed Check ----------
// Same fixed 24-question, ~3-minute mental format as the Negative Numbers
// sheet, but converting between fractions, decimals and percentages. The
// pool is the common GCSE equivalents (no eighths) plus the thirds (1/3 and
// 2/3), whose recurring decimals are the ones students get stuck on — both
// thirds are always on the sheet, only ever as fraction <-> decimal (never a
// percentage), with the rest drawn from the
// other common equivalents. Every one of the six conversion directions
// appears four times, and no value is asked for the same answer twice (e.g.
// 1/4 → % and 0.25 → % are never both on one sheet).
// Compact stacked fraction for the speed-check rows: the shared Frac above
// is three lines tall (numerator, bar, denominator) and overflows the
// fixed-height print rows at this font size.
function SpeedFrac({ n, d }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", verticalAlign: "middle", lineHeight: 1.05, margin: "0 3px", fontSize: "0.92em" }}>
      <span style={{ padding: "0 4px" }}>{n}</span>
      <span style={{ padding: "0 4px", borderTop: "2px solid currentColor", width: "100%", textAlign: "center" }}>{d}</span>
    </span>
  );
}
const FDP_TRIPLES = [
  { n: 1, d: 2, dec: "0.5", pct: "50%" },
  { n: 1, d: 4, dec: "0.25", pct: "25%" },
  { n: 3, d: 4, dec: "0.75", pct: "75%" },
  { n: 1, d: 5, dec: "0.2", pct: "20%" },
  { n: 2, d: 5, dec: "0.4", pct: "40%" },
  { n: 3, d: 5, dec: "0.6", pct: "60%" },
  { n: 4, d: 5, dec: "0.8", pct: "80%" },
  { n: 1, d: 10, dec: "0.1", pct: "10%" },
  { n: 3, d: 10, dec: "0.3", pct: "30%" },
  { n: 7, d: 10, dec: "0.7", pct: "70%" },
  { n: 9, d: 10, dec: "0.9", pct: "90%" },
  { n: 1, d: 20, dec: "0.05", pct: "5%" },
  { n: 3, d: 20, dec: "0.15", pct: "15%" },
  { n: 5, d: 4, dec: "1.25", pct: "125%" },
  { n: 3, d: 2, dec: "1.5", pct: "150%" },
  { n: 1, d: 3, dec: "0.333...", third: true },
  { n: 2, d: 3, dec: "0.666...", third: true },
];
function buildFdpSpeedCheck(rng) {
  const DIRS = ["f-d", "f-p", "d-f", "d-p", "p-f", "p-d"];
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const dirs = shuffle(DIRS.flatMap((d) => [d, d, d, d])); // 24 slots, 4 of each direction
  const thirdIdx = FDP_TRIPLES.map((t, i) => (t.third ? i : -1)).filter((i) => i >= 0);
  const otherIdx = FDP_TRIPLES.map((t, i) => (t.third ? -1 : i)).filter((i) => i >= 0);
  // Recurring decimals (1/3 and 2/3) are only ever asked as fraction <->
  // decimal, never as a percentage, so they only go in f-d / d-f slots.
  const thirdSlots = shuffle(dirs.map((_, i) => i).filter((i) => dirs[i] === "f-d" || dirs[i] === "d-f")).slice(0, thirdIdx.length);
  const slotTriple = new Array(dirs.length).fill(-1);
  const targetOf = (dir) => dir.split("-")[1]; // the form being asked for: d, p or f
  const used = new Set();
  const count = {};
  thirdSlots.forEach((slot, k) => {
    slotTriple[slot] = thirdIdx[k];
    used.add(`${thirdIdx[k]}|${targetOf(dirs[slot])}`);
    count[thirdIdx[k]] = 1;
  });
  for (let slot = 0; slot < dirs.length; slot++) {
    if (slotTriple[slot] !== -1) continue;
    let pick_ = -1;
    for (let tries = 0; tries < 80 && pick_ === -1; tries++) {
      const cand = otherIdx[Math.floor(rng() * otherIdx.length)];
      const strict = tries < 60; // relax the repeat limits only if the strict ones can't be met
      if (used.has(`${cand}|${targetOf(dirs[slot])}`)) continue;
      if (strict && ((count[cand] || 0) >= 2 || slotTriple[slot - 1] === cand)) continue;
      pick_ = cand;
    }
    if (pick_ === -1) pick_ = otherIdx[Math.floor(rng() * otherIdx.length)];
    slotTriple[slot] = pick_;
    used.add(`${pick_}|${targetOf(dirs[slot])}`);
    count[pick_] = (count[pick_] || 0) + 1;
  }
  return dirs.map((dir, slot) => {
    const t = FDP_TRIPLES[slotTriple[slot]];
    const fracEl = <SpeedFrac n={t.n} d={t.d} />;
    if (dir === "f-d") return { expr: fracEl, target: "decimal", answer: t.dec };
    if (dir === "f-p") return { expr: fracEl, target: "%", answer: t.pct };
    if (dir === "d-f") return { expr: t.dec, target: "fraction", answer: fracEl };
    if (dir === "d-p") return { expr: t.dec, target: "%", answer: t.pct };
    if (dir === "p-f") return { expr: t.pct, target: "fraction", answer: fracEl };
    return { expr: t.pct, target: "decimal", answer: t.dec };
  });
}

// Number skills: 24 deliberately easy one-step questions, six from each of
// factors & multiples, rounding & estimation, ratio & proportion and units &
// rates, each written as a full sentence. The sheet is two columns of 12, so
// the left column is the first two areas and the right column the last two.
// Numbers are chosen so there is never a tie or an awkward edge case (no
// digit-5 roundings, exact divisions). `size` shrinks the prompt text (in em)
// so a sentence can wrap onto up to three lines inside its row.
function buildNumberSkillsSpeedCheck(rng) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const COPRIME = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 5], [2, 5], [3, 5]];
  const NON5 = [1, 2, 3, 4, 6, 7, 8, 9];
  const half = () => seededInt(rng, 2, 9) + (rng() < 0.5 ? 0.5 : 0);
  const out = [];
  const q = (expr, answer) => out.push({ expr, size: 0.6, answer });

  // ---- Factors & multiples (6)
  { const ps = [13, 17, 19, 23, 29, 31, 37], cs = [21, 27, 33, 39, 49, 51, 57];
    const isP = rng() < 0.5, n = pick(isP ? ps : cs);
    q(`Is ${n} a prime number?`, isP ? "Yes" : "No"); }
  { const g = seededInt(rng, 2, 6), [p, r] = pick([[2, 3], [2, 5], [3, 4], [3, 5], [4, 5], [2, 7]].filter(([a, b]) => a * g <= 36 && b * g <= 36));
    q(`What is the HCF of ${g * p} and ${g * r}?`, g); }
  { const [a, b] = pick([[3, 4], [3, 5], [4, 5], [4, 6], [2, 7], [6, 9], [3, 7], [5, 6]]);
    q(`What is the LCM of ${a} and ${b}?`, (a * b) / gcd(a, b)); }
  { const g = seededInt(rng, 2, 5), [p, r] = pick([[1, 2], [1, 3], [2, 3], [3, 4], [1, 4], [2, 5], [3, 5], [1, 5]]);
    q(<>Simplify <SpeedFrac n={g * p} d={g * r} />.</>, <SpeedFrac n={p} d={r} />); }
  { const m = seededInt(rng, 5, 9), k = seededInt(rng, 4, 9), x = m * k;
    q(`Which multiple of ${m} is between ${x - 2} and ${x + 2}?`, x); }
  { const n = pick([6, 8, 10, 12, 14, 15, 16, 18, 20, 24]);
    let c = 0; for (let i = 1; i <= n; i++) if (n % i === 0) c++;
    q(`How many factors does ${n} have?`, c); }

  // ---- Rounding & estimation (6)
  { const w = seededInt(rng, 1, 9), d1 = seededInt(rng, 0, 9), d2 = pick(NON5);
    q(`Round ${w}.${d1}${d2} to 1 decimal place.`, ((w * 10 + d1 + (d2 >= 5 ? 1 : 0)) / 10).toFixed(1)); }
  { const w = seededInt(rng, 1, 9), d1 = seededInt(rng, 0, 9), d2 = seededInt(rng, 0, 9), d3 = pick(NON5);
    q(`Round ${w}.${d1}${d2}${d3} to 2 decimal places.`, ((w * 100 + d1 * 10 + d2 + (d3 >= 5 ? 1 : 0)) / 100).toFixed(2)); }
  { const a = seededInt(rng, 1, 9), b = pick(NON5), c = seededInt(rng, 0, 9);
    q(`Round ${a}${b}${c} to 1 significant figure.`, (a + (b >= 5 ? 1 : 0)) * 100); }
  { const a = seededInt(rng, 1, 9), b = seededInt(rng, 0, 9), c = pick(NON5);
    q(`Round ${a}${b}${c} to 2 significant figures.`, (a * 10 + b + (c >= 5 ? 1 : 0)) * 10); }
  { const a0 = seededInt(rng, 2, 9), b0 = seededInt(rng, 2, 6), off = () => pick([-0.2, -0.1, 0.1, 0.2]);
    q(`Estimate the value of ${(a0 + off()).toFixed(1)} × ${(b0 + off()).toFixed(1)}.`, a0 * b0); }
  { const d = pick([2, 3, 4, 5]), m = pick([2, 3, 4, 5, 6, 7, 8, 9].filter((x) => (10 * x) % d === 0));
    q(`Estimate the value of ${10 * m + pick([-1, 1])} ÷ ${(d + pick([-0.1, 0.1])).toFixed(1)}.`, (10 * m) / d); }

  // ---- Ratio & proportion (6)
  { const g = seededInt(rng, 2, 6), [p, r] = pick(COPRIME);
    q(`Simplify ${g * p} : ${g * r}.`, `${p} : ${r}`); }
  { const [p, r] = pick([[1, 2], [1, 3], [2, 3], [1, 4], [1, 5], [3, 2]]), k = seededInt(rng, 2, 6);
    q(`Share ${(p + r) * k} in the ratio ${p} : ${r}.`, `${p * k} and ${r * k}`); }
  { const k = pick([2, 3, 4, 5, 10, 20]), L = seededInt(rng, 2, 9);
    q(`On a 1 : ${k} scale, what is the real length of ${L} cm?`, `${L * k} cm`); }
  { const it = pick([["cake", "cakes"], ["pen", "pens"], ["bun", "buns"], ["ticket", "tickets"]]), price = seededInt(rng, 2, 5), n = seededInt(rng, 2, 5), m = n + seededInt(rng, 2, 5);
    q(`${n} ${it[1]} cost £${n * price}. How much do ${m} ${it[1]} cost?`, `£${m * price}`); }
  { const [p, r] = pick(COPRIME), k = seededInt(rng, 2, 6);
    q(`Find the missing number: ${p} : ${r} = ${p * k} : ?`, r * k); }
  { const t = pick([[1, 2, 3], [2, 3, 5], [1, 3, 4], [2, 3, 4], [1, 1, 2], [3, 4, 5]]);
    q(`How many parts in the ratio ${t.join(" : ")}?`, t[0] + t[1] + t[2]); }

  // ---- Units & rates (6)
  { const [from, to, f] = pick([["m", "cm", 100], ["km", "m", 1000], ["cm", "mm", 10]]), v = half();
    q(`Convert ${v} ${from} to ${to}.`, Math.round(v * f)); }
  { const [from, to] = pick([["kg", "g"], ["litres", "ml"]]), v = seededInt(rng, 1, 6) + (rng() < 0.5 ? 0.5 : 0);
    q(`Convert ${v} ${from} to ${to}.`, Math.round(v * 1000)); }
  { if (rng() < 0.5) { const v = pick([1.5, 2.5, 3.5, 2, 3, 4]); q(`Convert ${v} hours to minutes.`, v * 60); }
    else { const m = pick([30, 90, 150, 210, 45, 15]); q(`Convert ${m} minutes to hours.`, m / 60); } }
  { const it = pick([["pen", "pens"], ["cake", "cakes"], ["bun", "buns"], ["ticket", "tickets"]]), n = pick([2, 4, 5, 10]), p = pick([10, 15, 20, 25, 30, 40, 50, 60, 75]);
    q(`${n} ${it[1]} cost £${((n * p) / 100).toFixed(2)}. How much does 1 ${it[0]} cost?`, `${p}p`); }
  { const sp = pick([20, 30, 40, 50, 60, 70, 80]), t = seededInt(rng, 2, 5);
    q(`A car travels ${sp * t} km in ${t} hours. What is its speed?`, `${sp} km/h`); }
  { const sp = pick([20, 30, 40, 50, 60, 70, 80]), t = seededInt(rng, 2, 5);
    q(`At ${sp} km/h for ${t} hours, how far does a car travel?`, `${sp * t} km`); }

  return out;
}

// Conversion of measures: 24 quick one-step conversions in four columns of six
// (time, mass, then two columns of length). Values are easy, whole numbers or
// halves/quarters, so a pupil can do each in a few seconds.
function buildMeasuresSpeedCheck(rng) {
  const take = (pool, n) => {
    const a = pool.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, n);
  };
  const num = (v) => String(Math.round(v * 1e6) / 1e6);
  const out = [];
  const conv = (value, from, to, factor, mode) => {
    // mode "x": answer = value × factor; mode "d": answer = value ÷ factor
    const ans = mode === "x" ? value * factor : value / factor;
    out.push({ expr: `Convert ${num(value)} ${from} to ${to}.`, size: 0.6, answer: `${num(ans)} ${to}` });
  };

  // ---- Time (6): 3 × hours→minutes, 3 × minutes→hours
  take([1.5, 2.5, 3.5, 0.5, 2, 3, 4, 0.25, 0.75, 1.25], 3).forEach((v) => conv(v, "hours", "minutes", 60, "x"));
  take([30, 90, 150, 210, 45, 15, 120, 180, 75], 3).forEach((v) => conv(v, "minutes", "hours", 60, "d"));

  // ---- Mass (6): 3 × kg→g, 3 × g→kg
  take([2, 3, 4, 5, 6, 1.5, 2.5, 3.5, 0.5, 0.25, 0.75], 3).forEach((v) => conv(v, "kg", "g", 1000, "x"));
  take([3000, 5000, 2000, 4500, 2500, 1500, 6000, 750, 250, 3500], 3).forEach((v) => conv(v, "g", "kg", 1000, "d"));

  // ---- Length (12): two each of mm→cm, cm→mm, cm→m, m→cm, m→km, km→m
  take([30, 50, 70, 90, 120, 45, 65, 85, 250], 2).forEach((v) => conv(v, "mm", "cm", 10, "d"));
  take([3, 5, 8, 12, 4.5, 6.5, 2.5, 9], 2).forEach((v) => conv(v, "cm", "mm", 10, "x"));
  take([200, 300, 500, 400, 250, 350, 150, 600, 50], 2).forEach((v) => conv(v, "cm", "m", 100, "d"));
  take([2, 3, 4, 5, 6, 1.5, 2.5, 3.5, 0.5], 2).forEach((v) => conv(v, "m", "cm", 100, "x"));
  take([2000, 3000, 5000, 4000, 1500, 2500, 3500, 500, 750], 2).forEach((v) => conv(v, "m", "km", 1000, "d"));
  take([2, 3, 4, 5, 1.5, 2.5, 3.5, 0.5, 0.25], 2).forEach((v) => conv(v, "km", "m", 1000, "x"));
  return out;
}

// Times-table practice: the same fixed 24-question, ~3-minute mental format.
// Every table from 2 to 12 appears at least once; 14 multiplication facts and
// 10 matching division facts (always exact, quotient 2-12), no fact repeated.
function buildTimesTablesSpeedCheck(rng) {
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const seen = new Set();
  const facts = [];
  const add = (a, b) => {
    const key = `${Math.min(a, b)}x${Math.max(a, b)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    facts.push([a, b]);
    return true;
  };
  for (let t = 2; t <= 12; t++) {
    for (let tries = 0; tries < 60; tries++) if (add(t, seededInt(rng, 2, 12))) break;
  }
  while (facts.length < 24) add(seededInt(rng, 2, 12), seededInt(rng, 2, 12));
  const ops = shuffle([...Array(14).fill("x"), ...Array(10).fill("d")]);
  return shuffle(facts).map(([a, b], i) => {
    const [p, q] = rng() < 0.5 ? [a, b] : [b, a];
    return ops[i] === "x" ? { expr: `${p} × ${q}`, answer: p * q } : { expr: `${p * q} ÷ ${p}`, answer: q };
  });
}

export default function QuizEngine() {
  const initialDecoded = useMemo(() => {
    if (typeof window === "undefined") return null;
    const code = new URLSearchParams(window.location.search).get("code");
    return code ? decodeQuizCode(code) : null;
  }, []);

  const [schemeKey, setSchemeKey] = useState(Object.keys(SCHEMES)[0]);
  const [weekKey, setWeekKey] = useState(Object.keys(SCHEMES[Object.keys(SCHEMES)[0]])[0]);
  const [selected, setSelected] = useState(initialDecoded?.ids ?? SCHEMES[Object.keys(SCHEMES)[0]][Object.keys(SCHEMES[Object.keys(SCHEMES)[0]])[0]]);
  const [openStrands, setOpenStrands] = useState(new Set(["Statistics & Probability"]));
  // Middle "Domain" layer between Strand and Group (e.g. Statistics & Probability →
  // Averages & Spread → Averages from a List), matching Mr Barton Maths's Ultimate
  // Retrieval Tool's topic breakdown. Keyed "Strand → Domain" since domain names
  // aren't unique across strands (e.g. "Indices, Roots & Surds" appears twice).
  const [openDomains, setOpenDomains] = useState(new Set());
  // Search box above the topic tree (feature: search topics). Typing forces
  // every strand/domain open (see isOpen/domainOpen below) and filters
  // subtopics by title, or shows a whole group/domain/strand's subtopics
  // untouched if the search matches that group/domain/strand name itself —
  // e.g. "circle" shows every subtopic under the "Circle Theorems" group,
  // not just ones with "circle" literally in their own title.
  const [topicSearch, setTopicSearch] = useState("");
  const searchQuery = topicSearch.trim().toLowerCase();
  // Colour theme: "auto" follows the device (prefers-color-scheme), "light" /
  // "dark" are a manual override stored on this browser. Applied as a
  // data-theme attribute on <html>, which the :root token blocks key off.
  const [themePref, setThemePref] = useState(() => {
    try {
      const v = window.localStorage.getItem("quizEngineTheme");
      return v === "light" || v === "dark" ? v : "auto";
    } catch (e) {
      return "auto";
    }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (themePref === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", themePref);
    try {
      if (themePref === "auto") window.localStorage.removeItem("quizEngineTheme");
      else window.localStorage.setItem("quizEngineTheme", themePref);
    } catch (e) { /* storage unavailable (private window etc.) — theme still applies for this session */ }
  }, [themePref]);
  // Below ~1100px the builder stacks above the quiz; this lets it be folded
  // away so the quiz itself isn't pushed off-screen. No effect on wide screens.
  const [builderOpen, setBuilderOpen] = useState(true);
  const [salt, setSalt] = useState(initialDecoded?.salt ?? 1);
  const [showAnswers, setShowAnswers] = useState(false);
  // "Save all versions as PDF" (see the button near Print quiz below): while
  // true, the printable area renders V1/V2/V3 back-to-back — each forcing
  // its own mark-scheme visibility (V1 off, V2 on, V3 off) — instead of just
  // the currently active version, so printing produces one combined PDF
  // with all three. Reset automatically once the browser's print dialog
  // closes (afterprint fires whether the user actually printed or cancelled).
  const [savingAllVersionsPdf, setSavingAllVersionsPdf] = useState(false);
  useEffect(() => {
    if (!savingAllVersionsPdf) return;
    const t = setTimeout(() => window.print(), 50);
    const onAfterPrint = () => setSavingAllVersionsPdf(false);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, [savingAllVersionsPdf]);
  const [activeVersion, setActiveVersion] = useState(initialDecoded?.version ?? "V1");
  // Feature 3: blocked practice repeats one skill; interleaved mixes several.
  const [practiceMode, setPracticeMode] = useState(initialDecoded?.mode ?? "interleaved");
  // Feature 2: the fixed question count for the Do Now (4) and Weekly Quiz
  // (6) presets. Custom mode no longer uses this at all — its question count
  // is simply derived from how many entries are in `selected` (each ticked
  // topic contributing 1 or more via the +/− stepper; see setTopicCount and
  // effectiveIds below) — but this still needs a sane starting value for
  // when the teacher switches to a preset. A quiz code saved before Custom
  // took an arbitrary count may carry length: null (the old "one question
  // per ticked subtopic" custom behaviour) — fall back to however many
  // subtopics that code had, so old links still open to the same quiz.
  const [quizLength, setQuizLength] = useState(initialDecoded?.length ?? initialDecoded?.ids?.length ?? 5);
  // Which of the three "Quiz length" buttons is highlighted — and, for
  // Custom, it's what actually drives quiz generation now (see effectiveIds
  // above), so this has to come from the decoded lengthMode field directly
  // rather than being re-guessed from the numeric length (a Custom quiz
  // whose count happens to be exactly 4 or 6 would otherwise misload as Do
  // Now/Weekly Quiz).
  const [lengthMode, setLengthMode] = useState(initialDecoded?.lengthMode ?? "custom");
  // Do Now (4) can be projected full-screen as a 2x2 grid, and printed as-is
  // for the teacher's own copy — only ever meaningful when lengthMode === "donow".
  const [fullScreenDoNow, setFullScreenDoNow] = useState(false);
  // Feature 8: Negative Numbers Speed Check — a fixed 24-question fluency
  // sheet, generated and viewed entirely separately from the subtopic
  // picker (see buildNegativeSpeedCheck above). speedCheckOpen swaps out the
  // whole main view the same way fullScreenDoNow does; the salt just rerolls
  // its own numbers without touching the regular quiz being built alongside.
  const [speedCheckOpen, setSpeedCheckOpen] = useState(false);
  const [speedCheckSalt, setSpeedCheckSalt] = useState(1);
  const [speedCheckAnswers, setSpeedCheckAnswers] = useState(false);
  // Projected full-screen view for students to complete in their books
  // rather than on paper — 4 columns instead of the print page's 2, since a
  // wide screen has more width to spend than an A4 sheet does, and it keeps
  // 6 rows per column instead of 12 for a bigger, further-back-readable font.
  const [speedCheckFullScreen, setSpeedCheckFullScreen] = useState(false);
  // Which fixed-format sheet is open: "neg", "fdp", "times", "skills" or "measures". All share the same view, timer and
  // full-screen layout — only the questions, title and blurb differ.
  const [speedCheckKind, setSpeedCheckKind] = useState("neg");
  const speedCheckQuestions = useMemo(
    () => (speedCheckKind === "fdp" ? buildFdpSpeedCheck : speedCheckKind === "times" ? buildTimesTablesSpeedCheck : speedCheckKind === "skills" ? buildNumberSkillsSpeedCheck : speedCheckKind === "measures" ? buildMeasuresSpeedCheck : buildNegativeSpeedCheck)(mulberry32((speedCheckSalt * 104729 + 7) >>> 0)),
    [speedCheckSalt, speedCheckKind]
  );
  const speedCheckInfo = speedCheckKind === "measures"
    ? {
        title: "Conversion of Measures Speed Check",
        description: "A 24-question Conversion of Measures Speed Check: hours and minutes (6), kilograms and grams (6), and millimetres, centimetres, metres and kilometres (12). Every question is a one-step conversion and suitable for ~3 minutes.",
      }
    : speedCheckKind === "skills"
    ? {
        title: "Number Skills Speed Check",
        description: "A 24-question Number Skills Speed Check: six quick questions each on factors and multiples, rounding and estimation, ratio and proportion, and units and rates. All are one-step and suitable for ~5 minutes.",
      }
    : speedCheckKind === "times"
    ? {
        title: "Times Tables Speed Check",
        description: "A 24-question Times Tables Speed Check: multiplication facts and the matching division facts from the 2 to 12 tables, with every table included. All answers are recalled from memory and suitable for ~3 minutes.",
      }
    : speedCheckKind === "fdp"
    ? {
        title: "FDP Speed Check",
        description: "A 24-question FDP Speed Check: convert between fractions, decimals and percentages. It uses the common equivalents, and always includes ⅓ and ⅔ as recurring decimals (fraction ↔ decimal only). All conversions are mental and suitable for ~3 minutes.",
      }
    : {
        title: "Negative Numbers Speed Check",
        description: "A 24-question Negative Numbers Speed Check. It covers all 23 variations involving at least one negative number, with one extra question from a common GCSE type. All calculations are mental and suitable for ~3 minutes.",
      };
  // Feature 9: an optional on-screen countdown timer for the speed check,
  // matching the "~3 minutes" it's designed to be completed in. Independent
  // of everything else on the page; only meaningful while speedCheckOpen.
  const [timerDuration, setTimerDuration] = useState(180);
  const [timerRemaining, setTimerRemaining] = useState(180);
  const [timerRunning, setTimerRunning] = useState(false);
  useEffect(() => {
    if (!timerRunning) return undefined;
    const id = setInterval(() => {
      setTimerRemaining((t) => {
        if (t <= 1) {
          setTimerRunning(false);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [timerRunning]);
  // Rerolling the numbers starts a fresh attempt, so give it a fresh clock too.
  useEffect(() => {
    setTimerRemaining(timerDuration);
    setTimerRunning(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speedCheckSalt, speedCheckKind]);
  const formatTimer = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const setTimerPreset = (secs) => {
    setTimerDuration(secs);
    setTimerRemaining(secs);
    setTimerRunning(false);
  };
  const handleTimerStartPause = () => {
    if (timerRunning) {
      setTimerRunning(false);
    } else if (timerRemaining === 0) {
      setTimerRemaining(timerDuration);
      setTimerRunning(true);
    } else {
      setTimerRunning(true);
    }
  };
  const handleTimerReset = () => {
    setTimerRemaining(timerDuration);
    setTimerRunning(false);
  };
  // Feature 5: bump a single question's nonce to reroll just that question.
  const [questionNonces, setQuestionNonces] = useState(initialDecoded?.nonces ?? {});
  const [codeInput, setCodeInput] = useState("");
  const [codeMessage, setCodeMessage] = useState("");
  const [codeTone, setCodeTone] = useState("ok"); // "ok" | "warn" | "err"
  // Shared online library (see "shared online quiz library" above). All of
  // this is inert unless the library has been configured.
  const libOn = libConfig() !== null;
  const [libSignedIn, setLibSignedIn] = useState(() => libOn && !!libLoadSession());
  const [libItems, setLibItems] = useState(null); // null = not loaded yet
  const [libBusy, setLibBusy] = useState(false);
  const [libMsg, setLibMsg] = useState({ tone: "ok", text: "" });
  const [libPassword, setLibPassword] = useState("");
  const [libName, setLibName] = useState("");
  const [libAuthor, setLibAuthor] = useState(() => {
    try { return window.localStorage.getItem("quizEngineAuthor") || ""; } catch (e) { return ""; }
  });
  const [libSearch, setLibSearch] = useState("");
  const [customLabel, setCustomLabel] = useState(initialDecoded ? "Custom quiz (loaded from code)" : null);
  const [copyFlash, setCopyFlash] = useState("");
  // Lock: freezes the generated quiz (numbers, subtopics, mode, length) so it
  // can't be accidentally regenerated or changed once a teacher is ready to
  // print or project it. Loading a different quiz code always unlocks.
  const [locked, setLocked] = useState(false);
  // Feature 7: lets a teacher drag a question card to reorder it within the
  // generated quiz (e.g. put the hardest question last, or group two
  // questions on the same subtopic together). Stores the underlying
  // (unfiltered) active.questions indices in the order they should display;
  // see orderedVisibleQuestions below for how a partial/stale list here is
  // reconciled against whatever's actually still visible. Deliberately never
  // reset on a topic-selection change, so a teacher's custom order survives
  // ticking/unticking a subtopic (including the auto-untick a delete now
  // does); any newly-added question is appended at the end automatically by
  // orderedVisibleQuestions's own reconciliation logic.
  const [questionOrder, setQuestionOrder] = useState(initialDecoded?.order ?? []);
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  // Ground-truth copies of the two states above, readable synchronously
  // inside pointer event handlers without waiting on a React re-render —
  // avoids a race where a fast pointerup reads a stale draggingIndex/
  // dragOverIndex before React has committed the latest setState from the
  // pointermove just before it.
  const draggingIndexRef = useRef(null);
  const dragOverIndexRef = useRef(null);

  // In Custom mode, quizLength is vestigial (see setTopicCount/effectiveIds)
  // and never tracks the real question count — it only changes via the Do
  // Now/Weekly presets or loadCode, so it can silently disagree with
  // selected.length. Baking the raw state into idsKey meant a saved Custom
  // code, loaded fresh, restored the right subtopics but reseeded every
  // question with different numbers the moment quizLength happened to land
  // on a different value than it held at save time — a quiz code that
  // didn't actually reproduce the quiz it was saved from. Mirror
  // encodeQuizCode's own "effective length" here so the two can never drift
  // apart from each other.
  const idsKey = selected.join(",") + "|" + practiceMode + "|" + (lengthMode === "custom" ? selected.length : quizLength ?? "custom");

  // Feature 2/3 combined: for Do Now/Weekly Quiz, the selected (unique)
  // subtopics are cycled — with fresh numbers each pass — to exactly fill
  // the fixed question count.
  // Custom mode works differently: `selected` is allowed to contain the same
  // subtopic id more than once (one entry per "copy" the teacher asked for
  // via the +/− stepper next to that topic — see setTopicCount below), so it
  // IS the exact quiz already; no cycling/fill-to-a-target-count is applied,
  // and the total question count is simply however many entries are in it.
  const targetCount = quizLength;
  const effectiveIds = useMemo(() => {
    if (selected.length === 0) return [];
    if (lengthMode === "custom" || lengthMode === "weekly") return selected;
    const out = [];
    for (let i = 0; i < targetCount; i++) out.push(selected[i % selected.length]);
    return out;
  }, [selected, targetCount, lengthMode]);

  const versions = useMemo(() => {
    return ["V1", "V2", "V3"].map((v) => {
      const questions = effectiveIds.map((id, i) => {
        const nonce = questionNonces[`${v}-${i}`] || 0;
        const seed = (seedFor(idsKey, v, salt) + i * 104729 + nonce * 999983) >>> 0;
        const rng = mulberry32(seed);
        return { ...SUBTOPIC_BANK[id].build(rng), marks: SUBTOPIC_BANK[id].marks };
      });
      return { id: v, questions };
    });
  }, [idsKey, salt, effectiveIds, questionNonces]);

  const regenerate = useCallback(() => { if (locked) return; setSalt((s) => s + 1); setQuestionNonces({}); }, [locked]);
  const regenerateQuestion = (index) => {
    if (locked) return;
    setQuestionNonces((prev) => ({ ...prev, [`${activeVersion}-${index}`]: (prev[`${activeVersion}-${index}`] || 0) + 1 }));
  };
  const toggleSubtopic = (id) => {
    if (locked) return;
    // In Custom mode, ticking/unticking a checkbox is just "how many of this
    // do I want" collapsed to a single click: off -> 1, on -> 0. Anything
    // beyond 1 is set with the +/− stepper next to the ticked topic (see
    // setTopicCount) rather than by clicking the checkbox repeatedly.
    if (lengthMode === "custom" || lengthMode === "weekly") {
      setTopicCount(id, selected.includes(id) ? 0 : 1);
      return;
    }
    setQuestionNonces({});
    setCustomLabel(null);
    if (practiceMode === "blocked") {
      setSelected((prev) => (prev.length === 1 && prev[0] === id ? [] : [id]));
      return;
    }
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= quizLength) return prev;
      return [...prev, id];
    });
  };
  // Custom mode lets a teacher put the same subtopic in the quiz more than
  // once (e.g. "3 of these, please") instead of ticking one box always
  // meaning exactly one question. `selected` carries this as a genuine
  // multiset — the same id repeated `n` times — rather than a separate count
  // map, so effectiveIds/versions/deleteQuestion above and below can all keep
  // treating it as a plain ordered list of "one question slot per entry"
  // with no extra bookkeeping. New copies are inserted right after the
  // topic's existing entries (not at the very end of the whole list) so a
  // topic's questions stay grouped together as its count changes; extra
  // copies beyond a 60-question overall cap are silently dropped, matching
  // the sane-size cap Custom always enforced before this feature existed.
  const setTopicCount = (id, newCount) => {
    if (locked) return;
    setQuestionNonces({});
    setCustomLabel(null);
    const n = Math.max(0, Math.round(newCount) || 0);
    // Weekly Quiz reuses this same per-topic stepper as Custom (see
    // toggleSubtopic/effectiveIds above) but is always a fixed 6-question
    // quiz, not an open-ended one — cap at quizLength (6) instead of
    // Custom's generous 60-question sanity cap.
    const cap = lengthMode === "weekly" ? quizLength : 60;
    setSelected((prev) => {
      if (practiceMode === "blocked") {
        // Blocked mode only ever has one distinct topic ticked at a time —
        // setting a count for a different topic replaces whatever was there.
        return n <= 0 ? [] : Array(Math.min(n, cap)).fill(id);
      }
      const existingCount = prev.filter((x) => x === id).length;
      if (n === existingCount) return prev;
      if (n < existingCount) {
        let kept = 0;
        return prev.filter((x) => {
          if (x !== id) return true;
          kept++;
          return kept <= n;
        });
      }
      const room = Math.max(0, cap - prev.length);
      const addCount = Math.min(n - existingCount, room);
      if (addCount <= 0) return prev;
      const extra = Array(addCount).fill(id);
      const lastIdx = prev.lastIndexOf(id);
      return lastIdx === -1 ? [...prev, ...extra] : [...prev.slice(0, lastIdx + 1), ...extra, ...prev.slice(lastIdx + 1)];
    });
  };
  const applyWeek = (scheme, week) => {
    if (locked) return;
    setSchemeKey(scheme);
    setWeekKey(week);
    setSelected(SCHEMES[scheme][week] || []);
    setQuestionNonces({});
    setCustomLabel(null);
  };
  const setPracticeModeSafe = (mode) => {
    if (locked) return;
    setPracticeMode(mode);
    setQuestionNonces({});
    if (mode === "blocked") setSelected((prev) => (prev.length > 0 ? [prev[0]] : prev));
  };
  // mode is one of "donow" | "weekly" — this is only ever called for the two
  // fixed-length presets now that Custom derives its length from the topic
  // stepper counts instead of a typed number (see switchToCustomMode below
  // and setTopicCount above). len is clamped to a sane range: at least 1,
  // and capped at 60 so a mistyped number doesn't try to render an
  // unreasonably huge sheet.
  const setQuizLengthSafe = (len, mode) => {
    if (locked) return;
    const n = Math.max(1, Math.min(60, Math.round(len) || 1));
    setQuizLength(n);
    setLengthMode(mode);
    if (mode !== "donow") setFullScreenDoNow(false);
    setQuestionNonces({});
    setSelected((prev) => {
      if (practiceMode === "blocked") return prev.slice(0, 1);
      if (mode === "weekly") {
        // Weekly Quiz uses the same per-topic stepper multiset as Custom
        // (see toggleSubtopic/effectiveIds above), just capped at a fixed
        // 6 — so coming from Custom, keep whatever counts were already
        // there instead of collapsing to one-of-each, just truncated to fit.
        return prev.slice(0, n);
      }
      // Do Now only ever ticks distinct topics and cycles them to fill the
      // fixed length, so a Custom/Weekly multiset needs deduping first.
      return [...new Set(prev)].slice(0, n);
    });
  };
  // Switching to Custom mode doesn't change the current topic selection —
  // whatever was ticked (each still counting as 1 copy) carries over as-is,
  // and the total question count is simply derived from how many entries
  // that leaves in `selected` (see effectiveIds above) rather than from a
  // separate typed number.
  const switchToCustomMode = () => {
    if (locked) return;
    setLengthMode("custom");
    setFullScreenDoNow(false);
  };
  const loadCode = (text) => {
    const parsed = parseQuizCode(typeof text === "string" ? text : codeInput);
    if (!parsed.ok) {
      setCodeTone("err");
      setCodeMessage(parsed.message);
      return;
    }
    const decoded = parsed.data;
    setLocked(false);
    setSelected(decoded.ids);
    setPracticeMode(decoded.mode);
    // A code saved before Custom took a real number may carry length: null
    // (the old "one question per ticked subtopic" behaviour) — fall back to
    // however many subtopics it has so the loaded quiz still matches.
    setQuizLength(decoded.length ?? decoded.ids.length ?? 5);
    setLengthMode(decoded.lengthMode ?? "custom");
    setSalt(decoded.salt);
    setActiveVersion(decoded.version);
    // Restores any individually-regenerated questions the code captured —
    // see encodeQuizCode's nonces handling — so a locked/loaded quiz is the
    // exact one that was printed, not the un-regenerated original.
    setQuestionNonces(decoded.nonces ?? {});
    // Restores a drag-reordered question order (format 5 codes carry it).
    setQuestionOrder(decoded.order ?? []);
    setCustomLabel("Custom quiz (loaded from code)");
    const shape = decoded.lengthMode === "donow" ? "Do Now (4)" : decoded.lengthMode === "weekly" ? "Weekly Quiz" : `${decoded.ids.length} question${decoded.ids.length === 1 ? "" : "s"}`;
    const base = `Quiz loaded: ${shape}, Version ${decoded.version.replace("V", "")}.`;
    if (decoded.dropped > 0) {
      setCodeTone("warn");
      setCodeMessage(`${base} ${decoded.dropped} question${decoded.dropped === 1 ? "" : "s"} in the code couldn't be recognised and ${decoded.dropped === 1 ? "was" : "were"} left out.`);
    } else {
      setCodeTone("ok");
      setCodeMessage(base);
    }
  };
  // ---- shared online library actions ----
  const libFail = (e) => {
    if (e && e.status === 401) { setLibSignedIn(false); setLibItems(null); }
    setLibMsg({ tone: "err", text: (e && e.message) || "Something went wrong." });
  };
  const libRefresh = async () => {
    setLibBusy(true);
    try { setLibItems(await libList()); } catch (e) { libFail(e); } finally { setLibBusy(false); }
  };
  useEffect(() => {
    if (libOn && libSignedIn && libItems === null) libRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libOn, libSignedIn]);
  const libDoSignIn = async (e) => {
    if (e) e.preventDefault();
    if (!libPassword) { setLibMsg({ tone: "err", text: "Enter the library password." }); return; }
    setLibBusy(true);
    try {
      await libSignIn(libPassword);
      setLibPassword("");
      setLibItems(null);
      setLibSignedIn(true);
      setLibMsg({ tone: "ok", text: "" });
    } catch (err) { libFail(err); } finally { setLibBusy(false); }
  };
  const libDoSignOut = () => { libSignOut(); setLibSignedIn(false); setLibItems(null); setLibMsg({ tone: "ok", text: "" }); };
  const libDoSave = async () => {
    const name = libName.trim();
    if (!name) { setLibMsg({ tone: "err", text: "Give the quiz a name first." }); return; }
    if (!currentCode) { setLibMsg({ tone: "err", text: "Tick some topics first, there is no quiz to save yet." }); return; }
    setLibBusy(true);
    try {
      const author = libAuthor.trim();
      try { window.localStorage.setItem("quizEngineAuthor", author); } catch (e) {}
      const row = await libSave({ name, author: author || null, code: currentCode });
      setLibItems((prev) => [row, ...(prev || [])]);
      setLibName("");
      setLibMsg({ tone: "ok", text: `Saved “${name}” to the library.` });
    } catch (e) { libFail(e); } finally { setLibBusy(false); }
  };
  const libDoOpen = (item) => {
    loadCode(item.code);
    setCustomLabel(item.name);
    setLibMsg({ tone: "ok", text: `Opened “${item.name}”.` });
  };
  const libDoUpdate = async (item) => {
    if (!currentCode) return;
    if (!window.confirm(`Replace “${item.name}” in the shared library with the quiz you have open now?`)) return;
    setLibBusy(true);
    try {
      const author = libAuthor.trim();
      const row = await libUpdate(item.id, { code: currentCode, ...(author ? { author } : null) });
      setLibItems((prev) => (prev || []).map((x) => (x.id === row.id ? row : x)));
      setLibMsg({ tone: "ok", text: `Updated “${item.name}”.` });
    } catch (e) { libFail(e); } finally { setLibBusy(false); }
  };
  const libDoDelete = async (item) => {
    if (!window.confirm(`Delete “${item.name}” from the shared library? Every teacher will lose access to it.`)) return;
    setLibBusy(true);
    try {
      await libHide(item.id);
      setLibItems((prev) => (prev || []).filter((x) => x.id !== item.id));
      setLibMsg({ tone: "ok", text: `Deleted “${item.name}”.` });
    } catch (e) { libFail(e); } finally { setLibBusy(false); }
  };
  const libVisible = (libItems || []).filter((x) => {
    const q = libSearch.trim().toLowerCase();
    return !q || `${x.name} ${x.author || ""}`.toLowerCase().includes(q);
  });

  const toggleStrand = (strand) => {
    setOpenStrands((prev) => {
      const next = new Set(prev);
      next.has(strand) ? next.delete(strand) : next.add(strand);
      return next;
    });
  };
  const toggleDomain = (key) => {
    setOpenDomains((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const active = versions.find((v) => v.id === activeVersion);
  // Every generated question maps onto a slot in effectiveIds/active.questions
  // (1:1 by index) — there's no separate "hidden question" list any more (see
  // deleteQuestion below for why), so nothing needs filtering here before
  // pagination/marks see it.
  const visibleQuestions = active.questions.map((q, index) => ({ q, index }));
  const deleteQuestion = (index) => {
    if (locked) return;
    // Deleting a question always keeps the topic picker in sync with what's
    // actually still in the quiz, rather than leaving a checkbox ticked (or
    // a stepper count) for a question that's no longer on screen.
    // (An earlier version of this instead hid just the one clicked question
    // behind a separate `removedIndices` set — but that hidden state got
    // silently wiped, resurrecting "deleted" questions, the moment any other
    // subtopic was ticked/unticked afterwards. Driving everything off
    // `selected` alone removes that failure mode entirely.)
    setQuestionNonces({});
    setCustomLabel(null);
    if (lengthMode === "custom" || lengthMode === "weekly") {
      // Custom and Weekly Quiz: effectiveIds is `selected` itself with no
      // cycling (see above), so `index` is a real position in `selected` —
      // drop just that one entry. If that subtopic only had a count of 1,
      // this naturally unticks its checkbox too; if it had 3, this leaves 2,
      // exactly matching the +/− stepper's per-copy counting instead of
      // wiping every copy of that topic out for a single delete.
      setSelected((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    // Do Now: still one tick = one topic (no per-topic counts), so deleting
    // unticks it entirely and the quiz refills back up to the fixed length
    // by cycling whichever topics remain ticked.
    const subtopicId = effectiveIds[index];
    if (subtopicId == null) return;
    setSelected((prev) => prev.filter((id) => id !== subtopicId));
  };
  // Applies the drag-reorder state on top of visibleQuestions. questionOrder
  // only needs to record indices the teacher has actually dragged; anything
  // missing from it (a brand-new question, or one just un-deleted) is
  // appended in its natural order, so nothing goes missing if the order
  // array falls behind the underlying question list.
  const orderedVisibleQuestions = useMemo(() => {
    const byIndex = new Map(visibleQuestions.map((v) => [v.index, v.q]));
    const validIndices = visibleQuestions.map((v) => v.index);
    const validSet = new Set(validIndices);
    const ordered = questionOrder.filter((i) => validSet.has(i));
    const seen = new Set(ordered);
    for (const i of validIndices) {
      if (!seen.has(i)) { ordered.push(i); seen.add(i); }
    }
    return ordered.map((index) => ({ q: byIndex.get(index), index }));
  }, [visibleQuestions, questionOrder]);
  const moveQuestion = (fromIndex, toIndex) => {
    if (locked || fromIndex === toIndex) return;
    const base = orderedVisibleQuestions.map(({ index }) => index);
    const fromPos = base.indexOf(fromIndex);
    const toPos = base.indexOf(toIndex);
    if (fromPos === -1 || toPos === -1) return;
    const next = [...base];
    next.splice(fromPos, 1);
    next.splice(toPos, 0, fromIndex);
    setQuestionOrder(next);
  };
  // Shared drag-and-drop wiring for a question at a given underlying index —
  // used by both the normal paginated view and the full-screen Do Now grid,
  // so dragging in either place updates the same questionOrder state.
  //
  // Built on the Pointer Events API rather than native HTML5 drag-and-drop
  // (draggable/dragstart/dragover/drop): the native API only recognises a
  // real OS-level mouse-drag gesture (so trackpad "click and glide" gestures
  // and any touchscreen use silently do nothing, since HTML5 DnD has no
  // touch support at all), and its cross-browser behaviour is inconsistent
  // enough that it's a common source of "the drag just doesn't work"
  // reports — which is exactly what happened here. Pointer Events unify
  // mouse, trackpad and touch input into one event stream.
  //
  // Deliberately does NOT use setPointerCapture: it looked like the right
  // tool (keep routing events to the handle that started the drag even once
  // the cursor moves over other cards) but during testing it did not
  // reliably redirect move/up events to the capturing element — move/up kept
  // targeting whatever was actually under the cursor instead. Falling back
  // to the classic, well-supported pattern instead: pointerdown on the
  // handle flips draggingIndex on, which a useEffect below turns into
  // window-level pointermove/pointerup listeners for the duration of the
  // drag — window listeners see every pointer event regardless of which
  // element is under the cursor, so no capture is needed. Each move then
  // uses document.elementFromPoint to find whichever question card the
  // pointer is currently over, via a data-qindex attribute on its container.
  const makeDragProps = (index) => ({
    handleProps: {
      onPointerDown: (e) => {
        if (locked || (e.pointerType === "mouse" && e.button !== 0)) return;
        e.preventDefault();
        draggingIndexRef.current = index;
        dragOverIndexRef.current = index;
        setDraggingIndex(index);
        setDragOverIndex(index);
      },
      style: { touchAction: "none" },
    },
    cardProps: { "data-qindex": index },
    isDragging: draggingIndex === index,
    isDragOver: dragOverIndex === index && draggingIndex !== index && draggingIndex !== null,
  });
  // Live for exactly as long as a drag is in progress (draggingIndex !== null).
  // Window-level listeners keep receiving pointermove/pointerup no matter
  // which element the cursor is currently over, which is what lets the
  // question the teacher grabbed follow the cursor across other cards.
  useEffect(() => {
    if (draggingIndex === null) return undefined;
    const handleMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const card = el && el.closest ? el.closest("[data-qindex]") : null;
      const overIndex = card ? Number(card.getAttribute("data-qindex")) : null;
      if (dragOverIndexRef.current !== overIndex) {
        dragOverIndexRef.current = overIndex;
        setDragOverIndex(overIndex);
      }
    };
    const endDrag = (shouldMove) => () => {
      const fromIndex = draggingIndexRef.current;
      const toIndex = dragOverIndexRef.current;
      draggingIndexRef.current = null;
      dragOverIndexRef.current = null;
      setDraggingIndex(null);
      setDragOverIndex(null);
      if (shouldMove && fromIndex !== null && toIndex !== null && fromIndex !== toIndex) {
        moveQuestion(fromIndex, toIndex);
      }
    };
    const handleUp = endDrag(true);
    const handleCancel = endDrag(false);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
    };
  }, [draggingIndex]);
  const currentCode = useMemo(
    // In Custom mode the real question count is however many entries are in
    // `selected` (its per-topic counts, including repeats) rather than the
    // now-vestigial quizLength state — see effectiveIds above.
    () => encodeQuizCode({ ids: selected, mode: practiceMode, length: lengthMode === "custom" ? selected.length : quizLength, lengthMode, salt, version: activeVersion, nonces: questionNonces, order: orderedVisibleQuestions.map((v) => v.index) }),
    [selected, practiceMode, quizLength, lengthMode, salt, activeVersion, questionNonces, orderedVisibleQuestions]
  );
  const currentLink = typeof window !== "undefined" && currentCode
    ? `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(currentCode)}`
    : "";
  const legacyCopy = (text) => {
    // navigator.clipboard is unavailable (or silently refuses) in some
    // browsers when this file is opened directly from disk rather than
    // served over http(s) — fall back to the older execCommand approach so
    // "Copy" still actually puts something on the clipboard rather than
    // quietly doing nothing.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  };
  const copyText = (text, label) => {
    const showResult = (ok) => {
      setCopyFlash(ok ? label : "Copy failed — select and copy manually.");
      setTimeout(() => setCopyFlash(""), 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showResult(true)).catch(() => showResult(legacyCopy(text)));
    } else {
      showResult(legacyCopy(text));
    }
  };

  // Feature 9: countdown timer controls for the Negative Numbers Speed
  // Check, shared between the print-style page and the full-screen
  // projection view. `big` renders a larger, further-back-readable digit
  // readout for the projector; both sizes share the same Start/Pause/Reset
  // and duration-preset buttons.
  function TimerControls({ big }) {
    const timerUp = timerRemaining === 0;
    // Custom time: free-text minutes/seconds fields next to the quick presets,
    // for whenever 1/2/3/5 minutes isn't the length a teacher wants (e.g. 90
    // seconds, or 8 minutes for a longer fluency task).
    const [customMin, setCustomMin] = useState("");
    const [customSec, setCustomSec] = useState("");
    const applyCustomTime = () => {
      const m = customMin === "" ? 0 : Math.max(0, parseInt(customMin, 10) || 0);
      const s = customSec === "" ? 0 : Math.max(0, Math.min(59, parseInt(customSec, 10) || 0));
      const total = Math.min(m * 60 + s, 99 * 60 + 59);
      if (total > 0) {
        setTimerPreset(total);
        setCustomMin("");
        setCustomSec("");
      }
    };
    return (
      <div className="no-print qe-timer-row">
        <div className={cx("qe-timer", big && "big", timerUp && "up")}>
          {timerUp ? "TIME!" : formatTimer(timerRemaining)}
        </div>
        <button className={btnCls({ active: timerRunning })} onClick={handleTimerStartPause}>
          {timerRunning ? "⏸ Pause" : timerUp ? "▶ Restart" : "▶ Start"}
        </button>
        <button className={btnCls()} onClick={handleTimerReset} title="Reset the timer without changing the length">
          ↺ Reset
        </button>
        <div className="qe-seg tight">
          {[1, 2, 3, 5].map((m) => (
            <button
              key={m}
              className={btnCls({ active: timerDuration === m * 60, sm: true })}
              onClick={() => setTimerPreset(m * 60)}
              title={`Set the timer to ${m} minute${m > 1 ? "s" : ""}`}
            >
              {m}m
            </button>
          ))}
        </div>
        <div className="qe-custom-time">
          <input
            type="number"
            min={0}
            max={99}
            placeholder="min"
            aria-label="Custom minutes"
            className="qe-field qe-num"
            value={customMin}
            onChange={(e) => setCustomMin(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyCustomTime(); }}
          />
          <span>:</span>
          <input
            type="number"
            min={0}
            max={59}
            placeholder="sec"
            aria-label="Custom seconds"
            className="qe-field qe-num"
            value={customSec}
            onChange={(e) => setCustomSec(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyCustomTime(); }}
          />
          <button className={btnCls({ sm: true })} onClick={applyCustomTime} title="Set a custom time, e.g. 4 min 30 sec">
            Set
          </button>
        </div>
      </div>
    );
  }

  function QuestionBlock({ q, number, onRegenerate, onDelete, handleProps, cardProps, isDragging, isDragOver, forceShowAnswers }) {
    // forceShowAnswers lets the "Save all versions as PDF" view show a
    // different mark-scheme visibility per version (see savingAllVersionsPdf
    // below) independent of the global Show/Hide mark scheme toggle.
    const answersVisible = forceShowAnswers !== undefined ? forceShowAnswers : showAnswers;
    return (
      <div
        className="quiz-question"
        {...cardProps}
        style={{
          border: isDragOver ? "2px dashed var(--paper-accent)" : "1px solid var(--paper-line)",
          borderRadius: 4,
          padding: "7px 9px 6px",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          boxSizing: "border-box",
          overflow: "hidden",
          opacity: isDragging ? 0.4 : 1,
          background: isDragOver ? "var(--paper-hl)" : "var(--paper)",
        }}
      >
        <div style={{ display: "flex", fontSize: 11.5, gap: 6, alignItems: "flex-start" }}>
          <span
            {...handleProps}
            className="no-print"
            title={locked ? "Unlock the quiz first to reorder questions" : "Drag to reorder this question"}
            style={{ ...handleProps.style, cursor: locked ? "not-allowed" : "grab", color: "var(--paper-muted)", fontSize: 13, lineHeight: "16px", padding: "0 2px", userSelect: "none", alignSelf: "flex-start", opacity: locked ? 0.4 : 1 }}
          >
            ⠿
          </span>
          <strong>{number}.</strong>
          <div style={{ flex: 1 }}>{mathify(q.prompt)}</div>
          <button
            onClick={onRegenerate}
            disabled={locked}
            className="no-print qe-mini"
            title={locked ? "Unlock the quiz first to regenerate this question" : "Regenerate just this question"}
            style={{ alignSelf: "flex-start" }}
          >
            ↻
          </button>
          <button
            onClick={onDelete}
            disabled={locked}
            className="no-print qe-mini danger"
            title={locked ? "Unlock the quiz first to delete this question" : "Remove just this question from the quiz"}
            style={{ alignSelf: "flex-start" }}
          >
            🗑
          </button>
        </div>

        {q.render && (
          <div style={{ margin: "6px auto 2px", maxWidth: "100%", textAlign: "center" }}>
            {q.render}
            {!q.accurateDiagram && <div style={{ fontSize: 8.5, fontStyle: "italic", color: "var(--paper-muted)", marginTop: 2 }}>Diagram NOT accurately drawn</div>}
          </div>
        )}

        <div style={{ flex: 1, minHeight: 16 }} />

        {answersVisible && (
          <div className="qe-ms">
            <strong>Mark scheme:</strong> {mathify(q.answer)}
            {q.answerRender && <div style={{ marginTop: 4 }}>{q.answerRender}</div>}
          </div>
        )}
      </div>
    );
  }

  // Renders one version's full set of printable pages. Shared by the normal
  // single-active-version view and "Save all versions as PDF" (which calls
  // this once per version, back to back, each with its own forced
  // mark-scheme visibility — see savingAllVersionsPdf above). Reorders each
  // version's own questions using the SAME index order as
  // orderedVisibleQuestions: dragging/deletion always operate on
  // effectiveIds' shared index space, so the order is identical across
  // versions even though the actual question content at each index differs.
  // interactive=false (used for the combined PDF view) drops the
  // regenerate/delete/drag handlers entirely rather than risk them
  // mutating the wrong version — they're print-hidden either way, but this
  // avoids relying on that alone.
  function renderVersionPages(versionData, forceShowAnswersForThisVersion, interactive) {
    const orderedForVersion = orderedVisibleQuestions.map(({ index }) => ({ q: versionData.questions[index], index }));
    const pageSizes = distributeQuestionsAcrossPages(orderedForVersion.length);
    let cursor = 0;
    const pages = pageSizes.map((size) => {
      const group = orderedForVersion.slice(cursor, cursor + size);
      cursor += size;
      return group;
    });
    let displayNumber = 0;
    return pages.map((pageQuestions, pageIdx) => (
      <div key={`${versionData.id}-${pageIdx}`} className="quiz-page qe-paper">
        {/* Printed on every page (not just page 1) so a version stays
            identifiable even if pages get separated once printed. */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <div className="qe-ver-pill">{VERSION_LABELS[versionData.id] || versionData.id}</div>
        </div>
        {pageIdx === 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24, fontSize: 12, borderBottom: "2px solid var(--paper-rule)", paddingBottom: 10, marginBottom: 18, alignItems: "center" }}>
            <div>Name: <span style={{ display: "inline-block", borderBottom: "1px solid var(--paper-rule)", width: 150 }}>&nbsp;</span></div>
            <div>Date: <span style={{ display: "inline-block", borderBottom: "1px solid var(--paper-rule)", width: 100 }}>&nbsp;</span></div>
            <div>Class: <span style={{ display: "inline-block", borderBottom: "1px solid var(--paper-rule)", width: 80 }}>&nbsp;</span></div>
            {locked && (
              <div style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 11, color: "var(--paper-muted)", wordBreak: "break-all", maxWidth: "100%" }}>Code: {currentCode || "—"}</div>
            )}
          </div>
        )}

        {orderedForVersion.length === 0 && pageIdx === 0 && (
          <div style={{ fontSize: 13, color: "var(--paper-muted)" }}>
            {versionData.questions.length > 0
              ? "Every question has been deleted from this quiz — untick and re-tick a subtopic, or generate new numbers, to start over."
              : lengthMode === "custom"
              ? "Tick one or more subtopics below to build your quiz — use the +/− next to a ticked topic to include it more than once."
              : lengthMode === "weekly"
              ? `Tick subtopics below to build your weekly quiz — use the +/− next to a ticked topic for extra copies. Printing unlocks once you reach ${quizLength} questions.`
              : practiceMode === "blocked"
              ? `Select 1 subtopic — it repeats ${quizLength} times with fresh numbers each round (blocked practice).`
              : `Select up to ${quizLength} subtopics to build a ${quizLength}-question quiz (interleaved practice).`}
          </div>
        )}

        {orderedForVersion.length > 0 && (
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr", gridTemplateRows: "repeat(3, 1fr)", gap: 10, minHeight: 0 }}>
            {pageQuestions.map(({ q, index }) => {
              displayNumber += 1;
              const { handleProps, cardProps, isDragging, isDragOver } = interactive
                ? makeDragProps(index)
                : { handleProps: {}, cardProps: {}, isDragging: false, isDragOver: false };
              return (
                <QuestionBlock
                  key={index}
                  q={q}
                  number={displayNumber}
                  onRegenerate={interactive ? () => regenerateQuestion(index) : undefined}
                  onDelete={interactive ? () => deleteQuestion(index) : undefined}
                  handleProps={handleProps}
                  cardProps={cardProps}
                  isDragging={isDragging}
                  isDragOver={isDragOver}
                  forceShowAnswers={forceShowAnswersForThisVersion}
                />
              );
            })}
            {Array.from({ length: 3 - pageQuestions.length }).map((_, i) => (
              <div key={`filler-${versionData.id}-${pageIdx}-${i}`} style={{ border: "1px dashed var(--paper-faint)", borderRadius: 4 }} />
            ))}
          </div>
        )}
      </div>
    ));
  }

  const printBlocked = lengthMode === "weekly" && selected.length < quizLength;
  const printBlockedTip = printBlocked
    ? `Pick ${quizLength - selected.length} more question${quizLength - selected.length === 1 ? "" : "s"} before printing (${selected.length}/${quizLength})`
    : undefined;

  return (
    <div className="app-shell qe-app">
      <style>{QE_STYLES}</style>
      {speedCheckOpen && speedCheckFullScreen ? (
      <div className="speedcheck-fullscreen qe-full">
        <div className="no-print qe-full-head">
          <div className="qe-full-title">{speedCheckInfo.title}</div>
          <TimerControls big />
          <div className="qe-row">
            <button onClick={() => setSpeedCheckSalt((s) => s + 1)} className={btnCls()} title="Reroll every number on the sheet">↻ New numbers</button>
            <button onClick={() => setSpeedCheckAnswers((a) => !a)} className={btnCls({ active: speedCheckAnswers, tone: "ok" })}>
              {speedCheckAnswers ? "Hide answers" : "Show answers"}
            </button>
            <button onClick={() => setSpeedCheckFullScreen(false)} className={btnCls()}>✕ Exit full screen</button>
          </div>
        </div>

        <div className="speedcheck-fullscreen-grid" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", columnGap: 24 }}>
          {[0, 1, 2, 3].map((colIdx) => (
            <div key={colIdx} style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              {speedCheckQuestions.slice(colIdx * 6, colIdx * 6 + 6).map((q, i) => {
                const n = colIdx * 6 + i + 1;
                return (
                  <div
                    key={n}
                    className="speedcheck-fullscreen-cell"
                    style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", gap: 8, fontSize: "clamp(15px, 2.3vw, 30px)", borderBottom: "1px solid var(--line)" }}
                  >
                    <strong style={{ flexShrink: 0 }}>{n}.</strong>
                    <div style={{ flex: 1, fontSize: q.size ? `${q.size}em` : q.small ? "0.72em" : undefined }}>
                      {q.expr}
                      {q.target && <span style={{ fontSize: "0.55em", color: "var(--muted)", marginLeft: 8, whiteSpace: "nowrap", display: "inline-block" }}>→ {q.target}</span>}
                    </div>
                    {speedCheckAnswers && <div style={{ color: "var(--ok)", fontWeight: 700, flexShrink: 0 }}>= {q.answer}</div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      ) : speedCheckOpen ? (
      <div className="qe-sheetwrap">
        <div className="no-print qe-toolbar">
          <button onClick={() => setSpeedCheckOpen(false)} className={btnCls()}>← Back to quiz builder</button>
          <TimerControls />
          <div className="qe-row">
            <button onClick={() => setSpeedCheckFullScreen(true)} className={btnCls()} title="Project full screen, 4 columns, for students to answer in their books">📺 Go full screen</button>
            <button onClick={() => setSpeedCheckSalt((s) => s + 1)} className={btnCls()} title="Reroll every number on the sheet">↻ New numbers</button>
            <button onClick={() => setSpeedCheckAnswers((a) => !a)} className={btnCls({ active: speedCheckAnswers, tone: "ok" })}>
              {speedCheckAnswers ? "Hide answers" : "Show answers"}
            </button>
            <button onClick={() => window.print()} className={btnCls({ primary: true })}>🖨 Print</button>
          </div>
        </div>

        <div className="qe-canvas">
        <div className="quiz-page qe-paper sheet">
          <div style={{ borderBottom: "2px solid var(--paper-rule)", paddingBottom: 10, marginBottom: 16, flexShrink: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "var(--display)" }}>{speedCheckInfo.title}</div>
            <div style={{ fontSize: 11, color: "var(--paper-muted)", marginTop: 4, lineHeight: 1.4 }}>
              {speedCheckInfo.description}
            </div>
            <div style={{ display: "flex", gap: 24, fontSize: 12, marginTop: 10 }}>
              <div>Name: <span style={{ display: "inline-block", borderBottom: "1px solid var(--paper-rule)", width: 150 }}>&nbsp;</span></div>
              <div>Date: <span style={{ display: "inline-block", borderBottom: "1px solid var(--paper-rule)", width: 90 }}>&nbsp;</span></div>
              <div>Time: <span style={{ display: "inline-block", borderBottom: "1px solid var(--paper-rule)", width: 50 }}>&nbsp;</span></div>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 40 }}>
            {[speedCheckQuestions.slice(0, 12), speedCheckQuestions.slice(12, 24)].map((col, colIdx) => (
              <div key={colIdx} style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                {col.map((q, i) => {
                  const n = colIdx * 12 + i + 1;
                  return (
                    <div
                      key={n}
                      className="speed-check-row"
                      style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", gap: 10, fontSize: 27, borderBottom: "1px dashed var(--paper-faint)" }}
                    >
                      <strong style={{ width: 40, flexShrink: 0 }}>{n}.</strong>
                      <div style={{ flex: 1, fontSize: q.size ? `${q.size}em` : q.small ? "0.72em" : undefined }}>
                        {q.expr}
                        {q.target && <span style={{ fontSize: 15, color: "var(--paper-muted)", marginLeft: 10, whiteSpace: "nowrap", display: "inline-block" }}>→ {q.target}</span>}
                      </div>
                      {!q.size && <div style={{ flexShrink: 0 }}>=</div>}
                      <div
                        style={{
                          minWidth: q.size ? 70 : 80,
                          textAlign: "center",
                          borderBottom: speedCheckAnswers ? "none" : "2px solid var(--paper-rule)",
                          color: speedCheckAnswers ? "var(--paper-ok)" : "transparent",
                          fontWeight: 700,
                        }}
                      >
                        {speedCheckAnswers ? q.answer : "   "}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        </div>
      </div>
      ) : fullScreenDoNow && lengthMode === "donow" ? (
      <div className="donow-fullscreen qe-full">
        <div className="no-print qe-full-head">
          <div className="qe-full-title">
            Do Now — {customLabel ? customLabel : `${schemeKey} · ${weekKey.split("—")[0].trim()}`} · {active.id}
          </div>
          <div className="qe-row">
            <button onClick={() => setShowAnswers((s) => !s)} className={btnCls({ active: showAnswers, tone: "ok" })}>
              {showAnswers ? "Hide answers" : "Show answers"}
            </button>
            <button onClick={() => window.print()} className={btnCls({ primary: true })}>
              🖨 Print
            </button>
            <button onClick={() => setFullScreenDoNow(false)} className={btnCls()}>
              ✕ Exit full screen
            </button>
          </div>
        </div>

        <div className="donow-grid" style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 16 }}>
          {orderedVisibleQuestions.map(({ q, index }, i) => {
            const { handleProps, cardProps, isDragging, isDragOver } = makeDragProps(index);
            return (
            <div
              key={index}
              className="donow-cell"
              {...cardProps}
              style={{
                border: isDragOver ? "2px dashed var(--accent)" : "1px solid var(--line)",
                borderRadius: 12,
                padding: "16px 20px",
                overflow: "auto",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                opacity: isDragging ? 0.4 : 1,
                background: isDragOver ? "var(--accent-soft)" : "var(--panel)",
              }}
            >
              <div style={{ display: "flex", fontSize: "clamp(16px, 2vw, 26px)", gap: 12, lineHeight: 1.35, alignItems: "flex-start" }}>
                <span
                  {...handleProps}
                  className="no-print"
                  title={locked ? "Unlock the quiz first to reorder questions" : "Drag to reorder this question"}
                  style={{ ...handleProps.style, cursor: locked ? "not-allowed" : "grab", color: "var(--muted)", fontSize: 16, userSelect: "none", opacity: locked ? 0.4 : 1 }}
                >
                  ⠿
                </span>
                <strong>{i + 1}.</strong>
                <div style={{ flex: 1 }}>{mathify(q.prompt)}</div>
              </div>

              {q.render && (
                <div style={{ margin: "12px 0 6px 8px", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {q.render}
                </div>
              )}

              {showAnswers && (
                <div style={{ background: "var(--ok-soft)", border: "1px solid color-mix(in srgb, var(--ok) 40%, var(--line))", borderRadius: 8, padding: "10px 14px", fontSize: "clamp(12px, 1.3vw, 16px)", marginTop: "auto" }}>
                  <strong style={{ color: "var(--ok)" }}>Answer:</strong> {mathify(q.answer)}
                  {q.answerRender && <div style={{ marginTop: 8 }}>{q.answerRender}</div>}
                </div>
              )}
            </div>
            );
          })}
          {orderedVisibleQuestions.length === 0 && (
            <div style={{ gridColumn: "1 / -1", gridRow: "1 / -1", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 15 }}>
              Select up to 4 subtopics in the sidebar to fill this grid.
            </div>
          )}
        </div>
      </div>
      ) : (
      <>
      <div className="quiz-grid qe-layout">

        <aside className={cx("no-print qe-side", !builderOpen && "is-collapsed")}>
          <header className="qe-side-head">
            <div>
              <h1 className="qe-title">Quiz Templating Engine</h1>
              <p className="qe-sub">Full GCSE spec browser — pick a scheme, a week, then edit freely</p>
            </div>
            <div className="qe-seg tight" role="group" aria-label="Colour theme">
              {[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([k, label]) => (
                <button key={k} type="button" className={btnCls({ active: themePref === k, sm: true })} aria-pressed={themePref === k} onClick={() => setThemePref(k)}>
                  {label}
                </button>
              ))}
            </div>
          </header>

          <button type="button" className={cx(btnCls({ block: true }), "qe-narrow-only")} aria-expanded={builderOpen} onClick={() => setBuilderOpen((o) => !o)}>
            {builderOpen ? "Hide quiz builder ▲" : "Show quiz builder ▼"}
          </button>

          <div className="qe-cards">
            <section className="qe-card">
              <div className="qe-card-head">
                <h3>Speed checks</h3>
                <div className="qe-note">Fixed-format fluency sheets, separate from the topic picker.</div>
              </div>
              <div className="qe-speed">
                {SPEED_CHECKS.map((sc) => (
                  <button
                    key={sc.kind}
                    type="button"
                    className="qe-speed-btn"
                    style={{ "--tag": sc.tag }}
                    onClick={() => { setSpeedCheckKind(sc.kind); setTimerPreset(sc.secs); setSpeedCheckOpen(true); }}
                    title={sc.tip}
                  >
                    <span className="qe-speed-dot" aria-hidden="true" />
                    <span>
                      <strong>{sc.title}</strong>
                      <small>{sc.blurb}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="qe-card">
              <div className="qe-card-head">
                <h3>Scheme of work</h3>
              </div>
              <label className="qe-label" htmlFor="qe-scheme">Scheme of work</label>
              <select
                id="qe-scheme"
                className="qe-field"
                value={schemeKey}
                onChange={(e) => applyWeek(e.target.value, Object.keys(SCHEMES[e.target.value])[0])}
                disabled={locked}
              >
                {Object.keys(SCHEMES).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>

              <label className="qe-label" htmlFor="qe-week">Week beginning</label>
              <select
                id="qe-week"
                className="qe-field"
                value={weekKey}
                onChange={(e) => applyWeek(schemeKey, e.target.value)}
                disabled={locked}
              >
                {Object.keys(SCHEMES[schemeKey]).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <div className="qe-note" style={{ marginTop: 8 }}>
                Picks that week's topics automatically — edit the list below before generating.
              </div>
            </section>

            <section className="qe-card">
              <div className="qe-card-head">
                <h3>Practice settings</h3>
              </div>
              <button
                onClick={() => setLocked((l) => !l)}
                title={locked ? "Unlock to change subtopics, mode, length or numbers again" : "Freeze this exact quiz so it can't be accidentally changed or regenerated before printing/projecting"}
                className={btnCls({ active: locked, tone: "warn", block: true })}
              >
                {locked ? "🔒 Quiz locked — click to unlock" : "🔓 Lock quiz"}
              </button>

              <span className="qe-label">Practice mode</span>
              <div className="qe-seg" style={{ opacity: locked ? 0.5 : 1 }}>
                <button disabled={locked} onClick={() => setPracticeModeSafe("interleaved")} className={btnCls({ active: practiceMode === "interleaved" })} title="Mix several skills — students must choose the method">Interleaved</button>
                <button disabled={locked} onClick={() => setPracticeModeSafe("blocked")} className={btnCls({ active: practiceMode === "blocked" })} title="Repeat one skill so the method is fixed">Blocked</button>
              </div>

              <span className="qe-label">Quiz length</span>
              <div className="qe-seg" style={{ opacity: locked ? 0.5 : 1 }}>
                <button disabled={locked} onClick={() => setQuizLengthSafe(4, "donow")} className={btnCls({ active: lengthMode === "donow" })} title="4 questions — fits a Do Now, one A4 side">Do Now (4)</button>
                <button disabled={locked} onClick={() => setQuizLengthSafe(6, "weekly")} className={btnCls({ active: lengthMode === "weekly" })} title="6 questions — a weekly quiz, three per printed page">Weekly Quiz (6)</button>
                <button disabled={locked} onClick={switchToCustomMode} className={btnCls({ active: lengthMode === "custom" })} title="Tick topics below (and use +/− for extra copies) to build any size quiz you want">Custom</button>
              </div>
              {(lengthMode === "custom" || lengthMode === "weekly") && (
                <div className="qe-note" style={{ marginTop: 8, opacity: locked ? 0.5 : 1 }}>
                  Tick topics below, then use the +/− next to a ticked one to include it more than once.
                  <br />
                  {lengthMode === "weekly" ? (
                    <>
                      Total: <strong className={selected.length === quizLength ? "qe-ok-text" : undefined}>{selected.length}/{quizLength}</strong> questions.
                      {selected.length < quizLength && <> Printing unlocks once you reach {quizLength}.</>}
                    </>
                  ) : (
                    <>Total: <strong>{selected.length}</strong> question{selected.length === 1 ? "" : "s"}.</>
                  )}
                </div>
              )}
              {lengthMode === "donow" && (
                <button
                  onClick={() => setFullScreenDoNow(true)}
                  title="Project the 4 questions as a full-screen 2x2 grid — still prints cleanly as one page for the teacher"
                  className={btnCls({ block: true })}
                  style={{ marginTop: 10 }}
                >
                  📺 Go full screen (Do Now)
                </button>
              )}
            </section>

            <section className="qe-card wide">
              <div className="qe-card-head">
                <h3>Topic picker</h3>
                <div className="qe-note">
                  {lengthMode === "custom"
                    ? `${new Set(selected).size} topic${new Set(selected).size === 1 ? "" : "s"} · ${selected.length} question${selected.length === 1 ? "" : "s"} selected`
                    : lengthMode === "weekly"
                    ? `${new Set(selected).size} topic${new Set(selected).size === 1 ? "" : "s"} · ${selected.length}/${quizLength} questions selected`
                    : `${selected.length}/${practiceMode === "blocked" ? 1 : quizLength} subtopics selected`}
                </div>
              </div>

              <div className="qe-row" style={{ flexWrap: "nowrap" }}>
                <input
                  type="search"
                  className="qe-field"
                  value={topicSearch}
                  onChange={(e) => setTopicSearch(e.target.value)}
                  placeholder="Search topics…"
                  aria-label="Search topics"
                />
                {topicSearch && (
                  <button onClick={() => setTopicSearch("")} className={btnCls()} title="Clear search" aria-label="Clear search">×</button>
                )}
              </div>
              <div className="qe-tree">
                {Object.entries(FULL_SPEC).map(([strand, domains]) => {
                  const strandNameMatches = !!searchQuery && strand.toLowerCase().includes(searchQuery);

                  // Precompute, per domain/group, which subtopics the search
                  // leaves visible — reused below both to decide whether this
                  // strand/domain has anything to show at all (skip it entirely
                  // if not) and to actually render it.
                  const domainsWithVisibility = Object.entries(domains).map(([domain, groups]) => {
                    const domainKey = `${strand} → ${domain}`;
                    const domainNameMatches = !!searchQuery && domain.toLowerCase().includes(searchQuery);
                    const groupsWithVisibility = groups.map((g) => {
                      const specKey = `${strand} → ${domain} → ${g}`;
                      const subIds = Object.entries(SUBTOPIC_TO_SPEC).filter(([, v]) => v === specKey).map(([id]) => id);
                      const groupNameMatches = !!searchQuery && g.toLowerCase().includes(searchQuery);
                      // A match on the group/domain/strand's own name shows every
                      // subtopic in that group untouched, not just ones whose own
                      // title happens to contain the search text too.
                      const showAllInGroup = !searchQuery || strandNameMatches || domainNameMatches || groupNameMatches;
                      const visibleSubIds = showAllInGroup ? subIds : subIds.filter((id) => SUBTOPIC_BANK[id].title.toLowerCase().includes(searchQuery));
                      return { g, subIds, visibleSubIds };
                    });
                    const domainVisible = !searchQuery || groupsWithVisibility.some((gv) => gv.visibleSubIds.length > 0);
                    return { domain, domainKey, groupsWithVisibility, domainVisible };
                  });
                  const strandVisible = !searchQuery || domainsWithVisibility.some((d) => d.domainVisible);
                  if (!strandVisible) return null;

                  const isOpen = searchQuery ? true : openStrands.has(strand);
                  return (
                    <div key={strand}>
                      <button type="button" className="qe-tree-row qe-tree-strand" aria-expanded={isOpen} onClick={() => toggleStrand(strand)}>
                        <span className="qe-tree-caret">{isOpen ? "▾" : "▸"}</span>
                        <span>{strand}</span>
                      </button>
                      {isOpen && (
                        <div className="qe-tree-body">
                          {domainsWithVisibility.map(({ domain, domainKey, groupsWithVisibility, domainVisible }) => {
                            if (!domainVisible) return null;
                            const domainOpen = searchQuery ? true : openDomains.has(domainKey);
                            return (
                              <div key={domain}>
                                <button type="button" className="qe-tree-row qe-tree-domain" aria-expanded={domainOpen} onClick={() => toggleDomain(domainKey)}>
                                  <span className="qe-tree-caret">{domainOpen ? "▾" : "▸"}</span>
                                  <span>{domain}</span>
                                </button>
                                {domainOpen && (
                                  <div className="qe-tree-body">
                                    {groupsWithVisibility.map(({ g, subIds, visibleSubIds }) => {
                                      if (searchQuery && visibleSubIds.length === 0) return null;
                                      if (subIds.length === 0) {
                                        return (
                                          <div key={g} className="qe-tree-empty">
                                            {g} — not yet added
                                          </div>
                                        );
                                      }
                                      return (
                                        <div key={g}>
                                          <div className="qe-tree-group">{g}</div>
                                          {visibleSubIds.map((id) => {
                                            const isTicked = selected.includes(id);
                                            const topicCount = selected.filter((x) => x === id).length;
                                            return (
                                              <label key={id} className={cx("qe-topic", locked && "is-locked")}>
                                                <input type="checkbox" checked={isTicked} onChange={() => toggleSubtopic(id)} disabled={locked} />
                                                <span className="qe-topic-name">
                                                  {SUBTOPIC_BANK[id].title} <span className="qe-marks">[{SUBTOPIC_BANK[id].marks}m]</span>
                                                </span>
                                                {(lengthMode === "custom" || lengthMode === "weekly") && isTicked && (
                                                  // How many copies of this one topic to include — lets a
                                                  // teacher ask for "3 of these" instead of one tick always
                                                  // meaning one question. preventDefault on each button stops
                                                  // the browser's native "click inside a <label> toggles its
                                                  // checkbox" behaviour from also firing here.
                                                  <span className="qe-stepper" title="How many of this question to include">
                                                    <button
                                                      type="button"
                                                      className="qe-step"
                                                      disabled={locked || topicCount <= 1}
                                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTopicCount(id, topicCount - 1); }}
                                                      title="One fewer of this question"
                                                      aria-label="One fewer"
                                                    >
                                                      −
                                                    </button>
                                                    <span className="qe-step-n">{topicCount}</span>
                                                    <button
                                                      type="button"
                                                      className="qe-step"
                                                      disabled={locked || (lengthMode === "weekly" && selected.length >= quizLength)}
                                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTopicCount(id, topicCount + 1); }}
                                                      title={lengthMode === "weekly" && selected.length >= quizLength ? `Weekly Quiz is capped at ${quizLength} questions` : "One more of this question"}
                                                      aria-label="One more"
                                                    >
                                                      +
                                                    </button>
                                                  </span>
                                                )}
                                              </label>
                                            );
                                          })}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="qe-card">
              <div className="qe-card-head">
                <h3>Versions &amp; export</h3>
              </div>
              <div className="qe-seg">
                {versions.map((v) => (
                  <button key={v.id} onClick={() => setActiveVersion(v.id)} className={btnCls({ active: v.id === activeVersion })} aria-pressed={v.id === activeVersion}>
                    {VERSION_LABELS[v.id] || v.id}
                  </button>
                ))}
              </div>
              <div className="qe-stack" style={{ marginTop: 10 }}>
                <button onClick={regenerate} disabled={locked} className={btnCls({ block: true })} title={locked ? "Unlock the quiz first to generate new numbers" : "Reroll every question with fresh numbers"}>↻ New numbers</button>
                <button onClick={() => setShowAnswers((s) => !s)} className={btnCls({ active: showAnswers, tone: "ok", block: true })}>
                  {showAnswers ? "Hide mark scheme" : "Show mark scheme"}
                </button>
                <button
                  onClick={() => window.print()}
                  disabled={printBlocked}
                  className={btnCls({ primary: true, block: true })}
                  title={printBlockedTip}
                >
                  🖨 Print quiz
                </button>
                <button
                  onClick={() => setSavingAllVersionsPdf(true)}
                  disabled={printBlocked || savingAllVersionsPdf}
                  className={btnCls({ block: true })}
                  title={
                    printBlocked
                      ? `Pick ${quizLength - selected.length} more question${quizLength - selected.length === 1 ? "" : "s"} before saving (${selected.length}/${quizLength})`
                      : "Opens the print dialog with all 3 versions together — Version 1 with no mark scheme, Version 2 with the mark scheme, Version 3 with no mark scheme. Choose \"Save as PDF\" as the destination."
                  }
                >
                  {savingAllVersionsPdf ? "Preparing…" : "💾 Save all versions as PDF"}
                </button>
              </div>
              <div className="qe-note" style={{ marginTop: 10 }}>
                Printing leaves out this panel. Versions 1–3 use the same skills in the same order with fresh numbers, handy for different classes or retests. Drag a question's ⠿ handle to reorder it. "Save all versions as PDF" bundles all three into one file — Version 1 and 3 without the mark scheme, Version 2 with it — via your browser's print dialog.
              </div>
            </section>

            <section className="qe-card">
              <div className="qe-card-head">
                <h3>Quiz code</h3>
                <div className="qe-note">Reopen this exact quiz later, or share it.</div>
              </div>
              <div className="qe-row" style={{ flexWrap: "nowrap" }}>
                <textarea
                  readOnly
                  value={currentCode}
                  aria-label="Quiz code"
                  className="qe-field mono"
                  rows={Math.max(1, Math.min(6, Math.ceil(currentCode.length / 30)))}
                  style={{ resize: "none", wordBreak: "break-all", lineHeight: 1.35 }}
                  onFocus={(e) => e.target.select()}
                />
                <button onClick={() => copyText(currentCode, "Code copied")} className={btnCls()}>Copy</button>
              </div>
              <div className="qe-row" style={{ marginTop: 8 }}>
                <button onClick={() => copyText(currentLink, "Link copied")} className={btnCls({ sm: true })}>Copy shareable link</button>
                {copyFlash && <span className="qe-ok-text" style={{ fontSize: ".78rem" }}>{copyFlash}</span>}
              </div>
              <div className="qe-row" style={{ marginTop: 12, flexWrap: "nowrap" }}>
                <input
                  className="qe-field mono"
                  value={codeInput}
                  onChange={(e) => { setCodeInput(e.target.value); setCodeMessage(""); }}
                  onPaste={(e) => {
                    // Pasting a code loads it straight away; no need to press Load.
                    const t = e.clipboardData && e.clipboardData.getData("text");
                    if (t && t.trim()) { e.preventDefault(); setCodeInput(t.trim()); loadCode(t); }
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") loadCode(); }}
                  placeholder="Paste a quiz code or link…"
                  aria-label="Paste a quiz code"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button onClick={() => loadCode()} className={btnCls()}>Load</button>
              </div>
              {codeMessage && (
                <div
                  className={codeTone === "ok" ? "qe-ok-text" : codeTone === "err" ? "qe-danger-text" : undefined}
                  style={{ fontSize: ".78rem", marginTop: 6, ...(codeTone === "warn" ? { color: "var(--warn)" } : null) }}
                  role="status"
                >
                  {codeMessage}
                </div>
              )}
              <div className="qe-note" style={{ marginTop: 8 }}>
                The code holds the whole quiz, order and all, so it works anywhere with no login. It ignores capital letters, spaces and dashes, so you can paste it straight from an email or message.
              </div>
            </section>

            {libOn && (
              <section className="qe-card wide">
                <div className="qe-card-head">
                  <h3>Saved quizzes</h3>
                  <div className="qe-note">A shared library for all teachers. Save a quiz here and open it from any computer.</div>
                </div>
                {!libSignedIn ? (
                  <form onSubmit={libDoSignIn} className="qe-row" style={{ flexWrap: "nowrap" }}>
                    <input
                      type="password"
                      className="qe-field"
                      value={libPassword}
                      onChange={(e) => { setLibPassword(e.target.value); setLibMsg({ tone: "ok", text: "" }); }}
                      placeholder="Library password"
                      aria-label="Library password"
                      autoComplete="current-password"
                    />
                    <button type="submit" disabled={libBusy} className={btnCls({ primary: true })}>{libBusy ? "Signing in…" : "Sign in"}</button>
                  </form>
                ) : (
                  <>
                    <div className="qe-row" style={{ flexWrap: "nowrap" }}>
                      <input
                        className="qe-field"
                        value={libName}
                        onChange={(e) => { setLibName(e.target.value); setLibMsg({ tone: "ok", text: "" }); }}
                        onKeyDown={(e) => { if (e.key === "Enter") libDoSave(); }}
                        placeholder="Name this quiz, e.g. 10B fractions wk 3"
                        aria-label="Quiz name"
                        maxLength={120}
                      />
                    </div>
                    <div className="qe-row" style={{ marginTop: 8, flexWrap: "nowrap" }}>
                      <input
                        className="qe-field"
                        value={libAuthor}
                        onChange={(e) => setLibAuthor(e.target.value)}
                        placeholder="Your name (so others know who made it)"
                        aria-label="Your name"
                        maxLength={60}
                      />
                      <button onClick={libDoSave} disabled={libBusy || !currentCode} className={btnCls({ primary: true })}>Save</button>
                    </div>
                    <div className="qe-row" style={{ marginTop: 12, flexWrap: "nowrap" }}>
                      <input
                        className="qe-field"
                        value={libSearch}
                        onChange={(e) => setLibSearch(e.target.value)}
                        placeholder="Search saved quizzes…"
                        aria-label="Search saved quizzes"
                      />
                      <button onClick={libRefresh} disabled={libBusy} className={btnCls({ sm: true })} title="Reload the list">Refresh</button>
                    </div>
                    <div className="qe-lib-list" aria-live="polite">
                      {libItems === null ? (
                        <div className="qe-note">Loading…</div>
                      ) : libVisible.length === 0 ? (
                        <div className="qe-note">{libItems.length === 0 ? "Nothing saved yet. Build a quiz, name it above and press Save." : "No saved quiz matches that search."}</div>
                      ) : (
                        libVisible.map((item) => (
                          <div key={item.id} className="qe-lib-item">
                            <div className="qe-lib-name">{item.name}</div>
                            <div className="qe-note">{item.author ? `${item.author} · ` : ""}{new Date(item.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>
                            <div className="qe-row" style={{ marginTop: 6 }}>
                              <button onClick={() => libDoOpen(item)} className={btnCls({ sm: true, primary: true })}>Open</button>
                              <button onClick={() => libDoUpdate(item)} disabled={libBusy || !currentCode} className={btnCls({ sm: true })} title="Replace this saved quiz with the one you have open now">Update</button>
                              <button onClick={() => libDoDelete(item)} disabled={libBusy} className={btnCls({ sm: true, tone: "warn" })}>Delete</button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="qe-row" style={{ marginTop: 10 }}>
                      <button onClick={libDoSignOut} className={btnCls({ sm: true })} title="Do this on a shared computer when you've finished">Sign out of library</button>
                    </div>
                  </>
                )}
                {libMsg.text && (
                  <div className={libMsg.tone === "ok" ? "qe-ok-text" : "qe-danger-text"} style={{ fontSize: ".78rem", marginTop: 8 }} role="status">{libMsg.text}</div>
                )}
              </section>
            )}
          </div>
        </aside>

        <main className="qe-canvas">
          {savingAllVersionsPdf
            ? versions.map((v, vi) => renderVersionPages(v, [false, true, false][vi], false))
            : renderVersionPages(active, showAnswers, true)}
        </main>

      </div>
      </>
      )}
    </div>
  );
}

// ---------- Visual design system ----------
// One stylesheet, tokens defined once on :root (light by default, a dark set
// under prefers-color-scheme plus a manual [data-theme] override). Tokens and
// type match the "Teacher dashboard" artifact: Bricolage Grotesque for
// headings, Atkinson Hyperlegible for body text, a teal accent, white panels
// with a 1px border and 12px radius.
//
// The printed/preview PAPER deliberately uses its own --paper-* tokens that do
// NOT flip in dark mode: a quiz sheet is white paper with dark ink whatever
// theme the builder around it is in, and the print block below also pins every
// token to its light value so nothing can print pale-on-white.
const QE_STYLES = `
@import url("https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&display=swap");

:root{
  --bg:#EDF0F4; --panel:#FFFFFF; --panel-2:#F6F8FA; --ink:#17202D; --muted:#586377; --line:#D5DBE4;
  --accent:#1E6F6D; --accent-ink:#FFFFFF; --accent-soft:#DDEFEE;
  --danger:#B23A2F; --danger-soft:#F8E4E1; --ok:#2F7D4F; --ok-soft:#E3F1E8; --warn:#A8650F; --warn-soft:#FBEBD0;
  --tag-neg:#C2493D; --tag-fdp:#3A6DB5; --tag-3:#7A4FB5; --tag-4:#B7791F; --tag-5:#2E8B7A;
  --display:"Bricolage Grotesque","Segoe UI",system-ui,sans-serif;
  --body:"Atkinson Hyperlegible","Segoe UI",system-ui,-apple-system,sans-serif;
  --paper:#FFFFFF; --paper-ink:#17202D; --paper-muted:#586377; --paper-line:#9AA3AF; --paper-rule:#17202D; --paper-faint:#D5DBE4;
  --paper-hl:#DDEFEE; --paper-accent:#1E6F6D; --paper-ok:#2F5B41; --paper-ok-bg:#EEF5F0; --paper-ok-line:#B9D3C2;
  --paper-danger:#B23A2F; --paper-danger-bg:#FBEDEB; --paper-tool-bg:#F6F8FA;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#11161E; --panel:#1A212C; --panel-2:#202834; --ink:#E7EBF1; --muted:#9AA5B6; --line:#2C3644;
  --accent:#43A9A4; --accent-ink:#0B1A1A; --accent-soft:#1D3534;
  --danger:#E0685C; --danger-soft:#3A211E; --ok:#6BC48A; --ok-soft:#1B2E23; --warn:#E0A83A; --warn-soft:#2C2818;
  --tag-neg:#E0685C; --tag-fdp:#6D9BE0; --tag-3:#A585DB; --tag-4:#DDA24A; --tag-5:#55B8A6;
  color-scheme:dark;
}}
:root[data-theme="dark"]{
  --bg:#11161E; --panel:#1A212C; --panel-2:#202834; --ink:#E7EBF1; --muted:#9AA5B6; --line:#2C3644;
  --accent:#43A9A4; --accent-ink:#0B1A1A; --accent-soft:#1D3534;
  --danger:#E0685C; --danger-soft:#3A211E; --ok:#6BC48A; --ok-soft:#1B2E23; --warn:#E0A83A; --warn-soft:#2C2818;
  --tag-neg:#E0685C; --tag-fdp:#6D9BE0; --tag-3:#A585DB; --tag-4:#DDA24A; --tag-5:#55B8A6;
  color-scheme:dark;
}

html,body{background:var(--bg)}
.qe-app{font-family:var(--body);background:var(--bg);color:var(--ink);font-size:15px;line-height:1.45;min-height:100vh;padding:20px clamp(12px,3vw,28px) 40px;-webkit-font-smoothing:antialiased}
.qe-app *,.qe-app *::before,.qe-app *::after{box-sizing:border-box}
.qe-app button,.qe-app input,.qe-app select{font:inherit}
.qe-app :focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.qe-app h1,.qe-app h2,.qe-app h3{margin:0}

/* Layout: builder sidebar + quiz canvas */
.qe-layout{max-width:1500px;margin:0 auto;display:grid;grid-template-columns:minmax(300px,380px) minmax(0,1fr);gap:20px;align-items:start}
.qe-side{display:grid;gap:12px}
.qe-side-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;padding:2px 2px 4px}
.qe-title{font:800 1.35rem/1.1 var(--display);letter-spacing:-0.02em}
.qe-sub{margin:4px 0 0;color:var(--muted);font-size:.85rem}
.qe-cards{display:grid;gap:12px}
.qe-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;min-width:0}
.qe-card-head{margin-bottom:8px}
.qe-card h3{font:700 1rem/1.3 var(--display)}
.qe-note{color:var(--muted);font-size:.8rem;line-height:1.4}
.qe-label{display:block;font-size:.78rem;font-weight:700;color:var(--muted);margin:12px 0 5px}
.qe-card-head + .qe-label,.qe-card .qe-label:first-child{margin-top:0}
.qe-canvas{min-width:0;overflow-x:auto;padding:2px 2px 8px}
.qe-app .qe-btn.qe-narrow-only{display:none}

/* Controls */
.qe-btn{border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:7px 12px;border-radius:8px;font-weight:700;font-size:.85rem;cursor:pointer;line-height:1.25}
.qe-btn:hover:not(:disabled){background:var(--panel-2);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.qe-btn:disabled{opacity:.5;cursor:not-allowed}
.qe-btn.is-active{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.qe-btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.qe-btn.primary:hover:not(:disabled){background:var(--accent);filter:brightness(1.08)}
.qe-btn.tone-ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 50%,var(--line))}
.qe-btn.tone-ok.is-active{background:var(--ok);border-color:var(--ok);color:var(--panel)}
.qe-btn.tone-warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 55%,var(--line))}
.qe-btn.tone-warn.is-active{background:var(--warn);border-color:var(--warn);color:var(--panel)}
.qe-btn.block{display:block;width:100%}
.qe-btn.sm{padding:3px 9px;font-size:.75rem;border-radius:7px}
.qe-seg{display:flex;gap:6px;flex-wrap:wrap}
.qe-seg>.qe-btn{flex:1 1 auto}
.qe-seg.tight{gap:4px}
.qe-seg.tight>.qe-btn{flex:0 0 auto}
.qe-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.qe-stack{display:grid;gap:8px}
.qe-field{width:100%;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:7px 10px;font-size:.88rem}
.qe-field:disabled{opacity:.55}
.qe-field.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.78rem}
.qe-field.qe-num{width:56px;padding:3px 6px;font-size:.8rem}
.qe-lib-list{display:flex;flex-direction:column;gap:8px;margin-top:10px;max-height:340px;overflow:auto}
.qe-lib-item{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--panel)}
.qe-lib-name{font-weight:700;overflow-wrap:anywhere}
.qe-ok-text{color:var(--ok);font-weight:700}
.qe-danger-text{color:var(--danger);font-weight:700}

/* Speed-check button family: one shape, a small colour tag tells them apart */
.qe-speed{display:grid;gap:8px}
.qe-speed-btn{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:10px 12px;border:1px solid var(--line);background:var(--panel-2);color:var(--ink);border-radius:10px;cursor:pointer}
.qe-speed-btn:hover{border-color:var(--tag);background:var(--panel)}
.qe-speed-dot{flex:none;width:12px;height:12px;border-radius:50%;background:var(--tag)}
.qe-speed-btn strong{display:block;font:700 .92rem/1.25 var(--display)}
.qe-speed-btn small{display:block;color:var(--muted);font-size:.76rem;margin-top:1px}

/* Topic picker */
.qe-tree{max-height:380px;overflow-y:auto;margin-top:10px;padding-right:4px}
.qe-tree-row{display:flex;align-items:center;gap:6px;width:100%;text-align:left;background:none;border:0;color:inherit;cursor:pointer;padding:5px 2px}
.qe-tree-strand{font:700 .9rem/1.3 var(--display);color:var(--accent);border-bottom:1px solid var(--line);margin-top:6px}
.qe-tree-domain{font-weight:700;font-size:.84rem;color:var(--ink)}
.qe-tree-caret{width:1em;flex:none;color:var(--muted)}
.qe-tree-body{padding:2px 0 4px 12px}
.qe-tree-group{font-weight:700;font-size:.8rem;color:var(--muted);margin:6px 0 1px}
.qe-tree-empty{font-size:.8rem;color:var(--muted);font-style:italic;padding:2px 0}
.qe-topic{display:flex;align-items:center;gap:8px;font-size:.86rem;padding:3px 0 3px 4px;cursor:pointer;border-radius:6px}
.qe-topic:hover{background:var(--panel-2)}
.qe-topic input{width:16px;height:16px;accent-color:var(--accent);flex:none}
.qe-topic.is-locked{cursor:not-allowed;opacity:.55}
.qe-topic-name{flex:1;min-width:0}
.qe-marks{color:var(--muted);font-size:.72rem;margin-left:4px;white-space:nowrap}
.qe-stepper{display:inline-flex;align-items:center;gap:4px;margin-left:6px}
.qe-step{width:24px;height:24px;border:1px solid var(--line);background:var(--panel-2);color:var(--ink);border-radius:7px;font-weight:700;line-height:1;padding:0;cursor:pointer}
.qe-step:disabled{opacity:.4;cursor:not-allowed}
.qe-step-n{min-width:16px;text-align:center;font-variant-numeric:tabular-nums;font-weight:700}

/* Timer */
.qe-timer-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qe-timer{font:700 .95rem var(--body);font-variant-numeric:tabular-nums;min-width:56px;text-align:center;color:var(--ink);background:var(--panel);border:2px solid var(--line);border-radius:8px;padding:1px 8px}
.qe-timer.big{font-size:2.5rem;min-width:116px;padding:2px 14px}
.qe-timer.up{color:var(--danger);border-color:var(--danger);background:var(--danger-soft)}
.qe-custom-time{display:flex;align-items:center;gap:4px;color:var(--muted)}

/* Full-screen projection views and the speed-check page toolbar */
.qe-full{position:fixed;inset:0;z-index:1000;background:var(--bg);color:var(--ink);display:flex;flex-direction:column;padding:16px 24px;overflow:auto}
.qe-full-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;flex-shrink:0}
.qe-full-title{font:700 1rem var(--display)}
.qe-sheetwrap{max-width:900px;margin:0 auto}
.qe-toolbar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px}

/* The paper: A4 sheet preview. Fixed light tokens, never themed. */
.qe-paper{background:var(--paper);color:var(--paper-ink);font-family:var(--body);border:1px solid var(--paper-line);box-shadow:0 1px 3px rgba(0,0,0,.18);margin:0 auto 16px;display:flex;flex-direction:column;box-sizing:border-box}
.qe-paper.quiz-page{width:min(210mm,100%);min-width:560px;min-height:267mm;padding:26px 30px 30px}
.qe-paper.sheet{width:210mm;height:267mm;padding:22px 28px 26px}
.qe-ver-pill{font:800 .8rem var(--display);letter-spacing:.04em;text-transform:uppercase;color:var(--paper);background:var(--paper-ink);padding:5px 14px;border-radius:5px}
.qe-mini{border:1px solid var(--paper-line);background:var(--paper-tool-bg);color:var(--paper-muted);border-radius:5px;font-size:10px;padding:0 5px;cursor:pointer}
.qe-mini.danger{border-color:var(--paper-danger);background:var(--paper-danger-bg);color:var(--paper-danger)}
.qe-mini:disabled{opacity:.4;cursor:not-allowed}
.qe-ms{background:var(--paper-ok-bg);border:1px solid var(--paper-ok-line);border-radius:3px;padding:4px 7px;font-size:10.5px;margin-top:4px;overflow:auto}
.qe-ms strong{color:var(--paper-ok)}

/* Below ~1100px: stack the builder above the quiz and let the cards flow in columns */
@media (max-width:1100px){
  .qe-layout{grid-template-columns:minmax(0,1fr)}
  .qe-cards{grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start}
  .qe-card.wide{grid-column:1 / -1}
  .qe-app .qe-btn.qe-narrow-only{display:block}
  .qe-side.is-collapsed .qe-cards{display:none}
  .qe-tree{max-height:320px}
  .qe-full{padding:12px 14px}
}
@media (max-width:560px){
  .qe-cards{grid-template-columns:minmax(0,1fr)}
}

@page { size: A4; margin: 12mm; }
@media print {
  :root,:root[data-theme="dark"]{
    color-scheme:light;
    --bg:#FFFFFF !important; --panel:#FFFFFF !important; --panel-2:#F6F8FA !important; --ink:#17202D !important;
    --muted:#586377 !important; --line:#D5DBE4 !important; --ok:#2F7D4F !important; --danger:#B23A2F !important;
    --accent:#1E6F6D !important;
  }
  html,body{background:#fff !important}
  body { background: #fff !important; }
  .app-shell { background: #fff !important; padding: 0 !important; min-height: 0 !important; }
  .no-print { display: none !important; }
  .quiz-grid { display: block !important; max-width: none !important; }
  .qe-canvas { overflow: visible !important; padding: 0 !important; }
  .quiz-page {
    width: auto !important;
    min-width: 0 !important;
    box-shadow: none !important;
    border: none !important;
    margin: 0 !important;
    page-break-after: always;
  }
  .quiz-page:last-of-type { page-break-after: auto; }
  .quiz-question { break-inside: avoid; page-break-inside: avoid; }
  .donow-fullscreen {
    position: static !important;
    width: auto !important;
    height: auto !important;
    padding: 0 !important;
    background: #fff !important;
    overflow: visible !important;
  }
  .donow-grid {
    height: auto !important;
    page-break-inside: avoid;
  }
  .donow-cell {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .speed-check-row {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .speedcheck-fullscreen {
    position: static !important;
    width: auto !important;
    height: auto !important;
    padding: 0 !important;
    background: #fff !important;
    overflow: visible !important;
  }
  .speedcheck-fullscreen-grid {
    height: auto !important;
    page-break-inside: avoid;
  }
  .speedcheck-fullscreen-cell {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
`;

// Joins truthy class names.
const cx = (...parts) => parts.filter(Boolean).join(" ");
// Class names for a button: active = selected/on, tone = ok | warn colour
// family, primary = filled accent, block/sm = sizing. One place so every
// button in the builder reads as part of the same family.
const btnCls = ({ active, tone, primary, block, sm } = {}) =>
  cx("qe-btn", active && "is-active", tone && `tone-${tone}`, primary && "primary", block && "block", sm && "sm");

// The fixed-format fluency sheets in the sidebar. Each one gets the same
// button; only its small colour tag differs, so adding a third is one row.
const SPEED_CHECKS = [
  {
    kind: "neg",
    secs: 180,
    title: "Negative Numbers",
    blurb: "24 questions · about 3 minutes",
    tag: "var(--tag-neg)",
    tip: "A fixed 24-question mental-maths sheet covering all 23 negative-number variations, two columns on one A4 page",
  },
  {
    kind: "fdp",
    secs: 180,
    title: "Fractions, Decimals & Percentages",
    blurb: "24 questions · about 3 minutes",
    tag: "var(--tag-fdp)",
    tip: "A fixed 24-question mental-maths sheet converting between fractions, decimals and percentages, including the recurring thirds, two columns on one A4 page",
  },
  {
    kind: "times",
    secs: 180,
    title: "Times Tables",
    blurb: "24 questions · about 3 minutes",
    tag: "var(--tag-3)",
    tip: "A fixed 24-question recall sheet of multiplication and division facts from the 2 to 12 tables, two columns on one A4 page",
  },
  {
    kind: "skills",
    secs: 300,
    title: "Number Skills",
    blurb: "24 questions · about 5 minutes",
    tag: "var(--tag-4)",
    tip: "Six easy questions each on factors & multiples, rounding & estimation, ratio & proportion and units & rates, two columns on one A4 page",
  },
  {
    kind: "measures",
    secs: 180,
    title: "Conversion of Measures",
    blurb: "24 questions · about 3 minutes",
    tag: "var(--tag-5)",
    tip: "A fixed 24-question sheet of one-step conversions: hours and minutes, kilograms and grams, and mm, cm, m and km, two columns on one A4 page",
  },
];
