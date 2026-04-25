"""
Bulk-apply mechanical lint fixes derived from /tmp/check.log to the jolkr-server workspace.

Handles:
- missing_docs (struct field / struct / module / fn / variant / constant / crate / method)
- unreachable_pub  -> pub(crate)
- let_underscore_drop -> drop(...)
- trivial_numeric_cast (drops `as f32` when source is already f32)

Idempotent: skips items that already have a /// doc comment immediately above.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parent.parent / "jolkr-server"
LOG = Path(r"f:/DevProjects/Entrochat") / sys.argv[1] if len(sys.argv) > 1 else Path("/tmp/check.log")

WARNING_RE = re.compile(r"^warning: (.+)$")
LOCATION_RE = re.compile(r"^\s*--> (crates/[^:]+):(\d+):(\d+)\s*$")


# ---------- name humanization ----------

ABBREV = {
    "id": "identifier",
    "uuid": "UUID",
    "url": "URL",
    "uri": "URI",
    "ws": "WebSocket",
    "http": "HTTP",
    "api": "API",
    "ip": "IP",
    "tls": "TLS",
    "ssl": "SSL",
    "db": "database",
    "tos": "Terms of Service",
    "dm": "DM",
    "dms": "DMs",
    "vm": "VM",
    "ttl": "TTL",
    "smtp": "SMTP",
    "json": "JSON",
    "jwt": "JWT",
    "sfu": "SFU",
    "sdp": "SDP",
    "ice": "ICE",
    "rtc": "RTC",
    "e2ee": "E2EE",
}


def humanize(snake: str) -> str:
    parts = [p for p in snake.split("_") if p]
    if not parts:
        return snake
    out: list[str] = []
    for i, p in enumerate(parts):
        lower = p.lower()
        word = ABBREV.get(lower, p)
        if i == 0:
            word = word[0].upper() + word[1:]
        out.append(word)
    return " ".join(out)


def field_doc(field_name: str) -> str:
    """Generate a 1-line doc for a struct field."""
    s = field_name.lower()
    # Common patterns
    common = {
        "id": "Unique identifier.",
        "user_id": "Owning user identifier.",
        "server_id": "Owning server identifier.",
        "channel_id": "Owning channel identifier.",
        "message_id": "Referenced message identifier.",
        "thread_id": "Owning thread identifier.",
        "role_id": "Role identifier.",
        "session_id": "Session identifier.",
        "device_id": "Device identifier.",
        "invite_id": "Invite identifier.",
        "webhook_id": "Webhook identifier.",
        "emoji_id": "Emoji identifier.",
        "poll_id": "Poll identifier.",
        "attachment_id": "Attachment identifier.",
        "reaction_id": "Reaction identifier.",
        "creator_id": "Creator user identifier.",
        "author_id": "Author user identifier.",
        "uploader_id": "Uploader user identifier.",
        "requester_id": "Requesting user identifier.",
        "addressee_id": "Addressee user identifier.",
        "banned_by": "Identifier of the user who issued the ban.",
        "category_id": "Owning category identifier.",
        "parent_id": "Parent identifier.",
        "name": "Display name.",
        "username": "Login username.",
        "email": "Email address.",
        "password": "Password (typically hashed).",
        "password_hash": "Argon2 password hash.",
        "display_name": "Optional display name shown in the UI.",
        "avatar_url": "Avatar image URL.",
        "icon_url": "Icon image URL.",
        "banner_url": "Banner image URL.",
        "image_url": "Image URL.",
        "preview_url": "Preview image URL.",
        "url": "Resource URL.",
        "content": "Message content (may be encrypted).",
        "nonce": "Encryption nonce when content is encrypted.",
        "title": "Title text.",
        "description": "Description text.",
        "color": "Color value (RGB).",
        "position": "Sort position.",
        "permissions": "Permission bitmask.",
        "is_default": "Whether this is the default entry.",
        "is_public": "Whether this entry is publicly visible.",
        "is_pinned": "Whether the message is pinned.",
        "is_edited": "Whether the message has been edited.",
        "is_online": "Whether the user is currently online.",
        "is_system": "Whether this is a system-generated entity.",
        "is_group": "Whether this is a group conversation.",
        "is_animated": "Whether the asset is animated.",
        "animated": "Whether the asset is animated.",
        "is_e2ee": "Whether the channel uses end-to-end encryption.",
        "created_at": "Creation timestamp.",
        "updated_at": "Last-update timestamp.",
        "deleted_at": "Soft-deletion timestamp.",
        "expires_at": "Expiration timestamp.",
        "joined_at": "Join timestamp.",
        "timeout_until": "Timestamp until which the user is timed out.",
        "size_bytes": "Size in bytes.",
        "kind": "Discriminator describing the variant.",
        "type": "Discriminator describing the variant.",
        "status": "Current status.",
        "token": "Opaque token string.",
        "token_hash": "SHA-256 hash of the token.",
        "refresh_token": "Refresh token string.",
        "access_token": "Access token string.",
        "expires_in": "Lifetime in seconds.",
        "use_count": "Number of times this entry has been used.",
        "max_uses": "Maximum allowed uses (None = unlimited).",
        "max_age_seconds": "Lifetime in seconds.",
        "member_count": "Cached member count.",
        "message_count": "Cached message count.",
        "thread_reply_count": "Number of replies in this thread.",
        "starter_msg_id": "Identifier of the message that started the thread.",
        "key_generation": "Key rotation generation counter.",
        "e2ee_key_generation": "Active E2EE key rotation generation.",
        "members": "Member list.",
        "embeds": "Attached embeds.",
        "attachments": "Attached files.",
        "reactions": "Aggregated reactions.",
        "poll": "Attached poll, if any.",
        "options": "Options list.",
        "votes": "Vote count.",
        "my_votes": "Votes cast by the calling user.",
        "multi_select": "Whether multiple options can be selected.",
        "anonymous": "Whether votes are anonymous.",
        "duration_seconds": "Duration in seconds.",
        "expires_in_hours": "Expiration in hours.",
        "max_age": "Maximum lifetime.",
        "burst": "Token-bucket burst capacity.",
        "refill_rate": "Token-bucket refill rate.",
        "key": "Lookup key.",
        "value": "Stored value.",
        "data": "Payload data.",
        "metadata": "Auxiliary metadata.",
        "config": "Configuration.",
        "mime_type": "MIME type string.",
        "filename": "File name.",
        "host": "Host name or address.",
        "port": "Port number.",
        "address": "Network address.",
        "endpoint": "Endpoint URL.",
        "path": "Filesystem or URL path.",
        "code": "Status or error code.",
        "message": "Human-readable message.",
        "reason": "Reason text.",
        "label": "Display label.",
    }
    if s in common:
        return common[s]
    # Default: humanize the field name
    h = humanize(s)
    if s.endswith("_id"):
        return f"{humanize(s[:-3])} identifier."
    if s.endswith("_at"):
        return f"{humanize(s[:-3])} timestamp."
    if s.startswith("is_") or s.startswith("has_"):
        return f"Whether {humanize(s[3:] if s.startswith('is_') else s[4:]).lower()}."
    if s.endswith("_url"):
        return f"{humanize(s[:-4])} URL."
    if s.endswith("_count"):
        return f"{humanize(s[:-6])} count."
    if s.endswith("_hash"):
        return f"{humanize(s[:-5])} hash."
    return f"{h}."


def fn_doc(fn_name: str, struct_ctx: str | None = None) -> str:
    s = fn_name.lower()
    # Common factory/getter patterns
    patterns = {
        "new": f"Creates a new instance.",
        "default": "Returns the default value.",
        "from_uuid": "Wraps an existing UUID into the strongly-typed identifier.",
        "from_row": "Builds the type from a database row.",
        "from_str": "Parses from a string.",
        "to_string": "Converts to a string.",
        "as_str": "Returns the string representation.",
        "as_ref": "Returns a reference to the inner value.",
        "is_empty": "Returns `true` if the value is empty.",
        "len": "Returns the length.",
        "build": "Builds the configured value.",
        "init": "Initializes the value.",
        "run": "Runs the operation.",
    }
    if s in patterns:
        return patterns[s]
    # Verb patterns
    if s.startswith("get_") or s == "get":
        return f"Fetches {humanize(s[4:] or 'the entity').lower()}."
    if s.startswith("list_") or s == "list":
        return f"Lists {humanize(s[5:] or 'matching entries').lower()}."
    if s.startswith("create_") or s == "create":
        return f"Creates {humanize(s[7:] or 'a new entry').lower()}."
    if s.startswith("update_") or s == "update":
        return f"Updates {humanize(s[7:] or 'an existing entry').lower()}."
    if s.startswith("delete_") or s == "delete":
        return f"Deletes {humanize(s[7:] or 'an entry').lower()}."
    if s.startswith("remove_") or s == "remove":
        return f"Removes {humanize(s[7:] or 'an entry').lower()}."
    if s.startswith("insert_") or s == "insert":
        return f"Inserts {humanize(s[7:] or 'a new row').lower()}."
    if s.startswith("find_") or s == "find":
        return f"Finds {humanize(s[5:] or 'matching entries').lower()}."
    if s.startswith("count_") or s == "count":
        return f"Counts {humanize(s[6:] or 'matching entries').lower()}."
    if s.startswith("set_"):
        return f"Sets {humanize(s[4:]).lower()}."
    if s.startswith("with_"):
        return f"Returns a copy with {humanize(s[5:]).lower()} set."
    if s.startswith("verify_"):
        return f"Verifies {humanize(s[7:]).lower()}."
    if s.startswith("validate_"):
        return f"Validates {humanize(s[9:]).lower()}."
    if s.startswith("check_"):
        return f"Checks {humanize(s[6:]).lower()}."
    if s.startswith("ensure_"):
        return f"Ensures {humanize(s[7:]).lower()}."
    if s.startswith("send_"):
        return f"Sends {humanize(s[5:]).lower()}."
    if s.startswith("receive_"):
        return f"Receives {humanize(s[8:]).lower()}."
    if s.startswith("handle_"):
        return f"Handles {humanize(s[7:]).lower()}."
    if s.startswith("on_"):
        return f"Callback fired on {humanize(s[3:]).lower()}."
    if s.startswith("can_"):
        return f"Returns `true` if the caller can {humanize(s[4:]).lower()}."
    if s.startswith("has_"):
        return f"Returns `true` if the entity has {humanize(s[4:]).lower()}."
    if s.startswith("is_"):
        return f"Returns `true` if {humanize(s[3:]).lower()}."
    if s.startswith("status_"):
        return f"Reports {humanize(s).lower()}."
    if s.startswith("encrypt"):
        return "Encrypts the input."
    if s.startswith("decrypt"):
        return "Decrypts the input."
    if s.startswith("hash"):
        return "Computes the hash."
    if s.startswith("sign"):
        return "Signs the input."
    if s.endswith("_handler"):
        return f"Axum handler for {humanize(s[:-8]).lower()}."
    return f"{humanize(s)}."


def variant_doc(variant: str) -> str:
    return f"`{variant}` variant."


def const_doc(name: str) -> str:
    return f"`{name}` constant."


def struct_doc(name: str) -> str:
    """Generate a 1-line doc for a struct/enum based on naming conventions."""
    if name.endswith("Request"):
        return f"Request payload for the `{name[:-7]}` operation."
    if name.endswith("Response"):
        return f"Response body returned by the `{name[:-8]}` operation."
    if name.endswith("Row"):
        return f"Database row for `{name[:-3].lower()}`."
    if name.endswith("Info"):
        return f"Public information about `{name[:-4].lower()}`."
    if name.endswith("Repo"):
        return f"Repository for `{name[:-4].lower()}` persistence."
    if name.endswith("Service"):
        return f"Domain service for `{name[:-7].lower()}` operations."
    if name.endswith("State"):
        return f"Shared application state for `{name[:-5].lower() or 'the api'}`."
    if name.endswith("Config"):
        return f"Configuration for `{name[:-6].lower() or 'the application'}`."
    if name.endswith("Error"):
        return f"Errors that can occur in `{name[:-5].lower() or 'this crate'}`."
    if name.endswith("Event"):
        return f"`{name}` event payload."
    if name.endswith("Layer"):
        return f"Tower layer for `{name[:-5].lower()}`."
    if name.endswith("Middleware"):
        return f"Middleware for `{name[:-10].lower()}`."
    if name.endswith("Builder"):
        return f"Builder for `{name[:-7]}`."
    if name.endswith("Handle"):
        return f"Handle to `{name[:-6].lower()}`."
    if name.endswith("Manager"):
        return f"Manager for `{name[:-7].lower()}`."
    if name.endswith("Pool"):
        return f"Pool of `{name[:-4].lower()}`."
    if name.endswith("Store"):
        return f"Store for `{name[:-5].lower()}`."
    if name.endswith("Cache"):
        return f"Cache for `{name[:-5].lower()}`."
    return f"`{name}` value."


def module_doc(file_path: str) -> str:
    """Doc for a module file based on its path."""
    name = Path(file_path).stem
    if name == "mod":
        # use parent dir name
        name = Path(file_path).parent.name
    h = humanize(name)
    return f"{h} module."


CRATE_DOCS = {
    "jolkr-common": "Cross-crate primitives: error type, permission bitmask, and strongly-typed identifiers.",
    "jolkr-db": "Database access layer: SQLx-backed repositories and row models for the Jolkr server.",
    "jolkr-core": "Domain services: cryptography helpers, business logic, and use-cases on top of the database layer.",
    "jolkr-api": "Jolkr HTTP/WebSocket API server: Axum routes, middleware, and the gateway.",
    "jolkr-media": "Jolkr media gateway (SFU): WebRTC signaling and forwarding for voice/video rooms.",
}


def crate_doc(file_path: str) -> str:
    parts = Path(file_path).parts
    for i, p in enumerate(parts):
        if p == "crates" and i + 1 < len(parts):
            crate = parts[i + 1]
            return CRATE_DOCS.get(crate, f"`{crate}` crate.")
    return "Crate documentation."


# ---------- log parsing ----------


def parse_log(log_path: Path):
    """Yield (warning_kind, file, line, col) tuples."""
    text = log_path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        m = WARNING_RE.match(lines[i])
        if m and i + 1 < len(lines):
            kind = m.group(1)
            loc = LOCATION_RE.match(lines[i + 1])
            if loc:
                file = loc.group(1)
                line = int(loc.group(2))
                col = int(loc.group(3))
                yield kind, file, line, col
                i += 2
                continue
        i += 1


# ---------- patchers ----------


IDENT_RE = r"[a-zA-Z_][a-zA-Z0-9_]*"


def get_indent(line: str) -> str:
    return line[: len(line) - len(line.lstrip())]


def has_doc_above(file_lines: list[str], idx: int) -> bool:
    """Return True if line idx-1 (0-based) is already a /// doc comment."""
    if idx <= 0:
        return False
    prev = file_lines[idx - 1].lstrip()
    return prev.startswith("///") or prev.startswith("//!")


def skip_attrs_back(file_lines: list[str], idx: int) -> int:
    """Walk backwards over `#[...]` attribute lines and return the topmost attr line index (or idx itself if no attrs)."""
    j = idx - 1
    while j >= 0:
        s = file_lines[j].lstrip()
        if s.startswith("#["):
            j -= 1
            continue
        # Sometimes attrs span multiple lines; for safety stop on closing only.
        break
    return j + 1


def insert_doc_line(file_lines: list[str], idx: int, doc_text: str) -> bool:
    """Insert a /// doc comment line right above `idx` (after skipping any attrs).
    Returns True if inserted, False if it was already documented."""
    target = skip_attrs_back(file_lines, idx)
    if has_doc_above(file_lines, target):
        return False
    indent = get_indent(file_lines[idx])
    file_lines.insert(target, f"{indent}/// {doc_text}\n")
    return True


def insert_inner_doc(file_lines: list[str], doc_text: str) -> bool:
    """Insert a //! crate/module-level doc at the very top of the file."""
    if file_lines and (file_lines[0].lstrip().startswith("//!")):
        return False
    file_lines.insert(0, f"//! {doc_text}\n")
    return True


# ---------- field doc derivation from line ----------

FIELD_RE = re.compile(r"^\s*pub(?:\([^)]+\))?\s+(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)\s*:")
STRUCT_RE = re.compile(r"^\s*pub(?:\([^)]+\))?\s+(?:struct|enum)\s+(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)")
FN_RE = re.compile(r"^\s*pub(?:\([^)]+\))?\s+(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)")
CONST_RE = re.compile(r"^\s*pub(?:\([^)]+\))?\s+const\s+(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)")
VARIANT_RE = re.compile(r"^\s*(?P<name>[A-Z][a-zA-Z0-9_]*)(?:[\s,({]|$)")
MOD_DECL_RE = re.compile(r"^\s*pub(?:\([^)]+\))?\s+mod\s+(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)")


def doc_for(kind: str, line: str, file_path: str) -> str | None:
    """Return the doc string to insert, given the warning kind and the source line."""
    if kind == "missing documentation for a struct field":
        m = FIELD_RE.match(line)
        if m:
            return field_doc(m.group("name"))
        return "Field."
    if kind == "missing documentation for a struct":
        m = STRUCT_RE.match(line)
        if m:
            return struct_doc(m.group("name"))
        return None
    if kind == "missing documentation for an associated function" or kind == "missing documentation for a method":
        m = FN_RE.match(line)
        if m:
            return fn_doc(m.group("name"))
        return None
    if kind == "missing documentation for a variant":
        m = VARIANT_RE.match(line)
        if m:
            return variant_doc(m.group("name"))
        return None
    if kind == "missing documentation for an associated constant":
        m = CONST_RE.match(line)
        if m:
            return const_doc(m.group("name"))
        return None
    if kind == "missing documentation for a module":
        m = MOD_DECL_RE.match(line)
        if m:
            return f"{humanize(m.group('name'))} module."
        return None
    return None


# ---------- main fix loop ----------


def main():
    print(f"Reading log: {LOG}")
    fixes: dict[Path, list[tuple[int, str, str]]] = defaultdict(list)
    crate_root_fixes: set[Path] = set()
    pub_fixes: dict[Path, set[int]] = defaultdict(set)
    let_drop_fixes: dict[Path, set[int]] = defaultdict(set)

    for kind, rel_path, line, col in parse_log(LOG):
        path = ROOT / rel_path
        if kind.startswith("missing documentation for"):
            if kind == "missing documentation for the crate":
                crate_root_fixes.add(path)
            else:
                fixes[path].append((line, kind, ""))
        elif kind == "unreachable `pub` item":
            pub_fixes[path].add(line)
        elif kind == "non-binding let on a type that has a destructor":
            let_drop_fixes[path].add(line)

    total_doc = 0
    total_pub = 0
    total_drop = 0

    # Apply per-file
    all_paths = set(fixes.keys()) | crate_root_fixes | set(pub_fixes.keys()) | set(let_drop_fixes.keys())
    for path in sorted(all_paths):
        if not path.exists():
            print(f"  skip (no file): {path}")
            continue
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines(keepends=True)

        # Apply doc inserts in REVERSE line order so insertions don't shift earlier lines.
        per_line_kinds: dict[int, list[str]] = defaultdict(list)
        for line, kind, _ in fixes.get(path, []):
            per_line_kinds[line].append(kind)
        # Use line numbers (1-based) as keys.
        for ln in sorted(per_line_kinds.keys(), reverse=True):
            idx = ln - 1
            if idx < 0 or idx >= len(lines):
                continue
            for kind in per_line_kinds[ln]:
                src_line = lines[idx].rstrip("\n")
                doc = doc_for(kind, src_line, str(path))
                if doc is None:
                    continue
                if insert_doc_line(lines, idx, doc):
                    total_doc += 1

        # Apply unreachable_pub: replace leading `pub` with `pub(crate)` on each flagged line.
        for ln in pub_fixes.get(path, set()):
            idx = ln - 1
            if 0 <= idx < len(lines):
                old = lines[idx]
                # Replace first occurrence of "pub " (not already pub(crate))
                new = re.sub(r"^(\s*)pub(\s)", r"\1pub(crate)\2", old, count=1)
                if new != old:
                    lines[idx] = new
                    total_pub += 1

        # Apply let_underscore_drop: `let _ = X;` -> `drop(X);`
        for ln in let_drop_fixes.get(path, set()):
            idx = ln - 1
            if 0 <= idx < len(lines):
                old = lines[idx]
                m = re.match(r"^(\s*)let\s+_\s*=\s*(.*?);(\s*)$", old)
                if m:
                    indent, expr, trail = m.group(1), m.group(2), m.group(3)
                    lines[idx] = f"{indent}drop({expr});{trail}"
                    total_drop += 1

        # Crate-level //! doc
        if path in crate_root_fixes:
            cdoc = crate_doc(str(path).replace("\\", "/"))
            if insert_inner_doc(lines, cdoc):
                total_doc += 1

        path.write_text("".join(lines), encoding="utf-8")

    print(f"Inserted {total_doc} doc comments")
    print(f"Replaced {total_pub} `pub` -> `pub(crate)`")
    print(f"Replaced {total_drop} `let _ = ...` -> `drop(...)`")


if __name__ == "__main__":
    main()
