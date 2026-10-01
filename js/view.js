// 화면 그리기 도우미 (상태를 갖지 않는 함수들)
import { W, H } from "./engine.js";
import { cellsOf } from "./pieces.js";

export const STEP_COLORS = ["--s1", "--s2", "--s3", "--s4", "--s5"];
export const stepColor = k => `var(${STEP_COLORS[k % STEP_COLORS.length]})`;

/** 작은 조각 미리보기. rows 문자열 배열 또는 좌표 목록을 받음 */
export function miniShape(shape, isCells = false) {
  const cells = isCells ? shape : cellsOf(shape);
  const h = Math.max(...cells.map(p => p[0])) + 1;
  const w = Math.max(...cells.map(p => p[1])) + 1;
  const set = new Set(cells.map(p => p.join(",")));
  const el = document.createElement("div");
  el.className = "mini";
  el.style.gridTemplateColumns = `repeat(${w},7px)`;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = document.createElement("i");
    if (set.has(r + "," + c)) i.className = "on";
    el.appendChild(i);
  }
  return el;
}

/** 10×16 판 + 줄/칸 번호 라벨 생성 */
export function buildBoard(el, { preview = false } = {}) {
  el.innerHTML = "";
  el.appendChild(Object.assign(document.createElement("div"), { className: "lab" }));
  for (let c = 0; c < W; c++) el.appendChild(Object.assign(document.createElement("div"), { className: "lab", textContent: c + 1 }));
  for (let r = 0; r < H; r++) {
    el.appendChild(Object.assign(document.createElement("div"), { className: "lab", textContent: r + 1 }));
    for (let c = 0; c < W; c++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.i = r * W + c;
      el.appendChild(cell);
    }
  }
  el.classList.toggle("preview", preview);
}

/** 칸 하나 칠하기. highlight: CSS 색 값, num: 표시할 단계 번호, willClear: 삭제될 줄 표시 */
export function paintCell(cell, { filled, icon, highlight, num, willClear, age }) {
  cell.className = "cell" + (filled ? " f" : "") + (willClear ? " clr" : "");
  cell.style.background = highlight || "";
  cell.replaceChildren();
  if (highlight) {
    if (num) cell.appendChild(Object.assign(document.createElement("span"), { className: "num", textContent: num }));
    return;
  }
  if (icon) {
    cell.appendChild(Object.assign(document.createElement("span"), {
      className: "ic " + (icon === 1 ? "s" : "d"),
      textContent: icon === 1 ? "⇄" : "◎",
    }));
    if (age) {
      // 오래된 순서 (1 = 다음에 아이콘이 생기면 사라질 수 있는 것)
      const tag = Object.assign(document.createElement("span"), { textContent: age, title: `${age}번째로 오래된 아이콘` });
      tag.style.cssText = "position:absolute;top:0;right:2px;font-size:9px;line-height:1.2;font-weight:700;pointer-events:none;"
        + `color:${filled ? "#fff" : "var(--muted)"}`;
      cell.appendChild(tag);
    }
  }
}

export function rangeText(from, to, unit) {
  return from === to ? `${from}번째 ${unit}` : `${from}~${to}번째 ${unit}`;
}

/** 한 단계의 결과(줄 삭제, 능력 획득, 아이콘 생성) 설명 */
export function effectText(action) {
  const parts = [];
  if (action.cleared.length) {
    const n = action.cleared.length;
    parts.push(`${action.cleared.map(r => r + 1).join("·")}번째 줄 삭제 (+${(300 * n * n).toLocaleString()}점)`);
  }
  action.gained.forEach(g => parts.push(g === 1 ? "⇄ 바꿔 뽑기 획득" : "◎ 점 찍기 획득"));
  if (action.spawn) parts.push("능력 아이콘 새로 생김");
  if (action.vanished != null) parts.push(`가장 오래된 아이콘(${Math.floor(action.vanished / W) + 1}번째 줄) 사라짐`);
  return parts.join(" · ");
}
