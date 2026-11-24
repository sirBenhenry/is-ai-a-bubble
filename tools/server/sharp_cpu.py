"""Runs `sharp` on this CPU-only Xen VM.

PyTorch's oneDNN path dies with SIGFPE here on some 1x1 convolutions (first seen on
Conv2d(1024, 512, 1) at 96x96). Switching oneDNN off everywhere runs out of memory, so only
1x1 convolutions take the plain path; they are just a matrix product and cost no extra memory.
"""
import sys, faulthandler, torch
faulthandler.enable()
_forward = torch.nn.Conv2d._conv_forward
def _conv_forward(self, x, weight, bias):
    if self.kernel_size == (1, 1):
        with torch.backends.mkldnn.flags(enabled=False):
            return _forward(self, x, weight, bias)
    return _forward(self, x, weight, bias)
torch.nn.Conv2d._conv_forward = _conv_forward
from sharp.cli import main_cli
sys.argv[0] = "sharp"
main_cli()
