// 조각(블록) 데이터와 모양 계산 유틸
// rows 표기: "#" = 칸 있음, "." = 빈칸

export const DEFAULT_PIECES = [
  { name: "ㆍ", rows: ["#"] },
  { name: "ㅡ", rows: ["###"] },
  { name: "ㅅ", rows: [".#.", "#.#"] },
  { name: "ㄱ", rows: ["##", ".#", ".#"] },
  { name: "ㅇ", rows: [".#.", "#.#", ".#."] },
  { name: "ㅏ", rows: ["#.", "##", "#."] },
  { name: "ㄷ", rows: ["##", "#.", "##"] },
  { name: "ㅣ", rows: ["#", "#", "#", "#", "#"] },
  { name: "ㅈ", rows: ["###", ".#.", "#.#"] },
  { name: "ㅋ", rows: ["##", ".#", "##", ".#"] },
  { name: "ㅊ", rows: [".#.", "###", ".#.", "#.#"] },
  { name: "ㅑ", rows: ["#.", "##", "#.", "##", "#."] },
  { name: "ㄹ", rows: ["##", ".#", "##", "#.", "##"] },
  { name: "ㅌ", rows: ["##", "#.", "##", "#.", "##"] },
  { name: "ㅁ", rows: ["###", "#.#", "###"] },
  { name: "ㅎ", rows: ["..#..", "#####", ".#.#.", "..#.."] },
  { name: "ㅂ", rows: ["#.#", "###", "#.#", "###"] },
  { name: "ㅍ", rows: ["####", ".##.", "####"] },
];

/** rows 문자열 배열 → [행, 열] 좌표 목록 */
export function cellsOf(rows) {
  const out = [];
  rows.forEach((line, r) => [...line].forEach((ch, c) => { if (ch === "#") out.push([r, c]); }));
  return out;
}

/** 좌표를 (0,0) 기준으로 당기고 정렬 */
export function normalize(cells) {
  const minR = Math.min(...cells.map(p => p[0]));
  const minC = Math.min(...cells.map(p => p[1]));
  return cells.map(([r, c]) => [r - minR, c - minC]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** 좌표 목록 → rows 문자열 배열 */
export function rowsFromCells(cells) {
  const n = normalize(cells);
  const h = Math.max(...n.map(p => p[0])) + 1;
  const w = Math.max(...n.map(p => p[1])) + 1;
  const set = new Set(n.map(p => p.join(",")));
  return Array.from({ length: h }, (_, r) =>
    Array.from({ length: w }, (_, c) => (set.has(r + "," + c) ? "#" : ".")).join(""));
}

/**
 * 회전 4방향 × 반전 2가지 중 서로 다른 모양만 반환.
 * masks[i]: i번째 줄의 비트마스크 (비트 c = 왼쪽에서 c번째 칸)
 */
export function orientations(rows) {
  const base = cellsOf(rows);
  const seen = new Set();
  const result = [];
  for (let flip = 0; flip < 2; flip++) {
    let cur = flip ? base.map(([r, c]) => [r, -c]) : base;
    for (let k = 0; k < 4; k++) {
      const n = normalize(cur);
      const key = n.map(p => p.join(",")).join(";");
      if (!seen.has(key)) {
        seen.add(key);
        const h = Math.max(...n.map(p => p[0])) + 1;
        const w = Math.max(...n.map(p => p[1])) + 1;
        const masks = new Array(h).fill(0);
        n.forEach(([r, c]) => { masks[r] |= 1 << c; });
        result.push({ h, w, masks, cells: n });
      }
      cur = cur.map(([r, c]) => [c, -r]); // 90도 회전
    }
  }
  return result;
}

/** 조각 목록 → 계산용 라이브러리 { list, map } (칸 수 오름차순) */
export function buildLibrary(pieces) {
  const list = pieces
    .filter(p => cellsOf(p.rows).length > 0)
    .map(p => ({ name: p.name, rows: p.rows.slice(), size: cellsOf(p.rows).length, orients: orientations(p.rows) }))
    .sort((a, b) => a.size - b.size);
  const map = {};
  list.forEach(p => { map[p.name] = p; });
  return { list, map };
}
