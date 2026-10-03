// 깊은 화면 열림 상태를 URL 쿼리(또는 router state)에 두는 공용 훅(WP-205).
// 판정은 lib/historyParam(순수), 여기서는 현재 위치를 스냅숏으로 넘기고 계획을 navigate 로 옮긴다.
// 이슈 채팅 드로워(H2)에서 검증된 패턴의 일반화 — 메일·연락처·스레드·드로워·미리보기·일정·개인작업·관리자 시트·AI 전체화면이 쓴다.
import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import {
  createCloseGuard,
  currentHistoryIdx,
  type HistoryParamOptions,
  type HistoryPlan,
  planClose,
  planOpen,
  readHistoryParam,
} from '@/lib/historyParam'

/**
 * 지금 브라우저가 가리키는 위치 key — react-router 7.15.1 createBrowserLocation 과 같은 규칙
 * (`history.state.key || "default"`, chunk-4N6VE7H7.mjs:137).
 */
function liveHistoryKey(): string {
  const key: unknown = (window.history.state as { key?: unknown } | null)?.key
  return typeof key === 'string' && key ? key : 'default'
}

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
  const mode = opts.mode ?? 'query'
  // clear 는 호출부 배열 리터럴이라 렌더마다 새 배열 — 문자열 서명으로 콜백 의존성을 안정화한다.
  const clearSig = (opts.clear ?? []).join('\u0000')
  const value = readHistoryParam(location, key, mode)

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

  // 낡은 콜백 차단 — open/close 는 렌더 시점 location 을 캡처한다. 비동기 onSuccess(삭제·저장 완료 후 닫기) 사이에
  // 사용자가 이미 뒤로 갔다면 캡처한 스냅숏(값·마크 있음)과 실제 idx 가 어긋나 규칙 2(-1)가 모듈 밖으로 한 칸 더 간다.
  // 캡처한 key 가 지금 브라우저 위치 key 와 다르면 아무것도 하지 않는다.
  const open = useCallback(
    (next: string) => {
      if (liveHistoryKey() !== location.key) return
      const clear = clearSig ? clearSig.split('\u0000') : []
      run(planOpen({ search: location.search, state: location.state, idx: currentHistoryIdx() }, key, next, { clear, mode }))
    },
    [run, location.key, location.search, location.state, key, clearSig, mode],
  )

  const close = useCallback(() => {
    if (liveHistoryKey() !== location.key) return
    if (!guardRef.current.claim(location.key)) return
    const clear = clearSig ? clearSig.split('\u0000') : []
    run(planClose({ search: location.search, state: location.state, idx: currentHistoryIdx() }, key, { clear, mode }))
  }, [run, location.key, location.search, location.state, key, clearSig, mode])

  return { value, open, close }
}
