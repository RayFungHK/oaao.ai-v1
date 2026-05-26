"""Local-only Python mirror of scripts/sql_injection_guard.sh (W11-S2)."""
import re
import pathlib
import sys

root = pathlib.Path("backbone/sites/oaaoai/oaaoai")
pat = re.compile(
    r"[\"'][^\"']*\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\b"
    r"[^\"']*[^{]\$[a-zA-Z_][a-zA-Z0-9_]*[^\"']*[\"']",
    re.IGNORECASE,
)
allow = ["mine/default/library/MineStorage.php"]
hits = []
for p in root.rglob("*.php"):
    try:
        for i, line in enumerate(
            p.read_text(encoding="utf-8", errors="ignore").splitlines(), 1
        ):
            if pat.search(line):
                rel = str(p).replace("\\", "/").split(
                    "backbone/sites/oaaoai/oaaoai/", 1
                )[-1]
                if any(a in rel for a in allow):
                    continue
                hits.append(f"{rel}:{i}: {line.strip()[:140]}")
    except Exception:
        pass
print(f"Hits: {len(hits)}")
for h in hits[:30]:
    print(h)
sys.exit(1 if hits else 0)
