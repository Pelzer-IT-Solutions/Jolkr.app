#!/usr/bin/env python3
"""
Verify that docs-backend-api-reference.md and docs-frontend-backend-integration.md
match the actual code. Run from project root:

    python scripts/verify-docs.py

Exit codes
  0  all checks passed — docs are up-to-date
  1  mismatches found  — a prompt is printed describing every required fix
  2  a required SOURCE file is missing (types.ts / events.rs / routes/mod.rs)

Doc files (docs-backend-api-reference.md / docs-frontend-backend-integration.md)
are NOT required to exist beforehand. When one is missing the script creates an
empty placeholder, runs all checks (which will report everything as missing), and
generates a prompt that instructs an agent to create the full document from scratch.

Checks
──────
  1.  TypeScript interfaces     (types.ts        ↔ frontend doc §12)
  2.  TypeScript enums          (types.ts        ↔ frontend doc §12)
  3.  API routes                (routes/mod.rs   ↔ backend  doc endpoint tables)
  4.  HTTP status codes         (routes/mod.rs   ↔ backend  doc endpoint tables)
  5.  WebSocket events          (ws/events.rs    ↔ backend  doc §25)
  6.  Version numbers           (Cargo.toml /
                                 package.json    ↔ both docs)
  7.  Auth requirements         (routes/mod.rs   ↔ backend  doc 🔒 markers)
  8.  Request body structs      (handlers/*.rs   ↔ backend  doc request tables)
  9.  Shared type consistency   (frontend doc    ↔ backend  doc)
  10. Deprecated endpoints      (routes/mod.rs   ↔ backend  doc)
"""

import re
import sys
import os
import json
from dataclasses import dataclass

# ─── Paths ──────────────────────────────────────────────────────────────────

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TYPES_TS     = os.path.join(ROOT, "jolkr-app",    "src", "api", "types.ts")
EVENTS_RS    = os.path.join(ROOT, "jolkr-server",  "crates", "jolkr-api", "src", "ws",     "events.rs")
ROUTER_RS    = os.path.join(ROOT, "jolkr-server",  "crates", "jolkr-api", "src", "routes", "mod.rs")
ROUTES_DIR   = os.path.join(ROOT, "jolkr-server",  "crates", "jolkr-api", "src", "routes")
DMS_DIR      = os.path.join(ROOT, "jolkr-server",  "crates", "jolkr-api", "src", "routes", "dms")
CLIENT_TS    = os.path.join(ROOT, "jolkr-app",    "src", "api", "client.ts")
MIGRATIONS   = os.path.join(ROOT, "jolkr-server",  "migrations")
COMPOSE_YML  = os.path.join(ROOT, "jolkr-server",  "docker", "docker-compose.yml")
ENV_EXAMPLE  = os.path.join(ROOT, "jolkr-server",  "docker", ".env.example")
CARGO_TOML   = os.path.join(ROOT, "jolkr-server",  "Cargo.toml")
PKG_JSON     = os.path.join(ROOT, "jolkr-app",    "package.json")
BACKEND_DOC  = os.path.join(ROOT, "docs-backend-api-reference.md")
FRONTEND_DOC = os.path.join(ROOT, "docs-frontend-backend-integration.md")

# Source files that MUST exist — script exits with code 2 if any are missing.
SOURCE_FILES = [TYPES_TS, EVENTS_RS, ROUTER_RS, CLIENT_TS]

TOTAL = 15  # Total number of checks (used in progress labels)

# Doc files that are created as empty placeholders when absent.
DOC_FILES = [BACKEND_DOC, FRONTEND_DOC]

BD = os.path.basename(BACKEND_DOC)
FD = os.path.basename(FRONTEND_DOC)

# ─── Finding / error bookkeeping ────────────────────────────────────────────

@dataclass
class Finding:
    """One actionable documentation fix."""
    doc:         str  # BD or FD
    section:     str  # human-readable section in that doc
    action:      str  # "Add" | "Remove" | "Update" | "Mark"
    description: str  # full sentence describing exactly what to change


errors:       int           = 0
findings:     list[Finding] = []
new_doc_files: set[str]     = set()   # basenames of docs that were just created


def fail(msg: str, f: Finding | None = None) -> None:
    global errors
    errors += 1
    print(f"  FAIL: {msg}")
    if f:
        findings.append(f)


def warn(msg: str) -> None:
    print(f"  SKIP: {msg}")


# ─── Doc-file bootstrap ──────────────────────────────────────────────────────

def ensure_doc_files() -> None:
    """Create empty doc files when they don't exist yet."""
    for path in DOC_FILES:
        if not os.path.exists(path):
            open(path, "w", encoding="utf-8").close()
            name = os.path.basename(path)
            new_doc_files.add(name)
            print(f"  INFO: '{name}' did not exist — created empty placeholder")


# ─── Shared helpers ─────────────────────────────────────────────────────────

def normalize_path_param(path: str) -> str:
    """Unify ``{id}`` (Axum) and ``:id`` (OpenAPI) so they compare equal."""
    return re.sub(r"\{(\w+)\}", r":\1", path)


def extract_enum_block(source: str, enum_name: str) -> str | None:
    """Return the raw text of ``pub enum <n> { … }`` or None."""
    start = source.find(f"pub enum {enum_name}")
    if start == -1:
        return None
    end = source.find("\n}\n", start)
    if end == -1:
        return None
    return source[start : end + 3]


def all_handler_source() -> str:
    """Concatenate every .rs file in ROUTES_DIR and DMS_DIR."""
    parts: list[str] = []
    for d in [ROUTES_DIR, DMS_DIR]:
        if not os.path.isdir(d):
            continue
        for name in os.listdir(d):
            if name.endswith(".rs"):
                parts.append(open(os.path.join(d, name), encoding="utf-8").read())
    return "\n".join(parts)


# ─── TypeScript parser helpers (shared by checks 1, 2, 9) ──────────────────

def normalize_ts(text: str) -> list[str]:
    text = text.replace("export ", "")
    out: list[str] = []
    for raw in text.split("\n"):
        raw = re.sub(r"//.*$", "", raw).strip()
        if not raw:
            continue
        for part in raw.split(";"):
            part = part.strip()
            if part:
                out.append(part)
    return out


def parse_ts_interfaces(lines: list[str]) -> dict[str, list[str]]:
    """
    Extract ``interface Name { … }`` → {name: sorted_fields}.
    Tracks brace depth so nested inline types don't confuse the parser.
    """
    interfaces: dict[str, list[str]] = {}
    current: str | None = None
    fields:  list[str]  = []
    depth = 0

    for line in lines:
        if line.startswith("interface "):
            if current:
                interfaces[current] = sorted(fields)
            current = line.split("{")[0].replace("interface ", "").strip()
            depth   = line.count("{") - line.count("}")
            fields  = []
            continue
        if current is not None:
            depth += line.count("{") - line.count("}")
            if depth <= 0:
                interfaces[current] = sorted(fields)
                current = None
                fields  = []
                depth   = 0
            elif line != "{":
                fields.append(line)

    if current:
        interfaces[current] = sorted(fields)
    return interfaces


def parse_ts_enums(text: str) -> dict[str, set[str]]:
    """Extract ``enum Name { … }`` → {name: {members}}."""
    text = re.sub(r"export\s+", "", text)
    text = re.sub(r"//[^\n]*", "", text)
    enums: dict[str, set[str]] = {}
    for m in re.finditer(r"\benum\s+(\w+)\s*\{([^}]+)\}", text, re.DOTALL):
        members = {e.split("=")[0].strip() for e in m.group(2).split(",") if e.strip()}
        enums[m.group(1)] = members
    return enums


# ─── Router parsing helper (shared by checks 3, 7, 8, 10) ──────────────────

def parse_code_routes(code: str) -> list[tuple[int, str, str, str]]:
    """Return [(position, METHOD, normalised_path, handler_name)] for every .route(…)."""
    clean  = re.sub(r"//[^\n]*", "", code)
    result: list[tuple[int, str, str, str]] = []
    i = 0
    while i < len(clean):
        idx = clean.find(".route(", i)
        if idx == -1:
            break
        path_m = re.search(r'"(/[^"]+)"', clean[idx : idx + 200])
        if not path_m:
            i = idx + 7
            continue
        path = normalize_path_param(path_m.group(1).split("?")[0])

        start = idx + 6
        depth = 0
        j     = start
        while j < len(clean):
            if   clean[j] == "(": depth += 1
            elif clean[j] == ")":
                depth -= 1
                if depth == 0:
                    break
            j += 1

        block = clean[start : j + 1]
        for method, handler in re.findall(
            r"(?<![_\w])(get|post|put|patch|delete)(?![_\w])\s*\(\s*(\w+)\s*\)", block
        ):
            result.append((idx, method.upper(), path, handler))
        for method in re.findall(
            r"(?<![_\w])(get|post|put|patch|delete)(?![_\w])(?!\s*\(\s*\w+\s*\))", block
        ):
            result.append((idx, method.upper(), path, ""))

        i = j + 1
    return result


def parse_doc_routes(doc: str) -> set[tuple[str, str]]:
    routes: set[tuple[str, str]] = set()
    for m in re.finditer(
        r"\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`?(/[^`|\s]+?)`?\s*\|", doc
    ):
        path = normalize_path_param(m.group(2).strip().split("?")[0])
        routes.add((m.group(1).strip(), path))
    return routes


# ═══════════════════════════════════════════════════════════════════════════
#  CHECK 1 — TypeScript interfaces
# ═══════════════════════════════════════════════════════════════════════════

def check_interfaces() -> None:
    print(f"\n[1/{TOTAL}] TypeScript interfaces  (types.ts ↔ frontend doc §12)")

    code = open(TYPES_TS,     encoding="utf-8").read()
    doc  = open(FRONTEND_DOC, encoding="utf-8").read()

    doc_match = re.search(
        r"### Bronbestand: `src/api/types\.ts`\s*\n\s*```typescript\s*\n(.*?)```",
        doc, re.DOTALL,
    )
    if not doc_match:
        fail("Could not find types.ts block in frontend doc",
             Finding(FD, "§12 – types.ts", "Add",
                     "Add the full types.ts code block under §12 "
                     "(### Bronbestand: `src/api/types.ts`)"))
        return

    code_ifaces = parse_ts_interfaces(normalize_ts(code))
    doc_ifaces  = parse_ts_interfaces(normalize_ts(doc_match.group(1)))

    for name in sorted(set(code_ifaces) - set(doc_ifaces)):
        fail(f"Interface '{name}' in code but not in doc",
             Finding(FD, "§12 – types.ts code block", "Add",
                     f"Add interface '{name}' to the types.ts code block"))

    for name in sorted(set(doc_ifaces) - set(code_ifaces)):
        fail(f"Interface '{name}' in doc but not in code",
             Finding(FD, "§12 – types.ts code block", "Remove",
                     f"Remove interface '{name}' from the types.ts code block "
                     f"(no longer exists in the code)"))

    ok = 0
    for name in sorted(set(code_ifaces) & set(doc_ifaces)):
        add  = sorted(set(code_ifaces[name]) - set(doc_ifaces[name]))
        drop = sorted(set(doc_ifaces[name])  - set(code_ifaces[name]))
        if not add and not drop:
            ok += 1
        else:
            for f in add:
                fail(f"Interface '{name}': field in code but not doc → {f}",
                     Finding(FD, f"§12 – interface '{name}'", "Add",
                             f"Add field `{f}` to interface '{name}'"))
            for f in drop:
                fail(f"Interface '{name}': field in doc but not code → {f}",
                     Finding(FD, f"§12 – interface '{name}'", "Remove",
                             f"Remove field `{f}` from interface '{name}' "
                             f"(no longer exists in types.ts)"))

    total = len(set(code_ifaces) | set(doc_ifaces))
    print(f"  {ok}/{total} interfaces fully match" + (" ✓" if ok == total else ""))


# ═══════════════════════════════════════════════════════════════════════════
#  CHECK 2 — TypeScript enums
# ═══════════════════════════════════════════════════════════════════════════

def check_enums() -> None:
    print(f"\n[2/{TOTAL}] TypeScript enums  (types.ts ↔ frontend doc §12)")

    code = open(TYPES_TS,     encoding="utf-8").read()
    doc  = open(FRONTEND_DOC, encoding="utf-8").read()

    doc_match = re.search(
        r"### Bronbestand: `src/api/types\.ts`\s*\n\s*```typescript\s*\n(.*?)```",
        doc, re.DOTALL,
    )
    if not doc_match:
        warn("types.ts block not found in frontend doc — skipping enum check")
        return

    code_enums = parse_ts_enums(code)
    doc_enums  = parse_ts_enums(doc_match.group(1))

    if not code_enums and not doc_enums:
        print("  No enums found in code or doc — nothing to check ✓")
        return

    for name in sorted(set(code_enums) - set(doc_enums)):
        fail(f"Enum '{name}' in code but not in doc",
             Finding(FD, "§12 – types.ts code block", "Add",
                     f"Add enum '{name}' to the types.ts code block"))

    for name in sorted(set(doc_enums) - set(code_enums)):
        fail(f"Enum '{name}' in doc but not in code",
             Finding(FD, "§12 – types.ts code block", "Remove",
                     f"Remove enum '{name}' from the types.ts code block "
                     f"(no longer exists in the code)"))

    ok = 0
    for name in sorted(set(code_enums) & set(doc_enums)):
        add  = sorted(code_enums[name] - doc_enums[name])
        drop = sorted(doc_enums[name]  - code_enums[name])
        if not add and not drop:
            ok += 1
        else:
            for v in add:
                fail(f"Enum '{name}': member '{v}' in code but not doc",
                     Finding(FD, f"§12 – enum '{name}'", "Add",
                             f"Add member '{v}' to enum '{name}'"))
            for v in drop:
                fail(f"Enum '{name}': member '{v}' in doc but not code",
                     Finding(FD, f"§12 – enum '{name}'", "Remove",
                             f"Remove member '{v}' from enum '{name}' "
                             f"(no longer exists in the code)"))

    total = len(set(code_enums) | set(doc_enums))
    print(f"  {ok}/{total} enums fully match" + (" ✓" if ok == total else ""))


# ═══════════════════════════════════════════════════════════════════════════
#  CHECK 3 — API routes
# ═══════════════════════════════════════════════════════════════════════════

def check_routes() -> None:
    print(f"\n[3/{TOTAL}] API routes  (routes/mod.rs ↔ backend doc endpoint tables)")

    code = open(ROUTER_RS,   encoding="utf-8").read()
    doc  = open(BACKEND_DOC, encoding="utf-8").read()

    code_routes = {
        (method, path)
        for _, method, path, _ in parse_code_routes(code)
        if path.startswith("/api/")
    }
    doc_routes = {(m, p) for m, p in parse_doc_routes(doc) if p.startswith("/api/")}

    for m, p in sorted(code_routes - doc_routes):
        fail(f"{m} {p} — in code but not documented",
             Finding(BD, "Endpoint table", "Add",
                     f"Add endpoint `{m} {p}` to the endpoint table"))

    for m, p in sorted(doc_routes - code_routes):
        fail(f"{m} {p} — in doc but not in code",
             Finding(BD, "Endpoint table", "Remove",
                     f"Remove endpoint `{m} {p}` from the endpoint table "
                     f"(no longer exists in the router)"))

    common = len(code_routes & doc_routes)
    total  = len(code_routes | doc_routes)
    print(f"  {common}/{total} routes match" + (" ✓" if common == total else ""))


# ═══════════════════════════════════════════════════════════════════════════
#  CHECK 4 — HTTP status codes
# ═══════════════════════════════════════════════════════════════════════════

_STATUS_MAP = {
    "OK": "200", "CREATED": "201", "ACCEPTED": "202",
    "NO_CONTENT": "204", "BAD_REQUEST": "400",
    "UNAUTHORIZED": "401", "FORBIDDEN": "403",
    "NOT_FOUND": "404", "CONFLICT": "409",
    "UNPROCESSABLE_ENTITY": "422", "INTERNAL_SERVER_ERROR": "500",
}


def check_status_codes() -> None:
    print(f"\n[4/{TOTAL}] HTTP status codes  (routes/*.rs ↔ backend doc)")

    handler_src = all_handler_source()
    doc         = open(BACKEND_DOC, encoding="utf-8").read()

    # Collect status codes from explicit StatusCode:: usage only
    # (bare numeric literals cause too many false positives)
    code_statuses: set[str] = set()
    for name in re.findall(r"StatusCode::(\w+)", handler_src):
        if name in _STATUS_MAP:
            code_statuses.add(_STATUS_MAP[name])

    if not code_statuses:
        warn("No StatusCode patterns found in route handlers — skipping")
        return

    # Check that every status code used in handlers appears somewhere in the doc
    doc_statuses: set[str] = set(re.findall(r"\b(\d{3})\b", doc))

    missing = 0
    for status in sorted(code_statuses):
        if status not in doc_statuses:
            fail(
                f"Status code {status} used in handlers but not mentioned in doc",
                Finding(BD, "Status codes", "Add",
                        f"Document status code {status} "
                        f"({next((k for k, v in _STATUS_MAP.items() if v == status), status)}) "
                        f"— it is used in route handlers but not mentioned in the doc"),
            )
            missing += 1

    total = len(code_statuses)
    ok    = total - missing
    print(f"  {ok}/{total} handler status codes found in doc" +
          (" ✓" if missing == 0 else ""))


# ═══════════════════════════════════════════════════════════════════════════
#  CHECK 5 — WebSocket events
# ═══════════════════════════════════════════════════════════════════════════

def check_ws_events() -> None:
    print(f"\n[5/{TOTAL}] WebSocket events  (ws/events.rs ↔ backend doc §25)")

    events_code = open(EVENTS_RS,   encoding="utf-8").read()
    doc         = open(BACKEND_DOC, encoding="utf-8").read()

    gw_block = extract_enum_block(events_code, "GatewayEvent")
    if gw_block is None:
        fail("Could not find 'pub enum GatewayEvent' in events.rs")
        gw_events: set[str] = set()
    else:
        gw_events = set(re.findall(r"^\s+([A-Z]\w+)\s*\{", gw_block, re.MULTILINE))

    cl_block = extract_enum_block(events_code, "ClientEvent")
    if cl_block is None:
        fail("Could not find 'pub enum ClientEvent' in events.rs")
        cl_events: set[str] = set()
    else:
        cl_events = set(re.findall(r"^\s+([A-Z]\w*)\s*[\{(]", cl_block, re.MULTILINE))

    ws_start = doc.find("## 25. WebSocket Gateway")
    if ws_start == -1:
        fail("Section '## 25. WebSocket Gateway' not found in backend doc",
             Finding(BD, "§25 – WebSocket Gateway", "Add",
                     "Section '## 25. WebSocket Gateway' is missing — add it with "
                     "a server→client table for GatewayEvent variants and a "
                     "client→server table for ClientEvent variants"))
        return

    ws_end     = doc.find("## 26.", ws_start)
    ws_section = doc[ws_start:] if ws_end == -1 else doc[ws_start:ws_end]

    doc_events: set[str] = {
        m.group(1)
        for m in re.finditer(r"\|\s*`([A-Z]\w+)`\s*\|", ws_section)
    }

    all_code = gw_events | cl_events

    for e in sorted(all_code - doc_events):
        direction = "server→client" if e in gw_events else "client→server"
        fail(f"Event '{e}' ({direction}) in code but not documented",
             Finding(BD, "§25 – WebSocket Gateway", "Add",
                     f"Add event `{e}` ({direction}) to the event table in §25"))

    for e in sorted(doc_events - all_code):
        fail(f"Event '{e}' in doc but not in code",
             Finding(BD, "§25 – WebSocket Gateway", "Remove",
                     f"Remove event `{e}` from the event table in §25 "
                     f"(no longer exists in events.rs)"))

    common = len(all_code & doc_events)
    total  = len(all_code | doc_events)
    print(f"  {common}/{total} events match" + (" ✓" if common == total else ""))


# ═══════════════════════════════════════════════════════════════════════════
#  CHECK 6 — Version numbers
# ═══════════════════════════════════════════════════════════════════════════

def check_versions() -> None:
    print(f"\n[6/{TOTAL}] Version numbers  (Cargo.toml / package.json ↔ both docs)")

    versions: dict[str, str] = {}

    if os.path.exists(CARGO_TOML):
        cargo    = open(CARGO_TOML, encoding="utf-8").read()
        pkg_sect = re.search(r"\[package\](.*?)(?=\n\[|\Z)", cargo, re.DOTALL)
        if pkg_sect:
            m = re.search(r'version\s*=\s*"([^"]+)"', pkg_sect.group(1))
            if m:
                versions["Cargo.toml"] = m.group(1)
    else:
        warn("Cargo.toml not found — skipping server version")

    if os.path.exists(PKG_JSON):
        try:
            pkg = json.loads(open(PKG_JSON, encoding="utf-8").read())
            if "version" in pkg:
                versions["package.json"] = pkg["version"]
        except json.JSONDecodeError as exc:
            warn(f"Could not parse package.json: {exc}")
    else:
        warn("package.json not found — skipping frontend version")

    if not versions:
        warn("No version sources found — skipping")
        return

    for source, version in sorted(versions.items()):
        for doc_name, doc_path in [(BD, BACKEND_DOC), (FD, FRONTEND_DOC)]:
            text = open(doc_path, encoding="utf-8").read()
            if version not in text:
                fail(f"Version '{version}' from {source} not found in {doc_name}",
                     Finding(doc_name, "Version reference", "Update",
                             f"Update the version number to '{version}' "
                             f"(current value in {source})"))
            else:
                print(f"  {source} v{version} found in {doc_name} ✓")


# ═══════════════════════════════════════════════════════════════════════════
#  CHECK 7 — Auth requirements
# ═══════════════════════════════════════════════════════════════════════════

def check_auth() -> None:
    """
    Routes behind a route_layer(…auth…) call must be marked 🔒 in the doc.
    """
    print(f"\n[7/{TOTAL}] Auth requirements  (routes/mod.rs auth layer ↔ backend doc 🔒)")

    code = open(ROUTER_RS,   encoding="utf-8").read()
    doc  = open(BACKEND_DOC, encoding="utf-8").read()

    clean = re.sub(r"//[^\n]*", "", code)
    auth_layer_positions = [
        m.start()
        for m in re.finditer(r"\.route_layer\s*\([^)]*auth[^)]*\)", clean, re.IGNORECASE)
    ]

    def is_authed(pos: int) -> bool:
        return any(pos < alp < pos + 3000 for alp in auth_layer_positions)

    code_authed: set[tuple[str, str]] = set()
    code_public: set[tuple[str, str]] = set()
    for pos, method, path, _ in parse_code_routes(code):
        if not path.startswith("/api/"):
            continue
        (code_authed if is_authed(pos) else code_public).add((method, path))

    doc_authed: set[tuple[str, str]] = set()
    doc_public: set[tuple[str, str]] = set()
    for m in re.finditer(
        r"\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`?(/[^`|\s]+?)`?\s*\|([^|\n]*)\|",
        doc,
    ):
        method = m.group(1).strip()
        path   = normalize_path_param(m.group(2).strip().split("?")[0])
        if not path.startswith("/api/"):
            continue
        (doc_authed if "🔒" in m.group(3) else doc_public).add((method, path))

    for method, path in sorted(code_authed - doc_authed):
        if (method, path) in doc_public:
            fail(f"{method} {path} — auth required in code but no 🔒 in doc",
                 Finding(BD, f"Endpoint `{method} {path}`", "Mark",
                         f"Add 🔒 to the table row of `{method} {path}` "
                         f"(sits behind auth middleware in the router)"))

    for method, path in sorted(doc_authed - code_authed):
        if (method, path) in code_public:
            fail(f"{method} {path} — 🔒 in doc but no auth layer found in code",
                 Finding(BD, f"Endpoint `{method} {path}`", "Update",
                         f"Remove 🔒 from `{method} {path}` in the doc, "
                         f"or add auth middleware in the router "
                         f"(doc and code are inconsistent)"))

    checked = len(code_authed | code_public)
    wrong   = len(code_authed - doc_authed) + len(doc_authed - code_authed)
    print(f"  {max(checked - wrong, 0)}/{checked} route auth markers match" +
          (" ✓" if wrong == 0 else ""))


# ═══════════════════════════════════════════════════════════════════════════
#  CHECK 8 — Request body structs
# ═══════════════════════════════════════════════════════════════════════════

def check_request_bodies() -> None:
    """
    For POST/PUT/PATCH handlers accepting Json<Struct>: compare struct fields
    to the request-body table in the backend doc.
    """
    print(f"\n[8/{TOTAL}] Request body structs  (routes/*.rs ↔ backend doc request tables)")

    router_src  = open(ROUTER_RS, encoding="utf-8").read()
    handler_src = all_handler_source()
    if not handler_src:
        warn(f"No route handler source found in {ROUTES_DIR} — skipping")
        return
    combined = router_src + "\n" + handler_src
    doc      = open(BACKEND_DOC, encoding="utf-8").read()

    handler_structs: dict[str, str] = {}
    for m in re.finditer(
        r"async\s+fn\s+(\w+)\s*\([^)]*Json\s*\(\w+\)\s*:\s*Json\s*<\s*(\w+)\s*>",
        combined,
    ):
        handler_structs[m.group(1)] = m.group(2)

    def struct_fields(name: str) -> set[str] | None:
        pattern = rf"(?:pub\s+)?struct\s+{re.escape(name)}\s*\{{([^}}]+)\}}"
        m = re.search(pattern, combined, re.DOTALL)
        if not m:
            return None
        fields: set[str] = set()
        for line in m.group(1).split("\n"):
            line = re.sub(r"//.*$", "", line).strip()
            line = re.sub(r"#\[.*?\]", "", line).strip()
            fm = re.match(r"(?:pub\s+)?(\w+)\s*:", line)
            if fm:
                fields.add(fm.group(1))
        return fields

    doc_request_fields: dict[tuple[str, str], set[str]] = {}
    for m in re.finditer(
        r"#{1,4}\s+(POST|PUT|PATCH)\s+`?(/[^\s`]+)`?.*?\n(.*?)(?=\n#{1,4}|\Z)",
        doc, re.DOTALL,
    ):
        method  = m.group(1)
        path    = normalize_path_param(m.group(2).split("?")[0])
        section = m.group(3)
        fields: set[str] = set()
        for row in re.finditer(r"\|\s*`?(\w+)`?\s*\|\s*\w+\s*\|", section):
            fname = row.group(1)
            if fname.lower() not in {
                "field", "veld", "name", "naam", "type", "required", "verplicht"
            }:
                fields.add(fname)
        if fields:
            doc_request_fields[(method, path)] = fields

    route_handler: dict[tuple[str, str], str] = {
        (method, path): handler
        for _, method, path, handler in parse_code_routes(router_src)
        if handler and method in {"POST", "PUT", "PATCH"} and path.startswith("/api/")
    }

    checked = ok = 0
    for (method, path), handler in sorted(route_handler.items()):
        struct_name = handler_structs.get(handler)
        if not struct_name:
            continue
        code_fields = struct_fields(struct_name)
        if code_fields is None:
            warn(f"Could not find struct '{struct_name}' for {method} {path}")
            continue
        doc_fields = doc_request_fields.get((method, path), set())
        if not doc_fields:
            warn(f"No request-body table found for {method} {path} — skipping")
            continue

        checked += 1
        add  = sorted(code_fields - doc_fields)
        drop = sorted(doc_fields  - code_fields)
        if not add and not drop:
            ok += 1
        else:
            for field in add:
                fail(
                    f"{method} {path}: request field '{field}' in code but not in doc",
                    Finding(BD, f"Endpoint `{method} {path}` – Request body", "Add",
                            f"Add field `{field}` to the request body table "
                            f"(present in struct '{struct_name}')"),
                )
            for field in drop:
                fail(
                    f"{method} {path}: request field '{field}' in doc but not in code",
                    Finding(BD, f"Endpoint `{method} {path}` – Request body", "Remove",
                            f"Remove field `{field}` from the request body table "
                            f"(no longer exists in struct '{struct_name}')"),
                )

    if checked == 0:
        warn("No request-body structs could be matched to doc tables")
        return
    print(f"  {ok}/{checked} request body structs match" + (" ✓" if ok == checked else ""))


# ═══════════════════════════════════════════════════════════════════════════
#  CHECK 9 — Shared type consistency between the two docs
# ═══════════════════════════════════════════════════════════════════════════

def parse_doc_type_fields(doc: str) -> dict[str, set[str]]:
    """Extract field names from sections with table-formatted types."""
    types: dict[str, set[str]] = {}
    for m in re.finditer(
        r"#{2,4}\s+`?(\w+(?:Response|Info|Dto)?)`?\s*\n(.*?)(?=\n#{2,4}\s|\Z)",
        doc, re.DOTALL,
    ):
        name = m.group(1)
        section = m.group(2)
        fields: set[str] = set()
        for row in re.finditer(r"\|\s*`?(\w+)`?\s*\|\s*`?[\w\[\]|<> ?]+`?\s*\|", section):
            fname = row.group(1)
            if fname.lower() not in {"field", "veld", "name", "naam", "type", "required", "verplicht", "description", "beschrijving"}:
                fields.add(fname)
        if fields:
            types[name] = fields
    return types


def check_shared_types() -> None:
    """
    Interfaces present in BOTH docs must have identical field sets.
    An interface only in one doc is not flagged.
    """
    print(f"\n[9/{TOTAL}] Shared type consistency  (frontend doc ↔ backend doc)")

    def extract_ts_blocks(text: str) -> str:
        return "\n".join(
            m.group(1)
            for m in re.finditer(r"```typescript\s*\n(.*?)```", text, re.DOTALL)
        )

    bd_text = open(BACKEND_DOC,  encoding="utf-8").read()
    fd_text = open(FRONTEND_DOC, encoding="utf-8").read()

    # TS code block interfaces
    bd_ifaces = parse_ts_interfaces(normalize_ts(extract_ts_blocks(bd_text)))
    fd_ifaces = parse_ts_interfaces(normalize_ts(extract_ts_blocks(fd_text)))

    # Table-parsed types from both docs (backend doc typically uses tables)
    bd_table_types = parse_doc_type_fields(bd_text)
    fd_table_types = parse_doc_type_fields(fd_text)

    # Merge: TS block fields as sets, then overlay table-parsed fields
    bd_all: dict[str, set[str]] = {k: set(v) for k, v in bd_ifaces.items()}
    for name, fields in bd_table_types.items():
        bd_all.setdefault(name, set()).update(fields)

    fd_all: dict[str, set[str]] = {k: set(v) for k, v in fd_ifaces.items()}
    for name, fields in fd_table_types.items():
        fd_all.setdefault(name, set()).update(fields)

    shared = set(bd_all) & set(fd_all)
    if not shared:
        print("  No shared type names across both docs — nothing to check ✓")
        return

    ok = 0
    for name in sorted(shared):
        only_bd = sorted(bd_all[name] - fd_all[name])
        only_fd = sorted(fd_all[name] - bd_all[name])
        if not only_bd and not only_fd:
            ok += 1
        else:
            for f in only_bd:
                fail(
                    f"Shared type '{name}': field '{f}' in backend doc but not frontend doc",
                    Finding(FD, f"§12 – type '{name}'", "Add",
                            f"Add field `{f}` to type '{name}' "
                            f"(present in the backend doc, missing here)"),
                )
            for f in only_fd:
                fail(
                    f"Shared type '{name}': field '{f}' in frontend doc but not backend doc",
                    Finding(BD, f"Type '{name}'", "Add",
                            f"Add field `{f}` to type '{name}' "
                            f"(present in the frontend doc, missing here)"),
                )

    print(f"  {ok}/{len(shared)} shared types are consistent" +
          (" ✓" if ok == len(shared) else ""))


# ═══════════════════════════════════════════════════════════════════════════
#  CHECK 10 — Deprecated endpoints
# ═══════════════════════════════════════════════════════════════════════════

def check_deprecated() -> None:
    """
    Handlers with #[deprecated] in Rust must be marked deprecated in the doc.
    """
    print(f"\n[10/{TOTAL}] Deprecated endpoints  (routes #[deprecated] ↔ backend doc)")

    router_src  = open(ROUTER_RS, encoding="utf-8").read()
    handler_src = all_handler_source()
    combined    = router_src + "\n" + handler_src
    doc         = open(BACKEND_DOC, encoding="utf-8").read()

    deprecated_handlers: set[str] = {
        m.group(1)
        for m in re.finditer(
            r"#\[deprecated[^\]]*\]\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)", combined
        )
    }

    if not deprecated_handlers:
        print("  No #[deprecated] handlers found — nothing to check ✓")
        return

    deprecated_routes: set[tuple[str, str]] = {
        (method, path)
        for _, method, path, handler in parse_code_routes(router_src)
        if handler in deprecated_handlers and path.startswith("/api/")
    }

    def is_marked_deprecated(path: str) -> bool:
        needle = re.escape(path)
        for m in re.finditer(rf"`?{needle}`?", doc):
            surrounding = doc[m.start() : m.start() + 400]
            if re.search(r"deprecated|~~|DEPRECATED", surrounding, re.IGNORECASE):
                return True
        return False

    ok = 0
    for method, path in sorted(deprecated_routes):
        if is_marked_deprecated(path):
            ok += 1
        else:
            fail(
                f"{method} {path} is #[deprecated] in code but not marked in doc",
                Finding(BD, f"Endpoint `{method} {path}`", "Mark",
                        f"Mark `{method} {path}` as deprecated "
                        f"(handler has #[deprecated] attribute) — "
                        f"add '> **Deprecated**' above the section or "
                        f"use ~~strikethrough~~ in the table row"),
            )

    total = len(deprecated_routes)
    print(f"  {ok}/{total} deprecated routes marked in doc" +
          (" ✓" if ok == total else ""))


# ═══════════════════════════════════════════════════════════════════════════
#  CHECK 11–15: Cross-file consistency checks
# ═══════════════════════════════════════════════════════════════════════════


def check_client_routes() -> None:
    """Compare API calls in client.ts to routes in mod.rs."""
    print(f"\n[11/{TOTAL}] Frontend client ↔ backend routes  (client.ts ↔ routes/mod.rs)")

    client_src = open(CLIENT_TS, encoding="utf-8").read()
    router_src = open(ROUTER_RS, encoding="utf-8").read()

    # Extract (method, path) from client.ts
    # client.ts uses: request<T>(path, { method: 'X', ... }, unwrapKey?)
    # path is either '/plain/path' or `/template/${var}/path`
    client_routes: set[tuple[str, str]] = set()

    # Find all request<...>(...) call sites and extract the full argument list
    for m in re.finditer(r"request\s*<[^>]*>\s*\(", client_src):
        start = m.end()
        # Find matching closing paren (track depth)
        depth = 1
        j = start
        while j < len(client_src) and depth > 0:
            if client_src[j] == "(": depth += 1
            elif client_src[j] == ")": depth -= 1
            j += 1
        args_str = client_src[start:j-1]

        # Extract the first argument (the path) — either 'str', "str", or `template`
        path_m = re.match(r"\s*(`(?:[^`\\]|\\.)*`|'[^']*'|\"[^\"]*\")", args_str)
        if not path_m:
            continue
        raw = path_m.group(1)[1:-1]  # strip quotes/backticks

        # Normalize template expressions: ${serverId} → :param
        raw = re.sub(r"\$\{[^}]+\}", ":param", raw)
        # Strip broken template fragments from nested backticks: ${qs... etc
        raw = re.sub(r"\$\{.*$", "", raw)
        # Strip query string (everything after ?)
        raw = re.split(r"\?", raw)[0]
        # Strip trailing :param that is the entire query (e.g. `/upload:param`)
        # but keep :param that is a path segment
        raw = re.sub(r":param$", "", raw) if raw.endswith(":param") and not raw.endswith("/:param") else raw
        # Remove trailing slashes
        raw = raw.rstrip("/") if raw != "/" else raw
        path = "/api" + raw

        # Extract method from the options object (second argument)
        method_m = re.search(r"method\s*:\s*['\"](\w+)['\"]", args_str)
        method = (method_m.group(1) if method_m else "GET").upper()
        client_routes.add((method, path))

    code_routes = {
        (method, path)
        for _, method, path, _ in parse_code_routes(router_src)
        if path.startswith("/api/")
    }

    # Normalize both sides: replace all :param_name with :p for comparison
    def norm(path: str) -> str:
        return re.sub(r":\w+", ":p", path)

    client_norm = {(m, norm(p)) for m, p in client_routes}
    code_norm   = {(m, norm(p)) for m, p in code_routes}

    # Parse routes already documented in §4.23 ("Backend routes zonder client.ts functie")
    # so we don't report them as missing.
    doc_src = open(FRONTEND_DOC, encoding="utf-8").read()
    sec423_m = re.search(
        r"###\s*4\.23\b.*?\n(.*?)(?=\n##\s|\Z)", doc_src, re.DOTALL
    )
    documented_backend_only: set[tuple[str, str]] = set()
    if sec423_m:
        for row in re.finditer(
            r"\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`?(/[^`|\s]+?)`?\s*\|",
            sec423_m.group(1),
        ):
            raw_path = normalize_path_param(row.group(2).strip().split("?")[0])
            # Doc §4.23 paths omit the /api prefix — add it to match code_norm
            full_path = "/api" + raw_path if not raw_path.startswith("/api") else raw_path
            documented_backend_only.add((row.group(1).strip(), norm(full_path)))

    # Parse routes already marked as client-only (⚠️ Geen backend route) in the doc
    documented_client_only: set[tuple[str, str]] = set()
    for row in re.finditer(
        r"\|\s*`?\w+`?\s*\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`?(/[^`|\s]+?)`?\s*\|"
        r"[^|]*\|[^|]*\|[^\n]*(?:client.only|Geen backend route)",
        doc_src,
    ):
        raw_path = normalize_path_param(row.group(2).strip().split("?")[0])
        # Doc table paths omit the /api prefix — add it to match client_norm
        full_path = "/api" + raw_path if not raw_path.startswith("/api") else raw_path
        documented_client_only.add((row.group(1).strip(), norm(full_path)))

    only_client = sorted(client_norm - code_norm)
    only_code   = sorted(code_norm - client_norm)

    for method, path in only_client:
        if (method, path) in documented_client_only:
            continue
        fail(f"{method} {path} — in client.ts but no matching route in mod.rs",
             Finding(FD, "API client functions", "Update",
                     f"Client calls `{method} {path}` but no matching backend route"))

    for method, path in only_code:
        if (method, path) in documented_backend_only:
            continue
        fail(f"{method} {path} — in router but no client.ts function calls it",
             Finding(FD, "API client functions", "Add",
                     f"Backend route `{method} {path}` has no client.ts function"))

    common = len(client_norm & code_norm)
    total  = len(client_norm | code_norm)
    print(f"  {common}/{total} client↔route pairs match" + (" ✓" if not only_client and not only_code else ""))


def check_migrations() -> None:
    """Check that tables from CREATE TABLE in migrations are in doc §27."""
    print(f"\n[12/{TOTAL}] Migration tables ↔ backend doc §27  (migrations/*.sql ↔ doc)")

    if not os.path.isdir(MIGRATIONS):
        warn(f"Migrations directory not found at {MIGRATIONS} — skipping")
        return

    doc = open(BACKEND_DOC, encoding="utf-8").read()

    code_tables: set[str] = set()
    for name in sorted(os.listdir(MIGRATIONS)):
        if not name.endswith(".sql"):
            continue
        sql = open(os.path.join(MIGRATIONS, name), encoding="utf-8").read()
        for m in re.finditer(
            r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)",
            sql, re.IGNORECASE,
        ):
            code_tables.add(m.group(1))

    db_start = doc.find("## 27.")
    if db_start == -1:
        db_start = doc.lower().find("## database models")
    if db_start == -1:
        fail("Section '## 27. Database Models' not found in backend doc",
             Finding(BD, "§27 – Database Models", "Add",
                     "Add a '## 27. Database Models' section listing all tables"))
        return

    db_end = doc.find("\n## ", db_start + 5)
    db_section = doc[db_start:] if db_end == -1 else doc[db_start:db_end]

    doc_tables: set[str] = {m.group(1) for m in re.finditer(r"`(\w+)`", db_section)}

    missing = sorted(code_tables - doc_tables)
    for table in missing:
        fail(f"Table '{table}' in migrations but not in doc §27",
             Finding(BD, "§27 – Database Models", "Add",
                     f"Add table `{table}` to the Database Models section"))

    ok = len(code_tables) - len(missing)
    print(f"  {ok}/{len(code_tables)} migration tables documented" + (" ✓" if not missing else ""))


def check_docker_services() -> None:
    """Check Docker services are documented in Infrastructure section."""
    print(f"\n[13/{TOTAL}] Docker services ↔ backend doc  (docker-compose.yml ↔ doc)")

    if not os.path.exists(COMPOSE_YML):
        warn(f"docker-compose.yml not found at {COMPOSE_YML} — skipping")
        return

    compose = open(COMPOSE_YML, encoding="utf-8").read()
    doc     = open(BACKEND_DOC, encoding="utf-8").read()

    services: set[str] = set()
    in_services = False
    for line in compose.split("\n"):
        stripped = line.rstrip()
        if re.match(r"^services\s*:", stripped):
            in_services = True
            continue
        if in_services:
            m = re.match(r"^  (\w[\w-]*)\s*:", stripped)
            if m:
                services.add(m.group(1))
            elif re.match(r"^\w", stripped) and stripped:
                in_services = False

    if not services:
        warn("No services found in docker-compose.yml — skipping")
        return

    infra_start = doc.find("## Infrastructure")
    if infra_start == -1:
        fail("Section '## Infrastructure Stack' not found in backend doc",
             Finding(BD, "Infrastructure Stack", "Add",
                     "Add an Infrastructure Stack section documenting Docker services"))
        return

    infra_end = doc.find("\n## ", infra_start + 5)
    infra_section = doc[infra_start:] if infra_end == -1 else doc[infra_start:infra_end]
    infra_lower = infra_section.lower()

    service_aliases: dict[str, list[str]] = {
        "jolkr-api":   ["axum", "jolkr-api", "api", "web framework", "rust"],
        "jolkr-media":  ["jolkr-media", "media", "webrtc"],
        "postgres":     ["postgres", "postgresql"],
        "redis":        ["redis"],
        "minio":        ["minio", "s3", "object storage"],
        "nats":         ["nats", "event bus", "pub/sub"],
        "mailhog":      ["mailhog", "smtp", "email"],
        "nginx":        ["nginx", "reverse proxy"],
    }

    missing: list[str] = []
    for svc in sorted(services):
        aliases = service_aliases.get(svc, [svc])
        if not any(a.lower() in infra_lower for a in aliases):
            missing.append(svc)
            fail(f"Docker service '{svc}' not in Infrastructure section",
                 Finding(BD, "Infrastructure Stack", "Add",
                         f"Add Docker service `{svc}` to the Infrastructure Stack table"))

    ok = len(services) - len(missing)
    print(f"  {ok}/{len(services)} Docker services documented" + (" ✓" if not missing else ""))


def check_env_vars() -> None:
    """Check env vars from compose/.env.example are in doc §26."""
    print(f"\n[14/{TOTAL}] Environment variables  (docker-compose + .env.example ↔ doc §26)")

    doc = open(BACKEND_DOC, encoding="utf-8").read()

    env_start = doc.find("## 26.")
    if env_start == -1:
        env_start = doc.lower().find("## environment variables")
    if env_start == -1:
        fail("Section '## 26. Environment Variables' not found",
             Finding(BD, "§26 – Environment Variables", "Add",
                     "Add a '## 26. Environment Variables' section"))
        return

    env_end = doc.find("\n## ", env_start + 5)
    env_section = doc[env_start:] if env_end == -1 else doc[env_start:env_end]
    doc_vars: set[str] = {m.group(1) for m in re.finditer(r"`(\w+)`", env_section)}

    code_vars: set[str] = set()
    if os.path.exists(COMPOSE_YML):
        compose = open(COMPOSE_YML, encoding="utf-8").read()
        for m in re.finditer(r"\$\{(\w+?)(?:[:-][^}]*)?\}", compose):
            code_vars.add(m.group(1))
        for m in re.finditer(r"^\s+-\s+(\w+)=", compose, re.MULTILINE):
            code_vars.add(m.group(1))

    if os.path.exists(ENV_EXAMPLE):
        env_src = open(ENV_EXAMPLE, encoding="utf-8").read()
        for m in re.finditer(r"^(\w+)=", env_src, re.MULTILINE):
            code_vars.add(m.group(1))

    if not code_vars:
        warn("No env vars extracted — skipping")
        return

    # Filter out container-internal / well-known vars
    skip = {"POSTGRES_USER", "POSTGRES_DB", "TZ", "LANG", "PATH",
            "POSTGRES_PASSWORD", "MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD"}
    code_vars -= skip

    missing = sorted(code_vars - doc_vars)
    for var in missing:
        fail(f"Env var '{var}' in compose/.env.example but not in doc §26",
             Finding(BD, "§26 – Environment Variables", "Add",
                     f"Add env var `{var}` to the Environment Variables table"))

    ok = len(code_vars) - len(missing)
    print(f"  {ok}/{len(code_vars)} env vars documented" + (" ✓" if not missing else ""))


def check_response_structs() -> None:
    """Compare Rust response struct fields to doc response sections."""
    print(f"\n[15/{TOTAL}] Response structs  (routes/*.rs ↔ backend doc response sections)")

    handler_src = all_handler_source()
    if not handler_src:
        warn("No route handler source found — skipping")
        return

    router_src = open(ROUTER_RS, encoding="utf-8").read()
    doc        = open(BACKEND_DOC, encoding="utf-8").read()

    # Extract response struct names from handler return types
    handler_responses: dict[str, str] = {}
    for m in re.finditer(
        r"pub\s+async\s+fn\s+(\w+)\s*\([^)]*\)\s*->\s*Result\s*<\s*Json\s*<\s*(\w+)\s*>",
        handler_src,
    ):
        handler_responses[m.group(1)] = m.group(2)

    def struct_fields(name: str) -> set[str] | None:
        pattern = rf"(?:pub\s+)?struct\s+{re.escape(name)}\s*\{{([^}}]+)\}}"
        m = re.search(pattern, handler_src, re.DOTALL)
        if not m:
            return None
        fields: set[str] = set()
        for line in m.group(1).split("\n"):
            line = re.sub(r"//.*$", "", line).strip()
            line = re.sub(r"#\[.*?\]", "", line).strip()
            fm = re.match(r"(?:pub\s+)?(\w+)\s*:", line)
            if fm:
                fields.add(fm.group(1))
        return fields

    route_handler: dict[tuple[str, str], str] = {
        (method, path): handler
        for _, method, path, handler in parse_code_routes(router_src)
        if handler and path.startswith("/api/")
    }

    def doc_response_fields(method: str, path: str) -> set[str]:
        escaped = re.escape(path).replace(r"\:", ":")
        pattern = rf"#{{{2,4}}}\s+{re.escape(method)}\s+`?{escaped}`?"
        m = re.search(pattern, doc)
        if not m:
            return set()
        end = doc.find("\n## ", m.end())
        end2 = doc.find("\n### ", m.end())
        if end == -1: end = len(doc)
        if end2 != -1 and end2 < end: end = end2
        section = doc[m.end():end]
        fields: set[str] = set()
        for fm in re.finditer(r'"(\w+)"\s*:', section):
            fields.add(fm.group(1))
        for fm in re.finditer(r"\|\s*`?(\w+)`?\s*\|\s*`?[\w\[\]|<> ?]+`?\s*\|", section):
            fname = fm.group(1)
            if fname.lower() not in {"field", "veld", "name", "naam", "type", "required", "verplicht", "description", "beschrijving"}:
                fields.add(fname)
        return fields

    checked = ok = 0
    for (method, path), handler in sorted(route_handler.items()):
        struct_name = handler_responses.get(handler)
        if not struct_name:
            continue
        code_fields = struct_fields(struct_name)
        if code_fields is None:
            continue
        doc_fields = doc_response_fields(method, path)
        if not doc_fields:
            continue
        checked += 1
        add  = sorted(code_fields - doc_fields)
        drop = sorted(doc_fields - code_fields)
        if not add and not drop:
            ok += 1
        else:
            for field in add:
                fail(f"{method} {path}: response field '{field}' in struct but not in doc",
                     Finding(BD, f"Endpoint `{method} {path}` – Response", "Add",
                             f"Add field `{field}` to response doc (in struct '{struct_name}')"))
            for field in drop:
                fail(f"{method} {path}: response field '{field}' in doc but not in struct",
                     Finding(BD, f"Endpoint `{method} {path}` – Response", "Remove",
                             f"Remove field `{field}` from response doc (not in struct '{struct_name}')"))

    if checked == 0:
        warn("No response structs could be matched to doc sections")
        return
    print(f"  {ok}/{checked} response structs match" + (" ✓" if ok == checked else ""))


# ═══════════════════════════════════════════════════════════════════════════
#  PROMPT GENERATOR
# ═══════════════════════════════════════════════════════════════════════════

def generate_prompt() -> None:
    """
    Print a ready-to-use agent prompt listing every required doc fix,
    grouped by target file and section.

    When a doc file was freshly created (empty placeholder), the prompt
    instructs the agent to write the full document from scratch rather
    than making incremental edits.
    """
    if not findings:
        return

    # Group: doc → section → [action + description strings]
    grouped: dict[str, dict[str, list[str]]] = {}
    for f in findings:
        grouped.setdefault(f.doc, {}).setdefault(f.section, []).append(
            f"[{f.action}] {f.description}"
        )

    W = 66
    print("\n" + "═" * W)
    print("  DOCUMENTATION UPDATE PROMPT")
    print("═" * W)
    print(
        "\nCopy the prompt below and hand it to Claude (or any agent)\n"
        "to apply all documentation changes in one pass.\n"
    )
    print("─" * W)

    # Determine whether this is a full creation run or a patch run
    all_new = new_doc_files == {BD, FD}
    any_new = bool(new_doc_files)

    if all_new:
        preamble = """\
You are a technical writer for the Jolkr project.
Neither documentation file exists yet. Create both files from
scratch using the findings below as your complete specification.
The findings were generated by an automated verification tool
that read all source files and extracted every item that must
be documented.

RULES:
  - Create well-structured Markdown files with clear headings.
  - Use tables for endpoints, events, fields, and enums.
  - Include a version reference section in each file.
  - Document every item listed below — do not skip any.
  - After finishing, print a numbered summary of every section
    you created."""
    elif any_new:
        new_names = ", ".join(sorted(new_doc_files))
        preamble = f"""\
You are a technical writer for the Jolkr project.
The file(s) {new_names} did not exist and have been created as
empty placeholders. Write those files from scratch. For any
file that already existed, apply only the changes listed below.
The findings were generated by an automated verification tool.

RULES:
  - For NEW files: create well-structured Markdown with tables
    for endpoints, events, fields, and enums.
  - For EXISTING files: change ONLY what is listed below.
    Preserve all existing formatting and structure.
  - Document every item listed below — do not skip any.
  - After finishing, print a numbered summary of every change."""
    else:
        preamble = """\
You are a technical writer for the Jolkr project.
Apply the changes below to the documentation files.
The findings were generated by an automated verification tool
that compared the source code to the current documentation.

RULES:
  - Change ONLY what is explicitly listed below.
  - Preserve all existing formatting, table style, and structure.
  - Do not add extra explanation or text outside the changes.
  - After finishing, print a numbered summary of every change."""

    print(f"\n{preamble}\n")

    for doc_name in sorted(grouped):
        print("─" * W)
        status = " [NEW FILE — write from scratch]" if doc_name in new_doc_files else ""
        print(f"FILE: {doc_name}{status}\n")
        for section in sorted(grouped[doc_name]):
            print(f"  ▸ {section}")
            for item in grouped[doc_name][section]:
                print(f"    • {item}")
            print()

    print("─" * W)
    print(
        f"  Total: {len(findings)} change(s) across {len(grouped)} file(s).\n"
        f"  Apply all items to make the documentation fully correct."
    )
    print("─" * W)


# ═══════════════════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    W = 60
    print("=" * W)
    print("  Documentation Verification  —  Jolkr")
    print("=" * W)

    # Hard stop if source files are missing — nothing to verify without them
    missing_sources = [p for p in SOURCE_FILES if not os.path.exists(p)]
    if missing_sources:
        for p in missing_sources:
            print(f"ERROR: required source file not found: {p}")
        sys.exit(2)

    # Create empty doc placeholders if needed, then run all checks
    print()
    ensure_doc_files()

    check_interfaces()          # 1
    check_enums()               # 2
    check_routes()              # 3
    check_status_codes()        # 4
    check_ws_events()           # 5
    check_versions()            # 6
    check_auth()                # 7
    check_request_bodies()      # 8
    check_shared_types()        # 9
    check_deprecated()          # 10
    check_client_routes()       # 11
    check_migrations()          # 12
    check_docker_services()     # 13
    check_env_vars()            # 14
    check_response_structs()    # 15

    print("\n" + "=" * W)
    if errors == 0:
        print("  ALL CHECKS PASSED ✓  —  docs are up-to-date")
        print("=" * W)
        sys.exit(0)
    else:
        print(f"  {errors} MISMATCH(ES) FOUND ✗")
        print("=" * W)
        generate_prompt()
        sys.exit(1)
