#!/usr/bin/env bash
# Bump version + sync module.json + commit + tag + push.
# The CI workflow at .github/workflows/release.yml takes over from there:
# it builds module.zip and creates the GitHub release with both assets.
#
# Usage: ./scripts-dev/release.sh 0.1.1
#        ./scripts-dev/release.sh patch     # 0.1.0 → 0.1.1
#        ./scripts-dev/release.sh minor     # 0.1.0 → 0.2.0
#        ./scripts-dev/release.sh major     # 0.1.0 → 1.0.0

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${1:-}" ]; then
  echo "usage: $0 <new-version | patch | minor | major>" >&2
  exit 1
fi

CURRENT=$(python3 -c "import json; print(json.load(open('module.json'))['version'])")
TARGET="$1"

case "$TARGET" in
  patch|minor|major)
    NEW=$(python3 -c "
v = '$CURRENT'.split('.')
v = [int(x) for x in v]
kind = '$TARGET'
if kind == 'patch': v[2] += 1
elif kind == 'minor': v[1] += 1; v[2] = 0
elif kind == 'major': v[0] += 1; v[1] = 0; v[2] = 0
print('.'.join(map(str, v)))
")
    ;;
  *)
    NEW="$TARGET"
    ;;
esac

if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: '$NEW' is not a semver x.y.z" >&2
  exit 1
fi

echo "current: $CURRENT"
echo "new:     $NEW"
echo

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree not clean. commit or stash first." >&2
  git status --short
  exit 1
fi

# Patch module.json with new version + bumped download URL
python3 - <<EOF
import json
with open('module.json') as f:
    d = json.load(f)
d['version'] = '$NEW'
d['download'] = 'https://github.com/takaqiao/pf2e-dsn-persistent-bridge/releases/download/v$NEW/module.zip'
with open('module.json', 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
EOF

git add module.json
git commit -m "chore(release): v$NEW"
git tag -a "v$NEW" -m "v$NEW"
git push origin main "v$NEW"

echo
echo "✅ pushed v$NEW. CI will build module.zip and publish the release."
echo "   Watch: https://github.com/takaqiao/pf2e-dsn-persistent-bridge/actions"
echo
echo "After the workflow goes green, verify:"
echo "  curl -sIL https://github.com/takaqiao/pf2e-dsn-persistent-bridge/releases/latest/download/module.json"
