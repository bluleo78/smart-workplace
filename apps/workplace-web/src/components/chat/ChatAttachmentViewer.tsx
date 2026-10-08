// 채팅 첨부 통합 뷰어 호스트(WP-279) — 팀 채팅·이슈 채팅·메인 AI 채팅이 함께 쓴다.
// 무엇을: 메시지 첨부 카드·썸네일이 컨텍스트의 open(키)을 부르면 열림 키를 히스토리에 올리고,
//   지금 그린 메시지 목록에서 그 키가 든 메시지 묶음을 다시 만들어(resolve) 뷰어를 그린다.
// 왜 router state 모드인가: 채팅은 무한 스크롤이라 딥링크 키의 메시지가 로드돼 있다는 보장이 없고(찾을 수 없음 오판),
//   메인 AI 채팅은 모든 라우트 위에 떠 있어 ?preview 를 쓰면 드라이브·이슈·메일 호스트의 쿼리 네임스페이스에 섞인다.
//   state 모드도 자기 히스토리 항목을 push 하므로 시스템 뒤로가기 = 뷰어만 닫기(?thread·?chat=1·AI 시트는 그대로)다.
// 왜 스냅숏이 아니라 키에서 묶음을 다시 만드나: 열림 항목이 스스로 충분해야 앞으로가기·드라이브에서 돌아오기·새로고침 뒤에도
//   같은 뷰어가 다시 열린다(키에 메시지 id·fileId 가 들어 있다). 같은 키를 그릴 수 있는 호스트가 여럿이면 등록부가 하나만 고른다.

import type { ReactNode } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'

import { ChatAttachmentViewerContext, type OpenChatAttachment } from '@/components/chat/chatAttachmentViewerContext'
import { chatViewerRegistry } from '@/components/chat/chatViewerRegistry'
import { AttachmentViewer } from '@/components/viewer/AttachmentViewer'
import type { ViewerItem } from '@/components/viewer/types'
import { useHistoryParam } from '@/hooks/useHistoryParam'
import { currentHistoryState, hasLiveStateMark, liveHistoryKey, readHistoryParam, stripHistoryKey } from '@/lib/historyParam'

/** 지금 브라우저 항목의 열림 키 — 라우터 갱신 전에도 history.state 로 바로 읽는다. */
const liveValue = (historyKey: string) => readHistoryParam({ search: '', state: currentHistoryState() }, historyKey, 'state')

/**
 * 채팅 목록을 감싸 첨부 뷰어를 연결한다.
 * - 묶음 = 열린 키가 든 메시지 한 건(업로드 + 드라이브 링크, 표시 순서). resolve 가 지금 그린 목록에서 다시 만든다.
 * - 같은 표면 키를 그릴 수 있는 호스트(스레드 패널의 두 목록·채널 목록, 여러 AIChatPanel)가 여럿이어도 소유 호스트 하나만 그린다
 *   (chatViewerRegistry — 클릭한 호스트가 가져가고, 소유자 없이 열린 키는 먼저 묶음을 만든 호스트가 가져간다).
 * - 소유 호스트의 묶음이 사라지면(메시지 삭제·대화 전환) 정상 닫기로 히스토리 항목까지 되돌린다 — 보이지 않는 열림 항목을 남기지 않게.
 * - 아무 호스트도 그 키를 못 그리면(메시지가 페이지 밖) 열림 표식을 replace 로 지운다 — 뒤로가기가 헛돌지 않게.
 * - 뷰어는 children 의 형제로 그린다 — 목록의 길게 누르기·툴바 핸들러로 뷰어(포털) 이벤트가 React 트리를 타고 버블되지 않게.
 * - 링크로 다시 열 수 없으므로(state 모드) ⋯ "링크 복사"는 숨긴다(shareable=false).
 *
 * @param historyKey router state 키 — 표면마다 고유(팀·이슈·메인 AI 채팅이 서로의 열림을 자기 것으로 읽지 않게).
 * @param resolve 열린 키 → 그 키가 든 묶음(없으면 null). 목록이 바뀔 때만 새 함수가 되게 useCallback 으로 넘긴다.
 * @param ready 목록 조회가 끝났는지 — 거짓이면 "못 그림"으로 판단하지 않는다(대화 이력 읽는 중 등).
 * @param resetKey 바뀌면(메인 AI 대화 전환·새 대화) 이 호스트가 연 뷰어를 닫는다.
 */
export function ChatAttachmentViewerHost({
  historyKey,
  resolve,
  ready = true,
  resetKey,
  aboveAiSheet = false,
  children,
}: {
  historyKey: string
  resolve: (key: string) => ViewerItem[] | null
  ready?: boolean
  resetKey?: unknown
  /** 모바일 AI 시트 안 목록(메인 AI 채팅)인지 — 뷰어를 시트 위 레이어로 올린다(AttachmentViewer 참조). */
  aboveAiSheet?: boolean
  children: ReactNode
}) {
  const param = useHistoryParam(historyKey, { mode: 'state' })
  const navigate = useNavigate()
  const [hostId] = useState(() => chatViewerRegistry.newHostId())
  const owner = useSyncExternalStore(chatViewerRegistry.subscribe, () => chatViewerRegistry.owner(historyKey))
  const value = param.value
  // 열린 키가 든 묶음과 그 안 위치 — 키가 묶음 밖이면(항목이 빠짐) 그릴 수 없음과 같다.
  const { bundle, index } = useMemo(() => {
    const items = value != null ? resolve(value) : null
    const i = items ? items.findIndex((it) => it.key === value) : -1
    return i >= 0 ? { bundle: items, index: i } : { bundle: null, index: -1 }
  }, [value, resolve])
  const resolvable = bundle != null

  // 콜백·이펙트가 최신 open/close 를 쓰게 ref 에 둔다 — param 함수는 위치가 바뀔 때마다 새로 만들어진다.
  const latest = useRef({ open: param.open, close: param.close })
  useLayoutEffect(() => {
    latest.current = { open: param.open, close: param.close }
  })

  // 상태가 바뀔 때마다: 상태 보고 → 소유자 없으면 가져가기 → 내 묶음이 사라졌으면 닫기 → 아무도 못 그리면 낡은 표식 지우기.
  useEffect(() => {
    chatViewerRegistry.report(historyKey, hostId, { resolvable, ready })
    if (value == null) return
    const current = chatViewerRegistry.owner(historyKey)
    if (resolvable) {
      if (current == null) chatViewerRegistry.claim(historyKey, hostId)
      return
    }
    if (!ready) return
    if (current === hostId) {
      latest.current.close()
      return
    }
    if (current != null) return
    // 같은 커밋의 다른 호스트가 보고를 마친 뒤 판단한다(이펙트는 트리 순서로 돈다).
    const t = setTimeout(() => {
      if (chatViewerRegistry.owner(historyKey) != null || !chatViewerRegistry.nobodyCanShow(historyKey)) return
      if (!hasLiveStateMark(historyKey)) return
      const { pathname, search, hash } = window.location
      void navigate({ pathname, search, hash }, { replace: true, state: stripHistoryKey(currentHistoryState(), historyKey, 'state') })
    }, 0)
    return () => clearTimeout(t)
  }, [historyKey, hostId, resolvable, ready, value, owner, navigate])

  // 닫힘(값 있음 → 없음)에서 소유권을 내려놓는다 — 다음 열림(앞으로가기 등)은 다시 그릴 수 있는 호스트가 가져간다.
  const prevValue = useRef(value)
  useEffect(() => {
    if (prevValue.current != null && value == null) chatViewerRegistry.release(historyKey, hostId)
    prevValue.current = value
  }, [value, historyKey, hostId])

  // 대화 전환·새 대화 — 이 호스트가 연 뷰어는 정상 닫기로 히스토리 항목까지 되돌린다.
  const prevReset = useRef(resetKey)
  useEffect(() => {
    if (Object.is(prevReset.current, resetKey)) return
    prevReset.current = resetKey
    if (liveValue(historyKey) != null && chatViewerRegistry.owner(historyKey) === hostId) latest.current.close()
  }, [resetKey, historyKey, hostId])

  // 언마운트 — 보고·소유권 해제(다른 호스트가 이어받을 수 있게).
  // 연 뷰어가 열린 채 호스트만 사라지면(데스크톱 AI 사이드 패널을 X·Esc·⌘K 로 닫음) 같은 항목에 열림 표식이 남아
  // 뒤로가기가 헛돌고 패널을 다시 열면 뷰어가 갑자기 되살아난다. 그래서 이어받을 호스트가 없으면 정상 닫기로 항목을 되돌린다.
  // 바로 닫지 않고 한 틱 미루는 이유: 사이드↔전체화면 전환처럼 같은 커밋에 새 호스트가 마운트돼 이어받는 경우를 먼저 기다린다.
  useEffect(
    () => () => {
      const wasOwner = chatViewerRegistry.owner(historyKey) === hostId
      chatViewerRegistry.unregister(historyKey, hostId)
      const openKey = liveValue(historyKey)
      if (!wasOwner || openKey == null) return
      const entry = liveHistoryKey()
      const close = latest.current.close
      setTimeout(() => {
        // 그 사이 다른 호스트가 이어받았거나, 위치가 바뀌었거나(라우트 이동·뒤로가기), 이미 닫혔으면 손대지 않는다.
        if (chatViewerRegistry.owner(historyKey) != null || liveHistoryKey() !== entry || liveValue(historyKey) !== openKey) return
        close()
      }, 0)
    },
    [historyKey, hostId],
  )

  const open = useCallback<OpenChatAttachment>(
    (key) => {
      // 첨부 뷰어가 이미 열려 있을 때(데스크톱 AI 사이드 패널은 뷰어 옆에서도 눌린다):
      // 이 호스트가 연 뷰어면 그 자리에서 누른 첨부로 바꾸고(replace — 히스토리가 늘지 않음),
      // 다른 뷰어(다른 채팅·?preview 호스트)면 겹쳐 열지 않는다.
      if (document.querySelector('[data-viewer-root]')) {
        if (chatViewerRegistry.owner(historyKey) === hostId && liveValue(historyKey) != null) latest.current.open(key)
        return
      }
      chatViewerRegistry.claim(historyKey, hostId)
      latest.current.open(key)
      // 내비게이션이 무동작이었으면(낡은 위치 콜백 등) 소유권을 바로 돌려놓는다 — 열리지 않은 클릭이 소유권을 쥐고 남지 않게.
      if (liveValue(historyKey) !== key) chatViewerRegistry.release(historyKey, hostId)
    },
    [historyKey, hostId],
  )

  return (
    <>
      <ChatAttachmentViewerContext.Provider value={open}>{children}</ChatAttachmentViewerContext.Provider>
      {bundle != null && owner === hostId && (
        <AttachmentViewer
          items={bundle}
          index={index}
          // 넘김은 열린 상태에서 값만 바꾼다(replace — 히스토리가 늘지 않음).
          onIndexChange={(i) => {
            const next = bundle[i]
            if (next) param.open(next.key)
          }}
          onClose={param.close}
          shareable={false}
          aboveAiSheet={aboveAiSheet}
        />
      )}
    </>
  )
}
