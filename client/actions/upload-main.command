#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")/.."
npm run steam:upload:main

printf "\nMain game upload flow finished. Press Enter to close..."
read
