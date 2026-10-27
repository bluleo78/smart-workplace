// 「새 소식」 상태 훅 — 안 읽음 여부와 창 열림 상태를 한곳에서 든다(WP-439).
// 사용자 메뉴(데스크톱)·계정 시트(모바일)가 같은 훅을 쓰고, 창(WhatsNewDialog)은 훅을 가진 쪽이 그린다.
import { useCallback, useState, useSyncExternalStore } from 'react'

import { isUnread, markSeen, selectWhatsNew, WHATS_NEW_STORAGE_KEY } from '@/lib/releaseNotes'
import { loadBundledNotes } from '@/lib/releaseNotesBundle'

/** 노트 선택은 빌드 상수와 번들 노트에만 의존하므로 모듈 로드 시 한 번만 계산한다(렌더마다 파싱하지 않는다). */
export const { current: currentNote, previous: previousNotes } = selectWhatsNew(loadBundledNotes(), __APP_VERSION__)

// 같은 탭의 구독자 — markSeen 은 같은 문서에서 storage 이벤트를 내지 않으므로 직접 알린다.
const listeners = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  // 다른 탭이 확인 기록을 바꾸면 다시 계산한다. key 가 null 이면 clear() 라 함께 본다.
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === WHATS_NEW_STORAGE_KEY) cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

/** 스냅샷은 boolean 이라 값이 같으면 재렌더되지 않는다. */
const getUnread = () => isUnread(currentNote)

/** useWhatsNew 가 돌려주는 상태 — 메뉴·시트·창이 이 값을 그대로 받아 쓴다. */
export type WhatsNewState = {
  /** 현재 노트를 아직 안 봤는가 — 점 표시 기준 */
  unread: boolean
  open: boolean
  /** 창 열기/닫기 — 열 때 현재 노트가 있으면 확인 처리(markSeen)해 점을 끈다. */
  setOpen: (open: boolean) => void
}

export function useWhatsNew(): WhatsNewState {
  const [open, setOpenState] = useState(false)
  const unread = useSyncExternalStore(subscribe, getUnread, () => false)

  const setOpen = useCallback((next: boolean) => {
    if (next && currentNote) {
      // 창을 여는 순간 "봤음" — 닫기 전에 새로고침해도 점이 되살아나지 않는다.
      markSeen(currentNote.version)
      listeners.forEach((l) => l())
    }
    setOpenState(next)
  }, [])

  return { unread, open, setOpen }
}
