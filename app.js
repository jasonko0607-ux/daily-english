// Renders the home page, article pages and the word list from the JSON files
// in data/. All content is inserted as text nodes, never as HTML.
//
// Marked words are saved to data/marked.json through the GitHub API, using a
// fine-grained token the reader pastes once per device (kept in localStorage).

const OWNER = "jasonko0607-ux";
const REPO = "daily-english";
const MARKED_PATH = "data/marked.json";
const TOKEN_KEY = "de_github_token";
const SCHEDULE = [3, 7, 14];

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function button(cls, text, onClick) {
  const b = el("button", cls, text);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

function badge(level) {
  const high = level.includes("800+");
  return el("span", "badge " + (high ? "high" : "mid"), "TOEIC " + level);
}

function articleUrl(date, n) {
  return "article.html?d=" + encodeURIComponent(date) + "&n=" + n;
}

function reviewUrl(date) {
  return "review.html?d=" + encodeURIComponent(date);
}

function link(text, href, cls) {
  const a = el("a", cls, text);
  a.href = href;
  return a;
}

async function loadJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(path + " " + res.status);
  return res.json();
}

function showError(main, message) {
  main.replaceChildren(el("p", "empty", message));
}

// A study day runs from one 08:00 push to the next (Taipei time), so a word marked
// at 01:00 still belongs to the previous day's issue.
function studyDay() {
  const shifted = new Date(Date.now() - 8 * 3600 * 1000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(shifted);
}

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------- Token and GitHub storage ----------

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch (e) {
    return "";
  }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

function b64ToText(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function textToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function gh(path, options = {}, token = getToken()) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: "Bearer " + token,
  };
  if (options.body) headers["Content-Type"] = "application/json";
  return fetch("https://api.github.com/repos/" + OWNER + "/" + REPO + path, {
    ...options,
    headers,
    cache: "no-store",
  });
}

class AuthError extends Error {}

// Reads the word list. With a token it reads the repository directly, so a
// word marked a moment ago shows up at once; without one it reads the
// published copy, which can lag a minute behind.
async function readMarked() {
  if (getToken()) {
    const res = await gh("/contents/" + MARKED_PATH + "?ref=main");
    if (res.status === 404) return { data: { words: [] }, sha: null };
    if (res.status === 401 || res.status === 403) throw new AuthError();
    if (!res.ok) throw new Error("GitHub " + res.status);
    const file = await res.json();
    return { data: JSON.parse(b64ToText(file.content)), sha: file.sha };
  }
  try {
    return { data: await loadJson(MARKED_PATH), sha: null };
  } catch (e) {
    return { data: { words: [] }, sha: null };
  }
}

// Applies change(data) to the latest word list and saves it. If the file
// changed in between (another device, or the morning job), it retries.
async function updateMarked(change, message) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, sha } = await readMarked();
    if (!Array.isArray(data.words)) data.words = [];
    if (change(data) === false) return false;
    const body = { message, branch: "main", content: textToB64(JSON.stringify(data, null, 2) + "\n") };
    if (sha) body.sha = sha;
    const res = await gh("/contents/" + MARKED_PATH, { method: "PUT", body: JSON.stringify(body) });
    if (res.ok) return true;
    if (res.status === 401 || res.status === 403) throw new AuthError();
    if (res.status !== 409 && res.status !== 422) throw new Error("GitHub " + res.status);
  }
  throw new Error("conflict");
}

// ---------- Small UI pieces ----------

let toastTimer = null;
function toast(message) {
  let t = document.getElementById("toast");
  if (!t) {
    t = el("div", "toast");
    t.id = "toast";
    t.setAttribute("role", "status");
    document.body.append(t);
  }
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// Asks for the GitHub token in a dialog. Resolves true once a working token is saved.
function askToken() {
  return new Promise((resolve) => {
    const overlay = el("div", "modal");
    const box = el("div", "modal-box");
    const input = el("input", "modal-input");
    input.type = "password";
    input.placeholder = "github_pat_…";
    input.autocomplete = "off";
    const status = el("p", "modal-status");
    const close = (ok) => {
      overlay.remove();
      resolve(ok);
    };
    const save = button("btn primary", "儲存", async () => {
      const token = input.value.trim();
      if (!token) return;
      status.textContent = "確認中…";
      try {
        const res = await gh("/contents/data/index.json?ref=main", {}, token);
        if (!res.ok) throw new Error();
      } catch (e) {
        status.textContent = "這組金鑰無法讀取 daily-english，請確認是否複製完整、權限是否正確。";
        return;
      }
      if (!setToken(token)) {
        status.textContent = "這個瀏覽器無法儲存金鑰（可能是無痕模式）。";
        return;
      }
      close(true);
    });
    box.append(
      el("h2", "modal-title", "連結 GitHub"),
      el("p", null, "標記的單字會存到你的 GitHub 儲存庫。請貼上 daily-english 專用的金鑰，只需在這台裝置設定一次。"),
      input,
      status,
      el("div", "modal-actions")
    );
    box.lastChild.append(button("btn", "取消", () => close(false)), save);
    overlay.append(box);
    overlay.addEventListener("click", (ev) => ev.target === overlay && close(false));
    document.body.append(overlay);
    input.focus();
  });
}

async function markWord(text, context, ref) {
  const word = text.trim();
  if (!word) return;
  if (!getToken() && !(await askToken())) return;
  toast("儲存中…");
  try {
    let existed = false;
    await updateMarked((data) => {
      if (data.words.some((w) => w.word.toLowerCase() === word.toLowerCase())) {
        existed = true;
        return false;
      }
      data.words.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        word,
        context,
        article: ref,
        marked_at: studyDay(),
        zh: "",
        pos: "",
        reviews: [],
      });
    }, "Mark word: " + word);
    toast(existed ? "「" + word + "」已經在單字本裡" : "已標記「" + word + "」");
  } catch (e) {
    if (e instanceof AuthError) {
      setToken("");
      toast("金鑰已失效，請重新設定後再標記一次");
    } else {
      toast("儲存失敗，請稍後再試");
    }
  }
}

// ---------- Home ----------

async function renderIndex() {
  const main = document.getElementById("main");
  let days;
  try {
    days = await loadJson("data/index.json");
  } catch (e) {
    return showError(main, "無法載入文章列表。");
  }
  if (!days.length) return showError(main, "還沒有文章，明天早上 8 點見。");

  main.replaceChildren();
  for (const day of days) {
    const section = el("section", "day");
    section.append(el("h2", null, day.date));
    for (const a of day.articles) {
      const card = el("a", "card");
      card.href = articleUrl(day.date, a.n);
      card.append(badge(a.level), el("span", "c", a.category), el("span", "t", a.title));
      section.append(card);
    }
    if (day.reviews) {
      const card = link("", reviewUrl(day.date), "card review-card");
      card.append(el("span", "t", "🔁 今日複習 · " + day.reviews + " 個你標記過的字"));
      section.append(card);
    }
    main.append(section);
  }
}

// ---------- Article ----------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ABBREVIATION = /\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|Inc|Co|Corp|Ltd|No|U\.S|U\.K|e\.g|i\.e)$/;

// Returns the sentence of `text` that contains `phrase`.
function sentenceAround(text, phrase) {
  const at = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (at < 0) return "";
  const ends = /[.!?]["”’)]?\s+/g;
  let start = 0;
  let end = text.length;
  let m;
  while ((m = ends.exec(text))) {
    if (ABBREVIATION.test(text.slice(0, m.index))) continue;
    const next = m.index + m[0].length;
    if (next <= at) start = next;
    else {
      end = m.index + m[0].trimEnd().length;
      break;
    }
  }
  return text.slice(start, end).trim();
}

// Splits a paragraph into text and highlighted buttons. Each item is marked
// once, at its first appearance in the article.
function buildParagraph(text, items, used) {
  const p = el("p", "en");
  const hits = [];
  items.forEach((item, i) => {
    if (used.has(i)) return;
    const re = new RegExp("(^|[^A-Za-z])(" + escapeRegExp(item.match || item.word) + ")(?![A-Za-z])", "i");
    const m = re.exec(text);
    if (m) {
      const start = m.index + m[1].length;
      hits.push({ start, end: start + m[2].length, i });
    }
  });
  hits.sort((a, b) => a.start - b.start);

  let pos = 0;
  for (const h of hits) {
    if (h.start < pos) continue; // overlaps an earlier mark
    used.add(h.i);
    p.append(text.slice(pos, h.start));
    const b = button("vw" + (items[h.i].review ? " rv" : ""), text.slice(h.start, h.end));
    b.dataset.i = h.i;
    p.append(b);
    pos = h.end;
  }
  p.append(text.slice(pos));
  return p;
}

function setupPopover(items, ref) {
  const pop = document.getElementById("pop");
  let current = null;

  function hide() {
    pop.hidden = true;
    current = null;
  }

  document.addEventListener("click", (ev) => {
    if (ev.target.closest(".pop")) return;
    const b = ev.target.closest(".vw");
    if (!b || b === current) return hide();
    const item = items[Number(b.dataset.i)];
    const line = el("div", "pop-line");
    line.append(el("span", "w", item.word), el("span", "p", item.pos || ""));
    if (tts.supported) {
      const said = b.textContent;
      const again = button("pop-say", "🔊", () => speakWord(said));
      again.setAttribute("aria-label", "再念一次");
      line.append(again);
    }
    pop.replaceChildren(line, el("span", "z", item.zh));
    if (item.review) {
      pop.append(el("span", "pop-note", "🔁 你標記過的字"));
    } else {
      pop.append(button("pop-mark", "＋ 標記", () => {
        hide();
        markWord(item.word, item.example || "", ref);
      }));
    }
    pop.hidden = false;
    const r = b.getBoundingClientRect();
    const left = Math.max(16, Math.min(r.left, window.innerWidth - pop.offsetWidth - 16));
    pop.style.left = left + window.scrollX + "px";
    pop.style.top = r.bottom + window.scrollY + 6 + "px";
    current = b;
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hide();
  });
  window.addEventListener("resize", hide);
}

// Shows a "mark" bar at the bottom of the screen while a word or short phrase
// in the article is selected (long-press on a phone, drag on a computer).
function setupSelectionMark(ref) {
  const bar = button("markbar");
  bar.hidden = true;
  document.body.append(bar);
  let pending = null;
  let hideTimer = null;

  document.addEventListener("selectionchange", () => {
    const sel = window.getSelection();
    const raw = sel ? sel.toString() : "";
    const text = raw.replace(/\s+/g, " ").trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    const node = sel && sel.anchorNode;
    const elNode = node && (node.nodeType === 1 ? node : node.parentElement);
    const para = elNode && elNode.closest(".body p.en");
    const valid = para && text && text.length <= 40 && text.split(" ").length <= 4 && /^[A-Za-z][A-Za-z' -]*$/.test(text);

    clearTimeout(hideTimer);
    if (!valid) {
      // Wait a moment, so tapping the bar (which clears the selection) still works.
      hideTimer = setTimeout(() => {
        bar.hidden = true;
        pending = null;
      }, 400);
      return;
    }
    pending = { text, context: sentenceAround(para.textContent, text) };
    bar.textContent = "＋ 標記「" + text + "」";
    bar.hidden = false;
  });

  bar.addEventListener("click", () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    bar.hidden = true;
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    markWord(p.text, p.context, ref);
  });
}

// ---------- Read aloud (browser speech synthesis) ----------
//
// Each paragraph gets a speaker button, a position slider and a speed button.
// Text is spoken one sentence at a time (Chrome stops long utterances), with an
// American English voice. The sentence and word being spoken are highlighted
// with the CSS Custom Highlight API, so the paragraph's DOM is never touched.

const RATE_KEY = "de_tts_rate";
const RATES = [1, 0.8, 0.6];

const tts = {
  supported: "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function",
  voice: null,
  rate: 1,
  gen: 0, // bumped on every stop/start, so events from old utterances are ignored
  active: null, // the paragraph player that is speaking
  utter: null, // kept so Chrome doesn't garbage-collect it before onend fires
  boundaryWorks: false, // set once the voice reports word positions
  timer: null,
  clearTimer: null, // removes the highlight once the spoken word is over
};

try {
  const saved = Number(localStorage.getItem(RATE_KEY));
  if (RATES.includes(saved)) tts.rate = saved;
} catch (e) {}

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  const us = voices.filter((v) => /^en[-_]US$/i.test(v.lang));
  tts.voice =
    us.find((v) => /natural|neural|online/i.test(v.name)) ||
    us.find((v) => /google/i.test(v.name)) ||
    us.find((v) => /samantha|aria|jenny|ava|allison/i.test(v.name)) ||
    us.find((v) => v.localService) ||
    us[0] ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    null;
}

if (tts.supported) {
  pickVoice();
  speechSynthesis.addEventListener("voiceschanged", pickVoice);
  window.addEventListener("pagehide", () => speechSynthesis.cancel());
}

// Some setups (e.g. Windows with only Chinese voices installed) have no English
// voice at all; the text would then be read with a Chinese accent.
let warnedNoVoice = false;
function warnIfNoVoice() {
  if (tts.voice || warnedNoVoice || !speechSynthesis.getVoices().length) return;
  warnedNoVoice = true;
  toast("這個瀏覽器找不到英文語音，建議改用 Chrome／Edge，或在系統設定安裝英文（美國）語音。");
}

function makeUtterance(text) {
  warnIfNoVoice();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  if (tts.voice) u.voice = tts.voice;
  u.rate = tts.rate;
  return u;
}

// Splits text into sentences as [{start, end}] character offsets.
function splitSentences(text) {
  const out = [];
  const ends = /[.!?]["”’)]?\s+/g;
  let start = 0;
  let m;
  while ((m = ends.exec(text))) {
    if (ABBREVIATION.test(text.slice(0, m.index))) continue;
    out.push({ start, end: m.index + m[0].trimEnd().length });
    start = m.index + m[0].length;
  }
  if (start < text.trimEnd().length) out.push({ start, end: text.trimEnd().length });
  return out;
}

// Builds a DOM Range covering text offsets [from, to) inside element `root`.
function rangeFor(root, from, to) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0;
  let started = false;
  let node;
  while ((node = walker.nextNode())) {
    const len = node.data.length;
    if (!started && from <= seen + len) {
      range.setStart(node, from - seen);
      started = true;
    }
    if (started && to <= seen + len) {
      range.setEnd(node, to - seen);
      return range;
    }
    seen += len;
  }
  return started ? range : null;
}

const canHighlight = typeof Highlight === "function" && window.CSS && CSS.highlights;

function highlight(name, root, from, to) {
  if (!canHighlight) return;
  const r = root && to > from ? rangeFor(root, from, to) : null;
  if (r) CSS.highlights.set(name, new Highlight(r));
  else CSS.highlights.delete(name);
}

function clearHighlights() {
  highlight("tts-sentence");
  highlight("tts-word");
}

function stopTimer() {
  clearInterval(tts.timer);
  tts.timer = null;
  clearTimeout(tts.clearTimer);
  tts.clearTimer = null;
}

// Rough time, in ms, the voice needs to say `chars` characters.
function speechMs(chars) {
  return (chars / (14 * tts.rate)) * 1000;
}

// Stops whatever is speaking. The paragraph keeps its position, so pressing its
// speaker again continues from there.
function stopSpeaking() {
  tts.gen++;
  stopTimer();
  if (tts.supported) speechSynthesis.cancel();
  const st = tts.active;
  tts.active = null;
  if (st) {
    st.playing = false;
    updatePlayer(st);
  }
  clearHighlights();
}

function setPos(st, pos) {
  st.pos = pos;
  if (!st.dragging) st.range.value = String(pos);
}

function updatePlayer(st) {
  st.btn.textContent = st.playing ? "⏸" : "🔊";
  st.btn.setAttribute("aria-label", st.playing ? "暫停朗讀" : "朗讀這段");
  st.btn.classList.toggle("on", st.playing);
}

// Speaks paragraph `st` starting at character offset `from`.
function speakFrom(st, from) {
  stopSpeaking();
  const gen = tts.gen;
  const { text, sents } = st;
  // Start at the beginning of the word under `from`.
  while (from > 0 && /\S/.test(text[from - 1])) from--;
  let i = sents.findIndex((s) => from < s.end);
  if (i < 0) {
    i = 0;
    from = 0;
  }

  tts.active = st;
  st.playing = true;
  updatePlayer(st);

  const next = () => {
    if (gen !== tts.gen) return;
    stopTimer();
    if (i >= sents.length) return finishPlayer(st);
    const s = sents[i];
    const start = Math.max(from, s.start);
    const u = makeUtterance(text.slice(start, s.end));
    let sawBoundary = false;

    u.onstart = () => {
      if (gen !== tts.gen) return;
      setPos(st, start);
      highlight("tts-sentence", st.p, s.start, s.end);
      highlight("tts-word");
      // Voices that don't report word positions: move the slider by an estimate.
      if (!tts.boundaryWorks) {
        const t0 = Date.now();
        const total = speechMs(s.end - start);
        tts.timer = setInterval(() => {
          if (gen !== tts.gen || sawBoundary) return clearInterval(tts.timer);
          const ms = Date.now() - t0;
          setPos(st, Math.min(s.end - 1, start + Math.round(((s.end - start) * ms) / total)));
          // Some voices report the end late; drop the highlight once it should be over.
          if (ms > total * 1.2 + 400) {
            stopTimer();
            clearHighlights();
          }
        }, 150);
      }
    };
    u.onboundary = (e) => {
      if (gen !== tts.gen || (e.name && e.name !== "word")) return;
      sawBoundary = true;
      tts.boundaryWorks = true;
      const at = start + e.charIndex;
      let len = e.charLength;
      if (!len) {
        const m = /^[\w'’-]+/.exec(text.slice(at));
        len = m ? m[0].length : 0;
      }
      setPos(st, at);
      highlight("tts-word", st.p, at, at + len);
      // Remove the word highlight when the word should be over, so it never
      // lingers. After the last word the sentence highlight goes too, because
      // some voices fire the end event well after the audio stops.
      const last = !/[A-Za-z0-9]/.test(text.slice(at + len, s.end));
      clearTimeout(tts.clearTimer);
      tts.clearTimer = setTimeout(() => {
        if (gen !== tts.gen) return;
        highlight("tts-word");
        if (last) highlight("tts-sentence");
      }, speechMs(len + 1) + (last ? 250 : 400));
    };
    u.onend = () => {
      if (gen !== tts.gen) return;
      clearHighlights();
      i++;
      next();
    };
    u.onerror = (e) => {
      if (gen !== tts.gen || e.error === "interrupted" || e.error === "canceled") return;
      i++;
      next();
    };
    tts.utter = u;
    speechSynthesis.speak(u);
  };
  next();
}

function finishPlayer(st) {
  stopTimer();
  tts.active = null;
  st.playing = false;
  setPos(st, 0);
  updatePlayer(st);
  clearHighlights();
}

// Speaks a single word or phrase (used when a highlighted word is tapped).
function speakWord(word) {
  if (!tts.supported) return;
  stopSpeaking();
  highlight("tts-word");
  tts.utter = makeUtterance(word);
  speechSynthesis.speak(tts.utter);
}

function rateLabel() {
  return tts.rate.toFixed(1) + "×";
}

// The speaker / slider / speed controls for one paragraph.
function buildPlayer(p, text) {
  const st = { p, text, sents: splitSentences(text), pos: 0, playing: false, dragging: false };

  st.btn = button("tts-btn", "🔊", () => {
    if (st.playing) stopSpeaking();
    else speakFrom(st, st.pos);
  });

  st.range = el("input", "tts-range");
  st.range.type = "range";
  st.range.min = "0";
  st.range.max = String(text.length);
  st.range.step = "1";
  st.range.value = "0";
  st.range.setAttribute("aria-label", "朗讀位置");
  st.range.addEventListener("input", () => {
    st.dragging = true;
    const pos = Number(st.range.value);
    const s = st.sents.find((x) => pos < x.end);
    if (s) highlight("tts-sentence", p, s.start, s.end);
  });
  st.range.addEventListener("change", () => {
    st.dragging = false;
    const pos = Number(st.range.value);
    if (st.playing) speakFrom(st, pos);
    else {
      st.pos = pos;
      clearHighlights();
    }
  });

  const rate = button("tts-rate", rateLabel(), () => {
    tts.rate = RATES[(RATES.indexOf(tts.rate) + 1) % RATES.length];
    try {
      localStorage.setItem(RATE_KEY, String(tts.rate));
    } catch (e) {}
    document.querySelectorAll(".tts-rate").forEach((b) => (b.textContent = rateLabel()));
    if (tts.active) speakFrom(tts.active, tts.active.pos);
  });
  rate.setAttribute("aria-label", "朗讀速度");

  updatePlayer(st);
  const row = el("div", "tts");
  row.append(st.btn, st.range, rate);
  return row;
}

async function renderArticle() {
  const main = document.getElementById("main");
  const params = new URLSearchParams(location.search);
  const date = params.get("d") || "";
  const n = Number(params.get("n") || 1);
  if (!/^[\w-]+$/.test(date)) return showError(main, "找不到這篇文章。");

  let day;
  try {
    day = await loadJson("data/" + date + ".json");
  } catch (e) {
    return showError(main, "找不到這篇文章。");
  }
  const a = day.articles[n - 1];
  if (!a) return showError(main, "找不到這篇文章。");
  const ref = date + "#" + n;

  document.title = a.title + " · Daily English News";
  document.getElementById("date").textContent = day.date;

  const reviewWords = (a.review || []).filter((r) => r.kind === "review");
  const items = a.vocab.concat(reviewWords.map((r) => ({ ...r, review: true })));

  const meta = el("div", "meta");
  meta.append(badge(a.level), el("span", null, a.category));
  if (a.story_date) meta.append(el("span", null, "News date: " + a.story_date));

  const zh = Array.isArray(a.paragraphs_zh) ? a.paragraphs_zh : [];
  const body = el("div", "body");
  const used = new Set();
  a.paragraphs.forEach((para, i) => {
    const block = el("div", "para");
    const p = buildParagraph(para, items, used);
    block.append(p);
    if (tts.supported) block.append(buildPlayer(p, para));
    if (zh[i]) {
      const t = el("p", "zh", zh[i]);
      t.hidden = true;
      const toggle = button("tbtn", "看翻譯", () => {
        t.hidden = !t.hidden;
        toggle.textContent = t.hidden ? "看翻譯" : "收起翻譯";
        toggle.setAttribute("aria-expanded", String(!t.hidden));
      });
      toggle.setAttribute("aria-expanded", "false");
      block.append(toggle, t);
    }
    body.append(block);
  });

  const sources = el("p", "sources", "Sources: ");
  a.sources.forEach((s, i) => {
    if (i) sources.append(" · ");
    const link = el("a", null, s.name);
    if (/^https?:\/\//.test(s.url)) link.href = s.url;
    link.target = "_blank";
    link.rel = "noopener";
    sources.append(link);
  });

  const list = el("ul", "vocab");
  for (const v of a.vocab) {
    const li = document.createElement("li");
    const head = el("div", "head");
    head.append(el("span", "w", v.word), el("span", "p", v.pos), el("span", "z", v.zh));
    head.append(button("mini", "＋ 標記", () => markWord(v.word, v.example || "", ref)));
    li.append(head);
    if (v.example) li.append(el("p", "e", v.example));
    list.append(li);
  }

  const parts = [
    meta,
    el("h1", null, a.title),
    el("p", "hint", "點標示的字看中文；長按（或選取）任何字可以加入單字本。"),
    body,
    sources,
    el("h2", null, "📚 Vocabulary"),
    list,
  ];

  if (reviewWords.length) {
    const rlist = el("ul", "vocab review");
    for (const r of reviewWords) {
      const li = document.createElement("li");
      const head = el("div", "head");
      head.append(el("span", "w", r.word), el("span", "z", r.zh));
      li.append(head);
      rlist.append(li);
    }
    parts.push(el("h2", null, "🔁 複習：你標記過的字"), rlist);
  }
  if ((day.review_cards || []).length) {
    parts.push(link("🔁 今日複習卡還有 " + day.review_cards.length + " 個字 →", reviewUrl(date), "card review-card"));
  }

  const pager = el("nav", "pager");
  const prev = day.articles[n - 2] ? el("a", null, "← Previous article") : el("span");
  const next = day.articles[n] ? el("a", null, "Next article →") : el("span");
  if (prev.tagName === "A") prev.href = articleUrl(date, n - 1);
  if (next.tagName === "A") next.href = articleUrl(date, n + 1);
  pager.append(prev, next);
  parts.push(pager);

  main.replaceChildren(...parts);
  setupPopover(items, ref);
  setupSelectionMark(ref);
}

// ---------- Daily review ----------

// Puts `word` in bold inside `sentence` (first match only).
function emphasize(sentence, word) {
  const p = el("p", "e");
  const re = new RegExp("(^|[^A-Za-z])(" + escapeRegExp(word) + ")(?![A-Za-z])", "i");
  const m = re.exec(sentence);
  if (!m) {
    p.textContent = sentence;
    return p;
  }
  const start = m.index + m[1].length;
  p.append(sentence.slice(0, start), el("strong", null, m[2]), sentence.slice(start + m[2].length));
  return p;
}

async function renderReview() {
  const main = document.getElementById("main");
  const date = new URLSearchParams(location.search).get("d") || "";
  if (!/^[\w-]+$/.test(date)) return showError(main, "找不到這一天的複習。");
  let day;
  try {
    day = await loadJson("data/" + date + ".json");
  } catch (e) {
    return showError(main, "找不到這一天的複習。");
  }
  document.getElementById("date").textContent = day.date;
  document.title = "Review " + day.date + " · Daily English News";

  const parts = [];
  const inArticles = [];
  day.articles.forEach((a, i) => {
    for (const r of a.review || []) if (r.kind === "review") inArticles.push({ ...r, n: i + 1 });
  });
  const cards = day.review_cards || [];
  if (!inArticles.length && !cards.length) return showError(main, "這一天沒有要複習的字。");

  if (inArticles.length) {
    parts.push(el("h2", null, "📰 寫進文章裡的（" + inArticles.length + "）"));
    const list = el("ul", "vocab review");
    for (const r of inArticles) {
      const li = document.createElement("li");
      const head = el("div", "head");
      head.append(el("span", "w", r.word), el("span", "z", r.zh));
      head.append(link("第 " + r.n + " 篇 →", articleUrl(day.date, r.n), "mini"));
      li.append(head);
      list.append(li);
    }
    parts.push(list);
  }

  if (cards.length) {
    parts.push(el("h2", null, "🃏 複習卡（" + cards.length + "）"));
    const list = el("ul", "vocab cards");
    for (const c of cards) {
      const li = el("li", "flip");
      const head = el("div", "head");
      head.append(el("span", "w", c.word), el("span", "p", c.pos || ""));
      const back = el("div", "back");
      back.hidden = true;
      back.append(el("p", "z", c.zh), el("p", "e-zh", c.example_zh));
      if (c.context) {
        const orig = el("p", "orig", "你標記時的句子：" + c.context);
        const url = wordRefUrl(c.source);
        if (url) orig.append(" ", link("原文", url));
        back.append(orig);
      }
      const toggle = button("tbtn", "看中文", () => {
        back.hidden = !back.hidden;
        toggle.textContent = back.hidden ? "看中文" : "收起";
        toggle.setAttribute("aria-expanded", String(!back.hidden));
      });
      toggle.setAttribute("aria-expanded", "false");
      li.append(head, emphasize(c.example, c.match || c.word), toggle, back);
      list.append(li);
    }
    parts.push(list);
  }
  main.replaceChildren(...parts);
}

// ---------- My words ----------

function reviewStatus(w) {
  const done = (w.reviews || []).length;
  if (w.priority === 1) return "較少見的字，只收在單字本，不排入複習";
  if (done >= SCHEDULE.length) return "已完成 3 次複習，之後會不定期出現";
  const next = addDays(w.marked_at, SCHEDULE[done]);
  if (next < studyDay()) return "已複習 " + done + "/3 · 排隊中，近期會排入";
  return "已複習 " + done + "/3 · 下次約 " + next;
}

function stars(priority) {
  return "★★★".slice(0, priority) + "☆☆☆".slice(0, 3 - priority);
}

function wordRefUrl(ref) {
  const m = /^([\w-]+)#(\d+)$/.exec(ref || "");
  return m ? articleUrl(m[1], m[2]) : null;
}

async function renderWords() {
  const main = document.getElementById("main");
  const tokenBox = document.getElementById("token");

  function renderTokenBox() {
    const has = !!getToken();
    tokenBox.replaceChildren(
      el("span", null, has ? "這台裝置已連結 GitHub。" : "這台裝置尚未連結 GitHub，只能瀏覽，不能標記或刪除。"),
      has
        ? button("btn", "移除金鑰", () => {
            if (confirm("要移除這台裝置上的金鑰嗎？")) {
              setToken("");
              renderTokenBox();
            }
          })
        : button("btn primary", "設定金鑰", async () => {
            if (await askToken()) load();
          })
    );
  }

  async function load() {
    renderTokenBox();
    let data;
    try {
      ({ data } = await readMarked());
    } catch (e) {
      if (e instanceof AuthError) {
        setToken("");
        renderTokenBox();
        return showError(main, "金鑰已失效，請重新設定。");
      }
      return showError(main, "無法載入單字本。");
    }
    const words = (data.words || []).slice().sort((x, y) => (y.marked_at || "").localeCompare(x.marked_at || ""));
    if (!words.length) return showError(main, "還沒有標記任何字。在文章裡長按一個字就能加進來。");

    const kept = words.filter((w) => w.priority === 1).length;
    const learning = words.filter((w) => w.priority !== 1 && (w.reviews || []).length < SCHEDULE.length).length;
    main.replaceChildren(el("p", "summary", "共 " + words.length + " 個字 · 複習中 " + learning
      + " · 已完成 " + (words.length - learning - kept) + " · 只收藏 " + kept));

    const list = el("ul", "vocab words");
    for (const w of words) {
      const li = document.createElement("li");
      const head = el("div", "head");
      head.append(el("span", "w", w.base || w.word));
      if (w.pos) head.append(el("span", "p", w.pos));
      head.append(el("span", w.zh ? "z" : "z pending", w.zh || "明早補上翻譯"));
      if (w.priority) {
        const s = el("span", "stars", stars(w.priority));
        s.title = "重要度 " + w.priority + "/3（依多益與一般常用程度自動評估）";
        head.append(s);
      }
      li.append(head);
      if (w.context) li.append(el("p", "e", w.context));
      const foot = el("div", "word-foot");
      const info = el("span", null, "標記於 " + w.marked_at + " · " + reviewStatus(w));
      foot.append(info);
      const url = wordRefUrl(w.article);
      if (url) {
        const link = el("a", null, "原文");
        link.href = url;
        foot.append(link);
      }
      if (getToken()) {
        foot.append(button("mini danger", "刪除", async () => {
          if (!confirm("要從單字本刪除「" + w.word + "」嗎？")) return;
          toast("刪除中…");
          try {
            await updateMarked((d) => {
              const before = d.words.length;
              d.words = d.words.filter((x) => x.id !== w.id);
              if (d.words.length === before) return false;
            }, "Remove word: " + w.word);
            toast("已刪除「" + w.word + "」");
            load();
          } catch (e) {
            toast(e instanceof AuthError ? "金鑰已失效，請重新設定" : "刪除失敗，請稍後再試");
          }
        }));
      }
      li.append(foot);
      list.append(li);
    }
    main.append(list);
  }

  load();
}
