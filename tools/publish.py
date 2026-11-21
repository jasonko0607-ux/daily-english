"""Validate one day's articles and add them to the site.

Usage: python3 tools/publish.py path/to/day.json

Writes data/<date>.json, updates data/index.json (newest day first) and
records review-word usage (articles and review cards), translations and
priorities in data/marked.json.
Exits with an error message if the input does not follow the schema.
Running it again for the same date replaces that issue cleanly.
"""
import json
import re
import sys
from datetime import date as Date
from pathlib import Path

from review import ARTICLE_MAX, plan
from topics import CATEGORIES, load_index, previous_categories, recent, topic_tokens

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MARKED = DATA / "marked.json"
LEVELS = {"600–800", "800+"}
POS = {"n.", "v.", "adj.", "adv.", "phr."}
KINDS = {"review", "casual"}
MAX_REVIEW_PER_ARTICLE = 4
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


def check_topics(day):
    """Every article needs an allowed category and a topic key. Categories must
    differ from each other and from the previous issue; a topic may not repeat
    one from the last few days. A topic key that shares two or more meaningful
    words with a recent one is treated as the same story unless the article
    explains its different angle in "new_angle"."""
    today = Date.fromisoformat(day["date"])
    index = load_index()
    past = recent(today, index)
    blocked = set(previous_categories(today, index))
    seen_cats, seen_topics = set(), set()
    for i, a in enumerate(day["articles"], 1):
        where = f"article {i}: "
        cat = a.get("category")
        if cat not in CATEGORIES:
            fail(where + f"category must be one of {CATEGORIES}")
        if cat in seen_cats:
            fail(where + f"category {cat!r} is used twice today")
        if cat in blocked:
            fail(where + f"category {cat!r} was used in the previous issue; pick another (tools/topics.py)")
        seen_cats.add(cat)
        topic = a.get("topic")
        if not isinstance(topic, str) or not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", topic):
            fail(where + "topic must be a lowercase kebab-case key naming the specific story, e.g. 'putin-xi-trump-summit'")
        if topic in seen_topics:
            fail(where + f"topic {topic!r} is used twice today")
        seen_topics.add(topic)
        for p in past:
            if not p["topic"]:
                continue
            if p["topic"] == topic:
                fail(where + f"topic {topic!r} already ran on {p['date']} ({p['title']}); pick a different story")
            shared = topic_tokens(topic) & topic_tokens(p["topic"])
            if len(shared) >= 2 and not str(a.get("new_angle", "")).strip():
                fail(where + f"topic {topic!r} looks like {p['topic']!r} from {p['date']} ({p['title']}),"
                     f" sharing {sorted(shared)}. Pick a different story, or, if this is a genuinely different"
                     " angle on a broad issue (not a follow-up of the same event), say how in 'new_angle'")


def check(day, marked):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(day.get("date", ""))):
        fail("date must be YYYY-MM-DD")
    articles = day.get("articles")
    if not isinstance(articles, list) or len(articles) != 3:
        fail("articles must be a list of exactly 3")
    if [a.get("level") for a in articles].count("800+") != 1:
        fail("exactly one article must have level '800+'")

    check_topics(day)

    ids = {w["id"] for w in marked["words"]}
    today = plan(Date.fromisoformat(day["date"]), marked["words"])
    due_ids = [d["id"] for d in today["due"]]
    casual_ids = {c["id"] for c in today["casual"]}
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
        if sum(r.get("kind") == "review" for r in review) > MAX_REVIEW_PER_ARTICLE:
            fail(where + f"at most {MAX_REVIEW_PER_ARTICLE} review words per article")
        for r in review:
            rid = r.get("id")
            if rid not in ids:
                fail(where + f"review id {rid!r} is not in data/marked.json")
            if rid in used_ids:
                fail(where + f"review id {rid!r} is used more than once today")
            used_ids.add(rid)
            if r.get("kind") not in KINDS:
                fail(where + f"review {rid!r}: kind must be one of {sorted(KINDS)}")
            if r["kind"] == "review" and rid not in due_ids:
                fail(where + f"review {rid!r} is not in today's due list (tools/review.py)")
            if r["kind"] == "casual" and rid not in casual_ids:
                fail(where + f"casual {rid!r} is not today's casual word (tools/review.py)")
            if not r.get("word") or not r.get("match") or not r.get("zh"):
                fail(where + f"review {rid!r} needs word, match and zh")
            if not appears(r["match"], text):
                fail(where + f"review {rid!r}: {r['match']!r} does not appear in the body")
            review_total += r["kind"] == "review"
    if review_total > ARTICLE_MAX:
        fail(f"{review_total} review words in the articles; the maximum is {ARTICLE_MAX}")

    cards = day.get("review_cards", [])
    if not isinstance(cards, list):
        fail("review_cards must be a list")
    for c in cards:
        cid = c.get("id")
        where = f"review card {cid!r}: "
        if cid not in due_ids:
            fail(where + "is not in today's due list (tools/review.py)")
        if cid in used_ids:
            fail(where + "is already used today")
        used_ids.add(cid)
        if not c.get("word") or not c.get("zh") or c.get("pos") not in POS:
            fail(where + f"needs word, zh and pos {sorted(POS)}")
        example = str(c.get("example", ""))
        if CJK.search(example) or not re.search(r"[.!?][\"”’)]?$", example.strip()):
            fail(where + "example must be one complete English sentence")
        if not appears(c.get("match") or c["word"], example):
            fail(where + "the word does not appear in the example; set 'match' to the exact form used")
        if not CJK.search(str(c.get("example_zh", ""))):
            fail(where + "example_zh must be a Chinese translation of the example")
    missed = [d["word"] for d in today["due"] if d["id"] not in used_ids]
    if missed:
        fail("these due words are neither in an article nor in review_cards: " + ", ".join(missed))

    updates = day.get("marked_updates", {})
    if not isinstance(updates, dict):
        fail("marked_updates must be an object keyed by marked word id")
    for rid, u in updates.items():
        if rid not in ids:
            fail(f"marked_updates: id {rid!r} is not in data/marked.json")
        has_zh = any(w["id"] == rid and w.get("zh") for w in marked["words"])
        if (u.get("zh") or not has_zh) and not CJK.search(str(u.get("zh", ""))):
            fail(f"marked_updates {rid!r}: zh must be a Chinese translation")
        if u.get("pos") and u["pos"] not in POS:
            fail(f"marked_updates {rid!r}: pos must be one of {sorted(POS)}")
        if "priority" in u and u["priority"] not in (1, 2, 3):
            fail(f"marked_updates {rid!r}: priority must be 1, 2 or 3")


def used_today(day):
    ids = {r["id"] for a in day["articles"] for r in a.get("review", [])}
    return ids | {c["id"] for c in day.get("review_cards", [])}


def update_marked(day, marked):
    date = day["date"]
    used = used_today(day)
    for w in marked["words"]:
        reviews = [d for d in w.get("reviews", []) if d != date]  # replacing an issue resets that day
        if w["id"] in used:
            reviews.append(date)
        w["reviews"] = sorted(reviews)
        u = day.get("marked_updates", {}).get(w["id"])
        if u:
            for key in ("zh", "pos", "base", "priority"):
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
    contexts = {w["id"]: w for w in marked["words"]}
    for c in stored.get("review_cards", []):
        w = contexts[c["id"]]
        c["context"] = w.get("context", "")
        c["source"] = w.get("article", "")
    (DATA / f"{day['date']}.json").write_text(
        json.dumps(stored, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    index_path = DATA / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else []
    index = [d for d in index if d["date"] != day["date"]]
    index.append({
        "date": day["date"],
        "reviews": len(used_today(day)),
        "articles": [
            {"n": n, "level": a["level"], "category": a["category"], "topic": a["topic"],
             "title": a["title"]}
            for n, a in enumerate(day["articles"], 1)
        ],
    })
    index.sort(key=lambda d: d["date"], reverse=True)
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    update_marked(day, marked)
    MARKED.write_text(json.dumps(marked, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    in_articles = sum(len(a.get("review", [])) for a in day["articles"])
    print(f"published {day['date']}: " + " | ".join(a["title"] for a in day["articles"])
          + f" ({in_articles} review words in articles, {len(day.get('review_cards', []))} review cards,"
          + f" {len(day.get('marked_updates', {}))} marked words updated)")


if __name__ == "__main__":
    main()
