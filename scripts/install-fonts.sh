#!/usr/bin/env bash
# 図解・表紙の手書き風レンダリングに使うフォントを fontconfig に登録する。
# GitHub Actions などフォント未導入の環境で、画像生成前に実行する。
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$HOME/.fonts"
cp "$DIR/assets/fonts/"*.ttf "$HOME/.fonts/" 2>/dev/null || true
fc-cache -f >/dev/null 2>&1 || true
echo "fonts installed:"
fc-list 2>/dev/null | grep -iE "zen kurenaido|yomogi" || echo "  (fc-list unavailable)"
