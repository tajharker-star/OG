#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Which app do you want to make live?"
echo "1) Demo"
echo "2) Main game"
read "?Selection [1/2]: " selection

case "$selection" in
  1)
    target="demo"
    ;;
  2)
    target="main"
    ;;
  *)
    echo "Invalid selection."
    exit 1
    ;;
esac

read "?BuildID (leave blank for latest uploaded build): " buildid

if [[ -n "${buildid}" ]]; then
  npm run steam:set-live -- "$target" "$buildid"
else
  npm run steam:set-live -- "$target"
fi

printf "\nSet-live flow finished. Press Enter to close..."
read
