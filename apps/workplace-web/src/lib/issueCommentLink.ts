// 이슈 코멘트 링크(WP-1175) — 코멘트마다 복사하는 주소와, 그 주소로 이슈를 열 때 어느 코멘트로 갈지 읽는 규칙을 한곳에 둔다.
// 주소는 이슈 주소 + 조각(#comment-<id>)이다 — 조각은 서버로 가지 않아 권한·404 처리는 이슈 주소 그대로 따른다.

/** 코멘트 조각의 머리 — `#comment-123`. */
const COMMENT_HASH = /^#comment-(\d+)$/

/** 코멘트로 바로 가는 앱 안 경로 — `/projects/WP/issues/12#comment-345`. */
export function issueCommentPath(projectKey: string, issueNumber: number, commentId: number): string {
  return `/projects/${projectKey}/issues/${issueNumber}#comment-${commentId}`
}

/** 주소 조각(location.hash)이 가리키는 코멘트 id — 코멘트 조각이 아니면 null. */
export function commentIdFromHash(hash: string): number | null {
  const m = COMMENT_HASH.exec(hash)
  if (!m) return null
  const id = Number(m[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
