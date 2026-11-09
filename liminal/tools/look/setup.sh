#!/bin/bash
# One-time setup for the look tools: a Python venv in liminal/.venv-look with
# CPU PyTorch and transformers. Models download on first use (~1 GB) into
# ~/.cache/huggingface. Run: bash tools/look/setup.sh
set -e
cd "$(dirname "$0")/../.."
[ -d .venv-look ] || python3 -m venv .venv-look
.venv-look/bin/pip install -q --upgrade pip
.venv-look/bin/pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cpu
.venv-look/bin/pip install -q transformers pillow numpy timm
echo "ready: .venv-look/bin/python tools/look/compare.py --help"
