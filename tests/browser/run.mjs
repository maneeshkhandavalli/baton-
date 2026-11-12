#!/usr/bin/env node
// Baton headless browser checks (Round 3, QA). NOT part of `npm test`: the lead runs it against the local dev
// server. No dependencies beyond Node 22+ (global fetch + WebSocket) and an installed Chrome.
//
//   node tests/browser/run.mjs <outDir> <baseUrl> name:/path [name:/path ...] [--widths=1440,1024,390] [--no-keyboard]
//   e.g. node tests/browser/run.mjs ./out/browser http://localhost:3000 home:/ login:/login demo:/demo
//
// For every route × width (1440x900, 1024x768, 390x844 mobile dpr 2) it records: final URL, horizontal overflow
// (document scrollWidth − innerWidth), the number of <h1>, up to 10 non-fixed elements wider than the viewport,
// console errors (console.error + uncaught exceptions), blocked non-local requests, a full-viewport PNG, and a
// keyboard check: Tab through the first 15 focusable elements and verify each shows a visible focus indicator
// (computed outline / box-shadow / border / background of the element or its parent differs from unfocused).
// Output: <outDir>/report.json + <outDir>/<route>-<width>.png. Exit code 1 if any check fails.
//
// Safety: a THROWAWAY Chrome profile under the OS temp dir (deleted afterwards), cookies cleared, never signs in,
// never types into a page, and refuses any non-localhost URL: the base URL must be http(s)://localhost,
// 127.0.0.1 or [::1], and every request to another host (including redirects) is blocked and reported.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DEVICES = {
  1440: { w: 1440, h: 900, mobile: false, dpr: 1 },
  1024: { w: 1024, h: 768, mobile: false, dpr: 1 },
  390: { w: 390, h: 844, mobile: true, dpr: 2 },
};
const SETTLE_MS = 2500;
const LOAD_TIMEOUT_MS = 20000;
const TAB_STOPS = 15;

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error("usage: node tests/browser/run.mjs <outDir> <baseUrl> name:/path [...] [--widths=1440,1024,390] [--no-keyboard]");
  process.exit(2);
}

function isLocal(url) {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "ws:") && LOCAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

// ── arguments ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const [outArg, base, ...routeArgs] = argv.filter((a) => !a.startsWith("--"));
if (!outArg || !base || routeArgs.length === 0) usage();
if (!isLocal(base)) usage(`refusing non-localhost base URL ${base}`);
const routes = routeArgs.map((r) => {
  const i = r.indexOf(":");
  if (i <= 0) usage(`route must be name:/path, got ${r}`);
  const name = r.slice(0, i);
  const path = r.slice(i + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(name)) usage(`route name must be [A-Za-z0-9_-]: ${name}`);
  if (!path.startsWith("/")) usage(`route path must start with "/": ${path}`);
  const url = new URL(path, base).href;
  if (!isLocal(url)) usage(`refusing non-localhost route ${url}`);
  return { name, url };
});
const widthsFlag = flags.find((f) => f.startsWith("--widths="));
const widths = (widthsFlag ? widthsFlag.slice(9).split(",") : ["1440", "1024", "390"]).map((w) => {
  if (!DEVICES[w]) usage(`unknown width ${w} (use 1440, 1024, 390)`);
  return DEVICES[w];
});
const keyboard = !flags.includes("--no-keyboard");
const CHROME = process.env.BATON_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
if (!existsSync(CHROME)) usage(`Chrome not found at ${CHROME} (set BATON_CHROME)`);
const outDir = resolve(outArg);
mkdirSync(outDir, { recursive: true });

// ── Chrome with a throwaway profile ──────────────────────────────────────────
const profile = mkdtempSync(join(tmpdir(), "baton-qa-chrome-"));
const chrome = spawn(
  CHROME,
  ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
    "--hide-scrollbars", "--mute-audio", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;

function cleanup() {
  try { ws?.close(); } catch { /* closing anyway */ }
  try { chrome.kill(); } catch { /* already gone */ }
  for (let i = 0; i < 10; i++) {
    try { rmSync(profile, { recursive: true, force: true }); return; } catch { /* Chrome still releasing files */ }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));

async function devtoolsPort() {
  const file = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100; i++) {
    if (existsSync(file)) {
      const port = Number(readFileSync(file, "utf8").split("\n")[0]);
      if (port > 0) return port;
    }
    await sleep(100);
  }
  throw new Error("Chrome did not open a DevTools port");
}

// ── CDP plumbing ─────────────────────────────────────────────────────────────
let nextId = 0;
const pending = new Map();
const listeners = new Set();
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++nextId;
    pending.set(id, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result ?? {})));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function waitFor(method, ms) {
  return new Promise((res) => {
    const f = (m) => { if (m.method === method) { listeners.delete(f); clearTimeout(t); res(true); } };
    const t = setTimeout(() => { listeners.delete(f); res(false); }, ms);
    listeners.add(f);
  });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.text}`);
  return r.result?.value;
}

// In-page probes (strings evaluated in the page; no page state is changed except focus).
const LAYOUT_PROBE = `(() => {
  const de = document.documentElement;
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');
  const wide = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || getComputedStyle(el).position === 'fixed') return false;
    return r.right > innerWidth + 1 || r.left < -1;
  }).slice(0, 10).map((el) => ({ el: describe(el), right: Math.round(el.getBoundingClientRect().right) }));
  return { href: location.href, title: document.title, scrollWidth: de.scrollWidth, innerWidth, h1: document.querySelectorAll('h1').length, wide };
})()`;

const FOCUS_STYLE = `(el) => {
  const pick = (e) => { if (!e) return ''; const s = getComputedStyle(e);
    return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset, s.boxShadow, s.borderColor, s.backgroundColor, s.textDecorationLine].join('|'); };
  return pick(el) + '#' + pick(el.parentElement);
}`;
const FOCUSED_PROBE = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const i = Number(el.getAttribute('data-baton-qa-focus') ?? -1);
  if (i >= 0) return { repeat: i };
  const n = document.querySelectorAll('[data-baton-qa-focus]').length;
  el.setAttribute('data-baton-qa-focus', String(n));
  window.__batonQaFocused = window.__batonQaFocused || [];
  window.__batonQaFocused.push((${FOCUS_STYLE})(el));
  const r = el.getBoundingClientRect();
  const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('name') || '').trim().slice(0, 60);
  return { index: n, tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), name, visible: r.width > 0 && r.height > 0 };
})()`;
const UNFOCUSED_PROBE = `(() => {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  const els = [...document.querySelectorAll('[data-baton-qa-focus]')];
  const out = els.map((el) => {
    const i = Number(el.getAttribute('data-baton-qa-focus'));
    const changed = (window.__batonQaFocused || [])[i] !== (${FOCUS_STYLE})(el);
    el.removeAttribute('data-baton-qa-focus');
    return { index: i, indicator: changed };
  });
  window.__batonQaFocused = [];
  return out;
})()`;

async function keyboardCheck() {
  const stops = [];
  for (let t = 0; t < TAB_STOPS; t++) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await sleep(120); // let transitions on focus settle
    const s = await evaluate(FOCUSED_PROBE);
    if (s === null) continue; // focus left the document (e.g. to the address bar): keep tabbing
    if ("repeat" in s) break; // wrapped around
    stops.push(s);
  }
  const indicators = await evaluate(UNFOCUSED_PROBE);
  for (const s of stops) s.indicator = indicators.find((x) => x.index === s.index)?.indicator ?? false;
  return stops;
}

// ── run ──────────────────────────────────────────────────────────────────────
const report = { base, startedAt: new Date().toISOString(), chrome: CHROME, results: [] };
let failures = 0;
try {
  const port = await devtoolsPort();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let consoleErrors = [];
  let blocked = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 500));
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      consoleErrors.push(`uncaught: ${(d.exception?.description ?? d.text ?? "").split("\n")[0].slice(0, 500)}`);
    } else if (m.method === "Fetch.requestPaused") {
      const { requestId, request } = m.params;
      if (isLocal(request.url) || request.url.startsWith("data:") || request.url.startsWith("blob:")) {
        send("Fetch.continueRequest", { requestId }).catch(() => {});
      } else {
        blocked.push(request.url.slice(0, 200));
        send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {});
      }
    }
    for (const f of listeners) f(m);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.clearBrowserCookies");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }); // every request passes the localhost gate

  for (const route of routes) {
    for (const d of widths) {
      consoleErrors = [];
      blocked = [];
      await send("Emulation.setDeviceMetricsOverride", { width: d.w, height: d.h, deviceScaleFactor: d.dpr, mobile: d.mobile });
      await send("Emulation.setTouchEmulationEnabled", { enabled: d.mobile });
      const loaded = waitFor("Page.loadEventFired", LOAD_TIMEOUT_MS);
      await send("Page.navigate", { url: route.url });
      const loadFired = await loaded;
      await sleep(SETTLE_MS);
      const layout = await evaluate(LAYOUT_PROBE);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const file = join(outDir, `${route.name}-${d.w}.png`);
      writeFileSync(file, Buffer.from(shot.data, "base64"));
      const stops = keyboard ? await keyboardCheck() : [];
      const result = {
        route: route.name, url: route.url, width: d.w, height: d.h, mobile: d.mobile, loadFired,
        finalUrl: layout.href, finalUrlLocal: isLocal(layout.href), title: layout.title,
        overflowPx: layout.scrollWidth - layout.innerWidth, h1: layout.h1, wide: layout.wide,
        consoleErrors, blockedRequests: blocked, screenshot: file,
        keyboard: keyboard ? { stops: stops.length, missingIndicator: stops.filter((s) => !s.indicator), detail: stops } : null,
      };
      result.problems = [
        !loadFired && "load event did not fire",
        !result.finalUrlLocal && "ended on a non-localhost URL",
        result.overflowPx > 0 && `horizontal overflow ${result.overflowPx}px`,
        result.h1 !== 1 && `${result.h1} <h1> elements (expected 1)`,
        result.wide.length > 0 && `${result.wide.length} element(s) wider than the viewport`,
        consoleErrors.length > 0 && `${consoleErrors.length} console error(s)`,
        blocked.length > 0 && `${blocked.length} non-localhost request(s) blocked`,
        keyboard && stops.length === 0 && "no keyboard-focusable element reached",
        keyboard && result.keyboard.missingIndicator.length > 0 && `${result.keyboard.missingIndicator.length} focus stop(s) without a visible indicator`,
      ].filter(Boolean);
      if (result.problems.length) failures++;
      report.results.push(result);
      console.log(`${route.name.padEnd(14)} ${String(d.w).padStart(4)}  ${result.problems.length ? "FAIL " + result.problems.join("; ") : "PASS"}  -> ${new URL(layout.href).pathname}`);
    }
  }
} catch (error) {
  report.error = String(error?.stack ?? error);
  console.error(report.error);
  failures++;
} finally {
  report.finishedAt = new Date().toISOString();
  report.summary = { checks: report.results.length, failing: report.results.filter((r) => r.problems?.length).length };
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`report: ${join(outDir, "report.json")}  (${report.summary.checks} checks, ${report.summary.failing} failing)`);
  cleanup();
}
process.exit(failures ? 1 : 0);
