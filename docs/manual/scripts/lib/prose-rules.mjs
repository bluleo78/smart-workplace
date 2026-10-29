// 매뉴얼 본문 산문 규칙: 굵게 문구 대조와 집필 실수 검출.
import { proseLines } from './markdown.mjs';
import { norm } from './ui-strings.mjs';

// 화면 문구가 아니라 매뉴얼 자체의 라벨·역할명이라 대조하지 않는 굵게 문구.
const ALLOWED_BOLD = new Set(['참고', '주의', '경고', '이 장에서 할 수 있는 일', '구성원', '관리자', '슈퍼어드민']);
const MAX_UI_LEN = 20;
const SHORT_LEN = 4;
const BOLD = /\*\*([^*\n]+?)\*\*/g;

// 화면 문구 집합 → 부분 문자열 검색용 배열. 같은 집합으로 장마다 부르므로 집합당 한 번만 만든다.
const uiListCache = new WeakMap();
function uiListOf(uiStrings) {
  let list = uiListCache.get(uiStrings);
  if (!list) uiListCache.set(uiStrings, (list = [...uiStrings]));
  return list;
}

/**
 * 닫는 ** 앞이 구두점이고 바로 뒤가 글자인 굵게 구간을 모두 돌려준다.
 * CommonMark 는 이때 닫는 표지로 보지 않아 `**` 가 그대로 노출된다.
 */
export function findUnclosedEmphasis(line) {
  const hits = [];
  for (const m of line.matchAll(BOLD)) {
    const before = m[1].slice(-1);
    const after = line[m.index + m[0].length] ?? '';
    if (/[\p{P}\p{S}]/u.test(before) && /\p{L}/u.test(after)) hits.push(m[0]);
  }
  return hits;
}

/**
 * 장 본문 하나를 검사한다. 줄 번호는 body 기준이므로 프론트매터가 있으면 호출 쪽이 raw 를 넘긴다.
 * errors 는 `<kind> <file>:<line> <text>`, unverified 는 화면 문구에서 못 찾은 굵게 문구.
 */
export function checkProse(file, body, uiStrings) {
  const errors = [];
  const unverified = [];
  const all = body.split('\n');
  const ui = uiListOf(uiStrings);
  for (const [no, line] of proseLines(body)) {
    const at = `${file}:${no}`;
    // 인라인 코드 안의 ** · 04장 은 예시일 뿐이라 굵게·강조·장참조 검사에서 뺀다.
    const text0 = line.replace(/`[^`]*`/g, '');
    if (/^>\s*\*\*(참고|주의|경고)\*\*\s*$/.test(line) && all[no] !== undefined && /^>\s*\S/.test(all[no])) {
      errors.push(`[알림상자] ${at} 라벨 줄 다음에 빈 > 줄이 없다`);
    }
    for (const m of text0.matchAll(/(?<!\d)0[1-9]장/g)) errors.push(`[장참조] ${at} ${m[0]} (0 을 붙이지 않는다)`);
    for (const h of findUnclosedEmphasis(text0)) errors.push(`[강조미종결] ${at} ${h}`);
    if (/^>\s*TODO\(집필\)/.test(line)) errors.push(`[미집필] ${at} ${line.trim()}`);
    for (const m of text0.matchAll(BOLD)) {
      const text = norm(m[1]);
      if (ALLOWED_BOLD.has(text) || text.length > MAX_UI_LEN) continue;
      // 짧은 문구(저장 등)는 부분 문자열로 거의 다 맞으므로 정확히 같을 때만 확인된 것으로 본다.
      const found = text.length <= SHORT_LEN ? uiStrings.has(text) : ui.some((u) => u.includes(text));
      if (!found) unverified.push(`${at} ${text}`);
    }
  }
  return { errors, unverified };
}
