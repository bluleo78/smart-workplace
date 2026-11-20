import { useCallback, useRef } from 'react'

/**
 * 입력창(MessageComposer)을 감싼 div 의 ref 와, 그 안 contenteditable 로 초점을 주는 함수.
 * 입력기가 contenteditable 이라 testid 로 직접 focus 할 수 없어 감싸개에서 찾는다(WP-1859).
 * focusComposer 는 초점을 줬는지 돌려준다 — 입력기가 없으면(새 메시지의 수신자 0명·보관 채널) false.
 */
export function useComposerFocus() {
  const composerRef = useRef<HTMLDivElement>(null)
  const focusComposer = useCallback(() => {
    const editor = composerRef.current?.querySelector<HTMLElement>('[contenteditable="true"]')
    editor?.focus()
    return !!editor
  }, [])
  return { composerRef, focusComposer }
}
