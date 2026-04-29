"""
Fix multi-line `let _ = expr;` -> `drop(expr);` for warnings reported in check.log.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent / "jolkr-server"
LOG = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "check.log"


def parse_locations(log_path: Path):
    text = log_path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    locs = set()
    for i, line in enumerate(lines):
        if line == "warning: non-binding let on a type that has a destructor":
            if i + 1 < len(lines):
                m = re.match(r"^\s*--> (crates/[^:]+):(\d+):", lines[i + 1])
                if m:
                    locs.add((m.group(1), int(m.group(2))))
    return locs


def fix_file(path: Path, line_numbers: set[int]) -> int:
    text = path.read_text(encoding="utf-8")
    src = text.split("\n")
    fixed = 0

    for ln in sorted(line_numbers, reverse=True):  # apply bottom-up to keep indices stable
        idx = ln - 1
        if idx < 0 or idx >= len(src):
            continue
        line = src[idx]
        m = re.match(r"^(\s*)let\s+_\s*=\s*(.*)$", line)
        if not m:
            continue
        indent, after_eq = m.group(1), m.group(2)

        # Find the terminating `;` for this statement (could be on the same line or later)
        # Track balance of parens/brackets to know when the statement ends.
        balance_round = 0
        balance_square = 0
        balance_curly = 0
        end_idx = None
        end_col = None
        cur_line = after_eq
        i = idx
        offset_in_line = len(indent) + len("let _ = ")  # position where we start scanning
        # Scan character by character starting from `after_eq` on line idx
        scan_buf = after_eq
        cur_offset = 0
        first = True
        line_cursor = i
        while True:
            for j, ch in enumerate(scan_buf):
                if ch == '(':
                    balance_round += 1
                elif ch == ')':
                    balance_round -= 1
                elif ch == '[':
                    balance_square += 1
                elif ch == ']':
                    balance_square -= 1
                elif ch == '{':
                    balance_curly += 1
                elif ch == '}':
                    balance_curly -= 1
                elif ch == ';' and balance_round == 0 and balance_square == 0 and balance_curly == 0:
                    end_idx = line_cursor
                    end_col = j
                    break
            if end_idx is not None:
                break
            line_cursor += 1
            if line_cursor >= len(src):
                break
            scan_buf = src[line_cursor]
        if end_idx is None:
            continue

        # Apply edits:
        # 1) Replace `let _ = ` with `drop(` on line idx
        new_first = f"{indent}drop({after_eq}"
        src[idx] = new_first
        # 2) On end_idx, insert `)` before the `;` at end_col
        if end_idx == idx:
            # Recalculate using new line.
            # The `;` was at original column `len(indent) + len("let _ = ") + end_col`.
            # In the new line, the offset shifts: we removed "let _ = " (8 chars) and added "drop(" (5 chars), net -3.
            # Easier: search for `;` in new_first at the equivalent position.
            # Just locate the rightmost `;` not inside parens — but we already validated balance.
            # Let's find the `;` from the end.
            new_line = src[idx]
            # The `;` should be where end_col was, but offset by removed/added prefix.
            # Original column of `;` in old line: len(indent) + len("let _ = ") + end_col
            old_col = len(indent) + len("let _ = ") + end_col
            new_col = old_col - len("let _ = ") + len("drop(")
            assert new_line[new_col] == ';', f"Expected ';' at col {new_col} in '{new_line}'"
            src[idx] = new_line[:new_col] + ')' + new_line[new_col:]
        else:
            tail = src[end_idx]
            assert tail[end_col] == ';', f"Expected ';' at col {end_col} in '{tail}'"
            src[end_idx] = tail[:end_col] + ')' + tail[end_col:]
        fixed += 1

    new_text = "\n".join(src)
    if new_text != text:
        path.write_text(new_text, encoding="utf-8")
    return fixed


def main():
    locs = parse_locations(LOG)
    by_file: dict[Path, set[int]] = defaultdict(set)
    for rel, line in locs:
        by_file[ROOT / rel].add(line)

    total = 0
    for path, lns in sorted(by_file.items()):
        if not path.exists():
            print(f"  miss: {path}")
            continue
        n = fix_file(path, lns)
        total += n
        print(f"  {path}: fixed {n}")
    print(f"Total: {total}")


if __name__ == "__main__":
    main()
