import math
import threading
import time
from collections import deque

from app.core.config import LOGIN_MAX_ATTEMPTS_PER_IP, LOGIN_MAX_ATTEMPTS_PER_USERNAME, LOGIN_RATE_WINDOW_SECONDS


class LoginRateLimitExceeded(Exception):
    def __init__(self, retry_after: int):
        super().__init__("Too many login attempts")
        self.retry_after = retry_after


class LoginRateLimiter:
    def __init__(
        self,
        window_seconds: int = LOGIN_RATE_WINDOW_SECONDS,
        max_per_ip: int = LOGIN_MAX_ATTEMPTS_PER_IP,
        max_per_username: int = LOGIN_MAX_ATTEMPTS_PER_USERNAME,
    ):
        if min(window_seconds, max_per_ip, max_per_username) <= 0:
            raise ValueError("Login rate limits must be positive")
        self.window_seconds = window_seconds
        self.max_per_ip = max_per_ip
        self.max_per_username = max_per_username
        self._attempts: dict[tuple[str, str], deque[float]] = {}
        self._last_cleanup = 0.0
        self._lock = threading.Lock()

    def check(self, username: str, client_ip: str | None):
        with self._lock:
            now = time.monotonic()
            cutoff = now - self.window_seconds
            if now - self._last_cleanup >= self.window_seconds:
                self._attempts = {
                    key: attempts for key, attempts in self._attempts.items() if attempts and attempts[-1] > cutoff
                }
                self._last_cleanup = now

            keys = (("ip", client_ip or "unknown"), ("username", username.strip().lower()))
            retry_after = 0
            for key, limit in zip(keys, (self.max_per_ip, self.max_per_username)):
                attempts = self._attempts.get(key)
                if attempts is None:
                    continue
                while attempts and attempts[0] <= cutoff:
                    attempts.popleft()
                if len(attempts) >= limit:
                    retry_after = max(retry_after, math.ceil(attempts[0] + self.window_seconds - now))
            if retry_after:
                raise LoginRateLimitExceeded(retry_after)
            for key in keys:
                self._attempts.setdefault(key, deque()).append(now)
