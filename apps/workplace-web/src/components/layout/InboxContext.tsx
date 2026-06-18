// 알림 인박스 패널 오픈 컨텍스트 — AppRail 의 InboxPanel(Popover)을 앱 어디서든 열 수 있게 한다.
// 합성 레이어(홈 대시보드)의 '멘션' 셀처럼 패널과 형제 위치인 컴포넌트에서 패널을 트리거하기 위함.

import type { ReactNode } from 'react'
import { createContext, useContext, useMemo, useState } from 'react'

interface InboxContextValue {
  /** Popover 오픈 상태(InboxPanel 의 Popover open 에 바인딩). */
  open: boolean
  /** Popover onOpenChange 핸들러(직접 트리거/외부 닫기 모두 처리). */
  setOpen: (open: boolean) => void
  /** 인박스 패널 열기(외부 트리거용 편의 함수). */
  openInbox: () => void
}

const InboxContext = createContext<InboxContextValue | null>(null)

/** 인박스 오픈 상태 provider. AppLayout 이 AppRail·본문을 함께 감싼다. */
export function InboxProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  const value = useMemo(
    () => ({ open, setOpen, openInbox: () => setOpen(true) }),
    [open],
  )

  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>
}

/** 인박스 패널 컨트롤 훅. */
// eslint-disable-next-line react-refresh/only-export-components
export function useInboxPanel() {
  const ctx = useContext(InboxContext)
  if (!ctx) throw new Error('useInboxPanel must be used within InboxProvider')
  return ctx
}
