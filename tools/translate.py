"""Fill in the Chinese meaning of newly marked words right after they are saved.

Used by .github/workflows/translate.yml:

  python3 tools/translate.py pending
      Prints a JSON list of words that still have no Chinese meaning
      (id, word, context), at most MAX_BATCH of them, oldest first.

  python3 tools/translate.py apply RESULT.json
      RESULT.json is {"words": [{"id", "zh", "pos", "base"}, ...]}.
      Writes zh, pos and base into data/marked.json for words that still have
      no meaning. Entries that fail the checks are skipped, so a bad answer
      only leaves that word for the morning routine. Then merges any newly
      translated word whose dictionary form matches an older entry (e.g.
      "sought" after "seek") into that entry as a repeat mark, the same way
      the site records marking a word again. Prints how many changed.

Priority (stars) is left to the morning routine.
"""
import json
import re
import sys
from pathlib import Path

MARKED = Path(__file__).resolve().parent.parent / "data" / "marked.json"
POS = {"n.", "v.", "adj.", "adv.", "phr."}
CJK = re.compile(r"[一-鿿]")
MAX_BATCH = 40


def load():
    return json.loads(MARKED.read_text(encoding="utf-8"))


def pending(data):
    return [{"id": w["id"], "word": w["word"], "context": w.get("context", "")}
            for w in data["words"] if not w.get("zh")][:MAX_BATCH]


def apply(data, result):
    by_id = {w["id"]: w for w in data["words"]}
    changed = 0
    for r in result.get("words", []):
        w = by_id.get(r.get("id"))
        zh = str(r.get("zh", "")).strip()
        pos = str(r.get("pos", "")).strip()
        base = str(r.get("base", "")).strip()
        if not w or w.get("zh") or not CJK.search(zh) or len(zh) > 40:
            continue
        w["zh"] = zh
        if pos in POS and not w.get("pos"):
            w["pos"] = pos
        if base and len(base) <= 60 and not CJK.search(base) and not w.get("base"):
            w["base"] = base
        changed += 1
    return changed + merge_duplicates(data)


def key(w):
    return (w.get("base") or w["word"]).strip().lower()


def refs(w):
    return {w.get("article")} | {m.get("article") for m in w.get("marks", [])}


def merge_duplicates(data):
    """Fold a later entry into an earlier one with the same dictionary form.
    Only entries with a translation (so with a base form) are compared. The
    later entry becomes a repeat mark of the earlier one; if it came from a
    later day the earlier word's review round starts over that day."""
    first = {}
    keep = []
    merged = 0
    for w in data["words"]:
        if not w.get("zh"):
            keep.append(w)
            continue
        old = first.get(key(w))
        if old is None:
            first[key(w)] = w
            keep.append(w)
            continue
        marks = [{"marked_at": w["marked_at"], "context": w.get("context", ""), "article": w.get("article", "")}]
        marks += w.get("marks", [])
        for m in marks:
            if m["article"] in refs(old):
                continue
            old.setdefault("marks", []).append(m)
            if m["marked_at"] > (old.get("cycle_start") or old["marked_at"]):
                old["cycle_start"] = m["marked_at"]
        merged += 1
    data["words"] = keep
    return merged


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "pending":
        print(json.dumps(pending(load()), ensure_ascii=False))
    elif len(sys.argv) == 3 and sys.argv[1] == "apply":
        data = load()
        result = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8") or "{}")
        changed = apply(data, result)
        if changed:
            MARKED.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(changed)
    else:
        sys.exit("usage: translate.py pending | apply RESULT.json")


if __name__ == "__main__":
    main()
