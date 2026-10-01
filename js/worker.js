// 추천 계산을 화면과 분리된 스레드에서 실행 (계산 중에도 화면이 멈추지 않음)
import { solveDeep, decideSwap } from "./engine.js";
import { buildLibrary } from "./pieces.js";

self.onmessage = e => {
  const { id, root, opt, pieces, probs, deep } = e.data;
  try {
    const library = buildLibrary(pieces);
    // 1) 바꿔 뽑기를 먼저 쓰는 게 나은지
    const swap = decideSwap(root, opt, library, { probs });
    if (swap) {
      self.postMessage({ id, swap: { name: swap.name } });
      return;
    }
    // 2) 선읽기 탐색 (actions의 조각 방향 정보는 그대로 직렬화됨)
    const plans = solveDeep(root, opt, library, { ...deep, probs });
    self.postMessage({ id, plans });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
