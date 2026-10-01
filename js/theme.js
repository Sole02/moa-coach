// 다크 모드 전환. 고른 테마는 브라우저에 저장, 고른 적 없으면 컴퓨터 설정을 따름
const THEME_KEY = "moa-coach-theme";
const root = document.documentElement;
const media = window.matchMedia("(prefers-color-scheme: dark)");

function savedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
}
function currentTheme() {
  const t = root.getAttribute("data-theme");
  if (t === "dark" || t === "light") return t;
  return media.matches ? "dark" : "light";
}
function applyTheme(theme) {
  root.setAttribute("data-theme", theme);
}

export function setupThemeToggle() {
  const saved = savedTheme();
  if (saved === "dark" || saved === "light") applyTheme(saved);

  const header = document.querySelector("header");
  const title = header && header.querySelector("h1");
  if (!title) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn small";
  const label = () => {
    const dark = currentTheme() === "dark";
    btn.textContent = dark ? "☀ 라이트 모드" : "☾ 다크 모드";
    btn.setAttribute("aria-pressed", String(dark));
  };
  btn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 무시 */ }
    label();
  });
  media.addEventListener?.("change", label);
  label();

  // 제목 오른쪽에 버튼 배치
  const row = document.createElement("div");
  row.className = "row between";
  title.replaceWith(row);
  row.append(title, btn);
}
