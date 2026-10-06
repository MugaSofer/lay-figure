"""Refuse commits that would publish raw or adult assets, or oversized binaries.

The repo is public, so a slip here is a redistribution, not just a messy history.
Bypass only deliberately: `git commit --no-verify`, and say why in the message.
"""
import subprocess
import sys

MAX_BYTES = 5 * 1024 * 1024
FORBIDDEN_PREFIXES = ("assets-src/", "adult/")
FORBIDDEN_PARTS = ("/adult/",)
RAW_EXTS = (".blend", ".fbx", ".bvh", ".c3d", ".obj", ".mhm", ".mhclo", ".zip", ".7z", ".rar")


def staged():
    out = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
        capture_output=True, check=True,
    ).stdout.decode("utf-8")
    return [p for p in out.split("\0") if p]


def blob_size(path):
    out = subprocess.run(["git", "cat-file", "-s", f":{path}"], capture_output=True, check=True)
    return int(out.stdout)


def main():
    problems = []
    paths = staged()
    for p in paths:
        low = p.lower()
        if low.startswith(FORBIDDEN_PREFIXES) or any(x in "/" + low for x in FORBIDDEN_PARTS):
            problems.append(f"{p}: raw/adult asset paths never go in git")
        elif low.endswith(RAW_EXTS):
            problems.append(f"{p}: raw source format; convert via pipeline/ instead")
        elif blob_size(p) > MAX_BYTES:
            problems.append(f"{p}: {blob_size(p) / 1e6:.1f} MB exceeds {MAX_BYTES / 1e6:.0f} MB")
    new_assets = [p for p in paths if p.startswith("public/assets/")]
    if new_assets and "ASSETS.md" not in paths:
        problems.append("public/assets/ changed but ASSETS.md is not staged; log licence + URL first")
    if problems:
        print("pre-commit: refusing commit:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
