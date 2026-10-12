// RichInput 이미지 노드(WP-362) — 이슈 코멘트 입력창 안, 붙여넣은 자리에 이미지를 썸네일로 보여 준다.
// 저장 형식은 본문 이미지와 같은 마크다운 `![이름](/api/v1/...)` 이고(mentionSerialize), 노드 자체는 편집 중 표시용이다.
// 업로드 중에는 src 없이 uploadId 만 가진 자리표시 노드로 들어가고, 업로드가 끝나면 같은 노드에 src 를 채운다 —
// 위치가 아니라 uploadId 로 찾으므로 그 사이 사용자가 계속 타이핑해도 안전하다.
import type { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { RichImageNodeView } from './RichImageNodeView'

export const RichImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // 업로드 중 자리표시 식별자 — 마크다운에는 나가지 않는다(serializeToBody 는 src 가 있는 노드만 쓴다).
      uploadId: { default: null, rendered: false },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(RichImageNodeView)
  },
}).configure({ inline: true })

/** 문서에 아직 업로드 중인 이미지가 있는지 — 있으면 전송을 막는다(자리표시가 빈 이미지로 저장되지 않게). */
export function hasPendingImage(editor: Editor): boolean {
  let pending = false
  editor.state.doc.descendants((node) => {
    if (pending) return false
    if (node.type.name === 'image' && node.attrs.uploadId) pending = true
    return !pending
  })
  return pending
}

/** 문서에 이미지가 하나라도 있는지 — 글 없이 이미지만 있는 코멘트도 보낼 수 있게 빈 입력 판정에 쓴다. */
export function hasImage(editor: Editor): boolean {
  let found = false
  editor.state.doc.descendants((node) => {
    if (found) return false
    if (node.type.name === 'image') found = true
    return !found
  })
  return found
}

/** uploadId 자리표시 노드의 위치 — 업로드 완료·실패 시 그 노드만 고친다. 사용자가 지웠으면 null. */
function findPending(editor: Editor, uploadId: string): number | null {
  let at: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (at !== null) return false
    if (node.type.name === 'image' && node.attrs.uploadId === uploadId) at = pos
    return at === null
  })
  return at
}

/** 업로드가 끝난 자리표시를 실제 이미지로 바꾼다. 실행 취소 기록에는 남기지 않는다(되돌리면 다시 "업로드 중" 이 되므로). */
export function resolvePendingImage(editor: Editor, uploadId: string, src: string, alt: string) {
  if (editor.isDestroyed) return
  const pos = findPending(editor, uploadId)
  if (pos === null) return
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src, alt, uploadId: null })
  editor.view.dispatch(tr.setMeta('addToHistory', false))
}

/** 업로드에 실패한 자리표시를 지운다. */
export function removePendingImage(editor: Editor, uploadId: string) {
  if (editor.isDestroyed) return
  const pos = findPending(editor, uploadId)
  if (pos === null) return
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return
  editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize).setMeta('addToHistory', false))
}
