"""Verify direct text parsing and live localhost reads without touching user data."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
subprocess.run(['node', str(root / 'validate-source.cjs')], cwd=root, check=True)
subprocess.run(['node', str(root / 'test-comparison.cjs')], cwd=root, check=True)
subprocess.run([sys.executable, '-m', 'unittest', 'test_server', '-v'], cwd=root, check=True)
