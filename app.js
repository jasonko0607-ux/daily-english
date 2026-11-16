// Renders the home page and article pages from the JSON files in data/.
// All content is inserted as text nodes, never as HTML.

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function badge(level) {
  const high = level.includes("800+");
  return el("span", "badge " + (high ? "high" : "mid"), "TOEIC " + level);
}

function articleUrl(date, n) {
  return "article.html?d=" + encodeURIComponent(date) + "&n=" + n;
}

async function loadJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(path + " " + res.status);
  return res.json();
}

function showError(main, message) {
  main.replaceChildren(el("p", "empty", message));
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
    main.append(section);
  }
}

// ---------- Article ----------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Splits a paragraph into text and vocabulary buttons. Each vocabulary item is
// marked once, at its first appearance in the article.
function buildParagraph(text, vocab, used) {
  const p = document.createElement("p");
  const hits = [];
  vocab.forEach((v, i) => {
    if (used.has(i)) return;
    const needle = v.match || v.word;
    const m = new RegExp("(?<![A-Za-z])" + escapeRegExp(needle) + "(?![A-Za-z])", "i").exec(text);
    if (m) hits.push({ start: m.index, end: m.index + m[0].length, i });
  });
  hits.sort((a, b) => a.start - b.start);

  let pos = 0;
  for (const h of hits) {
    if (h.start < pos) continue; // overlaps an earlier mark
    used.add(h.i);
    p.append(text.slice(pos, h.start));
    const b = el("button", "vw", text.slice(h.start, h.end));
    b.type = "button";
    b.dataset.i = h.i;
    p.append(b);
    pos = h.end;
  }
  p.append(text.slice(pos));
  return p;
}

function setupPopover(vocab) {
  const pop = document.getElementById("pop");
  let current = null;

  function hide() {
    pop.hidden = true;
    current = null;
  }

  document.addEventListener("click", (ev) => {
    const b = ev.target.closest(".vw");
    if (!b || b === current) return hide();
    const v = vocab[Number(b.dataset.i)];
    pop.replaceChildren(el("span", "w", v.word), el("span", "p", v.pos), el("span", "z", v.zh));
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

  document.title = a.title + " · Daily English News";
  document.getElementById("date").textContent = day.date;

  const meta = el("div", "meta");
  meta.append(badge(a.level), el("span", null, a.category));
  if (a.story_date) meta.append(el("span", null, "News date: " + a.story_date));

  const body = el("div", "body");
  const used = new Set();
  for (const para of a.paragraphs) body.append(buildParagraph(para, a.vocab, used));

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
    li.append(head);
    if (v.example) li.append(el("p", "e", v.example));
    list.append(li);
  }

  const pager = el("nav", "pager");
  const prev = day.articles[n - 2] ? el("a", null, "← Previous article") : el("span");
  const next = day.articles[n] ? el("a", null, "Next article →") : el("span");
  if (prev.tagName === "A") prev.href = articleUrl(date, n - 1);
  if (next.tagName === "A") next.href = articleUrl(date, n + 1);
  pager.append(prev, next);

  main.replaceChildren(
    meta,
    el("h1", null, a.title),
    el("p", "hint", "點一下標示的單字可以看中文解釋。"),
    body,
    sources,
    el("h2", null, "📚 Vocabulary"),
    list,
    pager
  );
  setupPopover(a.vocab);
}
