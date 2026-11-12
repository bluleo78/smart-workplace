/**
 * 드라이브 업로드 컨텍스트와 훅 (WP-1534).
 *
 * 왜 Provider 와 따로 두는가: 컴포넌트 파일(.tsx)이 컴포넌트가 아닌 값(컨텍스트·훅)까지 내보내면
 * react-refresh 가 그 모듈의 빠른 새로고침을 포기한다. 컨텍스트·타입·훅은 여기에, Provider 컴포넌트는 DriveUploadProvider.tsx 에 둔다.
 *
 * 왜 컨텍스트가 넷인가: 패널 높이·모바일 비킴 같은 배치(layout) 값은 패널이 커지고 줄 때마다 바뀐다.
 * 큐 상태와 한 컨텍스트에 두면 높이 보고 한 번에 큐 구독자 모두가 다시 그려지므로 따로 둔다.
 * 떠 있는 패널 높이만 필요한 DrivePage 는 비킴(mobileLift) 변화에 다시 그려지지 않게 숫자 하나짜리 컨텍스트를 따로 쓴다.
 */
import { createContext, useContext, useEffect, useId } from 'react'

import type { useDriveUploadQueue,UseDriveUploadQueueOptions } from '@/pages/drive/useDriveUploadQueue'

/** 파일 한 개를 보내는 함수 — WP-1520 이 나눠 올리기로 갈아 끼우는 자리 */
export type DriveFileUpload = UseDriveUploadQueueOptions['upload']
export type DriveFolderResolve = UseDriveUploadQueueOptions['resolveFolder']

/** 큐 상태·동작 — useDriveUploadQueue 가 돌려준(필드로 memo 된) 그대로 */
export type DriveUploadContextValue = ReturnType<typeof useDriveUploadQueue>

/** 패널 배치 값 — 높이 보고·비킴 등록·안쪽 호스트 등록에 따라 바뀐다 */
export interface DriveUploadLayoutValue {
  /** 떠 있는(floating) 패널의 실제 높이(px), 없으면 0 — DrivePage 가 목록 아래 여백으로 쓴다 */
  panelHeight: number
  /** 모바일에서 떠 있는 패널을 더 올릴 높이(CSS 길이) — 등록된 값 중 마지막 것, 없으면 undefined */
  mobileLift: string | undefined
  /** 안쪽(inline) 호스트가 하나라도 있는가 — 있으면 떠 있는 호스트는 그리지 않는다 */
  inlineHosted: boolean
}

/** 패널 배치 동작 — 모두 안정 함수라 이것만 쓰는 쪽은 높이가 바뀌어도 다시 그려지지 않는다 */
export interface DriveUploadLayoutActions {
  setPanelHeight: (h: number) => void
  /** 등록자(key)별 비킴 값을 걸거나(undefined 면) 뗀다 — 다른 등록자의 값은 건드리지 않는다 */
  setLift: (key: string, lift: string | undefined) => void
  /** 안쪽 호스트를 등록하고, 돌려준 함수로 뗀다 */
  registerInlineHost: () => () => void
}

export const DriveUploadContext = createContext<DriveUploadContextValue | null>(null)
export const DriveUploadLayoutContext = createContext<DriveUploadLayoutValue | null>(null)
export const DriveUploadLayoutActionsContext = createContext<DriveUploadLayoutActions | null>(null)
/** 떠 있는 패널이 실제로 차지하는 높이(px) — 안쪽 호스트가 있으면 0. 비킴 변화로는 바뀌지 않는다. */
export const DriveUploadFloatingHeightContext = createContext<number | null>(null)

export function useDriveUpload(): DriveUploadContextValue {
  const ctx = useContext(DriveUploadContext)
  if (!ctx) throw new Error('useDriveUpload 는 DriveUploadProvider 안에서만 쓴다')
  return ctx
}

/** 패널 배치 값 — 높이·비킴·안쪽 호스트 여부. 높이가 바뀌면 다시 그려진다. */
export function useDriveUploadLayout(): DriveUploadLayoutValue {
  const ctx = useContext(DriveUploadLayoutContext)
  if (!ctx) throw new Error('useDriveUploadLayout 는 DriveUploadProvider 안에서만 쓴다')
  return ctx
}

/** 패널 배치 동작 — 안정 함수들. 값을 읽지 않는 쪽(비킴 등록·높이 보고)은 이것만 써서 높이 변화에 다시 그려지지 않는다. */
export function useDriveUploadLayoutActions(): DriveUploadLayoutActions {
  const ctx = useContext(DriveUploadLayoutActionsContext)
  if (!ctx) throw new Error('useDriveUploadLayoutActions 는 DriveUploadProvider 안에서만 쓴다')
  return ctx
}

/** 떠 있는 패널의 높이(px) 하나만 구독한다 — 안쪽 호스트가 있으면 0. mobileLift 가 바뀌어도 다시 그려지지 않는다. */
export function useDriveUploadFloatingPanelHeight(): number {
  const ctx = useContext(DriveUploadFloatingHeightContext)
  if (ctx === null) throw new Error('useDriveUploadFloatingPanelHeight 는 DriveUploadProvider 안에서만 쓴다')
  return ctx
}

/**
 * 마운트된 동안 이 컴포넌트 몫의 비킴 값을 건다 — 값이 바뀌면 갱신, undefined 거나 언마운트되면 제 몫만 뗀다.
 * 등록자별로 따로 두어, DrivePage 가 둘(풀페이지·채널 파일 드로워) 떠 있을 때 한쪽 정리가 다른 쪽 값을 지우지 않는다.
 */
export function useDriveUploadPanelLift(lift: string | undefined): void {
  const { setLift } = useDriveUploadLayoutActions()
  const key = useId()
  useEffect(() => {
    if (lift === undefined) return
    setLift(key, lift)
    return () => setLift(key, undefined)
  }, [key, lift, setLift])
}
