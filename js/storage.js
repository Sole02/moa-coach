// 브라우저 저장소: 편집한 조각 목록만 저장 (판·능력은 켤 때마다 초기화)
const KEY = "hangul-moa-pieces-v2";

export function loadPieces() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "null");
    if (Array.isArray(data) && data.length) return data;
  } catch (e) { /* 저장소를 못 쓰는 환경이면 기본값 사용 */ }
  return null;
}

export function savePieces(pieces) {
  try { localStorage.setItem(KEY, JSON.stringify(pieces)); } catch (e) { /* 무시 */ }
}

export function clearPieces() {
  try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
}

// 조각 등장 횟수 기록 (선읽기에서 실제 확률에 가깝게 쓰기 위함)
const COUNT_KEY = "hangul-moa-piece-counts-v1";

export function loadCounts() {
  try {
    const data = JSON.parse(localStorage.getItem(COUNT_KEY) || "null");
    if (data && typeof data === "object") return data;
  } catch (e) { /* 무시 */ }
  return {};
}

export function saveCounts(counts) {
  try { localStorage.setItem(COUNT_KEY, JSON.stringify(counts)); } catch (e) { /* 무시 */ }
}
