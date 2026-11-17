#!/bin/sh
# Converts every .webm in an evidence folder into a .gif beside it.
# Needs ffmpeg on PATH (brew install ffmpeg).
set -eu
dir="${1:?usage: to-gif.sh <evidence folder>}"
for video in "$dir"/*.webm; do
  [ -e "$video" ] || { echo "no .webm in $dir"; exit 1; }
  out="${video%.webm}.gif"
  ffmpeg -loglevel error -y -i "$video" \
    -vf "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse" \
    "$out"
  echo "wrote $out"
done
