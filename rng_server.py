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

#generator of seed;
def genseed(distr: str = "uniform", low: float = 0, high: float = 1):
    """
    Keccak + SHA3 + HMAC with XOR
    """
    entropy = _entropy() #glavnaya entropiya /dev/urandom/pid
    combined = b"".join(entropy.values())

    # keccak
    raw = hashlib.sha3_256(combined).hexdigest()

    # HMAC-SHA3
    key = secrets.token_bytes(32)
    hmac_ = hmac.new(key, combined, hashlib.sha3_256).hexdigest()

    # xor with entropiya raw == sha3-256 entropiya 064x - 64x hex = 256 bit, h_mac == resul'tat sha3-256 + (randomkey, entropiya) 256 bit;
    seed_int = int(raw, 16) ^ int(hmac_, 16) #perevod v ogromnuyou stroku = 1234... 16 chisel;
    seed_hex = format(seed_int & ((1 << 256) - 1), "064x") #<< 1 << 256) - 1 bit = maska 64x hex;
 
    value = generate_value(seed_int, distr, low, high) # vizivaem seed_int i delaem chislo u v diapazone [0,1]; distr - forma razpredeleniya; [0,1] == [low,high] v raspredelenii;

    print(f"[RNG] dist={distr:8s} | seed={seed_hex[:16]}... | value={value:.6f}") # logs; seed(16x symbol) + chislo posle zapyatoy(6x symbol);

    return {
        "seed": seed_hex,
        "seed_short": seed_hex[:16] + "..." + seed_hex[-8:],
        "algorithm": "SHA3-256 ^ HMAC-SHA3-256",
        "entropy_bits": 256,
        "distribution": distr,
        "low": low,
        "high": high,
        "value": value,
        "timestamp": time.time_ns(),        #json otvet; seed_short - sokrashenniy seed 
    }

#seed_int to [0,1]([low,high])
def generate_value(seed_int: int, distr: str, low: float, high: float) -> float:
    """seed dlya normal;nogo view"""
    # [0, 1)
    u = (seed_int % (2**53)) / (2**53) #ostatok ot deleniya - eto tochnost mantissi float64; delim na 2**53 = u; diapazon [0,1];
    u2_raw = hashlib.sha3_256(seed_int.to_bytes(32, "big")).digest() #double hashing seed_int cherez SHA3-256 = poluchaem +256 bit randomnosti; 
    u2 = int.from_bytes(u2_raw[:7], "big") / (2**56)  #pervie 7 byte ot nowogo u (u2) = poluchaem diapazon(kak v u) = [0,1]

    match distr:
        case "uniform": #ravnomernoe raspredelenie low + srznach * (high - low)
            return low + u * (high - low)

        case "normal":
            # box muller
            if u <= 0: 
                u = 1e-10 #<-goddless stroke; safeprotection ot log(0); 
            z = math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * u2) #ghauss raspredelenie or Z-raspredelenie; srznach(μ) = 0; σ=1; NORMALNOE RASPREDELENIE;
            mu = (low + high) / 2 #seredina intervala;
            sigma = (high - low) / 6 #formula standartnogo otkloneniya ot z-raspredeleniya (99.7% данных лежат в пределах +-3σ от среднего.); formula = (sigma(σ) = high - low / 6); pogreshnost primerno 1mm(0,003 or 0.3%);
            return max(low, min(high, mu + sigma * z)) #truncated normal distribution; mu = x; sigma = y; chislo[low,high]; generaciya = mu + sigma = [low,high], proverka granic; if chislo > high ;generaciya := chislo = high

        case "exponential": # x = -ln(1-u) / λ
            if u <= 0:
                u = 1e-10 #<-goddless stroke; safeprotection ot log(0); 
            lam = 1.0 #lambda = 1, exponential znach
            return low + (-math.log(1 - u) / lam) * (high - low) / 5 #znach [0,unlimited) + (mashtabirovanie + sdvig) v diapazone [low,high]; /5 chtobi math.log ne viletal ZA high;

        case "integer":
            n = int(low + u * (high - low + 1)) #chtobi high был > high no ne > chem na 1; v return zashita ot etogo;
            return float(min(int(high), n)) #protection high > high < high+1

    return u 


@app.route("/")
def index():
    return send_from_directory(".", "claude.html")


@app.route("/app.js")
def app_js():
    return send_from_directory(".", "app.js")


@app.route("/style.css")
def style_css():
    return send_from_directory(".", "style.css")


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

    app.run(host="localhost", port=8080, debug=True)
