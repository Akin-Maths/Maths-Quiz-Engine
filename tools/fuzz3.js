// Deep-render check: builds every subtopic in SUBTOPIC_BANK many times over
// (with different seeds) and walks the full resulting element tree —
// including any inline SVG diagram component — looking for anything that
// blew up or leaked a bad token (NaN/Infinity/undefined) into what a student
// would see. Also sanity-checks that every SUBTOPIC_TO_SPEC entry points at
// a strand/domain/group that actually exists in FULL_SPEC.
//
// Usage:  node tools/fuzz3.js
//
// A clean run ends with "NO BAD ATTRIBUTES / ERRORS FOUND." and
// "Bad FULL_SPEC paths: 0". Run this after adding or editing any subtopic.
const path = require("path");
const { loadBank, mulberry32 } = require("./loadBank");

const JSX_PATH = path.join(__dirname, "..", "QuizEngine.jsx");
const SEEDS_PER_ID = 40;

const { SUBTOPIC_BANK, SUBTOPIC_TO_SPEC, FULL_SPEC } = loadBank(JSX_PATH);

let badAttrs = [];
let currentLabel = "";
function walk(el, depth) {
  if (el == null || typeof el === "string" || typeof el === "number" || typeof el === "boolean") return;
  if (Array.isArray(el)) { el.forEach((c) => walk(c, depth)); return; }
  if (typeof el !== "object" || !("type" in el)) return;
  const { type, props } = el;
  if (typeof type === "function") {
    if (depth > 12) { badAttrs.push(`${currentLabel}: recursion too deep (possible infinite loop) at ${type.name}`); return; }
    let out;
    try {
      out = type(props);
    } catch (e) {
      badAttrs.push(`${currentLabel}: COMPONENT THREW in ${type.name}: ${e.message}`);
      return;
    }
    walk(out, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "children") { walk(v, depth + 1); continue; }
    if (typeof v === "number" && !Number.isFinite(v)) badAttrs.push(`${currentLabel}: <${type}> ${k}=${v} (not finite)`);
    if (typeof v === "string" && /NaN|Infinity|undefined/.test(v)) badAttrs.push(`${currentLabel}: <${type}> ${k}="${v}"`);
  }
}
function walkString(label, val) {
  if (typeof val === "string" && /NaN|Infinity|undefined/.test(val)) badAttrs.push(`${label}: string contains bad token: "${val}"`);
}

const ALL_IDS = Object.keys(SUBTOPIC_BANK);
console.log("Total ids in bank:", ALL_IDS.length);

let checked = 0;
for (const id of ALL_IDS) {
  for (let seed = 1; seed <= SEEDS_PER_ID; seed++) {
    checked++;
    currentLabel = `${id} seed=${seed}`;
    try {
      const rng = mulberry32(seed * 131 + 7);
      const q = SUBTOPIC_BANK[id].build(rng);
      if (!q || typeof q.prompt === "undefined" || typeof q.answer === "undefined") {
        badAttrs.push(`${currentLabel}: missing prompt/answer`);
        continue;
      }
      walkString(currentLabel + " prompt", q.prompt);
      walkString(currentLabel + " answer", q.answer);
      walk(q.prompt, 0);
      walk(q.answer, 0);
      if (q.render) walk(q.render, 0);
      if (q.answerRender) walk(q.answerRender, 0);
    } catch (e) {
      badAttrs.push(`${currentLabel}: build() THREW: ${e.message}`);
    }
  }
}
console.log(`Deep-rendered ${checked} (id, seed) combos, including full SVG component execution.`);
if (badAttrs.length === 0) {
  console.log("NO BAD ATTRIBUTES / ERRORS FOUND.");
} else {
  console.log(`${badAttrs.length} issues:`);
  badAttrs.slice(0, 120).forEach((e) => console.log(" -", e));
}

let badPaths = [];
for (const [id, specPath] of Object.entries(SUBTOPIC_TO_SPEC)) {
  const [strand, domain, group] = specPath.split(" → ");
  const groups = FULL_SPEC[strand] && FULL_SPEC[strand][domain];
  if (!groups || !groups.includes(group)) badPaths.push(`${id}: ${specPath}`);
}
const missingFromSpec = ALL_IDS.filter((id) => !(id in SUBTOPIC_TO_SPEC));
console.log("Bank ids missing from SUBTOPIC_TO_SPEC:", missingFromSpec.length, missingFromSpec.slice(0, 20));
console.log("Bad FULL_SPEC paths:", badPaths.length);
badPaths.forEach((p) => console.log(" -", p));

if (badAttrs.length > 0 || badPaths.length > 0 || missingFromSpec.length > 0) process.exitCode = 1;
