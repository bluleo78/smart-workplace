// 깊은 화면 열림 상태를 URL 쿼리(또는 router state)에 두는 공용 훅(WP-205).
// 판정은 lib/historyParam(순수), 여기서는 현재 위치를 스냅숏으로 넘기고 계획을 navigate 로 옮긴다.
// 이슈 채팅 드로워(H2)에서 검증된 패턴의 일반화 — 메일·연락처·스레드·드로워·미리보기·일정·개인작업·관리자 시트·AI 전체화면이 쓴다.
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import {
  createCloseGuard,
  currentHistoryIdx,
  currentHistoryState,
  hasLiveStateMark,
  type HistoryParamOptions,
  type HistoryPlan,
  type HistorySnapshot,
  liveHistoryKey,
  planClose,
  planOpen,
  readHistoryParam,
  stripHistoryKey,
} from '@/lib/historyParam'

export interface HistoryParam {
  /** 현재 값(상태의 단일 원천). 닫혀 있으면 null. */
  value: string | null
  /** 열기·전환 — 닫힌 상태면 push, 열린 상태면 replace. */
  open: (value: string) => void
  /** 닫기 — 마크 → 연 시점 직전, 마크 없고 idx>0 → -1, 콜드 → 키만 지우고 replace. */
  close: () => void
}

export function useHistoryParam(key: string, opts: HistoryParamOptions = {}): HistoryParam {
  const location = useLocation()
  const navigate = useNavigate()
  const { mode } = opts
  // clear 는 호출부 배열 리터럴이라 렌더마다 새 배열 — 문자열 서명이 같으면 같은 배열을 쓴다.
  const clearSig = (opts.clear ?? []).join('\u0000')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- clearSig 가 opts.clear 의 내용 서명
  const clear = useMemo(() => opts.clear ?? [], [clearSig])
  const value = useMemo(
    () => readHistoryParam({ search: location.search, state: location.state }, key, mode),
    [location.search, location.state, key, mode],
  )

  // 같은 항목에서 닫기가 두 번 와도 한 번만(‹ 연타·ESC+onOpenChange). 항목이 바뀌면 푼다(forward 재열림 대비).
  // ref 는 이펙트·콜백에서만 읽는다(React Compiler 린트 — 기존 useIssueChatDrawerParam 의 ref 패턴과 같다).
  const guardRef = useRef(createCloseGuard())
  useEffect(() => {
    guardRef.current.reset()
  }, [location.key])

  const run = useCallback(
    (plan: HistoryPlan) => {
      if (plan.kind === 'none') return
      if (plan.kind === 'go') {
        navigate(plan.delta)
        return
      }
      navigate(
        { pathname: location.pathname, search: plan.search, hash: location.hash },
        { replace: plan.kind === 'replace', state: plan.state },
      )
    },
    [navigate, location.pathname, location.hash],
  )

  // 렌더 시점 위치 스냅숏(idx 는 호출 시점 값). 캡처한 key 가 지금 브라우저 key 와 다르면(비동기 onSuccess 사이
  // 사용자가 이미 뒤로 간 낡은 콜백) null — 어긋난 스냅숏으로 모듈 밖까지 되돌리지 않게 무동작한다.
  const snapshot = useCallback((): HistorySnapshot | null => {
    if (liveHistoryKey() !== location.key) return null
    return { search: location.search, state: location.state, idx: currentHistoryIdx() }
  }, [location.key, location.search, location.state])

  const open = useCallback(
    (next: string) => {
      const snap = snapshot()
      if (snap) run(planOpen(snap, key, next, { clear, mode }))
    },
    [snapshot, run, key, clear, mode],
  )

  const close = useCallback(() => {
    const snap = snapshot()
    if (!snap || !guardRef.current.claim(location.key)) return
    run(planClose(snap, key, { clear, mode }))
  }, [snapshot, run, location.key, key, clear, mode])

  return { value, open, close }
}

/**
 * 새로고침 뒤 남은 state 모드 표식을 마운트 1회 지운다(다른 state·URL 보존, replace).
 * 오버레이는 닫힌 채 시작하므로 남은 표식은 back 을 한 번 헛돌게 하거나 하위 화면이 상속해 닫기가 엉뚱한 곳까지 되돌린다.
 * skip=true(마운트 시점에 이미 열린 오버레이)면 지우지 않는다. StrictMode 이중 실행에도 한 번만.
 */
export function useStripStaleStateMark(key: string, skip = false) {
  const navigate = useNavigate()
  const strippedRef = useRef(false)
  useEffect(() => {
    if (strippedRef.current) return
    strippedRef.current = true
    if (skip || !hasLiveStateMark(key)) return
    const { pathname, search, hash } = window.location
    void navigate({ pathname, search, hash }, { replace: true, state: stripHistoryKey(currentHistoryState(), key, 'state') })
  }, [key, skip, navigate])
}
