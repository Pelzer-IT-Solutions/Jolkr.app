"""Remove draft release v0.11.1 (versionCode 11001) from the internal track.

Steps:
  1. Create an edit
  2. GET the current internal track
  3. Filter out the draft (versionCode 11001), keep everything else
  4. PUT the filtered track
  5. Commit the edit
  6. Re-fetch and print the resulting state
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
TRACK = "internal"
DRAFT_VERSION_CODE = "11001"
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
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    r = requests.post(f"{BASE}/edits", headers=headers, timeout=30)
    if r.status_code != 200:
        print(f"create edit failed: {r.status_code} {r.text}", file=sys.stderr)
        return 1
    edit_id = r.json()["id"]
    print(f"edit created: {edit_id}")

    committed = False
    try:
        tr = requests.get(f"{BASE}/edits/{edit_id}/tracks/{TRACK}", headers=headers, timeout=30)
        if tr.status_code != 200:
            print(f"get track failed: {tr.status_code} {tr.text}", file=sys.stderr)
            return 1
        track = tr.json()
        releases = track.get("releases", []) or []

        kept = [
            rel for rel in releases
            if DRAFT_VERSION_CODE not in (rel.get("versionCodes") or [])
        ]
        removed = [r for r in releases if r not in kept]

        print(f"\nbefore — {len(releases)} releases:")
        for rel in releases:
            print(f"  {rel.get('status')} versionCodes={rel.get('versionCodes')} name={rel.get('name')!r}")
        print(f"\nremoving {len(removed)}:")
        for rel in removed:
            print(f"  - {rel.get('status')} versionCodes={rel.get('versionCodes')} name={rel.get('name')!r}")

        if not removed:
            print("\nnothing to remove — aborting (will discard edit)")
            return 0

        new_track = {"track": TRACK, "releases": kept}
        pr = requests.put(
            f"{BASE}/edits/{edit_id}/tracks/{TRACK}",
            headers=headers,
            data=json.dumps(new_track),
            timeout=30,
        )
        if pr.status_code != 200:
            print(f"put track failed: {pr.status_code} {pr.text}", file=sys.stderr)
            return 1
        print("\nput track ok")

        cm = requests.post(f"{BASE}/edits/{edit_id}:commit", headers=headers, timeout=30)
        if cm.status_code != 200:
            print(f"commit failed: {cm.status_code} {cm.text}", file=sys.stderr)
            return 1
        committed = True
        print("commit ok")
    finally:
        if not committed:
            requests.delete(f"{BASE}/edits/{edit_id}", headers=headers, timeout=30)
            print("edit discarded (not committed)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
