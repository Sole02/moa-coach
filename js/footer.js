// 사이트 하단 정보 (제작자, 버전). 버전은 고칠 때마다 여기 숫자만 올리면 됨
export const VERSION = "1.1.0";
const AUTHOR = "JaeSeok";
const EMAIL = "ljaeseok02@gmail.com";

export function setupFooter() {
  const wrap = document.querySelector(".wrap");
  if (!wrap) return;
  let foot = wrap.querySelector("footer");
  if (!foot) {
    foot = document.createElement("footer");
    foot.className = "site-foot";
    wrap.appendChild(foot);
  }
  // 안내 문구가 있으면 그대로 두고, 아래 줄에 제작자·버전 추가
  const line = document.createElement("div");
  line.style.cssText = "margin-top:4px;font-size:12px;color:var(--muted);text-align:center";
  const mail = document.createElement("a");
  mail.href = `mailto:${EMAIL}`;
  mail.textContent = EMAIL;
  mail.style.color = "inherit";
  line.append(`제작 ${AUTHOR} · `, mail, ` · v${VERSION}`);
  foot.appendChild(line);
}
