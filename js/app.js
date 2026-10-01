// 화면 상태 관리와 이벤트 연결
import { W, H, stageOf, analyze, countFits, replay, dotOptions, MAX_ABILITIES, SPAWN_EVERY, MAX_ICONS } from "./engine.js";
import { DEFAULT_PIECES, cellsOf, normalize, rowsFromCells, buildLibrary } from "./pieces.js";
import { loadPieces, savePieces, clearPieces, loadCounts, saveCounts } from "./storage.js";
import { miniShape, buildBoard, paintCell, rangeText, effectText, stepColor } from "./view.js";
import { setupThemeToggle } from "./theme.js";
import { setupFooter } from "./footer.js";

/* ---------- 상태: 켤 때마다 새 게임 기준 ---------- */
const DEFAULTS = { dots: 0, swaps: 0, counter: SPAWN_EVERY, lines: 0, risk: 90 };
const DEEP = { samples: 6, candidates: 5 };
const state = {
  library: buildLibrary(loadPieces() || DEFAULT_PIECES),
  filled: new Array(W * H).fill(0),
  icons: new Array(W * H).fill(0), // 1 = ⇄, 2 = ◎
  iconOrder: [],                    // 아이콘 칸 번호, 오래된 것부터 (최대 3개)
  hand: [],
  ...DEFAULTS,
  tool: "fill",
  plans: [], planIdx: 0, stepIdx: 0,
  history: [],
  counts: loadCounts(), // 조각별 등장 횟수
  swapAdvice: null,
};
const $ = id => document.getElementById(id);
const boardEl = $("board");
const resEl = $("results");

/* ---------- 입력 → 계산용 상태 ---------- */
function rootState() {
  const rows = new Array(H).fill(0);
  for (let i = 0; i < W * H; i++) if (state.filled[i]) rows[(i / W) | 0] |= 1 << (i % W);
  return {
    rows, icons: state.icons.slice(), iconOrder: state.iconOrder.filter(i => state.icons[i]), dots: state.dots, swaps: state.swaps, counter: state.counter,
    hand: state.hand.slice(), gain: 0, placed: 0, lines: 0, actions: [],
  };
}

/* ---------- 판 ---------- */
buildBoard(boardEl);
function renderBoard() {
  boardEl.querySelectorAll(".cell").forEach(cell => {
    const i = +cell.dataset.i;
    paintCell(cell, { filled: state.filled[i], icon: state.icons[i], age: ageOf(i) });
  });
}

let painting = null;
function ageOf(i, order = state.iconOrder, icons = state.icons) {
  const live = order.filter(j => icons[j]);
  const k = live.indexOf(i);
  return k >= 0 && live.length > 1 ? k + 1 : 0;
}
function setIcon(i, value) {
  state.icons[i] = value;
  state.iconOrder = state.iconOrder.filter(j => j !== i && state.icons[j]);
  if (value) {
    state.iconOrder.push(i);
    // 4번째 아이콘을 칠하면 게임처럼 가장 오래된 아이콘을 지움
    while (state.iconOrder.length > MAX_ICONS) state.icons[state.iconOrder.shift()] = 0;
  }
  renderBoard();
}
function paintAt(i) {
  if (state.tool === "fill") state.filled[i] = painting.value;
  else if (state.tool === "empty") { state.filled[i] = 0; if (state.icons[i]) { setIcon(i, 0); return; } }
  else { setIcon(i, painting.value); return; }
  paintCell(boardEl.querySelector(`[data-i="${i}"]`), { filled: state.filled[i], icon: state.icons[i], age: ageOf(i) });
}
boardEl.addEventListener("pointerdown", e => {
  const cell = e.target.closest(".cell");
  if (!cell) return;
  e.preventDefault();
  const i = +cell.dataset.i;
  if (state.tool === "fill") painting = { value: state.filled[i] ? 0 : 1 };
  else if (state.tool === "empty") painting = { value: 0 };
  else {
    const type = state.tool === "swap" ? 1 : 2;
    painting = { value: state.icons[i] === type ? 0 : type };
  }
  painting.last = i;
  paintAt(i);
  boardEl.setPointerCapture?.(e.pointerId);
});
boardEl.addEventListener("pointermove", e => {
  if (!painting) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el?.closest?.("#board .cell");
  if (!cell) return;
  const i = +cell.dataset.i;
  if (i === painting.last) return;
  painting.last = i;
  paintAt(i);
});
const endPaint = () => { if (painting) { painting = null; invalidate(); } };
boardEl.addEventListener("pointerup", endPaint);
boardEl.addEventListener("pointercancel", endPaint);

document.querySelectorAll("[data-tool]").forEach(btn => btn.addEventListener("click", () => {
  state.tool = btn.dataset.tool;
  document.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
}));
$("btn-clear").addEventListener("click", () => {
  pushHistory();
  state.filled.fill(0);
  state.icons.fill(0);
  state.iconOrder = [];
  renderBoard();
  invalidate();
});

/* ---------- 보유 조각 ---------- */
function renderHand() {
  const el = $("hand");
  el.replaceChildren();
  for (let k = 0; k < 3; k++) {
    const btn = document.createElement("button");
    btn.type = "button";
    const piece = state.library.map[state.hand[k]];
    if (piece) {
      btn.className = "slot on";
      btn.setAttribute("aria-label", piece.name + " 빼기");
      btn.append(miniShape(piece.rows),
        Object.assign(document.createElement("b"), { textContent: piece.name }),
        Object.assign(document.createElement("span"), { className: "small muted", textContent: piece.size + "칸" }));
      btn.addEventListener("click", () => { state.hand.splice(k, 1); renderHand(); invalidate(); });
    } else {
      btn.className = "slot";
      btn.textContent = "비어 있음";
      btn.disabled = true;
    }
    el.appendChild(btn);
  }
}
function pieceButton(piece, subText, onClick, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pc";
  btn.setAttribute("aria-label", label);
  btn.append(miniShape(piece.rows),
    Object.assign(document.createElement("b"), { textContent: piece.name }),
    Object.assign(document.createElement("span"), { textContent: subText }));
  btn.addEventListener("click", onClick);
  return btn;
}
/* ---------- 조각 정렬 (칸 수 순 / 가나다 순) ---------- */
const SORT_KEY = "moa-coach-piece-sort";
let pieceSort = "size";
try { if (localStorage.getItem(SORT_KEY) === "name") pieceSort = "name"; } catch (e) { /* 무시 */ }

// 한글 호환 자모는 유니코드 순서가 곧 ㄱㄴㄷ…ㅎ, ㅏㅑ…ㅣ 순서
function sortedPieces() {
  const list = state.library.list.slice();
  if (pieceSort === "name") list.sort((a, b) => a.name.localeCompare(b.name, "ko") || a.size - b.size);
  else list.sort((a, b) => a.size - b.size || a.name.localeCompare(b.name, "ko"));
  return list;
}

function setupSortControl() {
  const seg = el("div", { className: "seg" });
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "조각 정렬");
  [["size", "칸 수 순"], ["name", "가나다 순"]].forEach(([key, label]) => {
    const b = el("button", { type: "button", textContent: label });
    b.dataset.sort = key;
    b.addEventListener("click", () => {
      pieceSort = key;
      try { localStorage.setItem(SORT_KEY, key); } catch (e) { /* 무시 */ }
      renderPalette();
      renderLibrary();
    });
    seg.appendChild(b);
  });
  const palette = $("palette");
  const row = el("div", { className: "row between" });
  const label = palette.previousElementSibling; // "조각 추가" 라벨
  if (label && label.classList.contains("label")) { label.replaceWith(row); row.append(label, seg); }
  else palette.before(row), row.append(seg);
}
function syncSortButtons() {
  document.querySelectorAll("[data-sort]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sort === pieceSort)));
}

function renderPalette() {
  syncSortButtons();
  $("palette").replaceChildren(...sortedPieces().map(p => pieceButton(p, p.size + "칸", () => {
    if (state.hand.length >= 3) state.hand.shift();
    state.hand.push(p.name);
    state.counts[p.name] = (state.counts[p.name] || 0) + 1;
    saveCounts(state.counts);
    renderHand();
    invalidate();
  }, p.name + " 보유 조각에 추가")));
}

/* ---------- 숫자 입력 ---------- */
const LIMITS = { dots: [0, MAX_ABILITIES], swaps: [0, MAX_ABILITIES], counter: [1, SPAWN_EVERY], lines: [0, 9999] };
function setNumber(key, value) {
  const [lo, hi] = LIMITS[key];
  state[key] = Math.max(lo, Math.min(hi, Number.isNaN(value) ? lo : value));
  renderNumbers();
}
function renderNumbers() {
  Object.keys(LIMITS).forEach(k => { $("in-" + k).value = state[k]; });
  const stage = stageOf(state.lines);
  $("stage-line").textContent = `현재 ${stage}단계 · 보유 능력 ${state.dots + state.swaps}/${MAX_ABILITIES}`
    + (stage >= 3 ? " · 큰 조각이 자주 나오는 단계라 넓은 빈 공간을 더 중요하게 계산해요" : "");
  $("in-risk").value = state.risk;
  const mode = state.risk <= 30 ? "안전 위주" : state.risk >= 80 ? "여러 줄 동시 삭제" : "균형";
  $("risk-val").textContent = `${state.risk}% · ${mode}`;
}
document.querySelectorAll("[data-step]").forEach(btn => btn.addEventListener("click", () => {
  const k = btn.dataset.step;
  setNumber(k, state[k] + Number(btn.dataset.d));
  invalidate();
}));
Object.keys(LIMITS).forEach(k => $("in-" + k).addEventListener("change", e => {
  setNumber(k, parseInt(e.target.value, 10));
  invalidate();
}));
$("in-risk").addEventListener("input", e => { state.risk = Number(e.target.value); renderNumbers(); invalidate(); });

/* ---------- 결과 ---------- */
function showEmpty(html) {
  resEl.innerHTML = `<div class="empty">${html}</div>`;
}
// 입력이 바뀌어도 결과는 지우지 않고, 다시 계산하라는 안내만 띄움
function invalidate() {
  if (!state.plans.length && !state.swapAdvice) return;
  if (state.stale) return; // 이미 안내 중
  state.stale = true;
  if (state.swapAdvice) renderSwapAdvice(); else renderResults();
}
function staleBanner() {
  const box = el("div", { className: "note warn" });
  box.innerHTML = "<b>입력이 바뀌었어요.</b> 아래 결과는 바뀌기 전 기준이에요. 판이나 조각을 바꿨다면 다시 계산하세요. 능력 개수만 고친 거면 그대로 적용해도 고친 값이 유지돼요.";
  const again = el("button", { type: "button", className: "btn small strong", textContent: "다시 계산", style: "margin-left:8px" });
  again.addEventListener("click", () => $("btn-solve").click());
  box.appendChild(again);
  return box;
}

/* ---------- 계산 (Web Worker) ---------- */
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let jobId = 0;
function probs() {
  // 관찰한 횟수 + 1 (한 번도 안 본 조각도 나올 수 있으니 0으로 두지 않음)
  const out = {};
  state.library.list.forEach(p => { out[p.name] = (state.counts[p.name] || 0) + 1; });
  return out;
}
function finishSolve() {
  const btn = $("btn-solve");
  btn.disabled = false;
  btn.textContent = "추천 계산";
}
worker.onmessage = e => {
  const msg = e.data;
  if (msg.id !== jobId) return; // 오래된 계산 결과는 버림
  finishSolve();
  if (msg.error) {
    resEl.innerHTML = `<div class="note warn"><b>계산 중 오류가 났어요.</b> 판 입력을 확인한 뒤 다시 눌러주세요. (${msg.error})</div>`;
    return;
  }
  state.stale = false;
  if (msg.swap) { state.plans = []; state.swapAdvice = msg.swap; renderSwapAdvice(); return; }
  state.swapAdvice = null;
  state.plans = msg.plans;
  state.planIdx = 0;
  state.stepIdx = 0;
  renderResults();
};
worker.onerror = () => {
  finishSolve();
  resEl.innerHTML = '<div class="note warn"><b>계산을 시작하지 못했어요.</b> 페이지를 새로고침한 뒤 다시 눌러주세요.</div>';
};

$("btn-solve").addEventListener("click", () => {
  if (!state.hand.length) { showEmpty("보유 조각을 먼저 골라주세요."); return; }
  const btn = $("btn-solve");
  btn.disabled = true;
  btn.textContent = "계산 중…";
  showEmpty("계산 중이에요. 보통 몇 초 걸려요.");
  state.planRoot = rootState(); // 결과를 보여줄 때 이 시점의 판 기준으로 다시 그림
  worker.postMessage({
    id: ++jobId,
    root: state.planRoot,
    opt: { risk: state.risk / 100, lines: state.lines },
    pieces: state.library.list.map(p => ({ name: p.name, rows: p.rows })),
    probs: probs(),
    deep: DEEP,
  });
});

function renderSwapAdvice() {
  const name = state.swapAdvice.name;
  resEl.innerHTML = "";
  if (state.stale) resEl.appendChild(staleBanner());
  resEl.insertAdjacentHTML("beforeend", `<div class="note warn"><b>먼저 바꿔 뽑기를 ${name}에 쓰세요.</b><br>지금 판에서는 ${name}을(를) 두는 것보다 다른 조각으로 바꾸는 쪽이 평균적으로 더 안전해요. 바꾼 뒤 새로 나온 조각을 넣고 다시 계산하세요.</div>`);
  const btn = el("button", { type: "button", className: "btn strong", textContent: `바꿔 뽑기 사용함 (${name} 빼기)` });
  btn.addEventListener("click", () => {
    pushHistory();
    state.hand.splice(state.hand.indexOf(name), 1);
    state.swaps = Math.max(0, state.swaps - 1);
    state.swapAdvice = null;
    state.stale = false;
    renderHand(); renderNumbers();
    showEmpty("새로 나온 조각을 <b>보유 조각</b>에 추가한 뒤 다시 계산하세요.");
  });
  resEl.appendChild(el("div", { className: "row", style: "margin-top:10px" }, btn));
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function buildNotes(plan, fin) {
  const notes = [];
  if (fin.hand.length) {
    const names = fin.hand.join(", ");
    if (fin.swaps > 0) {
      notes.push({ warn: true, html: `<b>${names}</b>은(는) 둘 곳이 없어요. 위 순서대로 둔 뒤 <b>바꿔 뽑기를 ${names}에</b> 쓰세요.` });
    } else if (fin.dots > 0) {
      const opt = dotOptions(fin).find(([r]) => fin.icons.slice(r * W, r * W + W).includes(1));
      notes.push({
        warn: true,
        html: opt
          ? `<b>${names}</b>은(는) 둘 곳이 없어요. 마지막에 <b>점 찍기로 ${opt[0] + 1}번째 줄 ${opt[1] + 1}번째 칸</b>을 채우면 그 줄의 바꿔 뽑기를 얻어서 ${names}을(를) 바꿀 수 있어요.`
          : `<b>${names}</b>은(는) 둘 곳이 없어요. 점 찍기가 남아 있어서 게임은 바로 끝나지 않지만, 아이콘 줄을 지워 바꿔 뽑기를 얻어야 해요.`,
      });
    } else {
      notes.push({ warn: true, html: `<b>${names}</b>은(는) 둘 곳이 없고 남는 능력도 없어요. 이대로면 게임 오버예요.` });
    }
  }
  if (plan.actions.some(a => a.spawn)) {
    notes.push({ html: "이번에 능력 아이콘이 새로 생겨요. 위치는 랜덤이라 생긴 뒤에 판에 직접 칠해 주세요. 판에 이미 3개가 있으면 가장 오래된 아이콘(숫자 1)은 칠할 때 자동으로 지워져요." });
  }
  const unfit = state.library.list.filter(p => countFits(fin.rows, p.orients, 1) === 0).map(p => p.name);
  if (unfit.length) {
    notes.push({ html: `다 둔 뒤 판에서 <b>못 놓는 조각</b>: ${unfit.join(", ")}. 다음에 나오면 능력이 필요해요.` });
  }
  return notes;
}

function renderResults() {
  resEl.replaceChildren();
  const plans = state.plans;
  if (!plans.length) { showEmpty("계산할 수 있는 수가 없어요."); return; }
  const plan = plans[state.planIdx];
  const states = replay(state.planRoot, plan.actions);
  const fin = states[states.length - 1];
  const n = plan.actions.length;
  if (state.stale) resEl.appendChild(staleBanner());

  if (plans.length > 1) {
    const tabs = el("div", { className: "tabs" });
    plans.forEach((_, k) => {
      const b = el("button", { type: "button", textContent: "추천 " + (k + 1) });
      b.setAttribute("aria-pressed", String(k === state.planIdx));
      b.addEventListener("click", () => { state.planIdx = k; state.stepIdx = 0; renderResults(); });
      tabs.appendChild(b);
    });
    resEl.appendChild(tabs);
  }

  // 요약
  const holes = analyze(fin.rows).s1;
  const chips = el("div", { className: "chips" });
  const chip = (text, cls = "") => chips.appendChild(el("span", { className: "chip " + cls, textContent: text }));
  chip(`조각 ${fin.placed}/${state.hand.length}개 배치`, fin.placed === state.hand.length ? "good" : "bad");
  chip(`예상 점수 +${fin.gain.toLocaleString()}`);
  chip(`남는 능력: 점 ${fin.dots} · 바꿔 ${fin.swaps}`, fin.dots + fin.swaps === 0 ? "bad" : "");
  chip(`갇힌 1칸 구멍 ${holes}개`, holes > 0 ? "bad" : "");
  resEl.appendChild(chips);

  // 단계 목록
  const left = el("div", { className: "res-col" });
  const list = el("ol", { className: "steps" });
  plan.actions.forEach((act, k) => {
    const isDot = act.type === "dot";
    const body = el("div", { style: "min-width:0" },
      el("div", { className: "st-title", textContent: isDot ? "점 찍기" : `${act.name} 놓기` }),
      el("div", {
        className: "st-sub",
        textContent: isDot
          ? `${act.r + 1}번째 줄 · ${act.c + 1}번째 칸`
          : `${rangeText(act.r + 1, act.r + act.o.h, "줄")} · ${rangeText(act.c + 1, act.c + act.o.w, "칸")}`,
      }));
    const fx = effectText(act);
    if (fx) body.appendChild(el("div", { className: "st-fx", textContent: "→ " + fx }));
    const badge = el("span", { className: "badge", textContent: k + 1 });
    badge.style.background = stepColor(k);
    const shape = isDot ? el("span", { className: "dot-mark", textContent: "◎" }) : miniShape(act.o.cells, true);
    const li = el("li", { tabIndex: 0 }, badge, body, shape);
    li.setAttribute("aria-current", String(k === state.stepIdx));
    const go = () => { state.stepIdx = k; renderResults(); };
    li.addEventListener("click", go);
    li.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    list.appendChild(li);
  });
  if (n) left.appendChild(list);
  buildNotes(plan, fin).forEach(note => {
    const d = el("div", { className: "note" + (note.warn ? " warn" : "") });
    d.innerHTML = note.html;
    left.appendChild(d);
  });
  const applyBtn = el("button", { type: "button", className: "btn strong", textContent: "이 추천대로 판에 적용", disabled: !n });
  applyBtn.addEventListener("click", () => applyPlan(fin));
  const undoBtn = el("button", { type: "button", className: "btn", textContent: "되돌리기", disabled: !state.history.length });
  undoBtn.addEventListener("click", undo);
  left.appendChild(el("div", { className: "row" }, applyBtn, undoBtn));

  // 미리보기 판
  const right = el("div", { className: "res-col" });
  const prev = el("button", { type: "button", className: "btn small", textContent: "이전", disabled: state.stepIdx <= 0 });
  prev.addEventListener("click", () => { state.stepIdx--; renderResults(); });
  const next = el("button", { type: "button", className: "btn small", textContent: "다음", disabled: state.stepIdx >= n });
  next.addEventListener("click", () => { state.stepIdx++; renderResults(); });
  const label = el("span", { className: "small", textContent: state.stepIdx < n ? `${state.stepIdx + 1}단계: 놓을 칸` : "다 놓은 뒤" });
  const pv = el("div", { className: "board" });
  buildBoard(pv, { preview: true });
  const shown = states[Math.min(state.stepIdx, n)];
  const act = plan.actions[state.stepIdx];
  const highlight = new Map();
  const clearSet = new Set();
  if (act) {
    const color = stepColor(state.stepIdx);
    if (act.type === "dot") highlight.set(act.r * W + act.c, color);
    else act.o.cells.forEach(([dr, dc]) => highlight.set((act.r + dr) * W + act.c + dc, color));
    act.cleared.forEach(r => { for (let c = 0; c < W; c++) clearSet.add(r * W + c); });
  }
  pv.querySelectorAll(".cell").forEach(cell => {
    const i = +cell.dataset.i, r = (i / W) | 0, c = i % W;
    paintCell(cell, {
      filled: (shown.rows[r] >> c) & 1, icon: shown.icons[i], age: ageOf(i, shown.iconOrder || [], shown.icons),
      highlight: highlight.get(i), num: highlight.has(i) ? state.stepIdx + 1 : 0, willClear: clearSet.has(i),
    });
  });
  const caption = act && act.cleared.length ? "빨간 테두리 줄은 이 단계에서 지워져요." : "번호 칸이 이번에 채울 칸이에요.";
  right.append(el("div", { className: "pv-nav" }, prev, label, next), pv, el("div", { className: "small muted", textContent: caption }));

  resEl.appendChild(el("div", { className: "res-grid" }, left, right));
}

/* ---------- 적용 / 되돌리기 ---------- */
function snapshot() {
  const { filled, icons, iconOrder, hand, dots, swaps, counter, lines } = state;
  return JSON.stringify({ filled, icons, iconOrder, hand, dots, swaps, counter, lines });
}
function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 20) state.history.shift();
}
function undo() {
  const saved = state.history.pop();
  if (!saved) return;
  Object.assign(state, JSON.parse(saved));
  renderAll();
  state.plans = [];
  showEmpty("되돌렸어요. 필요하면 <b>추천 계산</b>을 다시 눌러주세요.");
}
function applyPlan(fin) {
  pushHistory();
  for (let i = 0; i < W * H; i++) {
    state.filled[i] = (fin.rows[(i / W) | 0] >> (i % W)) & 1;
    state.icons[i] = fin.icons[i];
  }
  state.iconOrder = (fin.iconOrder || []).filter(i => state.icons[i]);
  const root = state.planRoot;
  state.hand = fin.hand.slice();
  state.dots = Math.max(0, state.dots + (fin.dots - root.dots));
  state.swaps = Math.max(0, state.swaps + (fin.swaps - root.swaps));
  // 조각을 놓을 때마다 1씩 줄고, 0이 되면 다시 7부터
  state.counter = ((state.counter - fin.placed - 1) % SPAWN_EVERY + SPAWN_EVERY) % SPAWN_EVERY + 1;
  state.lines += fin.lines;
  state.plans = [];
  state.stale = false;
  renderAll();
  resEl.innerHTML = '<div class="empty">판에 적용했어요. 새로 나온 조각과 새 능력 아이콘을 입력한 뒤 다시 계산하세요.<br><button type="button" class="btn small" id="undo-after-apply" style="margin-top:8px">되돌리기</button></div>';
  $("undo-after-apply").addEventListener("click", undo);
}

/* ---------- 조각 편집 ---------- */
let editing = null;
let editCells = null;
const pieceData = () => state.library.list.map(p => ({ name: p.name, rows: p.rows }));
function setLibrary(pieces, persist = true) {
  state.library = buildLibrary(pieces);
  state.hand = state.hand.filter(n => state.library.map[n]);
  if (persist) savePieces(pieces);
  renderLibrary(); renderPalette(); renderHand(); invalidate();
}
function renderLibrary() {
  $("lib-list").replaceChildren(...sortedPieces().map(p =>
    pieceButton(p, p.size + "칸 · 편집", () => openEditor(p.name), p.name + " 편집")));
}
function openEditor(name) {
  editing = name;
  editCells = Array.from({ length: 5 }, () => new Array(5).fill(0));
  const piece = name && state.library.map[name];
  if (piece) cellsOf(piece.rows).forEach(([r, c]) => { if (r < 5 && c < 5) editCells[r][c] = 1; });
  $("ed-name").value = name || "";
  $("ed-del").hidden = !name;
  setEditorMessage("");
  $("editor").hidden = false;
  drawEditor();
}
function setEditorMessage(text, ok = false) {
  const m = $("ed-msg");
  m.textContent = text;
  m.className = "small " + (ok ? "ok" : "err");
}
function drawEditor() {
  const grid = $("ed-grid");
  grid.replaceChildren();
  let count = 0;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const b = el("button", { type: "button", className: editCells[r][c] ? "on" : "" });
    b.setAttribute("aria-label", `${r + 1}행 ${c + 1}열`);
    if (editCells[r][c]) count++;
    b.addEventListener("click", () => { editCells[r][c] ^= 1; drawEditor(); });
    grid.appendChild(b);
  }
  $("ed-count").textContent = count + "칸";
}
$("ed-save").addEventListener("click", () => {
  const name = $("ed-name").value.trim();
  if (!name) { setEditorMessage("이름을 입력해 주세요."); return; }
  const cells = [];
  editCells.forEach((row, r) => row.forEach((v, c) => { if (v) cells.push([r, c]); }));
  if (!cells.length) { setEditorMessage("칸을 하나 이상 칠해 주세요."); return; }
  if (name !== editing && state.library.map[name]) { setEditorMessage("같은 이름의 조각이 이미 있어요."); return; }
  const pieces = pieceData().filter(p => p.name !== editing);
  pieces.push({ name, rows: rowsFromCells(normalize(cells)) });
  if (editing && editing !== name) state.hand = state.hand.map(x => (x === editing ? name : x));
  editing = name;
  setLibrary(pieces);
  setEditorMessage("저장했어요.", true);
});
$("ed-del").addEventListener("click", () => {
  if (!editing) return;
  setLibrary(pieceData().filter(p => p.name !== editing));
  $("editor").hidden = true;
  editing = null;
});
$("ed-cancel").addEventListener("click", () => { $("editor").hidden = true; editing = null; });
$("btn-new").addEventListener("click", () => openEditor(null));
$("btn-reset-lib").addEventListener("click", () => { clearPieces(); setLibrary(DEFAULT_PIECES, false); });

/* ---------- 시작 ---------- */
setupThemeToggle();
setupSortControl();
setupFooter();
function renderAll() { renderBoard(); renderHand(); renderPalette(); renderNumbers(); renderLibrary(); }
renderAll();
showEmpty("새 게임 기준으로 시작했어요. 게임판과 보유 조각을 입력한 뒤 <b>추천 계산</b>을 눌러주세요.");
