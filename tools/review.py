"""List the marked words to use in today's articles.

Usage: python3 tools/review.py YYYY-MM-DD

Prints JSON with:
  due         words whose next spaced review (3, 7, 14 days after marking)
              has arrived, oldest first. Use these with kind "review".
  casual      at most one word that finished its three reviews and has not
              appeared for 21+ days. Use it with kind "casual" if there is room.
  missing_zh  words that still need a Chinese translation (marked_updates).
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

MARKED = Path(__file__).resolve().parent.parent / "data" / "marked.json"
SCHEDULE = [3, 7, 14]
CASUAL_GAP = 21


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python3 tools/review.py YYYY-MM-DD")
    today = date.fromisoformat(sys.argv[1])
    words = json.loads(MARKED.read_text(encoding="utf-8"))["words"] if MARKED.exists() else []

    due, casual = [], []
    for w in words:
        # Ignore a use recorded for today, so re-running a day gives the same plan.
        past = sorted(d for d in w.get("reviews", []) if date.fromisoformat(d) < today)
        item = {"id": w["id"], "word": w.get("base") or w["word"], "context": w.get("context", ""),
                "zh": w.get("zh", "")}
        if len(past) < len(SCHEDULE):
            due_on = date.fromisoformat(w["marked_at"]) + timedelta(days=SCHEDULE[len(past)])
            if due_on <= today:
                due.append({**item, "review_number": len(past) + 1, "due_on": due_on.isoformat()})
        elif (today - date.fromisoformat(past[-1])).days >= CASUAL_GAP:
            casual.append({**item, "last_used": past[-1]})

    due.sort(key=lambda x: x["due_on"])
    casual.sort(key=lambda x: x["last_used"])
    missing = [{"id": w["id"], "word": w["word"], "context": w.get("context", "")}
               for w in words if not w.get("zh")]
    print(json.dumps({"date": today.isoformat(), "due": due, "casual": casual[:1],
                      "missing_zh": missing}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
