// TipTap 편집칸 테스트 키트(WP-1657) — RichInput(본문 모드·코멘트)·본문 편집칸을 띄운 화면 테스트가 함께 쓴다.
// 여러 테스트 파일에 같은 꺼내기 함수가 복사돼 있던 것을 하나로 모았다.
import type { Editor } from '@tiptap/core'

/** 편집칸 DOM 에서 TipTap 편집기를 꺼낸다(TipTap 이 view.dom.editor 에 걸어 둔다). 없으면 바로 실패시킨다. */
export function editorOf(el: HTMLElement): Editor {
  const editor = (el as HTMLElement & { editor?: Editor }).editor
  if (!editor) throw new Error('TipTap 편집기를 찾지 못했다')
  return editor
}
