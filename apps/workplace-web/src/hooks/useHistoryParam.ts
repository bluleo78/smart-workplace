// 깊은 화면 열림 상태를 URL 쿼리(또는 router state)에 두는 공용 훅(WP-205).
// 판정은 lib/historyParam(순수), 여기서는 현재 위치를 스냅숏으로 넘기고 계획을 navigate 로 옮긴다.
// 이슈 채팅 드로워(H2)에서 검증된 패턴의 일반화 — 메일·연락처·스레드·드로워·미리보기·일정·개인작업·관리자 시트·AI 전체화면이 쓴다.
// 마크 없는 진입 펴기(unmarkedEntry='expand', WP-1414)는 opt-in — 지금은 팀 이슈 상세의 채팅 서랍만 켠다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Location, useLocation, useNavigate } from 'react-router-dom'

import {
  createCloseGuard,
  currentHistoryIdx,
  currentHistoryState,
  hasLiveStateMark,
  hasOpenMark,
  type HistoryParamOptions,
  type HistoryPlan,
  type HistorySnapshot,
  liveHistoryKey,
  planClose,
  planOpen,
  planUnmarkedEntry,
  readHistoryParam,
  stripHistoryKey,
} from '@/lib/historyParam'

/** 공용 훅 옵션 — 순수 계획 옵션(HistoryParamOptions)에 훅만 다루는 「마크 없는 진입 펴기」를 더한다. */
export interface UseHistoryParamOptions extends HistoryParamOptions {
  /**
   * 'expand' 면 링크·알림·주소로 처음부터 열린 채(마크 없음) 들어온 항목을 「아래 화면 → 열린 화면(마크)」 두 항목으로 편다
   * (planUnmarkedEntry, WP-1414). 그래서 닫기가 출발 화면(-1)이 아니라 아래 화면으로 돌아간다. 기본은 펴지 않는다.
   */
  unmarkedEntry?: 'expand'
  /**
   * 펴기를 지금 해도 되는지(기본 참). 거짓인 동안은 펴지 않고 값도 숨기지 않는다 — 리다이렉트로 사라질 화면·
   * 오버레이를 그리지 않는 로딩 화면에 항목을 쌓지 않으려는 호출부가 준비될 때까지 거짓으로 둔다.
   */
  unmarkedEntryReady?: boolean
}

export interface HistoryParam {
  /** 현재 값(상태의 단일 원천). 닫혀 있으면 null. 마크 없는 진입을 펴려고 기다리는 동안도 null. */
  value: string | null
  /** 열기·전환 — 닫힌 상태면 push, 열린 상태면 replace. */
  open: (value: string) => void
  /** 닫기 — 마크 → 연 시점 직전, 마크 없고 idx>0 → -1(unmarkedClose='replace' 면 키만 지움), 콜드 → 키만 지우고 replace. */
  close: () => void
}

export function useHistoryParam(key: string, opts: UseHistoryParamOptions = {}): HistoryParam {
  const location = useLocation()
  const navigate = useNavigate()
  const { mode, unmarkedClose, unmarkedEntry, unmarkedEntryReady = true } = opts
  // clear 는 호출부 배열 리터럴이라 렌더마다 새 배열 — 문자열 서명이 같으면 같은 배열을 쓴다.
  const clearSig = (opts.clear ?? []).join('\u0000')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- clearSig 가 opts.clear 의 내용 서명
  const clear = useMemo(() => opts.clear ?? [], [clearSig])
  const rawValue = useMemo(
    () => readHistoryParam({ search: location.search, state: location.state }, key, mode),
    [location.search, location.state, key, mode],
  )

  // 마크 없는 진입 펴기(opt-in, WP-1414). 펴기를 기다리는 동안은 값을 숨겨(null) 오버레이를 닫힌 것으로 둔다 —
  // 편 두 항목이 화면(라우터 위치)에 닿기 전에 오버레이가 보이면 그 사이 누른 닫기는 낡은 위치의 것이라
  // 아래 close 가 무시하고(스냅숏 key 불일치) 닫히지 않는다. 펴고 나면 새 항목엔 마크가 있어 곧바로 보인다.
  // 다만 이 위치에서 펴기를 건너뛰었으면(브라우저 key 가 어긋남 등) 펴지 않은 채 그대로 보인다 —
  // 숨긴 채 두면 값은 열림인데 오버레이가 영영 안 보이고 여는 단추도 같은 값이라 먹지 않는다.
  // 위치는 location.key 가 아니라 location 객체(항목마다 새 객체, 다시 그려도 같은 객체)로 가른다 — 라우터 밖에서
  // history.pushState 로 쌓인 항목은 key 가 없어 모두 'default' 라, key 로 가르면 두 번째 항목부터 결정이 끝난 것으로 보고
  // 숨긴 채 멈춘다(채팅 서랍을 연 채 다른 이슈로 옮길 때 서랍이 안 보이던 회귀).
  const expandEligible =
    unmarkedEntry === 'expand' && unmarkedEntryReady && rawValue != null && !hasOpenMark(location.state, key)
  const [skippedExpandLocation, setSkippedExpandLocation] = useState<Location | null>(null)
  const awaitingExpand = expandEligible && skippedExpandLocation !== location
  const value = awaitingExpand ? null : rawValue

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
    run(planClose(snap, key, { clear, mode, unmarkedClose }))
  }, [snapshot, run, location.key, key, clear, mode, unmarkedClose])

  // 펴기 실행 — 같은 위치(location 객체)에서는 한 번만 결정한다(StrictMode 이중 실행·다시 그리기에도 항목이 더 쌓이지 않게).
  // 결정은 둘 중 하나: ① 계획대로 replace → push(새 위치가 그려질 때까지 계속 숨김) ② 건너뛰기(이 위치를 기록해 숨김을 푼다).
  // 브라우저가 이미 다른 항목이면(라우터가 아직 따라오지 못한 낡은 위치) 펴지 않고 건너뛴다.
  const expandDecidedRef = useRef<Location | null>(null)
  useEffect(() => {
    if (!awaitingExpand || expandDecidedRef.current === location) return
    expandDecidedRef.current = location
    // snapshot() 은 브라우저 key 가 어긋나면 null — 그때는 펴지 않고 건너뛴다.
    const snap = snapshot()
    const plan = snap && planUnmarkedEntry(snap, key, { clear, mode })
    if (!plan) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 key(외부)를 이펙트에서 확인한 뒤에야 숨김을 풀지 알 수 있다.
      setSkippedExpandLocation(location)
      return
    }
    // BrowserRouter 의 navigate 는 history.replaceState/pushState 를 곧바로(동기로) 부른다 — 그래서 push 는 방금 바꾼
    // 항목 위에 쌓이고(push 의 idx = replace 한 idx + 1), 계획이 심은 마크(idx + 1)와 맞는다. 비동기 라우터로 바꾸면 이 가정을 다시 본다.
    for (const step of plan) run(step)
  }, [awaitingExpand, location, snapshot, run, key, clear, mode])

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
