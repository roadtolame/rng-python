"""
rng_server.py — криптостойкий генератор сидов
Запуск: python rng_server.py
Сайт:   http://localhost:8080
"""

import http.server
import json
import secrets
import hashlib
import hmac
import os
import time
import math
import threading
from urllib.parse import urlparse, parse_qs

# ─── Криптостойкая генерация ──────────────────────────────────────────────────

def get_entropy_sources():
    """Собираем несколько источников энтропии — как Cloudflare с лавовыми лампами."""
    return {
        "os_urandom":   secrets.token_bytes(32),
        "time_ns":      time.time_ns().to_bytes(8, "big"),
        "pid":          os.getpid().to_bytes(4, "big"),
        "token_hex":    secrets.token_bytes(16),
    }

def generate_seed(distribution: str = "uniform", low: float = 0, high: float = 1):
    """
    Генерирует криптостойкий сид через SHA-3 (Keccak).
    SHA-3 выбран вместо SHA-256: более современный стандарт NIST (2015),
    устойчив к length-extension атакам.
    """
    # 1. Собираем энтропию из нескольких источников
    entropy = get_entropy_sources()
    combined = b"".join(entropy.values())

    # 2. Хешируем через SHA-3-256 (Keccak)
    raw_hash = hashlib.sha3_256(combined).hexdigest()

    # 3. HMAC-SHA3 для дополнительной защиты (как делает Cloudflare)
    key = secrets.token_bytes(32)
    hmac_val = hmac.new(key, combined, hashlib.sha3_256).hexdigest()

    # 4. Финальный сид = XOR двух хешей (дополнительный mixing)
    seed_int = int(raw_hash, 16) ^ int(hmac_val, 16)
    seed_hex = format(seed_int & ((1 << 256) - 1), "064x")

    # 5. Генерируем значение по выбранному распределению
    value = generate_value(seed_int, distribution, low, high)

    print(f"[RNG] dist={distribution:8s} | seed={seed_hex[:16]}... | value={value:.6f}")

    return {
        "seed":         seed_hex,
        "seed_short":   seed_hex[:16] + "..." + seed_hex[-8:],
        "algorithm":    "SHA3-256 + HMAC-SHA3-256",
        "entropy_bits": 256,
        "distribution": distribution,
        "low":          low,
        "high":         high,
        "value":        value,
        "timestamp":    time.time_ns(),
    }

def generate_value(seed_int: int, distribution: str, low: float, high: float) -> float:
    """Преобразуем сид в значение нужного распределения."""
    # Нормируем в [0, 1)
    u = (seed_int % (2**53)) / (2**53)
    u2_raw = hashlib.sha3_256(seed_int.to_bytes(32, "big")).digest()
    u2 = int.from_bytes(u2_raw[:7], "big") / (2**56)

    if distribution == "uniform":
        return low + u * (high - low)

    elif distribution == "normal":
        # Box-Muller
        if u <= 0: u = 1e-10
        z = math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * u2)
        mu    = (low + high) / 2
        sigma = (high - low) / 6
        return max(low, min(high, mu + sigma * z))

    elif distribution == "exponential":
        if u <= 0: u = 1e-10
        lam = 1.0
        return low + (-math.log(1 - u) / lam) * (high - low) / 5

    elif distribution == "integer":
        n = int(low + u * (high - low + 1))
        return float(min(int(high), n))

    return u

# ─── HTTP-сервер ──────────────────────────────────────────────────────────────

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass  # отключаем стандартный лог

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/":
            self.serve_file()

        elif parsed.path == "/generate":
            params = parse_qs(parsed.query)
            dist   = params.get("dist", ["uniform"])[0]
            low    = float(params.get("low",  [0])[0])
            high   = float(params.get("high", [1])[0])

            result = generate_seed(dist, low, high)
            body   = json.dumps(result).encode()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        else:
            self.send_response(404)
            self.end_headers()

    def serve_file(self):
        try:
            with open("index.html", "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(content)
        except FileNotFoundError:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b"index.html not found")

if __name__ == "__main__":
    HOST, PORT = "localhost", 8080
    server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    print("=" * 55)
    print("  🔐 Crypto RNG Server")
    print(f"  Открой браузер: http://{HOST}:{PORT}")
    print("  Алгоритм: SHA3-256 + HMAC-SHA3-256")
    print("  Остановить: Ctrl+C")
    print("=" * 55)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Сервер остановлен.")
