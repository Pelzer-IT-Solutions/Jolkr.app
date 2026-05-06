"""Read-only snapshot of Google Play Console state for io.jolkr.app.

Uses the service account in keys/google-playstore-key.json. Creates an edit,
lists tracks (with releases + version codes), then discards the edit. No
writes survive this script.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

ROOT = Path(__file__).resolve().parents[1]
KEY_PATH = ROOT / "keys" / "google-playstore-key.json"
PACKAGE = "io.jolkr.app"
SCOPES = ["https://www.googleapis.com/auth/androidpublisher"]
BASE = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}"


def get_token() -> str:
    creds = service_account.Credentials.from_service_account_file(
        str(KEY_PATH), scopes=SCOPES
    )
    creds.refresh(Request())
    return creds.token


def main() -> int:
    token = get_token()
    headers = {"Authorization": f"Bearer {token}"}

    r = requests.post(f"{BASE}/edits", headers=headers, timeout=30)
    if r.status_code != 200:
        print(f"create edit failed: {r.status_code} {r.text}", file=sys.stderr)
        return 1
    edit_id = r.json()["id"]

    try:
        tr = requests.get(f"{BASE}/edits/{edit_id}/tracks", headers=headers, timeout=30)
        if tr.status_code != 200:
            print(f"list tracks failed: {tr.status_code} {tr.text}", file=sys.stderr)
            return 1
        tracks = tr.json().get("tracks", [])

        print(f"Package: {PACKAGE}")
        print(f"Tracks ({len(tracks)}):\n")
        for t in tracks:
            name = t.get("track")
            releases = t.get("releases", []) or []
            print(f"  [{name}]")
            if not releases:
                print("    (no releases)")
                continue
            for rel in releases:
                status = rel.get("status")
                rel_name = rel.get("name", "")
                version_codes = rel.get("versionCodes", [])
                user_fraction = rel.get("userFraction")
                country_targeting = rel.get("countryTargeting")
                print(f"    - status={status} name={rel_name!r} versionCodes={version_codes}"
                      + (f" userFraction={user_fraction}" if user_fraction is not None else "")
                      + (f" countryTargeting={country_targeting}" if country_targeting else ""))
            print()
    finally:
        d = requests.delete(f"{BASE}/edits/{edit_id}", headers=headers, timeout=30)
        if d.status_code not in (204, 200):
            print(f"warn: edit {edit_id} discard returned {d.status_code}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
