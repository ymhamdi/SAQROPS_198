import sys
from pathlib import Path

# The ml/ scripts import each other as top-level modules (python ml/train.py); tests do the same.
sys.path.insert(0, str(Path(__file__).parent))
