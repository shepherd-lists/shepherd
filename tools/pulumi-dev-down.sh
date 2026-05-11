#!/usr/bin/env bash
set -euo pipefail

STACK=dev
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Teardown order: addons → services → base infra (reverse of dependency order).
ADDON_DIRS=()
while IFS= read -r f; do
  ADDON_DIRS+=("$(dirname "$f")")
done < <(find "${REPO_ROOT}/addons" -mindepth 2 -name 'Pulumi.yaml' -not -path '*/node_modules/*' -not -path "${REPO_ROOT}/addons/services/infra/*")

echo "Will destroy '${STACK}' stack in:"
for d in "${ADDON_DIRS[@]}"; do echo "  - ${d#$REPO_ROOT/}"; done
echo "  - addons/services/infra"
echo "  - infra"
read -r -p "Proceed? [y/N] " reply
[[ "$reply" =~ ^[Yy]$ ]] || { echo "aborted"; exit 1; }

destroy_stack() {
  local dir="$1"
  pushd "$dir" > /dev/null
  if pulumi stack select "${STACK}" 2>/dev/null; then
    pulumi destroy -y
  else
    echo "skip: no '${STACK}' stack in ${dir#$REPO_ROOT/}"
  fi
  popd > /dev/null
}

for d in "${ADDON_DIRS[@]}"; do destroy_stack "$d"; done
destroy_stack "${REPO_ROOT}/addons/services/infra"
destroy_stack "${REPO_ROOT}/infra"

echo "done"
