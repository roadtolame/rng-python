let timer = null;
let count = 0;
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
  setButtonsState(isRunning);
}

function showMessage(text) {
  const box = $("uiMessage");
  if (!box) return;
  if (!text) {
    box.classList.remove("show");
    return;
  }
  box.textContent = text;
  box.classList.add("show", "error");
}

async function generate() {
  const dist = $("dist").value;
  const low = parseFloat($("low").value);
  const high = parseFloat($("high").value);
  const userSeed = $("userSeed") ? $("userSeed").value.trim() : "";

  showMessage("");

  if (isNaN(low) || isNaN(high)) {
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
    url += `&user_seed=${encodeURIComponent(userSeed)}`;   // ← user_seed
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Server issue");
    const data = await res.json();
    updateUI(data);
    return true;
  } catch (e) {
    $("seedDisplay").textContent = "ServerSide issue. Is server up?";
    stopGen();
    return false;
  }
}

function updateUI(d) {
    // не трогать, работает
    count++;
    $("counter").textContent = count;
    const full = d.seed;
    const disp = full.slice(0, 16) + " " + full.slice(16, 32) + " " +
                 full.slice(32, 48) + " " + full.slice(48, 64);
    animateSeed(disp);

    const v = d.distribution === "integer" ? Math.round(d.value).toString() : d.value.toFixed(8);
    $("valueBig").textContent = v;
    $("mAlg").textContent = d.algorithm;
    $("mBits").textContent = d.entropy_bits + " bit";
    $("mDist").textContent = d.distribution;
    $("mRange").textContent = `[${d.low}, ${d.high}]`;

    addHistory(count, v, d.distribution, d.seed);
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
  item.innerHTML = `
    <span class="hist-n">#${n}</span>
    <span class="hist-val">${val}</span>
    <span class="hist-dist">${dist}</span>
    <span class="hist-seed">${seed}</span>
  `;
  list.insertBefore(item, list.firstChild);
  while (list.children.length > MAX_HISTORY) list.removeChild(list.lastChild);
}

function startGen() {
    if (timer) return;

    generate().then(success => {
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
        trigger.setAttribute("aria-expanded", isOpen);
    });

    list.querySelectorAll(".dist-option").forEach((option) => {
        option.addEventListener("click", () => {
            select.value = option.dataset.value;
            $("distTriggerText").textContent = option.textContent;
            list.querySelectorAll(".dist-option").forEach(opt => {
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
    $("speedVal").textContent = (ms / 1000).toFixed(1) + " с";
    if (timer) { stopGen(); startGen(); }
  });

  $("btnStart").onclick = startGen;
  $("btnStop").onclick = stopGen;
  $("btnOnce").onclick = genOnce;
}

function initApp() {
  setupDistributionDropdown();
  bindUIEvents();
  setStatus("ОСТАНОВЛЕН", false);
}

initApp();