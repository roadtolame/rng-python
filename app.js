let timer = null;
let count = 0;
let latestRequestId = 0;
const MAX_HISTORY = 30;

const $ = (id) => document.getElementById(id);

function setButtonsState(isRunning) {
  const start = $("btnStart");
  const stop = $("btnStop");
  if (start) start.disabled = isRunning;
  if (stop) stop.disabled = !isRunning;
}

function setStatus(text, isRunning) {
  $("statusText").textContent = text;
  $("liveDot").classList.toggle("live", isRunning);
}

function clearFieldErrors() {
  $("low").classList.remove("invalid-field");
  $("high").classList.remove("invalid-field");
}

function showMessage(text, isError = true) {
  const box = $("uiMessage");
  if (!box) return;
  box.textContent = text;
  box.classList.toggle("error", isError);
  box.classList.add("show");
}

function clearMessage() {
  const box = $("uiMessage");
  if (!box) return;
  box.textContent = "";
  box.classList.remove("show", "error");
}

function getValidatedParams() {
  const dist = $("dist").value;
  const low = $("low").valueAsNumber;
  const high = $("high").valueAsNumber;

  clearFieldErrors();

  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    $("low").classList.add("invalid-field");
    $("high").classList.add("invalid-field");
    showMessage("Введите корректные числовые значения диапазона.");
    return null;
  }

  if (dist === "integer") {
    const intLow = Math.ceil(low);
    const intHigh = Math.floor(high);
    if (intLow > intHigh) {
      $("low").classList.add("invalid-field");
      $("high").classList.add("invalid-field");
      showMessage("Для целого режима диапазон должен содержать хотя бы одно целое.");
      return null;
    }
    return { dist, low: intLow, high: intHigh };
  }

  if (low > high) {
    $("low").classList.add("invalid-field");
    $("high").classList.add("invalid-field");
    showMessage("Минимум не может быть больше максимума.");
    return null;
  }

  return { dist, low, high };
}

function formatSeed(seed) {
  const source = typeof seed === "string" ? seed : "";
  if (!source) return "— нет seed —";
  const chunks = source.match(/.{1,16}/g);
  return chunks ? chunks.join(" ") : source;
}

async function generate(validatedParams = null) {
  const params = validatedParams || getValidatedParams();
  if (!params) return false;

  const requestId = ++latestRequestId;

  try {
    clearMessage();
    const query = new URLSearchParams({
      dist: params.dist,
      low: String(params.low),
      high: String(params.high),
    });
    const res = await fetch(`/generate?${query.toString()}`);

    let data;
    if (!res.ok) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      const msg = data && typeof data.error === "string" ? data.error : `HTTP ${res.status}`;
      throw new Error(msg);
    }

    data = await res.json();
    if (requestId !== latestRequestId) return false;

    return updateUI(data, params);
  } catch (e) {
    if (requestId !== latestRequestId) return false;
    const msg = e instanceof Error && e.message ? e.message : "сервер недоступен";
    showMessage(`Ошибка генерации: ${msg}`);
    return false;
  }
}

function updateUI(d, params) {
  if (!d || typeof d !== "object") {
    showMessage("Некорректный ответ сервера.");
    return false;
  }

  const seed = typeof d.seed === "string" ? d.seed : "";
  const valueNum = Number(d.value);
  if (!seed || !Number.isFinite(valueNum)) {
    showMessage("Ответ сервера не содержит корректные seed/value.");
    return false;
  }

  count++;
  $("counter").textContent = count;

  animateSeed(formatSeed(seed));

  const dist = typeof d.distribution === "string" ? d.distribution : params.dist;
  const v =
    dist === "integer"
      ? Math.round(valueNum).toString()
      : valueNum.toFixed(8);
  $("valueBig").textContent = v;

  $("mAlg").textContent = typeof d.algorithm === "string" ? d.algorithm : "—";
  $("mBits").textContent =
    Number.isFinite(Number(d.entropy_bits)) ? d.entropy_bits + " bit" : "—";
  $("mDist").textContent = dist;
  const low = Number.isFinite(Number(d.low)) ? Number(d.low) : params.low;
  const high = Number.isFinite(Number(d.high)) ? Number(d.high) : params.high;
  $("mRange").textContent = `[${low}, ${high}]`;

  addHistory(count, v, dist, seed);
  clearMessage();
  return true;
}

function animateSeed(text) {
  const el = $("seedDisplay");
  el.innerHTML = "";
  [...text].forEach((ch, i) => {
    const span = document.createElement("span");
    span.className = "seed-char new";
    span.textContent = ch;
    setTimeout(() => span.classList.remove("new"), 400 + i * 5);
    el.appendChild(span);
  });
}

function addHistory(n, val, dist, seed) {
  const list = $("history");
  const item = document.createElement("div");
  item.className = "hist-item";
  const nEl = document.createElement("span");
  nEl.className = "hist-n";
  nEl.textContent = `#${n}`;

  const valEl = document.createElement("span");
  valEl.className = "hist-val";
  valEl.textContent = val;

  const distEl = document.createElement("span");
  distEl.className = "hist-dist";
  distEl.textContent = dist;

  const seedEl = document.createElement("span");
  seedEl.className = "hist-seed";
  seedEl.textContent = seed;

  item.append(nEl, valEl, distEl, seedEl);
  list.insertBefore(item, list.firstChild);
  while (list.children.length > MAX_HISTORY) list.removeChild(list.lastChild);
}

function startGen() {
  if (timer) return;
  const params = getValidatedParams();
  if (!params) {
    setButtonsState(false);
    return;
  }

  const ms = +$("speed").value;
  setButtonsState(true);
  setStatus("Генерация...", true);

  generate(params);
  timer = setInterval(generate, ms);
}

function stopGen() {
  if (timer) clearInterval(timer);
  timer = null;
  latestRequestId++;
  setButtonsState(false);
  setStatus("Остановлен", false);
}

function genOnce() {
  stopGen();
  generate();
}

function setupDistributionDropdown() {
  const select = $("dist");
  const control = $("distControl");
  const trigger = $("distTrigger");
  const triggerText = $("distTriggerText");
  const list = $("distList");
  if (!select || !control || !trigger || !triggerText || !list) return;

  const options = Array.from(list.querySelectorAll(".dist-option"));
  if (!options.length) return;

  let activeIndex = 0;

  const getIndexByValue = (value) =>
    options.findIndex((option) => option.dataset.value === value);

  const setSelectedIndex = (index) => {
    const nextIndex = index >= 0 ? index : 0;
    const current = options[nextIndex];
    if (!current) return;

    options.forEach((option, i) => {
      const selected = i === nextIndex;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-selected", String(selected));
    });
    triggerText.textContent = current.textContent || "";
    activeIndex = nextIndex;
  };

  const setActiveIndex = (index, focus = false) => {
    if (!options.length) return;
    const wrapped = (index + options.length) % options.length;
    activeIndex = wrapped;
    options.forEach((option, i) => {
      option.classList.toggle("is-active", i === wrapped);
    });
    if (focus) options[wrapped].focus();
  };

  const clearActive = () => {
    options.forEach((option) => option.classList.remove("is-active"));
  };

  const isOpen = () => control.classList.contains("open");

  const openList = (focusCurrent = false) => {
    if (isOpen()) return;
    control.classList.add("open");
    list.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    setActiveIndex(activeIndex, focusCurrent);
  };

  const closeList = (focusTrigger = false) => {
    if (!isOpen()) return;
    control.classList.remove("open");
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    clearActive();
    if (focusTrigger) trigger.focus();
  };

  const commitByIndex = (index) => {
    const option = options[index];
    if (!option) return;
    const value = option.dataset.value;
    if (!value) return;

    const changed = select.value !== value;
    select.value = value;
    setSelectedIndex(index);
    if (changed) {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  const initialIndex = getIndexByValue(select.value);
  setSelectedIndex(initialIndex >= 0 ? initialIndex : 0);

  trigger.addEventListener("click", () => {
    if (isOpen()) closeList(false);
    else openList(false);
  });

  trigger.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openList(true);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen()) openList(true);
      else setActiveIndex(activeIndex + 1, true);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen()) openList(true);
      else setActiveIndex(activeIndex - 1, true);
      return;
    }

    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      closeList(false);
      return;
    }

    if (event.key === "Tab" && isOpen()) {
      closeList(false);
    }
  });

  list.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(activeIndex + 1, true);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(activeIndex - 1, true);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      commitByIndex(activeIndex);
      closeList(true);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeList(true);
      return;
    }

    if (event.key === "Tab") {
      closeList(false);
    }
  });

  options.forEach((option, index) => {
    option.addEventListener("mousemove", () => {
      if (!isOpen()) return;
      setActiveIndex(index, false);
    });
    option.addEventListener("click", () => {
      commitByIndex(index);
      closeList(false);
    });
  });

  select.addEventListener("change", () => {
    const selectedIndex = getIndexByValue(select.value);
    setSelectedIndex(selectedIndex >= 0 ? selectedIndex : 0);
  });

  document.addEventListener("click", (event) => {
    if (!control.contains(event.target)) {
      closeList(false);
    }
  });
}

function bindUIEvents() {
  $("speed").addEventListener("input", () => {
    const ms = +$("speed").value;
    $("speedVal").textContent = (ms / 1000).toFixed(1) + " с";
    if (timer) {
      stopGen();
      startGen();
    }
  });

  ["low", "high"].forEach((id) => {
    $(id).addEventListener("input", () => {
      $(id).classList.remove("invalid-field");
      clearMessage();
    });
  });

  $("dist").addEventListener("change", () => {
    clearFieldErrors();
    clearMessage();
  });

  $("btnStart").addEventListener("click", startGen);
  $("btnStop").addEventListener("click", stopGen);
  $("btnOnce").addEventListener("click", genOnce);
}

function initApp() {
  setupDistributionDropdown();
  bindUIEvents();
  setButtonsState(false);
  setStatus("Остановлен", false);
}

initApp();
