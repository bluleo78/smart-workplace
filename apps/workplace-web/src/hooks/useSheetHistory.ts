// 전체 화면 시트의 열림 상태를 히스토리 항목 하나에 묶는 훅(WP-222).
// 시트 open 은 부모 useState 소유라 URL 이 없다 — 그래서 시스템 back 이 시트가 아닌 이전 페이지로 가 작성 내용이 사라졌다.
// 열리면 URL 변경 없이 항목을 push(공용 useHistoryParam state 모드)하고, back 으로 그 항목이 빠지면 시트를 닫거나(내용 없음)
// 항목을 다시 push 한 뒤 호출부의 확인창을 띄운다(내용 있음). 다른 경로로 닫히면 남은 항목을 되돌려 다음 back 이 헛돌지 않게 한다.
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { useHistoryParam } from '@/hooks/useHistoryParam'
import { currentHistoryState, readHistoryParam, stripHistoryKey } from '@/lib/historyParam'

interface Options {
  /** state 모드 표식 키(시트마다 고유). */
  historyKey: string
  open: boolean
  /** 작성 중인 내용이 있는지 — 있으면 back 으로 바로 닫지 않고 onBlockedBack 으로 확인을 요청한다. */
  hasContent: boolean
  onClose: () => void
  /** 내용이 있는 채로 back 이 왔을 때(표식은 훅이 다시 심는다) — 버림 확인창을 띄운다. */
  onBlockedBack: () => void
}

/** 지금 브라우저 항목에 표식이 있는지 — 라우터 위치 갱신(transition)보다 빠른 history.state 로 판정한다(WP-209). */
const liveMarked = (key: string) =>
  readHistoryParam({ search: '', state: currentHistoryState() }, key, 'state') != null

export function useSheetHistory({ historyKey, open, hasContent, onClose, onBlockedBack }: Options) {
  const { value, open: pushMark, close: popMark } = useHistoryParam(historyKey, { mode: 'state' })

  // 이벤트 핸들러·이펙트가 호출 시점 최신 값을 읽도록 ref 에 둔다(리스너를 렌더마다 갈아끼우지 않게).
  const latest = useRef({ open, hasContent, onClose, onBlockedBack, pushMark })
  useLayoutEffect(() => {
    latest.current = { open, hasContent, onClose, onBlockedBack, pushMark }
  })

  // 열리는 순간 표식이 없으면 push. live 확인은 StrictMode 이중 실행 중복 push 방지.
  useEffect(() => {
    if (open && !liveMarked(historyKey)) latest.current.pushMark('1')
  }, [open, historyKey])

  // 시트가 (back 이 아닌 경로로) 닫혔는데 현재 항목에 표식이 남아 있으면 되돌린다. back 으로 닫힌 경우는 이미 표식이 없다.
  // 열렸다 닫힌 전이에서만 — 닫힌 채 마운트(새로고침 뒤 남은 표식)에서는 뒤로 가면 안 된다.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open && liveMarked(historyKey)) popMark()
    wasOpen.current = open
  }, [open, historyKey, popMark])

  // 시스템 back/forward 로 표식이 사라지면 동기화. location 대신 popstate 시점 history.state 를 읽는 이유는 AIAssistantContext 와 같다(WP-209).
  // 내용이 있어 시트를 유지할 때는 표식을 다시 push 한다. 라우터가 이 리스너보다 먼저 위치를 갱신했으면 바로 push 되고,
  // 아직이면(push 가 낡은 위치라 무동작) 위치가 갱신된 뒤 아래 이펙트가 이어서 push 한다(repush 플래그).
  const repush = useRef(false)
  useEffect(() => {
    const onPop = () => {
      const cur = latest.current
      if (!cur.open || liveMarked(historyKey)) return
      if (cur.hasContent) {
        repush.current = true
        cur.pushMark('1')
        cur.onBlockedBack()
      } else {
        cur.onClose()
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [historyKey])
  useEffect(() => {
    if (!repush.current) return
    if (liveMarked(historyKey)) repush.current = false
    else if (open && value == null) pushMark('1')
  }, [value, open, historyKey, pushMark])

  // 새로고침 뒤 남은 표식 정리(마운트 1회) — 시트는 닫힌 채 시작하므로 남은 표식은 back 이 한 번 헛돌게 만든다. 표식만 replace 로 지운다.
  const navigate = useNavigate()
  const stripped = useRef(false)
  useEffect(() => {
    if (stripped.current) return
    stripped.current = true
    if (open || !liveMarked(historyKey)) return
    const { pathname, search, hash } = window.location
    void navigate({ pathname, search, hash }, { replace: true, state: stripHistoryKey(currentHistoryState(), historyKey, 'state') })
  }, [open, historyKey, navigate])
}
