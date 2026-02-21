"""
run `python rng_server.py`
web `http://localhost:8080`
"""

from flask import Flask, request, jsonify, send_from_directory

import secrets
import hashlib
import hmac
import os
import time
import math

app = Flask(__name__)


def _entropy():
    return {
        "os_urandom": secrets.token_bytes(32),
        "time_ns": time.time_ns().to_bytes(8, "big"),
        "pid": os.getpid().to_bytes(4, "big"),
        "token_hex": secrets.token_bytes(16),
    }


def genseed(distr: str = "uniform", low: float = 0, high: float = 1):
    """
    Keccak + SHA3 + HMAC with XOR
    """
    entropy = _entropy()
    combined = b"".join(entropy.values())

    # keccak
    raw = hashlib.sha3_256(combined).hexdigest()

    # HMAC-SHA3
    key = secrets.token_bytes(32)
    hmac_ = hmac.new(key, combined, hashlib.sha3_256).hexdigest()

    # xor
    seed_int = int(raw, 16) ^ int(hmac_, 16)
    seed_hex = format(seed_int & ((1 << 256) - 1), "064x")

    value = generate_value(seed_int, distr, low, high)

    print(f"[RNG] dist={distr:8s} | seed={seed_hex[:16]}... | value={value:.6f}")

    return {
        "seed": seed_hex,
        "seed_short": seed_hex[:16] + "..." + seed_hex[-8:],
        "algorithm": "SHA3-256 ^ HMAC-SHA3-256",
        "entropy_bits": 256,
        "distribution": distr,
        "low": low,
        "high": high,
        "value": value,
        "timestamp": time.time_ns(),
    }


def generate_value(seed_int: int, distr: str, low: float, high: float) -> float:
    """seed to normal view"""
    # [0, 1)
    u = (seed_int % (2**53)) / (2**53)
    u2_raw = hashlib.sha3_256(seed_int.to_bytes(32, "big")).digest()
    u2 = int.from_bytes(u2_raw[:7], "big") / (2**56)

    match distr:
        case "uniform":
            return low + u * (high - low)

        case "normal":
            # box muller
            if u <= 0:
                u = 1e-10
            z = math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * u2)
            mu = (low + high) / 2
            sigma = (high - low) / 6
            return max(low, min(high, mu + sigma * z))

        case "exponential":
            if u <= 0:
                u = 1e-10
            lam = 1.0
            return low + (-math.log(1 - u) / lam) * (high - low) / 5

        case "integer":
            n = int(low + u * (high - low + 1))
            return float(min(int(high), n))

    return u


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/generate")
def generate():
    dist = request.args.get("dist", "uniform")
    try:
        low = float(request.args.get("low", 0))
        high = float(request.args.get("high", 1))
    except ValueError:
        return jsonify({"error": "Invalid low/high values"}), 400

    result = genseed(dist, low, high)

    return jsonify(result)


if __name__ == "__main__":
    print("=" * 55)
    print(" Crypto RNG Server")
    print(" Run: http://localhost:8080")
    print("=" * 55)

    app.run(host="localhost", port=8080, debug=False)
