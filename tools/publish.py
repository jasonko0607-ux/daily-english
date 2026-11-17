"""Validate one day's articles and add them to the site.

Usage: python3 tools/publish.py path/to/day.json

Writes data/<date>.json, updates data/index.json (newest day first) and
records review-word usage and new translations in data/marked.json.
Exits with an error message if the input does not follow the schema.
Running it again for the same date replaces that issue cleanly.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MARKED = DATA / "marked.json"
LEVELS = {"600–800", "800+"}
POS = {"n.", "v.", "adj.", "adv.", "phr."}
KINDS = {"review", "casual"}
MAX_REVIEW_PER_DAY = 5
CJK = re.compile(r"[一-鿿]")


def fail(msg):
    sys.exit("publish.py: " + msg)


def appears(needle, text):
    return re.search(r"(^|[^A-Za-z])" + re.escape(needle) + r"(?![A-Za-z])", text, re.I) is not None


def load_marked():
    if MARKED.exists():
        data = json.loads(MARKED.read_text(encoding="utf-8"))
        data.setdefault("words", [])
        return data
    return {"words": []}


def check(day, marked):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(day.get("date", ""))):
        fail("date must be YYYY-MM-DD")
    articles = day.get("articles")
    if not isinstance(articles, list) or len(articles) != 3:
        fail("articles must be a list of exactly 3")
    if [a.get("level") for a in articles].count("800+") != 1:
        fail("exactly one article must have level '800+'")

    ids = {w["id"] for w in marked["words"]}
    used_ids = set()
    review_total = 0
    for i, a in enumerate(articles, 1):
        where = f"article {i}: "
        if a.get("level") not in LEVELS:
            fail(where + f"level must be one of {sorted(LEVELS)}")
        for key in ("category", "title"):
            if not isinstance(a.get(key), str) or not a[key].strip():
                fail(where + key + " is missing")
        paras = a.get("paragraphs")
        if not isinstance(paras, list) or not 3 <= len(paras) <= 6:
            fail(where + "paragraphs must be a list of 3-6 strings")
        text = " ".join(paras)
        words = len(text.split())
        if not 230 <= words <= 380:
            fail(where + f"body is {words} words; expected 250-350")
        if CJK.search(text + a["title"]):
            fail(where + "title and body must be English only")
        zh = a.get("paragraphs_zh")
        if not isinstance(zh, list) or len(zh) != len(paras):
            fail(where + "paragraphs_zh must have one Chinese translation per paragraph")
        if not all(isinstance(z, str) and CJK.search(z) for z in zh):
            fail(where + "every paragraphs_zh entry must be a Chinese translation")
        sources = a.get("sources")
        if not isinstance(sources, list) or not sources:
            fail(where + "at least one source is required")
        for s in sources:
            if not s.get("name") or not re.match(r"https?://", str(s.get("url", ""))):
                fail(where + "each source needs a name and an http(s) url")
        vocab = a.get("vocab")
        if not isinstance(vocab, list) or not 8 <= len(vocab) <= 12:
            fail(where + "vocab must have 8-12 items")
        for v in vocab:
            word = v.get("word", "")
            if not word or v.get("pos") not in POS or not v.get("zh") or not v.get("example"):
                fail(where + f"vocab item {word!r} needs word, pos {sorted(POS)}, zh and example")
            needle = v.get("match") or word
            if not appears(needle, text):
                fail(where + f"vocab {word!r}: {needle!r} does not appear in the body; set 'match' to the exact form used")
        review = a.get("review", [])
        if not isinstance(review, list):
            fail(where + "review must be a list")
        for r in review:
            rid = r.get("id")
            if rid not in ids:
                fail(where + f"review id {rid!r} is not in data/marked.json")
            if rid in used_ids:
                fail(where + f"review id {rid!r} is used more than once today")
            used_ids.add(rid)
            if r.get("kind") not in KINDS:
                fail(where + f"review {rid!r}: kind must be one of {sorted(KINDS)}")
            if not r.get("word") or not r.get("match") or not r.get("zh"):
                fail(where + f"review {rid!r} needs word, match and zh")
            if not appears(r["match"], text):
                fail(where + f"review {rid!r}: {r['match']!r} does not appear in the body")
            review_total += 1
    if review_total > MAX_REVIEW_PER_DAY:
        fail(f"{review_total} review words today; the maximum is {MAX_REVIEW_PER_DAY}")

    updates = day.get("marked_updates", {})
    if not isinstance(updates, dict):
        fail("marked_updates must be an object keyed by marked word id")
    for rid, u in updates.items():
        if rid not in ids:
            fail(f"marked_updates: id {rid!r} is not in data/marked.json")
        if not CJK.search(str(u.get("zh", ""))):
            fail(f"marked_updates {rid!r}: zh must be a Chinese translation")
        if u.get("pos") and u["pos"] not in POS:
            fail(f"marked_updates {rid!r}: pos must be one of {sorted(POS)}")


def update_marked(day, marked):
    date = day["date"]
    used = {r["id"] for a in day["articles"] for r in a.get("review", [])}
    for w in marked["words"]:
        reviews = [d for d in w.get("reviews", []) if d != date]  # replacing an issue resets that day
        if w["id"] in used:
            reviews.append(date)
        w["reviews"] = sorted(reviews)
        u = day.get("marked_updates", {}).get(w["id"])
        if u:
            for key in ("zh", "pos", "base"):
                if u.get(key):
                    w[key] = u[key]


def main():
    if len(sys.argv) != 2:
        fail("usage: python3 tools/publish.py day.json")
    day = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    marked = load_marked()
    check(day, marked)

    DATA.mkdir(exist_ok=True)
    stored = {k: v for k, v in day.items() if k != "marked_updates"}
    (DATA / f"{day['date']}.json").write_text(
        json.dumps(stored, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    index_path = DATA / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else []
    index = [d for d in index if d["date"] != day["date"]]
    index.append({
        "date": day["date"],
        "articles": [
            {"n": n, "level": a["level"], "category": a["category"], "title": a["title"]}
            for n, a in enumerate(day["articles"], 1)
        ],
    })
    index.sort(key=lambda d: d["date"], reverse=True)
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    update_marked(day, marked)
    MARKED.write_text(json.dumps(marked, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    reviews = sum(len(a.get("review", [])) for a in day["articles"])
    print(f"published {day['date']}: " + " | ".join(a["title"] for a in day["articles"])
          + f" ({reviews} review words, {len(day.get('marked_updates', {}))} translations added)")


if __name__ == "__main__":
    main()
