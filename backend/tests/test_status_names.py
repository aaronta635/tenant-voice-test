"""The backend names HTTP statuses the way every Starlette that requirements.txt allows does.

fastapi>=0.115.0 can install a Starlette from before the RFC 9110 names
(HTTP_422_UNPROCESSABLE_CONTENT, HTTP_413_CONTENT_TOO_LARGE, ...). There,
reaching for one is an AttributeError, so the 422 or 413 a user should get
becomes a 500. The older names work on every version.
"""

import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
NEWER_NAMES = (
    "HTTP_413_CONTENT_TOO_LARGE",
    "HTTP_414_URI_TOO_LONG",
    "HTTP_416_RANGE_NOT_SATISFIABLE",
    "HTTP_422_UNPROCESSABLE_CONTENT",
)


def test_no_status_name_only_newer_starlette_has():
    used = {
        f"{path.relative_to(APP)}:{line}: {name}"
        for path in APP.rglob("*.py")
        for line, text in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1)
        for name in re.findall(r"HTTP_\d{3}_[A-Z_]+", text)
        if name in NEWER_NAMES
    }
    assert not used, sorted(used)
