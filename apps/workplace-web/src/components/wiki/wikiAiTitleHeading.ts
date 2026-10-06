// AI 생성 결과에서 페이지 제목을 반복한 맨 앞 H1 을 걷어내는 방어(WP-255).
//
// 노트 페이지는 제목을 본문 밖 입력란으로 따로 보여 주므로, 모델이 본문 첫 줄에 같은 제목을 `# 제목` 으로
// 다시 쓰면 화면에 제목이 두 번 나온다. 프롬프트로도 막지만(ai-agent wiki-prompt) 모델이 지시를 어길 수 있어
// 삽입 직전에 한 번 더 거른다.

/** 비교용 정규화 — 앞뒤 공백·연속 공백, 감싼 굵게/기울임(`**…**`, `*…*`) 한 겹을 걷어낸다. */
function normalize(text: string): string {
  const collapsed = text.trim().replace(/\s+/g, ' ')
  const unwrapped = collapsed.replace(/^(\*\*|\*)(.+)\1$/, '$2')
  return unwrapped.trim()
}

/**
 * 마크다운의 첫 비어있지 않은 줄이 페이지 제목과 같은 H1(`# 제목`)이면 그 줄과 뒤따르는 빈 줄을 제거한다.
 *
 * - H1 만 대상이다 — `## 제목` 같은 섹션 제목은 의도한 구조일 수 있어 건드리지 않는다.
 * - 제목이 비어 있으면(제목 없는 페이지) 그대로 둔다 — 빈 제목과 `# ` 를 같다고 판정하는 오탐 방지.
 * - 첫 줄 외 위치의 같은 제목은 본문 내용이므로 그대로 둔다.
 */
export function stripLeadingTitleHeading(markdown: string, pageTitle: string): string {
  const title = normalize(pageTitle)
  if (!title) return markdown
  const lines = markdown.split('\n')
  const first = lines.findIndex((l) => l.trim() !== '')
  if (first < 0) return markdown
  // ATX H1 — `# 텍스트` (닫는 `#` 열은 허용). `##` 이상은 `#\s` 조건에서 걸러진다.
  const match = /^\s{0,3}#\s+(.*?)(?:\s+#+)?\s*$/.exec(lines[first])
  if (!match || normalize(match[1]) !== title) return markdown
  let next = first + 1
  while (next < lines.length && lines[next].trim() === '') next++
  return lines.slice(next).join('\n')
}
