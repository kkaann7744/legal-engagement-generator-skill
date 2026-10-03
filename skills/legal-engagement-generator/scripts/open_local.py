#!/usr/bin/env python3
"""Open the bundled offline form without reading any case information."""
import json
import webbrowser
from pathlib import Path


def main():
    page = Path(__file__).resolve().parent.parent / "assets" / "generator.html"
    if not page.is_file():
        print(json.dumps({"status": "unavailable", "code": "asset_missing"}))
        return 2
    try:
        opened = webbrowser.open(page.as_uri(), new=2)
    except Exception:
        opened = False
    print(json.dumps({"status": "opened" if opened else "manual_open_required"}))
    return 0 if opened else 2


if __name__ == "__main__":
    raise SystemExit(main())
