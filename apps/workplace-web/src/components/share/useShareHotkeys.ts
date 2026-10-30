// 링크 단축키(WP-1234) — ⇧⌘,(Windows Ctrl+Shift+,) 는 지금 보는 대상의 링크를, ⌘.(Ctrl+.) 는 이슈 키를 복사한다.
// AppLayout 이 AI 와 무관하게 한 번 건다. 입력칸에 초점이 있어도 동작한다(조합 키라 글자 입력과 겹치지 않는다).
import { useEffect } from 'react'

import { matchShareHotkey, shareTargetStore } from '@/lib/shareTarget'

import { copyShareKey, copyShareLink } from './shareActions'

export function useShareHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 화면이 먼저 같은 키를 쓴 경우는 양보한다(AI ⌘K 와 같은 규칙).
      if (e.defaultPrevented) return
      const hotkey = matchShareHotkey(e)
      if (!hotkey) return
      const target = shareTargetStore.get()
      // 대상이 없으면(목록·설정 화면) 아무것도 하지 않는다 — 브라우저 기본 동작(설정 열기 등)도 막지 않는다.
      if (!target) return
      if (hotkey === 'key' && !target.key) return
      e.preventDefault()
      void (hotkey === 'link' ? copyShareLink(target) : copyShareKey(target))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
