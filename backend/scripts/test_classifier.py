"""Quick standalone tester for the financial-document classifier.

Bypasses Redis, ARQ, the worker, and the upload flow. Reads a PDF from
disk and prints the classifier's verdict so you can verify the rules
against a real file in seconds.

Usage:
  cd backend
  python scripts/test_classifier.py "C:\\path\\to\\resume.pdf"
"""
import sys
from pathlib import Path

# Allow running from `backend/scripts/` — make `backend/` importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from financial_classifier import classify_pdf  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python scripts/test_classifier.py <pdf-path>")
        return 2

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        print(f"File not found: {pdf_path}")
        return 1

    pdf_bytes = pdf_path.read_bytes()
    result = classify_pdf(pdf_bytes)

    # Windows default console (cp1252) can't print some unicode. Force ASCII-
    # safe output for the diagnostic — replaces unprintable chars with '?'.
    def safe(s: object) -> str:
        return str(s).encode("ascii", errors="replace").decode("ascii")

    print(f"File:        {safe(pdf_path.name)}  ({len(pdf_bytes):,} bytes)")
    print(f"Action:      {safe(result.action)}")
    print(f"Score:       {result.score}")
    print(f"Text length: {result.text_length:,} chars (first 25 pages)")
    print(f"Reason:      {safe(result.reason)}")
    if result.matched_keywords:
        print(f"Matched:     {safe(result.matched_keywords)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
