// RichInput 이미지 노드(WP-362) — 이슈 코멘트 입력창 안, 붙여넣은 자리에 이미지를 썸네일로 보여 준다.
// 저장 형식은 본문 이미지와 같은 마크다운 `![이름](/api/v1/...)` 이고(mentionSerialize), 노드 자체는 편집 중 표시용이다.
// 업로드 중에는 src 없이 uploadId 만 가진 자리표시 노드로 들어가고, 업로드가 끝나면 같은 노드에 src 를 채운다 —
// 위치가 아니라 uploadId 로 찾으므로 그 사이 사용자가 계속 타이핑해도 안전하다.
import type { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ReactNodeViewRenderer } from '@tiptap/react'

import { isIssueImageSrc } from '../../api/issueImages'
import { RichImageNodeView } from './RichImageNodeView'

export const RichImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // 업로드 중 자리표시 식별자 — 마크다운에는 나가지 않는다(serializeToBody 는 src 가 있는 노드만 쓴다).
      uploadId: { default: null, rendered: false },
    }
  },
  // 웹 페이지·서식 있는 글을 붙여넣을 때 섞여 온 <img> 는 이슈 이미지 경로만 받는다 — 외부·blob 주소가
  // 코멘트에 `![](https://…)` 로 저장돼 남에게 깨져 보이거나 글자로 노출되지 않게. 나머지 <img> 는 버린다.
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (el) => {
          const src = (el as HTMLElement).getAttribute('src')
          return isIssueImageSrc(src) ? { src, alt: (el as HTMLElement).getAttribute('alt') ?? '' } : false
        },
      },
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(RichImageNodeView)
  },
}).configure({ inline: true })

/** 조건에 맞는 첫 이미지 노드의 위치(없으면 null) — 아래 판정·찾기가 같은 순회를 쓴다. */
function findImage(editor: Editor, match: (node: PMNode) => boolean): number | null {
  let at: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (at !== null) return false
    if (node.type.name === 'image' && match(node)) at = pos
    return at === null
  })
  return at
}

/** 문서에 이미지가 하나라도 있는지 — 글 없이 이미지만 있는 코멘트도 보낼 수 있게 빈 입력 판정에 쓴다. */
export function hasImage(editor: Editor): boolean {
  return findImage(editor, () => true) !== null
}

/** 문서에 아직 업로드 중인 이미지가 있는지 — 있으면 전송을 막는다(자리표시가 빈 이미지로 저장되지 않게). */
export function hasPendingImage(editor: Editor): boolean {
  return findImage(editor, (n) => Boolean(n.attrs.uploadId)) !== null
}

/**
 * 자리표시를 끝난 결과로 바꾼다 — result 가 있으면 실제 이미지로, null(업로드 실패)이면 지운다.
 * 사용자가 이미 지웠으면 아무것도 하지 않는다. (RichInput 은 실행 취소 기록이 없어 지운 자리표시가 되살아나지 않는다.)
 */
export function settlePendingImage(editor: Editor, uploadId: string, result: { src: string; alt: string } | null) {
  if (editor.isDestroyed) return
  const pos = findImage(editor, (n) => n.attrs.uploadId === uploadId)
  if (pos === null) return
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return
  const tr = result
    ? editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...result, uploadId: null })
    : editor.state.tr.delete(pos, pos + node.nodeSize)
  editor.view.dispatch(tr)
}
