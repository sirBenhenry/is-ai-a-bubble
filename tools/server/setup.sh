#!/usr/bin/env bash
# One-time setup of the depth machine (any Linux box with 8+ GB RAM; no GPU needed).
# Run it there:   bash setup.sh
# It installs uv into ~/.local/bin and everything else into ~/splat-lab. Nothing needs root.
set -euo pipefail
export PATH=$HOME/.local/bin:$PATH
mkdir -p ~/splat-lab && cd ~/splat-lab
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh

# Depth Pro 2 (Apple): photograph -> metric depth. This is what the plates use.
[ -d ml-depth-pro-2 ] || git clone --depth 1 https://github.com/apple-aiml-research/ml-depth-pro-2.git
[ -d venv-dp2 ] || uv venv --python 3.12 venv-dp2
VIRTUAL_ENV=$PWD/venv-dp2 uv pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
(cd ml-depth-pro-2 && VIRTUAL_ENV=$HOME/splat-lab/venv-dp2 uv pip install -e .)
# The weights (1.3 GB for the L model) download on first use.

# Optional: SHARP (Apple), photograph -> Gaussian-splat scene. Only for `--depth sharp`.
if [ "${WITH_SHARP:-0}" = 1 ]; then
  [ -d ml-sharp ] || git clone --depth 1 https://github.com/apple/ml-sharp.git
  [ -d venv-sharp ] || uv venv --python 3.13 venv-sharp
  VIRTUAL_ENV=$PWD/venv-sharp uv pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cpu
  (cd ml-sharp && VIRTUAL_ENV=$HOME/splat-lab/venv-sharp uv pip install -e .)
  mkdir -p ckpt
  [ -s ckpt/sharp_2572gikvuh.pt ] || curl -L --fail -o ckpt/sharp_2572gikvuh.pt https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt
fi
echo "ready"
