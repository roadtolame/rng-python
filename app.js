let timer = null;
let count = 0;
const MAX_HISTORY = 30;
const STORAGE_KEY = "rng_history_v1";

let historyEntries = [];

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setButtonsState(isRunning) {
  const start = $("btnStart");
  const stop = $("btnStop");
  if (start) start.disabled = isRunning;
  if (stop) stop.disabled = !isRunning;
}

function setStatus(text, isRunning) {
  $("statusText").textContent = text;
  $("liveDot").classList.toggle("live", isRunning);
  setButtonsState(isRunning);
}

function showMessage(text) {
  const box = $("uiMessage");
  if (!box) return;
  if (!text) {
    box.classList.remove("show", "error");
    box.textContent = "";
    return;
  }
  box.textContent = text;
  box.classList.add("show", "error");
}

function formatSeed(seed) {
  const full = String(seed || "");
  if (full.length !== 64) return full || "—";
  return `${full.slice(0, 16)} ${full.slice(16, 32)} ${full.slice(32, 48)} ${full.slice(48, 64)}`;
}

function formatTimestamp(timestampNs) {
  const raw = String(timestampNs ?? "");
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return raw || "—";
  const dt = new Date(numeric / 1e6);
  if (Number.isNaN(dt.getTime())) return `${raw} ns`;
  return `${dt.toLocaleString("ru-RU")} (${raw} ns)`;
}

function deriveNonceFromGeneration(generation) {
  const n = Number(generation);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n - 1));
}

function buildProvablyFairUrl(entry) {
  const params = new URLSearchParams({
    rng_gen: String(entry.n),
    rng_seed: String(entry.seed),
    rng_dist: String(entry.distribution),
    rng_low: String(entry.low),
    rng_high: String(entry.high),
    rng_value: String(entry.rawValue),
    rng_display: String(entry.displayValue),
    rng_alg: String(entry.algorithm),
    rng_bits: String(entry.entropyBits),
    rng_timestamp: String(entry.timestamp),
    rng_nonce: String(entry.nonceDerived),
  });
  if (entry.userSeed) {
    params.set("rng_user_seed", String(entry.userSeed));
  }
  return `/provably-fair?${params.toString()}`;
}

function renderHistory() {
  const list = $("history");
  if (!list) return;

  if (historyEntries.length === 0) {
    list.innerHTML = '<div class="hist-empty">История пуста</div>';
    return;
  }

  list.innerHTML = historyEntries
    .map((entry, idx) => {
      return `
        <div class="hist-item">
          <span class="hist-n">#${escapeHtml(entry.n)}</span>
          <span class="hist-val">${escapeHtml(entry.displayValue)}</span>
          <span class="hist-dist">${escapeHtml(entry.distribution)}</span>
          <span class="hist-seed" title="${escapeHtml(entry.seed)}">${escapeHtml(entry.seed)}</span>
          <span class="hist-actions">
            <button type="button" class="hist-details-btn" data-idx="${idx}" aria-label="Детали генерации #${escapeHtml(entry.n)}">⋯</button>
          </span>
        </div>
      `;
    })
    .join("");
}

function saveHistoryState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        count,
        entries: historyEntries,
      })
    );
  } catch (_err) {
    // localStorage can be blocked in private mode; app still works in-memory.
  }
}

function loadHistoryState() {
  const list = $("history");
  if (!list) return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      renderHistory();
      $("counter").textContent = "0";
      return;
    }
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    historyEntries = entries.slice(0, MAX_HISTORY).map((item, idx) => {
      const n = Number(item?.n) || idx + 1;
      return {
        n,
        displayValue: item?.displayValue ?? item?.val ?? "—",
        distribution: item?.distribution ?? item?.dist ?? "—",
        seed: item?.seed ?? "—",
        algorithm: item?.algorithm ?? "—",
        entropyBits: item?.entropyBits ?? item?.entropy_bits ?? "—",
        low: item?.low ?? "—",
        high: item?.high ?? "—",
        rawValue: item?.rawValue ?? item?.value ?? "—",
        timestamp: item?.timestamp ?? "—",
        userSeed: item?.userSeed ?? item?.user_seed ?? "",
        nonceDerived: Number.isFinite(Number(item?.nonceDerived))
          ? Math.max(0, Number(item.nonceDerived))
          : deriveNonceFromGeneration(n),
      };
    });

    const storedCount = Number.parseInt(parsed?.count, 10);
    if (Number.isFinite(storedCount) && storedCount >= 0) {
      count = storedCount;
    } else {
      count = historyEntries.reduce((max, item) => Math.max(max, Number(item?.n) || 0), 0);
    }

    $("counter").textContent = String(count);
    renderHistory();
  } catch (_err) {
    historyEntries = [];
    count = 0;
    $("counter").textContent = "0";
    renderHistory();
  }
}

function addHistory(entry) {
  historyEntries.unshift({
    ...entry,
    nonceDerived: Number.isFinite(Number(entry?.nonceDerived))
      ? Math.max(0, Number(entry.nonceDerived))
      : deriveNonceFromGeneration(entry?.n),
  });
  while (historyEntries.length > MAX_HISTORY) {
    historyEntries.pop();
  }
  renderHistory();
  saveHistoryState();
}

function openHistoryModal(index) {
  const entry = historyEntries[index];
  const modal = $("histModal");
  const body = $("histModalBody");
  const title = $("histModalTitle");
  const link = $("histModalToPf");
  if (!entry || !modal || !body || !title || !link) return;

  title.textContent = `Генерация #${entry.n}`;
  body.innerHTML = `
    <div class="hist-modal-row"><span class="hist-modal-key">№ генерации</span><span class="hist-modal-val">#${escapeHtml(entry.n)}</span></div>
    <div class="hist-modal-row"><span class="hist-modal-key">Nonce (derived)</span><span class="hist-modal-val">${escapeHtml(entry.nonceDerived)}</span></div>
    <div class="hist-modal-row"><span class="hist-modal-key">Распределение</span><span class="hist-modal-val">${escapeHtml(entry.distribution)}</span></div>
    <div class="hist-modal-row"><span class="hist-modal-key">Диапазон</span><span class="hist-modal-val">[${escapeHtml(entry.low)}, ${escapeHtml(entry.high)}]</span></div>
    <div class="hist-modal-row"><span class="hist-modal-key">Итоговое значение</span><span class="hist-modal-val">${escapeHtml(entry.displayValue)}</span></div>
    <div class="hist-modal-row"><span class="hist-modal-key">Raw value</span><span class="hist-modal-val">${escapeHtml(entry.rawValue)}</span></div>
    <div class="hist-modal-row"><span class="hist-modal-key">Seed</span><span class="hist-modal-val hist-modal-seed">${escapeHtml(entry.seed)}</span></div>
    <div class="hist-modal-row"><span class="hist-modal-key">Алгоритм</span><span class="hist-modal-val">${escapeHtml(entry.algorithm)}</span></div>
    <div class="hist-modal-row"><span class="hist-modal-key">Биты энтропии</span><span class="hist-modal-val">${escapeHtml(entry.entropyBits)} bit</span></div>
    <div class="hist-modal-row"><span class="hist-modal-key">Пользовательский seed</span><span class="hist-modal-val">${escapeHtml(entry.userSeed || "—")}</span></div>
    <div class="hist-modal-row"><span class="hist-modal-key">Время</span><span class="hist-modal-val">${escapeHtml(formatTimestamp(entry.timestamp))}</span></div>
  `;
  link.href = buildProvablyFairUrl(entry);

  modal.hidden = false;
}

function closeHistoryModal() {
  const modal = $("histModal");
  if (!modal) return;
  modal.hidden = true;
}

async function generate() {
  const dist = $("dist").value;
  const low = parseFloat($("low").value);
  const high = parseFloat($("high").value);
  const userSeed = $("userSeed") ? $("userSeed").value.trim() : "";

  showMessage("");

  if (Number.isNaN(low) || Number.isNaN(high)) {
    showMessage("Введите числа в поля диапазона");
    return false;
  }

  if (low > high) {
    showMessage("Минимум не может быть больше максимума");
    stopGen();
    return false;
  }

  let url = `/generate?dist=${dist}&low=${low}&high=${high}`;
  if (userSeed) {
    url += `&user_seed=${encodeURIComponent(userSeed)}`;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Server issue");
    const data = await res.json();
    updateUI(data, userSeed);
    return true;
  } catch (_err) {
    $("seedDisplay").textContent = "ServerSide issue. Is server up?";
    stopGen();
    return false;
  }
}

function updateUI(data, userSeed) {
  count += 1;
  $("counter").textContent = String(count);
  animateSeed(formatSeed(data.seed));

  const viewValue = data.distribution === "integer" ? Math.round(data.value).toString() : data.value.toFixed(8);
  $("valueBig").textContent = viewValue;
  $("mAlg").textContent = data.algorithm;
  $("mBits").textContent = `${data.entropy_bits} bit`;
  $("mDist").textContent = data.distribution;
  $("mRange").textContent = `[${data.low}, ${data.high}]`;

  addHistory({
    n: count,
    nonceDerived: deriveNonceFromGeneration(count),
    displayValue: viewValue,
    distribution: data.distribution,
    seed: data.seed,
    algorithm: data.algorithm,
    entropyBits: data.entropy_bits,
    low: data.low,
    high: data.high,
    rawValue: data.value,
    timestamp: data.timestamp,
    userSeed,
  });
}

function animateSeed(text) {
  const el = $("seedDisplay");
  if (!el) return;
  el.innerHTML = "";
  [...text].forEach((ch, i) => {
    const span = document.createElement("span");
    span.className = "seed-char new";
    span.textContent = ch;
    setTimeout(() => span.classList.remove("new"), 400 + i * 5);
    el.appendChild(span);
  });
}

function startGen() {
  if (timer) return;

  generate().then((success) => {
    if (!success) return;

    const ms = +$("speed").value;
    setStatus("ГЕНЕРАЦИЯ...", true);
    timer = setInterval(generate, ms);
  });
}

function stopGen() {
  if (timer) clearInterval(timer);
  timer = null;
  setStatus("ОСТАНОВЛЕН", false);
}

function genOnce() {
  stopGen();
  generate();
}

function setupDistributionDropdown() {
  const select = $("dist");
  const control = $("distControl");
  const trigger = $("distTrigger");
  const list = $("distList");
  if (!select || !control || !trigger || !list) return;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = control.classList.toggle("open");
    list.hidden = !isOpen;
    trigger.setAttribute("aria-expanded", String(isOpen));
  });

  list.querySelectorAll(".dist-option").forEach((option) => {
    option.addEventListener("click", () => {
      select.value = option.dataset.value;
      $("distTriggerText").textContent = option.textContent;
      list.querySelectorAll(".dist-option").forEach((opt) => {
        opt.classList.remove("is-selected");
        opt.setAttribute("aria-selected", "false");
      });
      option.classList.add("is-selected");
      control.classList.remove("open");
      list.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      select.dispatchEvent(new Event("change"));
    });
  });

  document.addEventListener("click", () => {
    control.classList.remove("open");
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  });
}

function bindUIEvents() {
  $("speed").addEventListener("input", () => {
    const ms = +$("speed").value;
    $("speedVal").textContent = `${(ms / 1000).toFixed(1)} с`;
    if (timer) {
      stopGen();
      startGen();
    }
  });

  $("btnStart").onclick = startGen;
  $("btnStop").onclick = stopGen;
  $("btnOnce").onclick = genOnce;

  $("history")?.addEventListener("click", (event) => {
    const btn = event.target.closest(".hist-details-btn");
    if (!btn) return;
    const index = Number.parseInt(btn.dataset.idx || "", 10);
    if (Number.isNaN(index)) return;
    openHistoryModal(index);
  });

  $("histModalClose")?.addEventListener("click", closeHistoryModal);
  $("histModalCloseBtn")?.addEventListener("click", closeHistoryModal);
  $("histModalBackdrop")?.addEventListener("click", closeHistoryModal);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeHistoryModal();
    }
  });
}

function initApp() {
  setupDistributionDropdown();
  bindUIEvents();
  loadHistoryState();
  setStatus("ОСТАНОВЛЕН", false);
}

initApp();
