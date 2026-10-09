// 커서가 "정말로" 링크 안에 있는지 판정(WP-312) — 에디터 상태만 보는 순수 로직.
//
// 왜 따로 두나: tiptap getMarkRange 는 커서 바로 앞·뒤에 붙은 링크도 찾아 준다. 그대로 쓰면 링크 바로 뒤(또는 앞)에 커서를 두고
// ⌘K 를 누를 때 옆 링크를 "고치기" 대상으로 잡아, 새로 친 주소가 옆 링크를 덮어썼다. 링크 마크는 끝에서 이어지지 않으므로
// (inclusive=false) 커서 양옆 글자가 모두 같은 링크일 때만 "안"이다 — 링크 앞·뒤 경계는 새 링크를 넣는 자리다.
import { getMarkRange } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'

/** 빈 선택(커서)이 링크 안이면 그 링크 전체 범위·주소, 아니면 null. */
export function linkAtCaret(state: EditorState): { from: number; to: number; href: string } | null {
  const { selection, schema } = state
  const linkType = schema.marks.link
  if (!selection.empty || !linkType) return null
  const $pos = selection.$from
  const before = linkType.isInSet($pos.nodeBefore?.marks ?? [])
  const after = linkType.isInSet($pos.nodeAfter?.marks ?? [])
  // 양옆이 같은 링크(같은 주소)여야 한다 — 서로 다른 두 링크가 맞닿은 경계도 "안"이 아니다.
  if (!before || !after || !before.eq(after)) return null
  const range = getMarkRange($pos, linkType, after.attrs)
  if (!range) return null
  return { ...range, href: (after.attrs.href as string | null) ?? '' }
}
