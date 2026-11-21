"""Show recent stories and categories so a new issue does not repeat them.

Usage: python3 tools/topics.py YYYY-MM-DD

Prints JSON with:
  recent       every article from the TOPIC_DAYS days before DATE
               (date, category, topic, title), newest first. Today's stories
               must not continue any of these topics; a different angle on a
               broad issue is fine but needs "new_angle" (see publish.py).
  blocked      categories used in the previous issue; none of them may be used
               today.
  categories   every allowed category with the days since it was last used
               (null = not in the last CATEGORY_LOOKBACK days), least recently
               used first. Prefer the top of this list.
"""
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

INDEX = Path(__file__).resolve().parent.parent / "data" / "index.json"
TOPIC_DAYS = 7
CATEGORY_LOOKBACK = 14
CATEGORIES = [
    "International", "Business", "Technology", "Taiwan", "Science", "Health",
    "Environment", "Lifestyle", "Culture", "Sports", "Odd News",
]
# Words that say nothing about which story it is, ignored when comparing topic keys.
GENERIC = {
    "the", "a", "an", "of", "and", "in", "on", "for", "to", "with", "new", "us",
    "talks", "deal", "plan", "news", "report", "update", "crisis", "war", "market",
    "markets", "policy", "global", "world", "economy", "rise", "fall", "ban",
}


def load_index():
    return json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else []


def topic_tokens(topic):
    return {t for t in re.split(r"[^a-z0-9]+", str(topic).lower()) if len(t) > 1 and t not in GENERIC}


def recent(today, index, days=TOPIC_DAYS):
    out = []
    for d in index:
        day = date.fromisoformat(d["date"])
        if today - timedelta(days=days) <= day < today:
            for a in d["articles"]:
                out.append({"date": d["date"], "category": a["category"],
                            "topic": a.get("topic", ""), "title": a["title"]})
    out.sort(key=lambda a: a["date"], reverse=True)
    return out


def previous_categories(today, index):
    earlier = [d for d in index if d["date"] < today.isoformat()]
    if not earlier:
        return []
    last = max(earlier, key=lambda d: d["date"])
    if (today - date.fromisoformat(last["date"])).days > 1:
        return []  # only the issue of the day before counts
    return sorted({a["category"] for a in last["articles"]})


def report(today, index):
    last_used = {}
    for a in recent(today, index, CATEGORY_LOOKBACK):
        last_used.setdefault(a["category"], (today - date.fromisoformat(a["date"])).days)
    cats = [{"category": c, "days_since": last_used.get(c)} for c in CATEGORIES]
    cats.sort(key=lambda c: -(c["days_since"] if c["days_since"] is not None else 999))
    return {"date": today.isoformat(), "recent": recent(today, index),
            "blocked": previous_categories(today, index), "categories": cats}


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python3 tools/topics.py YYYY-MM-DD")
    print(json.dumps(report(date.fromisoformat(sys.argv[1]), load_index()), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
