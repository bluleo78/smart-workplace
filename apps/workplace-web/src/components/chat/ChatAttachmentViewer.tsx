// 채팅 첨부 통합 뷰어 호스트(WP-279) — 팀 채팅·이슈 채팅·메인 AI 채팅이 함께 쓴다.
// 무엇을: 메시지 첨부 카드·썸네일이 컨텍스트의 open(묶음, 키)을 부르면, 그 메시지 묶음을 스냅숏으로 들고 뷰어를 그린다.
// 왜 router state 모드인가: 채팅은 무한 스크롤이라 딥링크 키의 메시지가 로드돼 있다는 보장이 없고(찾을 수 없음 오판),
//   메인 AI 채팅은 모든 라우트 위에 떠 있어 ?preview 를 쓰면 드라이브·이슈·메일 호스트의 쿼리 네임스페이스에 섞인다.
//   state 모드도 자기 히스토리 항목을 push 하므로 시스템 뒤로가기 = 뷰어만 닫기(?thread·?chat=1·AI 시트는 그대로)다.

import type { ReactNode } from 'react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { ChatAttachmentViewerContext, type OpenChatAttachment } from '@/components/chat/chatAttachmentViewerContext'
import { AttachmentViewer } from '@/components/viewer/AttachmentViewer'
import type { ViewerItem } from '@/components/viewer/types'
import { useHistoryParam, useStripStaleStateMark } from '@/hooks/useHistoryParam'

/**
 * 채팅 목록을 감싸 첨부 뷰어를 연결한다.
 * - 묶음 = 클릭한 메시지 한 건(업로드 + 드라이브 링크). 클릭 때 받은 묶음을 스냅숏으로 들어, 목록 재조회·실시간 갱신에도 열린 뷰어가 바뀌지 않는다.
 * - 같은 표면 키를 읽는 다른 인스턴스(스레드 패널의 두 목록·채널 목록, 여러 AIChatPanel)는 스냅숏이 없어 뷰어를 그리지 않는다.
 *   한 번 보여 준 스냅숏은 닫히면(값이 사라지면) 버린다 — 나중에 다른 인스턴스가 같은 키를 열 때 두 뷰어가 겹치지 않게.
 * - 뷰어는 children 의 형제로 그린다 — 목록의 길게 누르기·툴바 핸들러로 뷰어(포털) 이벤트가 React 트리를 타고 버블되지 않게.
 * - 링크로 다시 열 수 없으므로(state 모드·스냅숏) ⋯ "링크 복사"는 숨긴다(shareable=false).
 *
 * @param historyKey router state 키 — 표면마다 고유(팀·이슈·메인 AI 채팅이 서로의 열림을 자기 것으로 읽지 않게).
 */
export function ChatAttachmentViewerHost({ historyKey, children }: { historyKey: string; children: ReactNode }) {
  const param = useHistoryParam(historyKey, { mode: 'state' })
  // 새로고침 뒤 history.state 에 남은 표식은 지운다 — 스냅숏이 없어 뷰어가 안 보이는데 back 이 한 번 헛돌지 않게.
  useStripStaleStateMark(historyKey)
  const [snap, setSnap] = useState<{ items: ViewerItem[]; shown: boolean } | null>(null)
  const index = snap != null && param.value != null ? snap.items.findIndex((i) => i.key === param.value) : -1
  // 렌더 중 수렴(이펙트 setState 아님): 값이 묶음 안이면 "보여 줌" 표시, 보여 준 뒤 값이 사라지면(닫힘) 스냅숏을 버린다.
  // 클릭 직후(navigate 반영 전) 렌더에선 값이 아직 없지만 shown=false 라 지우지 않는다.
  if (snap != null && !snap.shown && index >= 0) setSnap({ items: snap.items, shown: true })
  if (snap?.shown && param.value == null) setSnap(null)

  // 컨텍스트 값은 고정 — param.open 은 위치가 바뀔 때마다 새 함수라 그대로 내리면 모든 첨부 목록이 매 내비게이션마다 다시 그려진다.
  const openRef = useRef(param.open)
  useLayoutEffect(() => {
    openRef.current = param.open
  })
  const open = useCallback<OpenChatAttachment>((items, key) => {
    setSnap({ items, shown: false })
    openRef.current(key)
  }, [])

  return (
    <>
      <ChatAttachmentViewerContext.Provider value={open}>{children}</ChatAttachmentViewerContext.Provider>
      {snap != null && index >= 0 && (
        <AttachmentViewer
          items={snap.items}
          index={index}
          // 넘김은 열린 상태에서 값만 바꾼다(replace — 히스토리가 늘지 않음).
          onIndexChange={(i) => {
            const next = snap.items[i]
            if (next) param.open(next.key)
          }}
          onClose={param.close}
          shareable={false}
        />
      )}
    </>
  )
}
