// Cosmetic-regression scan: renders every subtopic's prompt/answer text many
// times over and flags patterns that usually mean a formatting bug rather
// than a real answer — a literal "1x" instead of "x", a "^1" exponent that
// should've simplified away, a stray "+ 0"/"- 0" term, or a double sign like
// "+ -" that should have collapsed to a single "-".
//
// Usage:  node tools/cosmetic_scan.js
//
// This is NOT a pass/fail check — some ids legitimately contain patterns
// that look suspicious but are correct (a caret exponent GIVEN in the
// question rather than computed, e.g. "3^1", or a genuine "+ 0" mid
// working-out). Compare the output against a previous run (e.g. `git diff`
// on a saved copy of this script's output) and investigate only NEW issues
// after an edit — don't expect the total to be, or stay, zero.
const path = require("path");
const { loadBank, mulberry32, flatten } = require("./loadBank");

const JSX_PATH = path.join(__dirname, "..", "QuizEngine.jsx");
const SEEDS_PER_ID = 100;

const { SUBTOPIC_BANK } = loadBank(JSX_PATH);
const ALL_IDS = Object.keys(SUBTOPIC_BANK);
console.log("Scanning", ALL_IDS.length, "ids");

const PATTERNS = [
  { name: "coef-1-letter", re: /\b1[a-zA-Z]\b/ },
  { name: "coef-neg1-letter", re: /-1[a-zA-Z]\b/ },
  { name: "caret-1", re: /\^1\b/ },
  { name: "plus-zero", re: /[+]\s*0\b/ },
  { name: "minus-zero", re: /-\s*0\b(?!\.\d)/ },
  { name: "double-sign-plus-minus", re: /\+\s*-/ },
  { name: "double-sign-minus-minus", re: /-\s*-/ },
  { name: "thrown", re: /\[THREW/ },
  { name: "bad-token", re: /NaN|Infinity|undefined/ },
];

let issues = [];
for (const id of ALL_IDS) {
  for (let seed = 1; seed <= SEEDS_PER_ID; seed++) {
    const rng = mulberry32(seed * 131 + 7);
    let q;
    try {
      q = SUBTOPIC_BANK[id].build(rng);
    } catch (e) {
      issues.push(`${id} seed=${seed}: build() THREW: ${e.message}`);
      continue;
    }
    const promptText = flatten(q.prompt);
    const answerText = flatten(q.answer);
    for (const [label, str] of [["prompt", promptText], ["answer", answerText]]) {
      for (const p of PATTERNS) {
        if (p.re.test(str)) {
          issues.push(`${id} seed=${seed} [${label}] matched ${p.name}: "${str}"`);
        }
      }
    }
  }
}
console.log(`Total issues found: ${issues.length}`);
// Dedup by id+pattern to keep output readable — one example per (id, pattern).
const seen = new Set();
for (const iss of issues) {
  const key = iss.split(" seed=")[0] + iss.split("matched ")[1]?.split(":")[0];
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(" -", iss);
}
