// 값이 보이는 속성 버튼의 접근 이름(WP-853) — aria-label 이 버튼 안 글자를 덮어써서 스크린리더는 「마감일 선택」만 읽고
// 지금 값(11월 20일)을 읽지 못했고, 음성 제어는 화면에 보이는 글자로 버튼을 찾지 못했다(WCAG 2.5.3 Label in Name·4.1.2).
// 기존 이름을 앞에 두고 화면에 그리는 값 글자를 그대로 뒤에 붙인다 — 「마감일 선택: 11월 20일」.

/**
 * `label: 값, 덧붙임…` 형태의 접근 이름을 만든다.
 * 값 조각은 반드시 화면에 그리는 글자와 같은 문자열을 넘긴다(Label in Name). 비거나 false 인 조각은 건너뛰고,
 * 남은 조각이 없으면 label 만 돌려준다(값이 화면에 안 보이는 경우 — 예: 붙은 사이클 없음).
 */
export function labelWithValue(label: string, ...parts: Array<string | null | undefined | false>): string {
  const shown = parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  return shown.length === 0 ? label : `${label}: ${shown.join(', ')}`;
}
