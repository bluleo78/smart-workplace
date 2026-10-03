// 이슈 본문(마크다운 Textarea)에 이미지를 넣는 순수 텍스트 조작(WP-199).
// 업로드는 비동기라 먼저 자리표시 토큰을 커서에 넣고, 끝나면 토큰을 찾아 실제 이미지 마크다운으로 바꾼다.
// 업로드 중 사용자가 계속 타이핑해도 위치가 아니라 토큰 문자열로 찾으므로 안전하다.

const TOKEN_PREFIX = '![업로드 중… #'

/** 업로드 자리표시 토큰. `]()` 로 닫혀 있어 #1 이 #10 의 접두로 잘못 매칭되지 않는다. */
export function placeholderToken(seq: number): string {
  return `${TOKEN_PREFIX}${seq}]()`
}

/** 본문에 아직 업로드 중 토큰이 남아 있는지 — 저장 직전 마지막 방어선. */
export function hasPendingToken(text: string): boolean {
  return text.includes(TOKEN_PREFIX)
}

/**
 * start~end(선택 영역)를 insert 로 바꾸고, 이미지가 독립 줄에 오도록 앞뒤 줄바꿈을 보정한다.
 * 반환 caret 은 삽입한 내용(뒤 줄바꿈 포함) 바로 뒤 — 이어서 타이핑하면 다음 줄에 쓰인다.
 * lead 는 앞에 줄바꿈을 보탰는지 — 업로드 실패 시 removeToken 이 정확히 되돌리는 데 쓴다.
 */
export function insertAt(
  text: string, start: number, end: number, insert: string,
): { text: string; caret: number; lead: boolean } {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const lead = before.length > 0 && !before.endsWith('\n')
  const block = `${lead ? '\n' : ''}${insert}\n`
  return { text: before + block + after, caret: before.length + block.length, lead }
}

/** 첫 번째 token 을 replacement 로 바꾼다. 사용자가 토큰을 지웠으면 원문 그대로. */
export function replaceToken(text: string, token: string, replacement: string): string {
  const i = text.indexOf(token)
  if (i < 0) return text
  return text.slice(0, i) + replacement + text.slice(i + token.length)
}

/**
 * 실패한 업로드의 토큰을 insertAt 이 보탠 줄바꿈(앞 lead 여부·뒤 1개)과 함께 지워 삽입 전 텍스트로 되돌린다.
 * 빈 문자열 교체만 하면 "재현 \n\n화면" 처럼 줄바꿈이 남기 때문. 사용자가 토큰을 지웠으면 원문 그대로.
 */
export function removeToken(text: string, token: string, lead: boolean): string {
  const i = text.indexOf(token)
  if (i < 0) return text
  const start = lead && i > 0 && text[i - 1] === '\n' ? i - 1 : i
  const endAt = i + token.length
  const end = text[endAt] === '\n' ? endAt + 1 : endAt
  return text.slice(0, start) + text.slice(end)
}

/** 이미지 마크다운. alt 의 [ ] 와 줄바꿈은 마크다운 구문을 깨므로 제거·공백 치환한다. */
export function imageMarkdown(name: string, url: string): string {
  const alt = name.replace(/[[\]]/g, '').replace(/\s*\n\s*/g, ' ').trim()
  return `![${alt}](${url})`
}
