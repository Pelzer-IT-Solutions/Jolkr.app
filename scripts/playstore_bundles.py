"""List all uploaded AAB bundles for io.jolkr.app (read-only)."""
from __future__ import annotations

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


def main() -> int:
    creds = service_account.Credentials.from_service_account_file(str(KEY_PATH), scopes=SCOPES)
    creds.refresh(Request())
    headers = {"Authorization": f"Bearer {creds.token}"}

    r = requests.post(f"{BASE}/edits", headers=headers, timeout=30)
    if r.status_code != 200:
        print(f"create edit failed: {r.status_code} {r.text}", file=sys.stderr)
        return 1
    edit_id = r.json()["id"]

    try:
        b = requests.get(f"{BASE}/edits/{edit_id}/bundles", headers=headers, timeout=30)
        print(f"bundles status={b.status_code}")
        print(b.text)
        a = requests.get(f"{BASE}/edits/{edit_id}/apks", headers=headers, timeout=30)
        print(f"\napks status={a.status_code}")
        print(a.text)
    finally:
        requests.delete(f"{BASE}/edits/{edit_id}", headers=headers, timeout=30)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
