#!/usr/bin/env node
// Rebuilds quiz_engine.html from QuizEngine.jsx.
//
// This project ships as a single static HTML file with no bundler: the JSX
// source (QuizEngine.jsx) is transformed just enough to run directly in a
// browser via Babel Standalone (see the <script type="text/babel"> tag near
// the top of quiz_engine.html), and this script keeps that tag's contents in
// sync with the source file. There is no other build step — quiz_engine.html
// IS the deployable artifact (what actually gets uploaded to GitHub
// Pages/wherever this is hosted).
//
// Run this after every edit to QuizEngine.jsx:
//
//   node tools/build.js
//
// Add --check to Babel-compile the result and fail loudly on a syntax error
// WITHOUT writing anything — a fast sanity check before touching the html:
//
//   node tools/build.js --check
//
// Requires @babel/core and @babel/preset-react — see tools/package.json
// (run `npm install` inside tools/ once).
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const JSX_PATH = path.join(ROOT, "QuizEngine.jsx");
const HTML_PATH = path.join(ROOT, "quiz_engine.html");

function transform(src) {
  // 1. Drop the ES module import — the browser copy gets React/ReactDOM as
  //    globals from the <script> tags in quiz_engine.html's <head> instead.
  src = src.replace(/^import React.*\n/, "");
  // 2. Babel Standalone's react preset needs the hooks available as plain
  //    identifiers (it doesn't know this is meant to be `React.useState`
  //    etc.), so destructure them up front.
  src = "const { useState, useMemo, useCallback, useId, useEffect, useRef } = React;\n" + src;
  // 3. Strip "export default" — there's no module system in the browser
  //    copy, just a plain function declaration.
  src = src.replace("export default function QuizEngine()", "function QuizEngine()");
  // 4. Mount it.
  src = src.replace(/\n*$/, "") + "\n\nReactDOM.createRoot(document.getElementById(\"root\")).render(<QuizEngine />);\n";
  return src;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  if (!fs.existsSync(JSX_PATH)) {
    console.error(`Can't find ${JSX_PATH}`);
    process.exit(1);
  }
  const src = fs.readFileSync(JSX_PATH, "utf8");
  const transformed = transform(src);

  try {
    const babel = require("@babel/core");
    babel.transform(transformed, { presets: ["@babel/preset-react"], filename: "QuizEngine.jsx" });
  } catch (e) {
    console.error("Babel compile FAILED — not touching quiz_engine.html:\n");
    console.error(e.message);
    process.exit(1);
  }

  if (checkOnly) {
    console.log("Syntax OK (--check passed, no files written).");
    return;
  }

  if (!fs.existsSync(HTML_PATH)) {
    console.error(`Can't find ${HTML_PATH}`);
    process.exit(1);
  }
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const pattern = /(<script type="text\/babel" data-presets="react">\n)[\s\S]*?(\n\s*<\/script>)/;
  if (!pattern.test(html)) {
    console.error(`Could not find the <script type="text/babel"> block in ${path.basename(HTML_PATH)} — is this the right file?`);
    process.exit(1);
  }
  const newHtml = html.replace(pattern, (_m, open, close) => open + transformed + close);
  fs.writeFileSync(HTML_PATH, newHtml);
  console.log(`Rebuilt ${path.relative(ROOT, HTML_PATH)} from ${path.relative(ROOT, JSX_PATH)}.`);
}

main();
