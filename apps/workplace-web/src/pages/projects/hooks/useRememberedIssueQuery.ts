// 프로젝트 이슈 화면의 필터·보기·그룹 기억(WP-1035) — 다른 화면에 다녀오거나 새로 들어와도 지난번 조건으로 다시 연다.
// 화면의 조건은 URL 이 단일 원본이라, 기억도 URL 을 그대로 따라 쓰고 들어올 때 URL 로 되살린다.
// - 조건 없는 주소는 되살린다. 단 이 화면에 조건이 있다가 replace 로 없어졌으면(화면 안에서 필터를 모두 지움·「전체」 칩) 기억을 지운다.
//   조건 없는 replace 를 모두 「지움」으로 보면 앱의 다른 replace(AI 대화 링크가 aiChat 을 지움, 모바일 뒤로 가기)가 기억을 지운다.
//   이 화면에 조건이 있었어도 링크·뒤로 가기(PUSH·POP)로 조건 없이 다시 들어오면(사이드바의 같은 프로젝트 링크) 되살린다.
// - 알 수 없는 필터 값만 든 주소(?status=BOGUS, WP-2083)는 조건이 있는 주소로 보아 되살리지 않고, 기억도 쓰지도 지우지도 않는다 — 오타 주소가 기억을 덮거나 지우지 않게.
//   그 값을 「주소에서 지우기」로 치운 이동(state IGNORED_CLEARED_STATE)은 기억을 되살리지도 cleared 로 지우지도 않는다(남은 조건이 있으면 평소처럼 기억).
// - 들어온 주소에 조건이 없을 때만 되살린다 — 공유 링크·에픽 링크·저장된 뷰처럼 주소에 조건이 있으면 그것을 따르고 기억을 바꾼다.
// - 개요 탭(WP-1478)의 링크는 조건을 단 주소로 이슈 탭을 열지만 기억은 바꾸지 않는다(state FROM_OVERVIEW_STATE) — 「오래 멈춤」·
//   고정 날짜(마감 ~11/10) 같은 그때그때의 조건이 사용자가 고른 기억을 덮지 않게. 화면 안에서 조건을 바꾸면(replace, state 없음) 다시 기억한다.
// - 저장 위치는 내 브라우저의 사용자·워크스페이스·프로젝트별 localStorage(useIssueListColumns 와 같은 키 규칙).
import { useEffect, useState } from 'react'
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { readStored, writeStored } from '@/lib/storageWithFallback'
import { userScopedKey } from '@/lib/userScopedKey'

import { BOARD_TAB_PARAM } from '../../../lib/boardTabs'
import { ignoredFilterTokens } from '../../../lib/ignoredFilterTokens'
import { filtersToParams, parseFilters, parseGroupParam, parseView } from '../../../lib/issueFilters'
import { readProjectNavState } from '../tabs/projectTabs'

const STORAGE_BASE = 'issue-list-query'

/**
 * 「알 수 없는 필터 값을 주소에서 지우기」(WP-2083) 이동이 싣는 router state 표지 — 그 replace 로 조건이 모두 없어져도
 * 「화면 안에서 필터를 모두 지움」으로 보아 기억을 지우지 않고, 조건 없는 주소라고 기억을 되살리지도 않는다(오타를 치운 것일 뿐 사용자가 조건을 푼 게 아니다).
 */
export const IGNORED_CLEARED_STATE = { ignoredCleared: true } as const

/** location.state 에서 「알 수 없는 값 지우기」 표지를 읽는다 — 다른 state·null 이면 false. */
export function readIgnoredClearedState(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as { ignoredCleared?: unknown }).ignoredCleared === true
}

/** 기존 location.state(개요 링크 표지 등)는 살리고 「알 수 없는 값 지우기」 표지만 합친 state. */
export function withIgnoredCleared(state: unknown): object {
  return { ...(state && typeof state === 'object' ? state : {}), ...IGNORED_CLEARED_STATE }
}

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
  // 이동마다 다시 본다 — 되살린 주소를 같은 커밋의 다른 replace(AI 대화 링크가 aiChat 지우기)가 낡은 쿼리로 덮으면,
  // 조건 없는 주소가 다시 와도 stored 가 같아 effect 가 돌지 않는다.
  const { key: locationKey, state } = useLocation()
  // 개요 링크로 온 이동 — 주소의 조건을 따르되 기억은 쓰지도 지우지도 않는다.
  const fromOverview = readProjectNavState(state).fromOverview
  // 알 수 없는 값 지우기로 온 이동 — 기억을 되살리지도 지우지도 쓰지도 않는다.
  const ignoredCleared = readIgnoredClearedState(state)
  const query = rememberedIssueQuery(params).toString()
  // 주소에 조건이 있는가 — 기본 보기(view=list)는 직렬화하면 빠지지만, 주소에 적혀 있으면 「목록으로」 고른 것이라 되살리지 않는다.
  const recordable = query !== '' || params.has('view')
  // 알 수 없는 값만 든 주소도 조건을 적은 주소라 되살리지도, 기억을 지우지도 않는다.
  const explicit = recordable || ignoredFilterTokens(params).length > 0
  // 이 화면(이 프로젝트의 기억)에 기억할 조건이 있었던 적이 있는가(알 수 없는 값만 든 주소는 세지 않는다 — 지운 뒤 상태 없는 replace 가 기억을 지우지 않게) — 렌더 중 갱신(이전 값 비교)이라 같은 렌더에서 바로 반영된다.
  const [hadConditionsFor, setHadConditionsFor] = useState<string | null>(null)
  if (recordable && storageKey && hadConditionsFor !== storageKey) setHadConditionsFor(storageKey)
  const hadConditions = storageKey !== null && hadConditionsFor === storageKey
  // 화면 안에서 조건을 모두 지웠다 — 조건이 있던 이 화면이 replace 로 조건 없는 주소가 됐다.
  const cleared = !explicit && hadConditions && navigationType === 'REPLACE' && !ignoredCleared
  const stored = storageKey && !explicit && !cleared && !ignoredCleared
    ? rememberedIssueQuery(new URLSearchParams(readStored(storageKey) ?? '')).toString()
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
    // 알 수 없는 값 지우기(ignoredCleared)는 cleared·stored 가 이미 막혀 있어, 남은 조건이 있을 때만 기억을 쓴다.
    // 조건이 있으면 기억하고, 화면 안에서 지웠으면 기억도 지운다. 그 밖(기억이 없는 조건 없는 진입·개요 링크로 온 이동)은 건드리지 않는다.
    if (fromOverview) return
    if (recordable) writeStored(storageKey, query || null)
    else if (cleared) writeStored(storageKey, null)
  }, [storageKey, stored, recordable, cleared, query, setParams, locationKey, fromOverview, ignoredCleared])

  return stored !== ''
}
