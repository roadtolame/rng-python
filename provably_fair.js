const RNG_VERIFY_TOLERANCE = 1e-12;
const VALID_RNG_DISTS = new Set(["uniform", "normal", "exponential", "integer"]);

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatRngDisplay(distribution, value) {
  return distribution === "integer"
    ? String(Math.round(value))
    : Number(value).toFixed(8);
}

function showMessage(text, isError = true) {
  const box = $("pfMessage");
  if (!box) return;

  if (!text) {
    box.classList.remove("show", "error");
    box.textContent = "";
    return;
  }

  box.textContent = text;
  box.classList.add("show");
  box.classList.toggle("error", isError);
}

function setRngVerifierStatus(text, statusClass = "") {
  const status = $("rngvStatus");
  if (!status) return;
  status.textContent = text;
  status.classList.remove("ok", "error");
  if (statusClass) status.classList.add(statusClass);
}

function readImportedRngParams() {
  const params = new URLSearchParams(window.location.search);
  const seed = params.get("rng_seed");
  if (!seed) return null;

  return {
    generation: params.get("rng_gen") || "",
    seed,
    distribution: params.get("rng_dist") || "",
    low: params.get("rng_low") || "",
    high: params.get("rng_high") || "",
    value: params.get("rng_value") || "",
    displayValue: params.get("rng_display") || "",
    algorithm: params.get("rng_alg") || "",
    entropyBits: params.get("rng_bits") || "",
    timestamp: params.get("rng_timestamp") || "",
    userSeed: params.get("rng_user_seed") || "",
    nonce: params.get("rng_nonce") || "",
  };
}

function renderImportedRngData(data) {
  const box = $("pfImportedBox");
  const grid = $("pfImportedData");
  if (!box || !grid || !data) return;

  const rows = [
    ["Генерация", data.generation ? `#${data.generation}` : "—"],
    ["Распределение", data.distribution || "—"],
    ["Диапазон", data.low && data.high ? `[${data.low}, ${data.high}]` : "—"],
    ["Итоговое значение", data.displayValue || data.value || "—"],
    ["Алгоритм", data.algorithm || "—"],
    ["Биты энтропии", data.entropyBits ? `${data.entropyBits} bit` : "—"],
    ["Nonce (derived)", data.nonce || "—"],
    ["Seed", data.seed || "—"],
    ["Пользовательский seed", data.userSeed || "—"],
    ["Timestamp", data.timestamp || "—"],
  ];

  grid.innerHTML = rows
    .map(([key, value]) => {
      return `
        <div class="pf-imported-row">
          <span class="pf-imported-key">${escapeHtml(key)}</span>
          <span class="pf-imported-val">${escapeHtml(value)}</span>
        </div>
      `;
    })
    .join("");
  box.hidden = false;
}

function renderProofGrid(targetId, rows) {
  const container = $(targetId);
  if (!container) return;
  if (!rows || rows.length === 0) {
    container.innerHTML = '<div class="pf-proof-empty">Нет данных</div>';
    return;
  }

  container.innerHTML = rows
    .map(([key, value]) => {
      return `
        <div class="pf-proof-row">
          <span class="pf-proof-key">${escapeHtml(key)}</span>
          <span class="pf-proof-val">${escapeHtml(value)}</span>
        </div>
      `;
    })
    .join("");
}

function resetProofView() {
  renderProofGrid("rngProofBase", []);
  renderProofGrid("rngProofRange", []);
  renderProofGrid("rngProofDist", []);
}

function renderProofData(proof, distribution) {
  if (!proof || typeof proof !== "object") {
    resetProofView();
    return;
  }

  const baseRows = [
    ["seed_int (dec)", proof.seed_int_dec ?? "—"],
    ["seed_int (hex)", proof.seed_int_hex ?? "—"],
    ["u", proof.u ?? "—"],
    ["u2", proof.u2 ?? "—"],
  ];

  const range = proof.range_check || {};
  const rangeRows = [
    ["low", range.low ?? "—"],
    ["high", range.high ?? "—"],
    ["within_range", range.within_range ?? "—"],
  ];

  const steps = proof.distribution_steps || {};
  let distRows = [["distribution", distribution]];
  if (distribution === "uniform") {
    distRows = distRows.concat([
      ["span", steps.span ?? "—"],
      ["raw", steps.raw ?? "—"],
    ]);
  } else if (distribution === "normal") {
    distRows = distRows.concat([
      ["u_safe", steps.u_safe ?? "—"],
      ["z", steps.z ?? "—"],
      ["mu", steps.mu ?? "—"],
      ["sigma", steps.sigma ?? "—"],
      ["raw_unclamped", steps.raw_unclamped ?? "—"],
      ["clamped", steps.clamped ?? "—"],
    ]);
  } else if (distribution === "exponential") {
    distRows = distRows.concat([
      ["u_safe", steps.u_safe ?? "—"],
      ["lambda", steps.lambda ?? "—"],
      ["exp_component", steps.exp_component ?? "—"],
      ["scaled", steps.scaled ?? "—"],
    ]);
  } else if (distribution === "integer") {
    distRows = distRows.concat([
      ["raw_n", steps.raw_n ?? "—"],
      ["n_floor", steps.n_floor ?? "—"],
      ["n_clamped", steps.n_clamped ?? "—"],
    ]);
  }

  renderProofGrid("rngProofBase", baseRows);
  renderProofGrid("rngProofRange", rangeRows);
  renderProofGrid("rngProofDist", distRows);
}

function applyImportedRngData() {
  const data = readImportedRngParams();
  if (!data) return;

  if ($("rngvSeed")) $("rngvSeed").value = data.seed;
  if ($("rngvDist") && VALID_RNG_DISTS.has(data.distribution)) $("rngvDist").value = data.distribution;
  if ($("rngvLow")) $("rngvLow").value = data.low;
  if ($("rngvHigh")) $("rngvHigh").value = data.high;
  if ($("rngvExpected")) $("rngvExpected").value = data.value;
  if ($("rngvNonce")) $("rngvNonce").value = data.nonce || "0";
  $("rngvComputedRaw").textContent = "Computed raw: —";
  $("rngvComputedDisplay").textContent = "Computed display: —";
  setRngVerifierStatus("Импортировано из RNG. Нажмите «Проверить RNG».", "");

  renderImportedRngData(data);
  resetProofView();
  showMessage("Данные выбранной генерации загружены автоматически.", false);
}

function readRngVerifierInputs() {
  const seed = String($("rngvSeed")?.value || "").trim().toLowerCase();
  const distribution = String($("rngvDist")?.value || "").trim();
  const lowRaw = $("rngvLow")?.value ?? "";
  const highRaw = $("rngvHigh")?.value ?? "";
  const expectedRaw = $("rngvExpected")?.value ?? "";

  if (!/^[0-9a-f]{64}$/.test(seed)) {
    throw new Error("RNG Verifier: seed должен быть 64-символьным hex.");
  }

  if (!VALID_RNG_DISTS.has(distribution)) {
    throw new Error("RNG Verifier: выберите корректное распределение.");
  }

  const low = Number.parseFloat(lowRaw);
  const high = Number.parseFloat(highRaw);
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    throw new Error("RNG Verifier: low/high должны быть числами.");
  }
  if (low > high) {
    throw new Error("RNG Verifier: low не может быть больше high.");
  }

  const expectedValue = Number.parseFloat(expectedRaw);
  if (!Number.isFinite(expectedValue)) {
    throw new Error("RNG Verifier: expected raw value должен быть числом.");
  }

  return { seed, distribution, low, high, expectedValue };
}

async function runRngVerifier() {
  showMessage("");
  setRngVerifierStatus("Проверка...", "");
  $("rngvComputedRaw").textContent = "Computed raw: —";
  $("rngvComputedDisplay").textContent = "Computed display: —";
  resetProofView();

  try {
    const input = readRngVerifierInputs();
    const query = new URLSearchParams({
      seed: input.seed,
      dist: input.distribution,
      low: String(input.low),
      high: String(input.high),
    });

    const res = await fetch(`/verify-rng?${query.toString()}`);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.error || "Ошибка verify-rng.");
    }

    const computedRaw = Number(payload.value);
    const computedDisplay =
      typeof payload.display_value === "string"
        ? payload.display_value
        : formatRngDisplay(input.distribution, computedRaw);
    if (!Number.isFinite(computedRaw)) {
      throw new Error("verify-rng вернул некорректное значение.");
    }

    const expectedDisplay = formatRngDisplay(input.distribution, input.expectedValue);
    const delta = Math.abs(computedRaw - input.expectedValue);
    const rawMatch = delta <= RNG_VERIFY_TOLERANCE;
    const displayMatch = computedDisplay === expectedDisplay;
    const isMatch = rawMatch && displayMatch;

    $("rngvComputedRaw").textContent = `Computed raw: ${computedRaw}`;
    $("rngvComputedDisplay").textContent = `Computed display: ${computedDisplay}`;
    renderProofData(payload.proof, input.distribution);

    if (isMatch) {
      setRngVerifierStatus(
        `MATCH: raw Δ=${delta.toExponential(2)}; display=${computedDisplay}`,
        "ok"
      );
    } else {
      setRngVerifierStatus(
        `MISMATCH: raw Δ=${delta.toExponential(2)}; expected display=${expectedDisplay}, computed=${computedDisplay}`,
        "error"
      );
    }
  } catch (err) {
    setRngVerifierStatus(err.message || "Ошибка RNG Verifier.", "error");
  }
}

function bindEvents() {
  $("rngvRun")?.addEventListener("click", runRngVerifier);
}

function init() {
  bindEvents();
  resetProofView();
  applyImportedRngData();
}

init();
