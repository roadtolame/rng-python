from flask import Flask, request, jsonify, send_from_directory

import secrets, hashlib, hmac, os, time, math, re

app = Flask(__name__)
ALLOWED_DISTRIBUTIONS = {"uniform", "normal", "exponential", "integer"}


def _entropy():
    return {
        "os_urandom": secrets.token_bytes(32),
        "time_ns": time.time_ns().to_bytes(8, "big"),
        "pid": os.getpid().to_bytes(4, "big"),
        "token_hex": secrets.token_bytes(16),
    }

#generator of seed;
def polzovatelskiy_seed(user_seed = None): 
    if user_seed and str(user_seed).strip():
        return int.from_bytes(hashlib.sha3_256(str(user_seed).encode('utf-8')).digest(), 'big')
    return None

def genseed(distr: str = "uniform", low: float = 0, high: float = 1, user_seed = None):
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
    
    if user_seed and str(user_seed).strip():
        seed_int = polzovatelskiy_seed(user_seed)
    
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


def build_value_proof(seed_int: int, distr: str, low: float, high: float, value: float):
    u = (seed_int % (2**53)) / (2**53)
    u2_raw = hashlib.sha3_256(seed_int.to_bytes(32, "big")).digest()
    u2 = int.from_bytes(u2_raw[:7], "big") / (2**56)

    steps = {}
    if distr == "uniform":
        span = high - low
        raw = low + u * span
        steps = {
            "span": span,
            "raw": raw,
        }
    elif distr == "normal":
        u_safe = u if u > 0 else 1e-10
        z = math.sqrt(-2 * math.log(u_safe)) * math.cos(2 * math.pi * u2)
        mu = (low + high) / 2
        sigma = (high - low) / 6
        raw_unclamped = mu + sigma * z
        clamped = max(low, min(high, raw_unclamped))
        steps = {
            "u_safe": u_safe,
            "z": z,
            "mu": mu,
            "sigma": sigma,
            "raw_unclamped": raw_unclamped,
            "clamped": clamped,
        }
    elif distr == "exponential":
        u_safe = u if u > 0 else 1e-10
        lam = 1.0
        exp_component = -math.log(1 - u_safe) / lam
        scaled = low + exp_component * (high - low) / 5
        steps = {
            "u_safe": u_safe,
            "lambda": lam,
            "exp_component": exp_component,
            "scaled": scaled,
        }
    elif distr == "integer":
        raw_n = low + u * (high - low + 1)
        n_floor = int(raw_n)
        n_clamped = min(int(high), n_floor)
        steps = {
            "raw_n": raw_n,
            "n_floor": n_floor,
            "n_clamped": n_clamped,
        }

    return {
        "seed_int_dec": str(seed_int),
        "seed_int_hex": format(seed_int & ((1 << 256) - 1), "064x"),
        "u": u,
        "u2": u2,
        "range_check": {
            "low": low,
            "high": high,
            "within_range": (low <= value <= high),
        },
        "distribution_steps": steps,
    }


@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/app.js")
def app_js():
    return send_from_directory(".", "app.js")


@app.route("/provably-fair")
def provably_fair():
    return send_from_directory(".", "provably_fair.html")


@app.route("/provably_fair.js")
def provably_fair_js():
    return send_from_directory(".", "provably_fair.js")


@app.route("/style.css")
def style_css():
    return send_from_directory(".", "style.css")


@app.route("/generate")
def generate():
    dist = request.args.get("dist", "uniform")
    user_seed = request.args.get("user_seed")
    try:
        low = float(request.args.get("low", 0))
        high = float(request.args.get("high", 1))
    except ValueError:
        return jsonify({"error": "Invalid low/high values"}), 400

    result = genseed(dist, low, high, user_seed)

    return jsonify(result)

@app.route("/verify-rng")
def verify_rng():
    seed_hex = str(request.args.get("seed", "")).strip().lower()
    dist = str(request.args.get("dist", "")).strip()

    if not re.fullmatch(r"[0-9a-f]{64}", seed_hex):
        return jsonify({"error": "Invalid seed: expected 64 hex characters"}), 400

    if dist not in ALLOWED_DISTRIBUTIONS:
        return jsonify({"error": "Invalid distribution"}), 400

    try:
        low = float(request.args.get("low", ""))
        high = float(request.args.get("high", ""))
    except ValueError:
        return jsonify({"error": "Invalid low/high values"}), 400

    if low > high:
        return jsonify({"error": "Invalid range: low must be <= high"}), 400

    seed_int = int(seed_hex, 16)
    value = generate_value(seed_int, dist, low, high)
    display_value = str(int(value)) if dist == "integer" else f"{value:.8f}"
    proof = build_value_proof(seed_int, dist, low, high, value)

    return jsonify(
        {
            "seed": seed_hex,
            "distribution": dist,
            "low": low,
            "high": high,
            "value": value,
            "display_value": display_value,
            "proof": proof,
        }
    )


if __name__ == "__main__":
    print("=" * 55)
    print(" Crypto RNG Server")
    print(" Run: http://localhost:8080")
    print("=" * 55)

    app.run(host="localhost", port=8080, debug=True)
