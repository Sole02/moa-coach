// 게임 규칙 시뮬레이션 + 추천 탐색(빔 서치)
// 판은 줄마다 10비트 정수로 표현: rows[r]의 비트 c = r번째 줄 c번째 칸이 채워짐
// icons[r*W+c]: 0 없음, 1 바꿔 뽑기(⇄), 2 점 찍기(◎)
// iconOrder: 아이콘 칸 번호 목록 (오래된 것부터)

export const W = 10;
export const H = 16;
export const FULL = (1 << W) - 1;
export const MAX_ABILITIES = 7;
export const SPAWN_EVERY = 7;
export const MAX_ICONS = 3; // 판 위 능력 아이콘 최대 개수 (넘치면 가장 오래된 것부터 사라짐)

const POP = new Uint8Array(1 << W);
for (let i = 1; i < POP.length; i++) POP[i] = POP[i >> 1] + (i & 1);
export const popcount = m => POP[m];

/** 제거한 줄 누적 수 → 단계 (이벤트 안내 기준) */
export function stageOf(lines) {
  return lines <= 30 ? 1 : lines <= 60 ? 2 : lines <= 100 ? 3 : lines <= 150 ? 4 : 5;
}

export function fits(rows, o, r, c) {
  for (let i = 0; i < o.h; i++) if (rows[r + i] & (o.masks[i] << c)) return false;
  return true;
}

/** 조각을 놓을 수 있는 위치 수 (cap에 도달하면 바로 반환) */
export function countFits(rows, orients, cap) {
  let n = 0;
  for (const o of orients)
    for (let r = 0; r <= H - o.h; r++)
      for (let c = 0; c <= W - o.w; c++)
        if (fits(rows, o, r, c) && ++n >= cap) return n;
  return n;
}

function clone(s) {
  return {
    rows: s.rows.slice(), icons: s.icons.slice(), iconOrder: (s.iconOrder || []).slice(),
    dots: s.dots, swaps: s.swaps, counter: s.counter,
    hand: s.hand.slice(), gain: s.gain, placed: s.placed, lines: s.lines, actions: s.actions.slice(),
  };
}

/** 꽉 찬 가로줄 삭제 + 점수 + 아이콘 능력 획득 (중력 없음) */
function clearLines(s) {
  const cleared = [];
  const gained = [];
  for (let r = 0; r < H; r++) if (s.rows[r] === FULL) cleared.push(r);
  for (const r of cleared) {
    s.rows[r] = 0;
    for (let c = 0; c < W; c++) {
      const t = s.icons[r * W + c];
      // 능력이 최대치면 아이콘은 판에 그대로 남음
      if (t && s.dots + s.swaps < MAX_ABILITIES) {
        if (t === 1) s.swaps++; else s.dots++;
        s.gain += 50;
        gained.push(t);
        s.icons[r * W + c] = 0;
        if (s.iconOrder) s.iconOrder = s.iconOrder.filter(i => i !== r * W + c);
      }
    }
  }
  if (cleared.length) {
    s.gain += 300 * cleared.length * cleared.length; // 1줄 300, 2줄 1200, 3줄 2700 ...
    s.lines += cleared.length;
  }
  return { cleared, gained };
}

export function doPlace(s, name, o, r, c) {
  const t = clone(s);
  for (let i = 0; i < o.h; i++) t.rows[r + i] |= o.masks[i] << c;
  t.gain += o.cells.length;
  t.placed++;
  t.hand.splice(t.hand.indexOf(name), 1);
  let spawn = false;
  if (t.counter > 0) {
    t.counter--;
    if (t.counter === 0) { spawn = true; t.counter = SPAWN_EVERY; }
  }
  const fx = clearLines(t);
  // 새 아이콘이 생길 때 판에 이미 3개면 가장 오래된 아이콘이 사라짐 (새 아이콘 위치는 랜덤이라 모름)
  let vanished = null;
  if (spawn) {
    t.iconOrder = t.iconOrder.filter(i => t.icons[i]);
    if (t.iconOrder.length >= MAX_ICONS) {
      vanished = t.iconOrder.shift();
      t.icons[vanished] = 0;
    }
  }
  t.actions.push({ type: "place", name, o, r, c, cleared: fx.cleared, gained: fx.gained, spawn, vanished });
  return t;
}

/** 점 찍기는 조각 배치 횟수에 포함되지 않음 */
export function doDot(s, r, c) {
  const t = clone(s);
  t.rows[r] |= 1 << c;
  t.dots--;
  t.gain += 1;
  const fx = clearLines(t);
  t.actions.push({ type: "dot", r, c, cleared: fx.cleared, gained: fx.gained });
  return t;
}

/** 점 하나로 줄이 완성되는 칸 목록 */
export function dotOptions(s) {
  const out = [];
  if (s.dots <= 0) return out;
  for (let r = 0; r < H; r++) {
    const empty = FULL & ~s.rows[r];
    if (empty && (empty & (empty - 1)) === 0) out.push([r, 31 - Math.clz32(empty)]);
  }
  return out;
}

/** 조각을 놓기 전에 점을 0~2개 쓰는 경우들 */
function withDots(s) {
  const out = [s];
  let layer = [s];
  for (let k = 0; k < 2; k++) {
    const next = [];
    for (const st of layer) for (const [r, c] of dotOptions(st)) next.push(doDot(st, r, c));
    out.push(...next);
    layer = next;
  }
  return out;
}

/** 빈 공간 덩어리 분석: 전체 빈칸 수, 크기 1·2·3짜리 갇힌 공간 수 */
export function analyze(rows) {
  const vis = new Uint8Array(W * H);
  const stack = new Int16Array(W * H);
  const isFilled = (r, c) => (rows[r] >> c) & 1;
  let empties = 0, s1 = 0, s2 = 0, s3 = 0;
  for (let i = 0; i < W * H; i++) {
    const r = (i / W) | 0, c = i % W;
    if (vis[i] || isFilled(r, c)) continue;
    let sp = 0, k = 0;
    stack[sp++] = i; vis[i] = 1;
    while (sp) {
      const j = stack[--sp]; k++;
      const rr = (j / W) | 0, cc = j % W;
      if (rr > 0 && !vis[j - W] && !isFilled(rr - 1, cc)) { vis[j - W] = 1; stack[sp++] = j - W; }
      if (rr < H - 1 && !vis[j + W] && !isFilled(rr + 1, cc)) { vis[j + W] = 1; stack[sp++] = j + W; }
      if (cc > 0 && !vis[j - 1] && !isFilled(rr, cc - 1)) { vis[j - 1] = 1; stack[sp++] = j - 1; }
      if (cc < W - 1 && !vis[j + 1] && !isFilled(rr, cc + 1)) { vis[j + 1] = 1; stack[sp++] = j + 1; }
    }
    empties += k;
    if (k === 1) s1++; else if (k === 2) s2++; else if (k === 3) s3++;
  }
  return { empties, s1, s2, s3 };
}

/** 평가 가중치 (시뮬레이션으로 조정 가능) */
export const DEFAULT_WEIGHTS = {
  hole1: 35, hole2: 18, hole3: 8, empty: 2.5,
  dot: 80, swap: 150, noAbility: 60,            // 능력을 아끼는 쪽이 시뮬레이션 점수가 높았음
  gainBase: 0.04, gainRisk: 0.26, nearFull: 25, // 여러 줄 동시 삭제 준비
  iconSwap: 60, iconDot: 30,
  bankRatio: 0.3, lossRisk: 0.8,              // 판 위 아이콘 저금 가치, 사라질 위험 감점
  unfitBase: 30, unfitPer: 10, fitLog: 4, bigMult: 1.25,
};

/** 빠른 평가: 배치 수, 갇힌 공간, 빈칸, 능력, 점수, 아이콘 줄 진행도 */
function evalCheap(s, opt) {
  const w = opt.w || DEFAULT_WEIGHTS;
  let v = s.placed * 10000;
  const a = analyze(s.rows);
  v -= a.s1 * w.hole1 + a.s2 * w.hole2 + a.s3 * w.hole3;
  v += a.empties * w.empty;
  v += s.dots * w.dot + s.swaps * w.swap;
  if (s.dots + s.swaps === 0) v -= w.noAbility; // 능력 0개 = 막히면 바로 게임 오버
  v += s.gain * (w.gainBase + w.gainRisk * opt.risk);
  for (let r = 0; r < H; r++) {
    const e = W - POP[s.rows[r]];
    if (e >= 1 && e <= 2) v += opt.risk * w.nearFull * (3 - e); // 동시 삭제 준비
  }
  if (opt.bank === false) {
    // 예전 방식: 보유 7개면 판 위 아이콘 가치를 0으로 봄
    if (s.dots + s.swaps < MAX_ABILITIES) {
      for (let i = 0; i < W * H; i++) {
        const t = s.icons[i];
        if (!t) continue;
        const e = W - POP[s.rows[(i / W) | 0]];
        if (e > 0) v += (t === 1 ? w.iconSwap : w.iconDot) / e;
      }
    }
    return v;
  }
  // 판 위 아이콘 = 나중에 받을 수 있는 능력 (보유 7개여도 아이콘은 판에 남으니 '저금'으로 봄)
  const full = s.dots + s.swaps >= MAX_ABILITIES;
  const live = [];
  for (let i = 0; i < W * H; i++) {
    const t = s.icons[i];
    if (!t) continue;
    live.push(i);
    const e = W - POP[s.rows[(i / W) | 0]];
    const base = t === 1 ? w.iconSwap : w.iconDot;
    // 받을 자리가 있으면 줄이 찰수록 가치↑, 보유가 꽉 찼으면 저금 가치만 (자리 나면 받으면 됨)
    v += full ? base * w.bankRatio : (e > 0 ? base / e : 0);
  }
  // 판에 아이콘이 3개면 다음 아이콘이 생길 때 가장 오래된 것이 사라짐 → 그 아이콘 가치만큼 위험
  if (live.length >= MAX_ICONS) {
    const order = (s.iconOrder || []).filter(i => s.icons[i]);
    const oldest = order.length ? order[0] : live[0];
    const t = s.icons[oldest];
    const lossValue = t === 1 ? w.swap : w.dot;
    const soon = s.counter <= 2 ? 1 : s.counter <= 4 ? 0.6 : 0.3; // 다음 아이콘까지 남은 배치 수
    v -= lossValue * w.lossRisk * soon;
  }
  return v;
}

/** 정밀 평가: 모든 조각에 대해 놓을 자리가 남아 있는지 */
function fitTerm(s, opt, lib) {
  const w = opt.w || DEFAULT_WEIGHTS;
  let v = 0;
  const stage = stageOf(opt.lines + s.lines);
  for (const p of lib) {
    const n = countFits(s.rows, p.orients, 30);
    const mult = stage >= 3 ? (p.size >= 6 ? w.bigMult : 2 - w.bigMult) : 1;
    if (n === 0) v -= (w.unfitBase + w.unfitPer * p.size) * (1.3 - 0.3 * opt.risk) * mult;
    else v += w.fitLog * Math.log2(1 + n);
  }
  return v;
}

function keyOf(s) {
  return s.rows.join(",") + "|" + s.hand.slice().sort().join("") + "|" + s.dots + "," + s.swaps + "|" + s.icons.join("");
}

/**
 * 추천 탐색.
 * root: { rows, icons, dots, swaps, counter, hand, gain:0, placed:0, lines:0, actions:[] }
 * opt:  { risk: 0~1, lines: 현재까지 제거한 줄 수 }
 * library: buildLibrary() 결과
 * 반환: 최종 상태 최대 3개 (actions에 순서가 들어 있음)
 */
export function solve(root, opt, library, { beam = 40, shortlist = 240, top = 3 } = {}) {
  const lib = library.list;
  const finals = [];
  root.full = evalCheap(root, opt) + fitTerm(root, opt, lib);
  let frontier = [root];

  for (let step = 0; step < root.hand.length && frontier.length; step++) {
    const kids = [];
    const seen = new Set();
    for (const st of frontier) {
      let placedAny = false;
      for (const pre of withDots(st)) {
        for (const name of new Set(pre.hand)) {
          const piece = library.map[name];
          if (!piece) continue;
          for (const o of piece.orients)
            for (let r = 0; r <= H - o.h; r++)
              for (let c = 0; c <= W - o.w; c++) {
                if (!fits(pre.rows, o, r, c)) continue;
                placedAny = true;
                const child = doPlace(pre, name, o, r, c);
                const k = keyOf(child);
                if (seen.has(k)) continue;
                seen.add(k);
                child.cheap = evalCheap(child, opt);
                kids.push(child);
              }
        }
      }
      if (!placedAny) finals.push(st); // 더 놓을 수 없는 상태
    }
    if (!kids.length) break;

    kids.sort((a, b) => b.cheap - a.cheap);
    const top = kids.slice(0, shortlist);
    for (const k of top) k.full = k.cheap + fitTerm(k, opt, lib);
    top.sort((a, b) => b.full - a.full);
    for (const k of top) if (k.hand.length === 0) finals.push(k);
    frontier = top.filter(k => k.hand.length > 0).slice(0, beam);
  }

  finals.sort((a, b) => (b.placed - a.placed) || (b.full - a.full));
  const out = [];
  const used = new Set();
  for (const f of finals) {
    const k = keyOf(f) + "#" + f.actions.length;
    if (used.has(k)) continue;
    used.add(k);
    out.push(f);
    if (out.length >= top) break;
  }
  return out;
}

/**
 * 선읽기 탐색: 상위 후보마다 "다음에 나올 조각 3개"를 여러 번 가정해서
 * 그다음 판까지 잘 이어지는 후보를 고른다. 조각 확률은 모두 같다고 가정.
 * samples: 가정할 다음 조각 묶음 수, candidates: 비교할 후보 수
 */
export function solveDeep(root, opt, library, { samples = 8, candidates = 6, seed = 7, probs = null } = {}) {
  const base = solve(root, opt, library, { top: Math.max(3, candidates) });
  if (base.length <= 1) return base;
  const w = opt.w || DEFAULT_WEIGHTS;
  const names = library.list.map(p => p.name);
  let x = seed;
  const rand = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  const weights = names.map(n => (probs && probs[n] != null ? probs[n] : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const pick = () => {
    let t = rand() * total;
    for (let i = 0; i < names.length; i++) { t -= weights[i]; if (t <= 0) return names[i]; }
    return names[names.length - 1];
  };
  const hands = Array.from({ length: samples }, () => [pick(), pick(), pick()]);
  const maxPlaced = base[0].placed;
  for (const c of base) {
    if (c.placed < maxPlaced || c.hand.length) { c.deep = -Infinity; continue; }
    let total = 0;
    for (const hand of hands) {
      const next = {
        rows: c.rows.slice(), icons: c.icons.slice(), iconOrder: (c.iconOrder || []).slice(),
        dots: c.dots, swaps: c.swaps, counter: c.counter,
        hand: hand.slice(), gain: 0, placed: 0, lines: 0, actions: [],
      };
      const best = solve(next, { ...opt, lines: opt.lines + c.lines }, library, { beam: 6, shortlist: 40, top: 1 })[0];
      let v = best.placed * 3000 + best.full - best.placed * 10000;
      // 막혔는데 바꿔 뽑기가 있으면 살 수 있으니 일부만 감점
      if (best.hand.length && best.swaps >= best.hand.length) v += 1500 * best.hand.length;
      total += v;
    }
    c.deep = total / samples + c.gain * (w.gainBase + w.gainRisk * opt.risk);
  }
  const ranked = base.filter(c => c.deep !== -Infinity).sort((a, b) => b.deep - a.deep);
  const rest = base.filter(c => c.deep === -Infinity);
  return ranked.concat(rest).slice(0, 3);
}

/** 시작 상태에서 actions를 순서대로 적용한 상태 목록 (각 단계 '전' 판 + 마지막 판) */
export function replay(root, actions) {
  const states = [root];
  let cur = root;
  for (const a of actions) {
    cur = a.type === "dot" ? doDot(cur, a.r, a.c) : doPlace(cur, a.name, a.o, a.r, a.c);
    states.push(cur);
  }
  return states;
}

/**
 * 바꿔 뽑기를 지금 쓰는 게 나은지 판단.
 * 보유 조각 X를 바꾸면 나올 수 있는 모든 조각(균등 확률)에 대해 결과를 평균내서
 * 바꾸지 않을 때보다 확실히 좋으면 { name: X } 반환, 아니면 null.
 */
export function decideSwap(root, opt, library, { margin = 40, probs = null } = {}) {
  if (root.swaps <= 0 || !root.hand.length) return null;
  const quick = { beam: 8, shortlist: 60, top: 1 };
  const keep = solve(root, opt, library, quick)[0];
  const keepVal = keep ? keep.full : -Infinity;
  const names = library.list.map(p => p.name);
  const weightOf = n => (probs && probs[n] != null ? probs[n] : 1);
  const totalW = names.reduce((a, n) => a + weightOf(n), 0);
  let best = null;
  for (const x of new Set(root.hand)) {
    let sum = 0;
    for (const n of names) {
      const hand = root.hand.slice();
      hand[hand.indexOf(x)] = n;
      const s = { ...root, rows: root.rows.slice(), icons: root.icons.slice(), hand, swaps: root.swaps - 1, actions: [] };
      const r = solve(s, opt, library, quick)[0];
      sum += (r ? r.full : -1e6) * weightOf(n);
    }
    const val = sum / totalW;
    if (val > keepVal + margin && (!best || val > best.val)) best = { name: x, val, keepVal };
  }
  return best;
}
