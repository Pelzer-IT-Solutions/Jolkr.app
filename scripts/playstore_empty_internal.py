"""Empty the internal track entirely (releases: []) and commit.

Removes both the v0.11.1 draft and the legacy completed v0.10.2 entry from the
internal track. Uploaded AABs remain available in the Play Console bundle
archive — they are simply no longer linked to a track release.
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
        pr = requests.put(
            f"{BASE}/edits/{edit_id}/tracks/{TRACK}",
            headers=headers,
            data=json.dumps({"track": TRACK, "releases": []}),
            timeout=30,
        )
        if pr.status_code != 200:
            print(f"put track failed: {pr.status_code} {pr.text}", file=sys.stderr)
            return 1
        print("put track ok (releases: [])")

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
