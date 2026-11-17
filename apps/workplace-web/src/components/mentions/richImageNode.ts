// RichInput 이미지 노드(WP-362) — 이슈 코멘트 입력창 안, 붙여넣은 자리에 이미지를 썸네일로 보여 준다.
// 저장 형식은 본문 이미지와 같은 마크다운 `![이름](/api/v1/...)` 이고(mentionSerialize), 노드 자체는 편집 중 표시용이다.
// 업로드 중에는 src 없이 uploadId 만 가진 자리표시 노드로 들어가고, 업로드가 끝나면 같은 노드에 src 를 채운다 —
// 위치가 아니라 uploadId 로 찾으므로 그 사이 사용자가 계속 타이핑해도 안전하다.
import type { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { type ReactNodeViewProps,ReactNodeViewRenderer } from '@tiptap/react'
import type { ComponentType } from 'react'

import { isIssueImageSrc, issueImageFileId } from '../../api/issueImages'
import { RichBodyImageNodeView } from './RichBodyImageNodeView'
import { RichImageNodeView } from './RichImageNodeView'

/**
 * 업로드 자리표시를 갖는 인라인 이미지 노드 — 이슈 코멘트 입력창(RichImage)과 메일 본문(WP-947)이 같이 쓴다.
 * acceptSrc: 받을 <img> 주소 — 웹 페이지·서식 있는 글을 붙여넣을 때 섞여 온 외부·blob 주소가 저장돼 남에게 깨져 보이지 않게
 * 그 화면의 업로드 경로만 받고 나머지 <img> 는 버린다. view: 인증 경로를 blob 으로 바꿔 그리는 노드뷰.
 */
export function createUploadImage(
  acceptSrc: (src: string | null) => boolean,
  view: ComponentType<ReactNodeViewProps>,
) {
  return Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        // 업로드 중 자리표시 식별자 — 저장 형식(마크다운·HTML)에는 나가지 않는다.
        uploadId: { default: null, rendered: false },
      }
    },
    parseHTML() {
      return [
        {
          tag: 'img[src]',
          getAttrs: (el) => {
            const src = (el as HTMLElement).getAttribute('src')
            return acceptSrc(src) ? { src, alt: (el as HTMLElement).getAttribute('alt') ?? '' } : false
          },
        },
      ]
    },
    addNodeView() {
      return ReactNodeViewRenderer(view)
    },
  }).configure({ inline: true })
}

/** 이슈 코멘트 입력창 이미지 — 이슈 이미지 경로만 받는다(마크다운 `![](…)` 로 저장, serializeToBody 는 src 가 있는 노드만 쓴다). */
export const RichImage = createUploadImage(isIssueImageSrc, RichImageNodeView)

/**
 * 본문 모드 RichInput 이미지(WP-1656) — 이 프로젝트(projectKey) 이슈 이미지 경로만 받고, 보기 화면과 같은 크기로 그린다.
 * 노드 이름은 RichImage 와 같은 `image` 라 자리표시·업로드 마무리 함수(insertImagePlaceholders·settlePendingImage)와 직렬화를 그대로 쓴다.
 * 다른 프로젝트·외부 주소 이미지는 보기 화면도 그리지 못하므로 편집칸에서도 노드로 받지 않는다(원문 글자로 남는다).
 * 이미지 노드는 원문 열기·붙여넣기(bodyToDoc)와 업로드로만 생긴다 — Image 확장의 입력 규칙(`![x](주소)` 를 치면 노드로 바꿈)은 끈다.
 * 그 규칙은 받는 경로를 보지 않아 외부·다른 프로젝트 주소도 노드로 만들고, 저장할 때 title·alt 앞뒤 공백을 떨궈 친 글자를 바꾼다.
 * 코멘트 입력창(RichImage)의 입력 규칙은 그대로 둔다.
 */
export function createRichBodyImage(projectKey: string) {
  return createUploadImage((src) => issueImageFileId(projectKey, src ?? undefined) !== null, RichBodyImageNodeView).extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        // 업로드 자리표시가 넣을 때 한 줄을 둘로 나눴으면 그때 나눈 뒤쪽 줄의 내용(tailKey), 나누지 않았으면 null(insertBodyImagePlaceholders).
        // 실패하면 뒤쪽 줄이 그대로일 때만 두 줄을 다시 잇는다(failBodyPlaceholder) — 사용자가 그 줄에 친 글자가 앞 줄에 붙지 않게.
        // 편집 중에만 쓰는 표시라 저장 형식·HTML 에는 나가지 않는다.
        splitTail: { default: null, rendered: false },
      }
    },
    addInputRules() {
      return []
    },
  })
}

/** 문단이 이미지 하나만 담은 줄인가 — 자리표시를 넣을 때 만든 이미지 줄. */
function isImageLine(node: PMNode | null | undefined): boolean {
  return node?.type.name === 'paragraph' && node.childCount === 1 && node.firstChild?.type.name === 'image'
}

/** 줄 내용을 비교용 문자열로 — 나눈 뒤쪽 줄이 넣을 때 그대로인지 본다(splitTail). 글자 말고 노드(멘션 등)가 바뀌어도 잡는다. */
function tailKey(content: Fragment): string {
  return JSON.stringify(content.toJSON())
}

/** 업로드 중 자리표시 하나만 담은 줄인가. */
function isPendingImageLine(node: PMNode | null | undefined): boolean {
  return isImageLine(node) && Boolean(node?.firstChild?.attrs.uploadId)
}

/**
 * 본문 모드(WP-1656) 자리표시 넣기 — 이미지마다 한 줄. 옛 Textarea(insertAt)처럼 실패하면 그 줄만 걷어 넣기 전 원문으로 돌아가도록
 * 「줄을 나눴는가」와 그때 나눈 뒤쪽 줄 내용을 자리표시 노드가 직접 들고 있다(splitTail). 줄 모양은 커서 자리에 따라:
 * - 줄 처음(빈 줄 포함): 이미지 줄들을 그 줄 앞에 넣고 커서는 그 줄에 둔다 — 나누지 않음.
 * - 줄 끝이고 다음 줄이 있음: 이미지 줄들을 그 줄 뒤에 넣고 커서는 다음 줄 처음 — 나누지 않음.
 * - 그 밖(줄 가운데, 문서 마지막 줄 끝): 줄을 둘로 나눠 사이에 넣고 커서는 뒤쪽 줄 처음 — 첫 자리표시가 splitTail 을 든다.
 *   (문서 끝이면 뒤쪽 줄은 빈 줄이라 이어 쓰는 글이 이미지 줄에 붙지 않는다.)
 * 선택 영역이 있으면 먼저 지운다. 코멘트·메일의 insertImagePlaceholders 는 그대로 둔다.
 */
export function insertBodyImagePlaceholders(editor: Editor, uploadIds: string[], at?: number) {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      if (at == null && !tr.selection.empty) tr.deleteSelection()
      const pos = at ?? tr.selection.from
      const $pos = tr.doc.resolve(pos)
      // 어디에 넣고(insertAt), 줄을 나누는지(split), 커서가 넣은 줄들 뒤 몇 칸에 오는지(cursorExtra — 1 이면 다음 줄 처음)만 고른다.
      let place: { insertAt: number; split: boolean; cursorExtra: number }
      // 나누면 뒤쪽 줄이 될 내용 — 실패 때 그 줄이 그대로인지 비교한다.
      const splitTail = $pos.parent.isTextblock ? tailKey($pos.parent.content.cut($pos.parentOffset)) : null
      if (!$pos.parent.isTextblock) {
        // 문단 사이(드롭 좌표가 줄 경계) — 그 자리에 줄로 넣고 커서는 넣은 줄들 바로 뒤.
        place = { insertAt: pos, split: false, cursorExtra: 0 }
      } else if ($pos.parentOffset === 0) {
        place = { insertAt: $pos.before(), split: false, cursorExtra: 1 }
      } else if ($pos.parentOffset === $pos.parent.content.size && $pos.after() < tr.doc.content.size) {
        place = { insertAt: $pos.after(), split: false, cursorExtra: 1 }
      } else {
        // 나눈 뒤 pos 는 앞쪽 줄 끝, pos+1 이 두 줄 사이 경계다.
        place = { insertAt: pos + 1, split: true, cursorExtra: 1 }
      }
      const { schema } = tr.doc.type
      const lines = Fragment.from(
        uploadIds.map((uploadId, i) =>
          schema.nodes.paragraph.create(
            null,
            schema.nodes.image.create({ uploadId, src: null, alt: '', splitTail: place.split && i === 0 ? splitTail : null }),
          ),
        ),
      )
      if (place.split) tr.split(pos)
      tr.insert(place.insertAt, lines)
      const cursor = place.insertAt + lines.size + place.cursorExtra
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(cursor, tr.doc.content.size))))
      tr.scrollIntoView()
      return true
    })
    .run()
}

/** 본문 모드 업로드 마무리 — 성공이면 자리표시에 이미지를 채우고(settlePendingImage), 실패면 그 줄을 걷어 넣기 전 원문으로(failBodyPlaceholder). 문서를 바꿨으면 true. */
export function settleBodyImage(editor: Editor, uploadId: string, result: { src: string; alt: string } | null): boolean {
  return result ? settlePendingImage(editor, uploadId, result) : failBodyPlaceholder(editor, uploadId)
}

/**
 * 본문 모드 업로드 실패 — 자리표시 줄을 걷어 넣기 전 원문으로 돌린다(실행 취소 기록 밖). 문서를 바꿨으면 true.
 * 자리표시가 splitTail(이 줄을 넣으려고 한 줄을 나눔)을 들고 있으면:
 * - 옆 줄이 아직 업로드 중인 다른 자리표시면 그 자리표시에 넘긴다 — 같이 넣은 이미지가 남아 있는 동안은 나눈 줄을 잇지 않는다.
 * - 옆 줄이 다 올린 이미지면 버린다 — 그 이미지가 나눈 자리를 쓰므로 「그 이미지만 넣은 것」과 같은 모양이 된다.
 * - 둘 다 아니고 뒤쪽 줄이 나눌 때 그대로면 앞뒤 줄을 잇는다(나누기 전 한 줄).
 *   뒤쪽 줄을 고쳤으면(문서 끝에서 넣은 뒤 빈 줄에 글자를 침 등) 잇지 않는다 — 이으면 친 글자가 앞 줄에 붙어 원문이 바뀐다(PR #1413 리뷰).
 * 사용자가 자리표시 줄에 글자를 더 썼으면 노드만 지운다(쓴 글자를 지키려고).
 */
export function failBodyPlaceholder(editor: Editor, uploadId: string): boolean {
  if (editor.isDestroyed) return false
  const pos = findImage(editor, (n) => n.attrs.uploadId === uploadId)
  if (pos === null) return false
  const { state } = editor
  const node = state.doc.nodeAt(pos)
  if (!node) return false
  const $pos = state.doc.resolve(pos)
  const tr = state.tr
  if (!isImageLine($pos.parent) || state.doc.childCount === 1) {
    tr.delete(pos, pos + node.nodeSize)
  } else {
    const lineStart = $pos.before()
    tr.delete(lineStart, $pos.after())
    const splitTail = node.attrs.splitTail as string | null
    if (splitTail != null) {
      const $gap = tr.doc.resolve(lineStart)
      const prev = $gap.nodeBefore
      const next = $gap.nodeAfter
      if (isPendingImageLine(next)) {
        tr.setNodeMarkup(lineStart + 1, undefined, { ...next!.firstChild!.attrs, splitTail })
      } else if (isPendingImageLine(prev)) {
        const prevImage = lineStart - prev!.nodeSize + 1
        tr.setNodeMarkup(prevImage, undefined, { ...prev!.firstChild!.attrs, splitTail })
      } else if (
        prev?.isTextblock &&
        next?.isTextblock &&
        !isImageLine(prev) &&
        !isImageLine(next) &&
        tailKey(next.content) === splitTail
      ) {
        tr.join(lineStart)
      }
    }
  }
  editor.view.dispatch(tr.setMeta('addToHistory', false))
  return true
}

/**
 * 이미지마다 한 줄(문단)로 자리표시를 넣는다 — 글 중간이면 문단이 나뉘어 이미지가 독립 줄에 온다. at 이 없으면 현재 커서.
 * 넣은 뒤 커서는 이어 쓰는 글이 이미지 줄에 붙지 않게 다음 줄로 옮긴다(뒤에 문단이 있으면 그 처음, 없으면 새 빈 문단).
 */
export function insertImagePlaceholders(editor: Editor, uploadIds: string[], at?: number) {
  const nodes = uploadIds.map((uploadId) => ({
    type: 'paragraph',
    content: [{ type: 'image', attrs: { uploadId, src: null, alt: '' } }],
  }))
  const chain = editor.chain().focus()
  ;(at != null ? chain.insertContentAt(at, nodes) : chain.insertContent(nodes)).run()
  const afterImage = editor.state.selection.$from.after()
  if (afterImage < editor.state.doc.content.size) editor.commands.setTextSelection(afterImage + 1)
  else editor.commands.splitBlock()
}

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
 * 사용자가 이미 지웠으면 아무것도 하지 않는다. (코멘트 입력창은 실행 취소 기록이 없어 지운 자리표시가 되살아나지 않는다 —
 * 실행 취소가 있는 본문 모드는 RichInput 이 끝난 업로드 결과를 기억해 되살아난 자리표시를 다시 채운다.)
 * 반환값은 문서를 바꿨는지 — 본문 모드가 되살아난 자리표시를 다시 채웠는지 알 때 쓴다.
 */
export function settlePendingImage(editor: Editor, uploadId: string, result: { src: string; alt: string } | null): boolean {
  if (editor.isDestroyed) return false
  const pos = findImage(editor, (n) => n.attrs.uploadId === uploadId)
  if (pos === null) return false
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return false
  const tr = result
    ? editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...result, uploadId: null })
    : editor.state.tr.delete(pos, pos + node.nodeSize)
  // 업로드 마무리는 실행 취소 기록에 넣지 않는다(본문 모드 bodyHistory) — 되돌리기가 다 올린 이미지를 「업로드 중」 자리표시로 되돌려
  // 저장이 영영 막히지 않게. history 플러그인이 없는 코멘트 입력창에는 아무 영향이 없다.
  editor.view.dispatch(tr.setMeta('addToHistory', false))
  return true
}
