// WP-579 공유 링크 받는 쪽 — 링크 열기 실패를 화면 갈래로 나누는 판정과, 닫힌 공유 화면의 캐시 정리(순수 로직).

import { WIKI_SHARE_TOKEN_HEADER } from '@smart-workplace/wiki-editor-schema/collab-protocol'
import type { Query, QueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'

import { wikiKeys } from '../../hooks/queries/wikiKeys'
import type { WikiShareAccessRequestResult, WikiShareForbiddenError, WikiShareOtherTenantError } from '../../types/wiki'

/**
 * 링크 열기(GET /wiki/shares/{token}) 실패의 화면 갈래.
 * - switch: 다른 워크스페이스 링크이고 그곳 멤버다(409, 본문 최상위 code·tenantId) — 그 워크스페이스로 전환해 다시 연다.
 * - public: 다른 워크스페이스의 외부 링크이고 그곳 멤버가 아니다(409, code WIKI_SHARE_PUBLIC) — 비로그인과 같은 외부 보기를 그린다.
 * - forbidden: 지정한 사람이 아니다(403, 언제나 요청 가능) — 「접근 요청」·「요청함」(requested)·「거절됨」(denied, 24시간 안의 거절).
 * - gone: 없음·만료·해제·재발급(404) — 「링크가 더 이상 열리지 않습니다」.
 * - error: 그 밖의 실패(5xx·네트워크 등) — 링크 문제가 아니라 일시적일 수 있어 「불러오지 못했습니다 + 다시 시도」(외부 보기와 같게).
 */
export type ShareLinkFailure =
  | { kind: 'switch'; tenantId: number }
  | { kind: 'public' }
  | { kind: 'forbidden'; requested: boolean; denied: boolean }
  | { kind: 'gone' }
  | { kind: 'error' }

/**
 * 실패를 갈래로 나눈다. activeTenantId 와 같은 테넌트로 전환하라는 409 는 gone 으로 본다 — 전환해도 같은 응답이라
 * 같은 주소로 다시 이동하는 고리가 생긴다.
 */
export function classifyShareLinkError(error: unknown, activeTenantId: number | null): ShareLinkFailure {
  if (!isAxiosError(error)) return { kind: 'error' }
  const status = error.response?.status
  const body = error.response?.data as Partial<Omit<WikiShareOtherTenantError, 'code'> & WikiShareForbiddenError> & { code?: string } | undefined
  if (status === 409 && body?.code === 'WIKI_SHARE_OTHER_TENANT' && typeof body.tenantId === 'number') {
    return body.tenantId === activeTenantId ? { kind: 'gone' } : { kind: 'switch', tenantId: body.tenantId }
  }
  if (status === 409 && body?.code === 'WIKI_SHARE_PUBLIC') return { kind: 'public' }
  if (status === 403) {
    return {
      kind: 'forbidden',
      requested: body?.requested === true,
      denied: body?.denied === true,
    }
  }
  return isGoneError(error) ? { kind: 'gone' } : { kind: 'error' }
}

/** 접근 요청 화면의 상태 — 요청 전(idle)·요청함(requested)·거절됨(denied). */
export type AccessRequestState = 'idle' | 'requested' | 'denied'

/**
 * 403 이 실어 온 값과 방금 보낸 요청의 결과(sent)를 합쳐 접근 요청 화면 상태를 정한다. 거절이 대기보다 앞선다 — 24시간 안의 재요청은
 * 서버가 새 요청 없이 DENIED 를 돌려주므로 「요청함」으로 보이면 안 된다. NOT_NEEDED 는 바뀐 게 없어 요청 전 그대로다(화면은 링크를 다시 연다).
 */
export function accessRequestState(
  failure: { requested: boolean; denied: boolean },
  sent: WikiShareAccessRequestResult['status'] | undefined,
): AccessRequestState {
  if (sent === 'DENIED' || (sent == null && failure.denied)) return 'denied'
  if (sent === 'PENDING' || (sent == null && failure.requested)) return 'requested'
  return 'idle'
}

/**
 * 링크·페이지·입구가 「없다」는 응답(404)인지 — 이때만 「더 이상 열리지 않습니다」로 안내한다. 5xx·네트워크 오류는 링크가 살아 있어도 나므로
 * 「불러오지 못했습니다 + 다시 시도」로 나눈다.
 */
export function isGoneError(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 404
}

/**
 * 이 공유 토큰으로 받은 캐시인지 — 토큰 헤더로 받은 페이지 상세(['wiki','page',pageId,token])·멘션(['wiki','mentions',pageId,token])·
 * 이미지 blob(['api-blob',path,headers]). 공유가 해제돼 화면을 닫을 때 지워, 같은 탭에서 다시 그려지지 않게 한다.
 */
export function isShareTokenQuery(queryKey: readonly unknown[], token: string): boolean {
  if (queryKey[0] === 'wiki' && (queryKey[1] === 'mentions' || queryKey[1] === 'page')) return queryKey[3] === token
  if (queryKey[0] === 'api-blob') {
    const headers = queryKey[2] as Record<string, string> | null | undefined
    return headers?.[WIKI_SHARE_TOKEN_HEADER] === token
  }
  return false
}

/**
 * 닫힌 공유 화면의 캐시를 버린다 — 토큰으로 받은 페이지 상세·멘션·이미지와 링크 열기 결과(공유된 페이지 제목 트리).
 * 링크 열기 결과를 남기면 같은 주소로 돌아왔을 때 다시 묻는 동안 해제된 공유의 페이지 제목이 잠깐 보인다.
 * 페이지 상세는 토큰별 키라 같은 페이지의 멤버 캐시·다른 링크 캐시는 그대로 둔다.
 */
export function dropShareCaches(qc: QueryClient, token: string): void {
  qc.removeQueries({ predicate: (q: Query) => isShareTokenQuery(q.queryKey, token) })
  qc.removeQueries({ queryKey: wikiKeys.shareLink(token), exact: true })
}
