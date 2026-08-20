#!/usr/bin/env python3
"""Inject QR-to-file hooks into upstream whatsapp-bridge/main.go (idempotent)."""
from __future__ import annotations

import pathlib
import sys

MARKER = "bwb-qr-file-hook"
WRITE_LINE = (
    f'\t\t\t\t\t_ = os.WriteFile("store/qr.code", []byte(evt.Code), 0o600) // {MARKER}\n'
)
REMOVE_SUCCESS = f'\t\t\t\t\t_ = os.Remove("store/qr.code") // {MARKER}\n'
REMOVE_TIMEOUT = f'\t\t\t\t\t_ = os.Remove("store/qr.code") // {MARKER}-timeout\n'


def patch(path: pathlib.Path) -> int:
    text = path.read_text(encoding="utf-8")
    if MARKER in text and "store/qr.code" in text:
        print(f"already patched: {path}")
        return 0

    # On every QR code event, persist payload for the admin UI.
    needle_code = '\t\t\t\tif evt.Event == "code" {\n'
    if needle_code not in text:
        print("ERROR: code-event block not found", file=sys.stderr)
        return 1
    text = text.replace(
        needle_code,
        needle_code + WRITE_LINE,
        1,
    )

    # Clear QR file on success.
    needle_success = '\t\t\t\t} else if evt.Event == "success" {\n'
    if needle_success not in text:
        print("ERROR: success-event block not found", file=sys.stderr)
        return 1
    text = text.replace(
        needle_success,
        needle_success + REMOVE_SUCCESS,
        1,
    )

    # Clear QR file on timeout.
    needle_timeout = '\t\t\t\t} else if evt.Event == "timeout" {\n'
    if needle_timeout not in text:
        print("ERROR: timeout-event block not found", file=sys.stderr)
        return 1
    text = text.replace(
        needle_timeout,
        needle_timeout + REMOVE_TIMEOUT,
        1,
    )

    path.write_text(text, encoding="utf-8")
    print(f"patched: {path}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} path/to/main.go", file=sys.stderr)
        sys.exit(2)
    raise SystemExit(patch(pathlib.Path(sys.argv[1])))
