/**
 * 커서가 표 안인지 구독한다(WP-1524) — 작성창이 모바일 표 막대 고정 줄 아래 빈 자리를 깔지 정할 때 쓴다.
 * editor 가 아직 없으면(useEditor 첫 렌더) false.
 */
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'

import { readTableSnapshot } from '@/components/wiki/wikiTableCommands'

export function useCaretInTable(editor: Editor | null): boolean {
  const inTable = useEditorState({ editor, selector: ({ editor: ed }) => readTableSnapshot(ed).inTable })
  return inTable ?? false
}
