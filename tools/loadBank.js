// Loads SUBTOPIC_BANK / SUBTOPIC_TO_SPEC / FULL_SPEC straight out of
// QuizEngine.jsx by transforming + Babel-compiling it in memory and running
// it inside a tiny sandboxed stand-in for React (just enough of
// React.createElement to build up plain {type, props} element trees — no
// real DOM, no rendering). This is how fuzz3.js and cosmetic_scan.js check
// every subtopic's build() output without needing a browser at all.
//
// Requires @babel/core and @babel/preset-react (see tools/package.json).
const fs = require("fs");

function loadBank(jsxPath) {
  const babel = require("@babel/core");
  let src = fs.readFileSync(jsxPath, "utf8");
  src = src.replace(/^import React.*\n/, "");
  src = src.replace("export default function QuizEngine", "function QuizEngine");
  // Defensive: strip a trailing ReactDOM.createRoot(...).render(...) call if
  // present (the version of this file spliced into quiz_engine.html has one;
  // the plain QuizEngine.jsx source file normally doesn't).
  src = src.replace(/ReactDOM\.createRoot\([\s\S]*?\.render\([\s\S]*?\);?\s*$/, "");
  const jsx = `const { useState, useMemo, useCallback, useId, useEffect, useRef } = React;\n${src}`;

  const { code } = babel.transform(jsx, { presets: ["@babel/preset-react"], filename: "QuizEngine.jsx" });

  function createElement(type, props, ...children) {
    props = props || {};
    if (children.length) props = { ...props, children: children.length === 1 ? children[0] : children };
    return { type, props };
  }
  // QuizEngine() itself is never called (we only need the module-level
  // consts below), so these hook stubs only need to exist, not behave —
  // they're here in case some top-level helper touches them incidentally.
  const React = {
    createElement,
    useState: (v) => [v, () => {}],
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useId: () => "uid",
    useEffect: () => {},
    useRef: (v) => ({ current: v }),
  };
  const sandbox = { require, console, React, module: { exports: {} }, exports: {} };
  const fn = new Function(...Object.keys(sandbox), code + "\nreturn { SUBTOPIC_BANK, SUBTOPIC_TO_SPEC, FULL_SPEC };");
  return fn(...Object.values(sandbox));
}

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

// Flattens a {type, props} element tree (or a plain string/number) down to
// its rendered text content, calling any function components along the way.
function flatten(el) {
  if (el == null || typeof el === "boolean") return "";
  if (typeof el === "string" || typeof el === "number") return String(el);
  if (Array.isArray(el)) return el.map(flatten).join("");
  if (typeof el !== "object" || !("type" in el)) return "";
  const { type, props } = el;
  if (typeof type === "function") {
    try {
      return flatten(type(props));
    } catch (e) {
      return `[THREW:${e.message}]`;
    }
  }
  const kids = props && props.children;
  return kids !== undefined ? flatten(kids) : "";
}

module.exports = { loadBank, mulberry32, flatten };
