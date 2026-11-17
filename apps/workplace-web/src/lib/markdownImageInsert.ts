// 이슈 본문 원문(마크다운) 이미지 문자열 다루기(WP-199).
// 옛 Textarea 본문 칸이 업로드 중 커서에 넣던 자리표시 토큰을 알아보고(복원한 옛 초안에 남아 있을 수 있다), 이미지 마크다운을 만든다.

const TOKEN_PREFIX = '![업로드 중… #'

/** 본문에 아직 업로드 중 토큰이 남아 있는지 — 저장 직전 마지막 방어선. */
export function hasPendingToken(text: string): boolean {
  return text.includes(TOKEN_PREFIX)
}

/** 이미지 마크다운. alt 의 [ ] 와 줄바꿈은 마크다운 구문을 깨므로 제거·공백 치환한다. */
export function imageMarkdown(name: string, url: string): string {
  const alt = name.replace(/[[\]]/g, '').replace(/\s*\n\s*/g, ' ').trim()
  return `![${alt}](${url})`
}
