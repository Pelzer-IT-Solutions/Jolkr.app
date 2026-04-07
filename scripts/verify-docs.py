#!/usr/bin/env python3
"""
Verify that docs-backend-api-reference.md and docs-frontend-backend-integration.md
match the actual code. Run from project root:

    python scripts/verify-docs.py

Exit code 0 = all OK, 1 = mismatches found.
"""

import re
import sys
import os

# Resolve project root (parent of scripts/)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TYPES_TS = os.path.join(ROOT, "jolkr-app", "src", "api", "types.ts")
EVENTS_RS = os.path.join(ROOT, "jolkr-server", "crates", "jolkr-api", "src", "ws", "events.rs")
ROUTER_RS = os.path.join(ROOT, "jolkr-server", "crates", "jolkr-api", "src", "routes", "mod.rs")
BACKEND_DOC = os.path.join(ROOT, "docs-backend-api-reference.md")
FRONTEND_DOC = os.path.join(ROOT, "docs-frontend-backend-integration.md")

errors = 0


def fail(msg):
    global errors
    errors += 1
    print(f"  FAIL: {msg}")


# ─── CHECK 1: TypeScript interfaces ────────────────────────────────────────

def check_types():
    print("\n[1/3] TypeScript interfaces (types.ts vs frontend doc section 12)")

    with open(TYPES_TS, "r", encoding="utf-8") as f:
        code = f.read()
    with open(FRONTEND_DOC, "r", encoding="utf-8") as f:
        doc = f.read()

    doc_match = re.search(
        r"### Bronbestand: `src/api/types\.ts`\s*\n\s*```typescript\s*\n(.*?)```",
        doc,
        re.DOTALL,
    )
    if not doc_match:
        fail("Could not find types.ts block in frontend doc")
        return

    doc_types = doc_match.group(1)

    def normalize(text):
        text = text.replace("export ", "")
        lines = []
        for line in text.split("\n"):
            line = re.sub(r"//.*$", "", line).strip()
            if not line:
                continue
            parts = [p.strip() for p in line.split(";") if p.strip()]
            lines.extend(parts)
        return lines

    def parse_interfaces(lines):
        interfaces = {}
        current = None
        fields = []
        for line in lines:
            if line.startswith("interface "):
                if current:
                    interfaces[current] = sorted(fields)
                current = line.split("{")[0].replace("interface ", "").strip()
                fields = []
            elif line == "}":
                if current:
                    interfaces[current] = sorted(fields)
                current = None
                fields = []
            elif current and line != "{":
                fields.append(line)
        if current:
            interfaces[current] = sorted(fields)
        return interfaces

    code_ifaces = parse_interfaces(normalize(code))
    doc_ifaces = parse_interfaces(normalize(doc_types))

    # Check for missing/extra interfaces
    for name in sorted(code_ifaces):
        if name not in doc_ifaces:
            fail(f"Interface {name} in code but not in doc")
    for name in sorted(doc_ifaces):
        if name not in code_ifaces:
            fail(f"Interface {name} in doc but not in code")

    # Check field-level matches
    mismatches = 0
    for name in sorted(code_ifaces):
        if name in doc_ifaces and code_ifaces[name] != doc_ifaces[name]:
            mismatches += 1
            code_set = set(code_ifaces[name])
            doc_set = set(doc_ifaces[name])
            for f in sorted(code_set - doc_set):
                fail(f"{name}: field in code but not doc: {f}")
            for f in sorted(doc_set - code_set):
                fail(f"{name}: field in doc but not code: {f}")

    total = len(code_ifaces)
    ok = total - mismatches
    print(f"  {ok}/{total} interfaces match" + (" ✓" if mismatches == 0 else ""))


# ─── CHECK 2: API routes ───────────────────────────────────────────────────

def check_routes():
    print("\n[2/3] API routes (router mod.rs vs backend doc endpoint tables)")

    with open(ROUTER_RS, "r", encoding="utf-8") as f:
        code = f.read()
    with open(BACKEND_DOC, "r", encoding="utf-8") as f:
        doc = f.read()

    # Parse routes using balanced-paren matching
    code_clean = re.sub(r"//[^\n]*", "", code)
    routes = set()
    i = 0
    while i < len(code_clean):
        idx = code_clean.find(".route(", i)
        if idx == -1:
            break

        path_match = re.search(r'"(/[^"]+)"', code_clean[idx : idx + 200])
        if not path_match:
            i = idx + 7
            continue

        path = path_match.group(1)

        # Find matching closing paren
        start = idx + 6
        depth = 0
        j = start
        while j < len(code_clean):
            if code_clean[j] == "(":
                depth += 1
            elif code_clean[j] == ")":
                depth -= 1
                if depth == 0:
                    break
            j += 1

        block = code_clean[start : j + 1]
        for method in re.findall(r"\b(get|post|put|patch|delete)\b", block):
            routes.add((method.upper(), path))

        i = j + 1

    # Parse documented routes
    doc_routes = set()
    for match in re.finditer(
        r"\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`?(/[^`|]+?)`?\s*\|", doc
    ):
        method = match.group(1).strip()
        path = match.group(2).strip().split("?")[0]
        doc_routes.add((method, path))

    api_code = {(m, p) for m, p in routes if p.startswith("/api/")}
    api_doc = {(m, p) for m, p in doc_routes if p.startswith("/api/")}

    for m, p in sorted(api_code - api_doc):
        fail(f"{m} {p} — in code but not documented")
    for m, p in sorted(api_doc - api_code):
        fail(f"{m} {p} — in doc but not in code")

    common = len(api_code & api_doc)
    total = len(api_code | api_doc)
    print(f"  {common}/{total} routes match" + (" ✓" if common == total else ""))


# ─── CHECK 3: WebSocket events ─────────────────────────────────────────────

def check_ws_events():
    print("\n[3/3] WebSocket events (events.rs vs backend doc section 25)")

    with open(EVENTS_RS, "r", encoding="utf-8") as f:
        events_code = f.read()
    with open(BACKEND_DOC, "r", encoding="utf-8") as f:
        doc = f.read()

    # Parse GatewayEvent variants (server→client)
    gw_start = events_code.find("pub enum GatewayEvent")
    gw_end = events_code.find("\n}\n", gw_start) + 3
    gw_block = events_code[gw_start:gw_end]
    gw_events = set(re.findall(r"^\s+(\w+)\s*\{", gw_block, re.MULTILINE))

    # Parse ClientEvent variants (client→server)
    cl_start = events_code.find("pub enum ClientEvent")
    cl_end = events_code.find("\n}\n", cl_start) + 3
    cl_block = events_code[cl_start:cl_end]
    cl_events = set(re.findall(r"^\s+(\w+)\s*[\{(]", cl_block, re.MULTILINE))

    # Parse documented events from WS section
    ws_section_start = doc.find("## 25. WebSocket Gateway")
    ws_section_end = doc.find("## 26.", ws_section_start)
    ws_section = doc[ws_section_start:ws_section_end]

    doc_events = set()
    for match in re.finditer(r"\|\s*`(\w+)`\s*\|", ws_section):
        name = match.group(1)
        if name[0].isupper():
            doc_events.add(name)

    all_code_events = gw_events | cl_events

    for e in sorted(all_code_events - doc_events):
        fail(f"Event {e} in code but not documented")
    for e in sorted(doc_events - all_code_events):
        fail(f"Event {e} in doc but not in code")

    common = len(all_code_events & doc_events)
    total = len(all_code_events | doc_events)
    print(f"  {common}/{total} events match" + (" ✓" if common == total else ""))


# ─── Main ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  Documentation Verification")
    print("=" * 60)

    # Check all source files exist
    for path in [TYPES_TS, EVENTS_RS, ROUTER_RS, BACKEND_DOC, FRONTEND_DOC]:
        if not os.path.exists(path):
            print(f"ERROR: File not found: {path}")
            sys.exit(2)

    check_types()
    check_routes()
    check_ws_events()

    print("\n" + "=" * 60)
    if errors == 0:
        print("  ALL CHECKS PASSED ✓")
        print("=" * 60)
        sys.exit(0)
    else:
        print(f"  {errors} MISMATCH(ES) FOUND ✗")
        print("=" * 60)
        sys.exit(1)
