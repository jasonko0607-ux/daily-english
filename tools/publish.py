"""Validate one day's articles and add them to the site.

Usage: python3 tools/publish.py path/to/day.json

Writes data/<date>.json and updates data/index.json (newest day first).
Exits with an error message if the input does not follow the schema.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
LEVELS = {"600–800", "800+"}
POS = {"n.", "v.", "adj.", "adv.", "phr."}


def fail(msg):
    sys.exit("publish.py: " + msg)


def check(day):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(day.get("date", ""))):
        fail("date must be YYYY-MM-DD")
    articles = day.get("articles")
    if not isinstance(articles, list) or len(articles) != 3:
        fail("articles must be a list of exactly 3")
    if [a.get("level") for a in articles].count("800+") != 1:
        fail("exactly one article must have level '800+'")
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
        if re.search(r"[一-鿿]", text + a["title"]):
            fail(where + "title and body must be English only")
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
            if needle.lower() not in text.lower():
                fail(where + f"vocab {word!r}: {needle!r} does not appear in the body; set 'match' to the exact form used")


def main():
    if len(sys.argv) != 2:
        fail("usage: python3 tools/publish.py day.json")
    day = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    check(day)

    DATA.mkdir(exist_ok=True)
    (DATA / f"{day['date']}.json").write_text(
        json.dumps(day, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
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
    print(f"published {day['date']}: " + " | ".join(a["title"] for a in day["articles"]))


if __name__ == "__main__":
    main()
