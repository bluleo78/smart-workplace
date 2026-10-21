// WP-579 노트 외부 공유 — 로그인 없이 여는 공개 조회. axios client 를 쓰지 않는다:
// client 는 401 이면 토큰 갱신을 시도하고 실패하면 /login 으로 보내는데, 이 화면은 로그인 없이 그려져야 한다.

import type { WikiPublicShare } from '../types/wiki'

/** 공개 조회 실패 — 401 은 「로그인하면 열리는 내부 링크」, 404 는 없음·만료·해제·외부 공유 꺼짐. */
export class WikiPublicShareError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`wiki public share ${status}`)
    this.status = status
  }
}

/** 외부 링크로 페이지 읽기 — pageId 를 주면 공유된 하위 페이지. 본문은 서버가 내부 링크·멘션을 가린 마크다운. */
export async function fetchPublicWikiShare(token: string, pageId?: number): Promise<WikiPublicShare> {
  const q = pageId != null ? `?pageId=${pageId}` : ''
  const res = await fetch(`/api/v1/public/wiki/shares/${encodeURIComponent(token)}${q}`)
  if (!res.ok) throw new WikiPublicShareError(res.status)
  return (await res.json()) as WikiPublicShare
}
