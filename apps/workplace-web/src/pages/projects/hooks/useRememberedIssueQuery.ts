// 프로젝트 이슈 화면의 필터·보기·그룹 기억(WP-1035) — 다른 화면에 다녀오거나 새로 들어와도 지난번 조건으로 다시 연다.
// 화면의 조건은 URL 이 단일 원본이라, 기억도 URL 을 그대로 따라 쓰고 들어올 때 URL 로 되살린다.
// - 「들어옴」은 링크·주소 입력·뒤로 가기(PUSH·POP)다. 화면 안 조건 바꾸기는 모두 replace 라 들어옴이 아니다 —
//   그래서 화면 안에서 필터를 모두 지우면 기억도 지우고, 사이드바의 같은 프로젝트 링크로 다시 들어오면 되살린다.
// - 들어온 주소에 조건이 없을 때만 되살린다 — 공유 링크·에픽 링크·저장된 뷰처럼 주소에 조건이 있으면 그것을 따르고 기억을 바꾼다.
// - 저장 위치는 내 브라우저의 사용자·워크스페이스·프로젝트별 localStorage(useIssueListColumns 와 같은 키 규칙).
import { useEffect } from 'react'
import { useNavigationType, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { safeLocalStorage } from '@/lib/safeLocalStorage'
import { userScopedKey } from '@/lib/userScopedKey'

import { BOARD_TAB_PARAM } from '../../../lib/boardTabs'
import { filtersToParams, parseFilters, parseGroupParam, parseView } from '../../../lib/issueFilters'

const STORAGE_BASE = 'issue-list-query'

/**
 * 기억할 몫 — 필터·보기·그룹(과 보드 탭). 같은 규칙으로 다시 써 모르는 값은 버리고, AI 채팅 등 다른 쿼리는 뺀다.
 * 목록 열(cols)은 뺀다 — 열은 개인 저장값(useIssueListColumns)이 따로 기억하고, URL cols 를 되살리면 열 바꾸기가 개인 저장값 대신 URL 로 가 개인 설정이 묻힌다.
 */
export function rememberedIssueQuery(params: URLSearchParams): URLSearchParams {
  const q = filtersToParams(parseFilters(params), parseView(params), parseGroupParam(params))
  const tab = params.get(BOARD_TAB_PARAM)
  if (tab && q.get('view') === 'board') q.set(BOARD_TAB_PARAM, tab)
  return q
}

function read(key: string): string {
  try {
    return safeLocalStorage()?.getItem(key) ?? ''
  } catch {
    return ''
  }
}

/** 기억을 쓰거나(빈 값이면 지운다) — 저장소가 막혔으면(사생활 보호 모드 등) 기억만 못 할 뿐이라 무시한다. */
function write(key: string, value: string): void {
  try {
    const storage = safeLocalStorage()
    if (value) storage?.setItem(key, value)
    else storage?.removeItem(key)
  } catch {
    // 다음 진입은 기본 조건으로 열린다
  }
}

/**
 * 프로젝트 이슈 화면(/projects/:key)에서 한 번 부른다 — 들어올 때 되살리고, 이후 URL 이 바뀔 때마다 기억한다.
 * @param enabled 프로젝트를 불러왔을 때만 — 없거나 볼 수 없는 프로젝트의 기억은 만들지 않는다.
 * @returns 되살리는 중인가 — 그동안 화면은 목록을 그리지 않는다(기본 조건 목록이 잠깐 보이고 헛요청이 나가지 않게).
 */
export function useRememberedIssueQuery(projectKey: string, enabled: boolean): boolean {
  const { user, activeTenant } = useAuth()
  // 로그인 전엔 누구의 기억도 읽거나 쓰지 않는다.
  const storageKey = user && enabled
    ? userScopedKey(`${STORAGE_BASE}:${projectKey}`, { userId: user.id, tenantId: activeTenant?.tenantId ?? null })
    : null
  const [params, setParams] = useSearchParams()
  const navigationType = useNavigationType()
  const query = rememberedIssueQuery(params).toString()
  // 주소에 조건이 있는가 — 기본 보기(view=list)는 직렬화하면 빠지지만, 주소에 적혀 있으면 「목록으로」 고른 것이라 되살리지 않는다.
  const explicit = query !== '' || params.has('view')
  const stored = storageKey && !explicit && navigationType !== 'REPLACE'
    ? rememberedIssueQuery(new URLSearchParams(read(storageKey))).toString()
    : ''

  useEffect(() => {
    if (!storageKey) return
    if (stored) {
      // 기억한 조건만 덧쓴다 — 주소의 다른 쿼리(AI 채팅 등)는 그대로. 뒤로 가기에 빈 화면이 끼지 않게 replace.
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        new URLSearchParams(stored).forEach((v, k) => next.set(k, v))
        return next
      }, { replace: true })
      return
    }
    write(storageKey, query)
  }, [storageKey, stored, query, setParams])

  return stored !== ''
}
