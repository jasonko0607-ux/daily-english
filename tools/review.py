"""Plan which marked words to review today.

Usage: python3 tools/review.py YYYY-MM-DD

Prints JSON with:
  due           words whose next spaced review (3, 7, 14 days after marking)
                has arrived, most urgent first, at most DAILY_MAX of them.
                Urgency = priority (1-3, 3 = most important) plus one point
                for every AGING_DAYS days the review is late, so a minor word
                that keeps getting postponed still gets its turn. Words with
                priority 1 (rare or specialised) are never scheduled; they
                only stay in the word list.
                Weave up to ARTICLE_MAX of them into the articles (kind
                "review"), taking them from the top of the list where they fit
                naturally; put every other word in this list in review_cards.
  postponed     how many more words are due but wait for a later day.
  casual        at most one word that finished its three reviews and has not
                appeared for 21+ days. Use it with kind "casual" if there is room.
  missing_info  words that still need a Chinese translation and/or a priority
                (marked_updates).
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

MARKED = Path(__file__).resolve().parent.parent / "data" / "marked.json"
SCHEDULE = [3, 7, 14]
CASUAL_GAP = 21
ARTICLE_MAX = 9
DAILY_MAX = 25
AGING_DAYS = 3
DEFAULT_PRIORITY = 2
MIN_REVIEW_PRIORITY = 2  # priority-1 (rare) words are kept but not reviewed


def load_words():
    return json.loads(MARKED.read_text(encoding="utf-8"))["words"] if MARKED.exists() else []


def plan(today, words):
    due, casual = [], []
    for w in words:
        # Ignore a use recorded for today, so re-running a day gives the same plan.
        past = sorted(d for d in w.get("reviews", []) if date.fromisoformat(d) < today)
        priority = w.get("priority") or DEFAULT_PRIORITY
        if priority < MIN_REVIEW_PRIORITY:
            continue  # rare words stay in the word list but are never scheduled
        item ={"id": w["id"], "word": w.get("base") or w["word"], "pos": w.get("pos", ""),
                "zh": w.get("zh", ""), "context": w.get("context", ""), "priority": priority}
        if len(past) < len(SCHEDULE):
            due_on = date.fromisoformat(w["marked_at"]) + timedelta(days=SCHEDULE[len(past)])
            if due_on <= today:
                late = (today - due_on).days
                due.append({**item, "review_number": len(past) + 1, "due_on": due_on.isoformat(),
                            "days_late": late, "urgency": round(priority + late / AGING_DAYS, 2)})
        elif (today - date.fromisoformat(past[-1])).days >= CASUAL_GAP:
            casual.append({**item, "last_used": past[-1]})

    due.sort(key=lambda x: (-x["urgency"], x["due_on"], x["id"]))
    casual.sort(key=lambda x: (-x["priority"], x["last_used"]))
    missing = [{"id": w["id"], "word": w["word"], "context": w.get("context", ""),
                "needs": [k for k in ("zh", "priority") if not w.get(k)]}
               for w in words if not w.get("zh") or not w.get("priority")]
    return {"date": today.isoformat(), "article_max": ARTICLE_MAX,
            "due": due[:DAILY_MAX], "postponed": max(0, len(due) - DAILY_MAX),
            "casual": casual[:1], "missing_info": missing}


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python3 tools/review.py YYYY-MM-DD")
    result = plan(date.fromisoformat(sys.argv[1]), load_words())
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
