#!/usr/bin/env bash
# Extract a package (with its history) into its own branch, ready to become its own repo.
# Usage: scripts/extract_package.sh hori|zon   (web: scripts/extract_package.sh web)
set -euo pipefail
pkg="${1:?usage: extract_package.sh hori|zon|web}"
case "$pkg" in
  hori|zon) prefix="packages/$pkg" ;;
  web)      prefix="apps/web" ;;
  *) echo "unknown package: $pkg" >&2; exit 1 ;;
esac
git subtree split --prefix="$prefix" -b "export/$pkg"
echo "Branch export/$pkg created. To make a standalone repo:"
echo "  git clone . ../$pkg-standalone -b export/$pkg"
