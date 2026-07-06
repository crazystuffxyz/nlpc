#!/usr/bin/env bash
# register .nlp files with nlpc compile on this Linux/macOS machine
# requires: xdg-mime (linux) or duti (mac)
set -e
APP=nlpc
EXT=nlp
if command -v xdg-mime >/dev/null; then
  xdg-mime default "$APP.desktop" "application/x-$EXT"
  echo "registered via xdg-mime (linux)"
elif command -v duti >/dev/null; then
  duti -s "$APP" "x-$EXT" all
  echo "registered via duti (mac)"
else
  echo "no handler tool found (need xdg-mime or duti)" >&2
  exit 1
fi
