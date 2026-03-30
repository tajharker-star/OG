#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")/.."
npm run steam:upload:demo

printf "\nDemo upload flow finished. Press Enter to close..."
read
