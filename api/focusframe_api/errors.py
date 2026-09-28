from __future__ import annotations


class ApiError(Exception):
    """An error that is safe to show to the client (no internals, no image bytes)."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
