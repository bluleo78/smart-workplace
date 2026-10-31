import { isWikiShapeNode } from '@smart-workplace/wiki-editor-schema'
import { Extension } from '@tiptap/core'
import { DOMSerializer, Fragment, type Node as PMNode, type Schema, Slice } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'

/**
 * 붙여넣기의 HTML 모양 거르기(WP-1240) — 노트 밖에서 온 붙여넣기는 HTML 모양 노드 도입 전과 같게 들이고, 노트끼리 복사만 모양을 옮긴다.
 *
 * 왜: Google Docs·Word·웹 페이지 HTML 은 `span style="font-family:Arial;font-size:11pt"` 같은 서식으로 가득해, 그대로 두면
 * 붙여넣을 때마다 인라인 모양 마크(wikiHtmlSpan)·모양 영역(wikiHtmlBox)이 생기고 노트에 범위 가두기(contain)까지 켜진다.
 * 글자 붙여넣기도 같다 — tiptap-markdown(transformPastedText)이 text/plain 을 html:true 마크다운으로 읽으므로
 * `<style data-wp-style>`·`<div class>` 를 친 글자가 그대로 페이지 스타일·모양 영역이 된다.
 *
 * 어떻게: HTML 문자열이 아니라 파싱이 끝난 조각(Slice)에서 거른다(transformPasted) — HTML·글자·끌어다 놓기 붙여넣기가 모두 지나는
 * 한 곳이라 경로마다 따로 막을 필요가 없다. 페이지 스타일(wikiStyle)은 지우고, 모양 영역(wikiHtmlBox)은 풀어 안쪽 블록만 남기고,
 * 인라인 모양(wikiHtmlSpan)은 마크만 뗀다. 굵게·기울임(style 의 font-weight 등으로 읽힌 마크)·표 셀 정렬 같은 다른 노드·마크는
 * 그대로라 바깥 HTML 붙여넣기 결과는 모양 노드 도입 전과 같다.
 *
 * 노트끼리 복사 판정: 노트 편집기가 복사·끌기 때 클립보드 HTML 에 표지(NOTE_COPY_ATTR)를 단다(clipboardSerializer).
 * ProseMirror 의 data-pm-slice 는 ProseMirror 기반 앱이면 어디서나 붙으므로 판정에 쓰지 않는다. 같은 편집기 안 끌어다 놓기는
 * 클립보드를 거치지 않으므로(view.dragging 의 조각을 그대로 쓴다) 노트 안 이동으로 본다.
 * HTML 아티팩트를 모양째 들여오는 명시 경로는 WP-1241 에서 따로 둔다.
 */

/** 노트 편집기에서 복사한 클립보드 HTML 표지 — 첫 최상위 요소에 단다. 붙여넣을 때 이 표지가 있어야 모양을 옮긴다. */
export const NOTE_COPY_ATTR = 'data-wp-note-copy'

/** 클립보드 HTML 이 노트 편집기에서 복사한 것인지 — 요소에 붙은 표지만 본다(글자로 적힌 'data-wp-note-copy' 는 아니다). */
export function isNoteCopyHtml(html: string): boolean {
  if (!html.includes(NOTE_COPY_ATTR)) return false
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
  return !!body.querySelector(`[${NOTE_COPY_ATTR}]`)
}

/**
 * 복사용 직렬화기 — 스키마 기본 직렬화 결과의 첫 최상위 요소에 노트 복사 표지를 단다. 최상위가 글자뿐이면(드묾) 표지를 달 곳이 없어
 * 바깥 붙여넣기로 다뤄진다(모양만 빠진다 — 안전한 쪽).
 */
export function noteClipboardSerializer(schema: Schema): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema)
  return new (class extends DOMSerializer {
    serializeFragment(...args: Parameters<DOMSerializer['serializeFragment']>) {
      const frag = super.serializeFragment(...args)
      for (let child = frag.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 1) {
          ;(child as HTMLElement).setAttribute(NOTE_COPY_ATTR, '')
          break
        }
      }
      return frag
    }
  })(base.nodes, base.marks)
}

/** 모양 노드·마크를 뺀 조각 내용 — 페이지 스타일은 지우고, 모양 영역은 풀고, 인라인 모양 마크는 뗀다. */
function stripFragment(fragment: Fragment): Fragment {
  const out: PMNode[] = []
  fragment.forEach((node) => {
    const name = node.type.name
    if (name === 'wikiStyle') return
    const marks = node.marks.filter((m) => m.type.name !== 'wikiHtmlSpan')
    if (node.isText) {
      out.push(node.mark(marks))
      return
    }
    const content = node.content.size ? stripFragment(node.content) : node.content
    if (name === 'wikiHtmlBox') {
      content.forEach((child) => out.push(child))
      return
    }
    // 안쪽이 페이지 스타일뿐이던 블록(표 셀 등)은 비면 스키마가 요구하는 빈 내용(빈 문단)으로 채운다.
    const copy =
      content.size || !node.content.size ? node.copy(content) : (node.type.createAndFill(node.attrs, content) ?? node.copy(content))
    out.push(copy.mark(marks))
  })
  // fromArray 가 같은 마크의 이웃 글자를 하나로 잇는다(span 만 다르던 글자들).
  return Fragment.fromArray(out)
}

/** 열린 쪽 경로(첫/끝 자식 사슬)에 놓인 모양 영역 수 — 영역을 풀면 그만큼 열린 깊이가 줄어든다. */
function boxesOnOpenPath(fragment: Fragment, depth: number, side: 'start' | 'end'): number {
  let count = 0
  let node = side === 'start' ? fragment.firstChild : fragment.lastChild
  for (let d = 0; d < depth && node; d++) {
    if (node.type.name === 'wikiHtmlBox') count++
    node = side === 'start' ? node.firstChild : node.lastChild
  }
  return count
}

/**
 * 조각에서 HTML 모양(페이지 스타일·모양 영역·인라인 모양)을 뺀다(순수 함수). 모양이 없으면 같은 조각을 그대로 돌려준다.
 * 열린 깊이(openStart/openEnd)는 열린 경로 위에서 풀린 영역 수만큼 줄인다 — 붙여넣기가 이어 붙일 자리 계산이 그대로 맞게.
 */
export function stripShapeFromSlice(slice: Slice): Slice {
  let shaped = false
  slice.content.descendants((node) => {
    if (shaped) return false
    shaped = isWikiShapeNode(node)
    return !shaped
  })
  if (!shaped) return slice
  const content = stripFragment(slice.content)
  if (!content.size) return Slice.empty
  return new Slice(
    content,
    Math.max(0, slice.openStart - boxesOnOpenPath(slice.content, slice.openStart, 'start')),
    Math.max(0, slice.openEnd - boxesOnOpenPath(slice.content, slice.openEnd, 'end')),
  )
}

/**
 * 붙여넣기 모양 거르기 확장 — 노트 본문 편집기(wikiEditorExtensions)와 판 미리보기(복사 원본)에 넣는다.
 * - clipboardSerializer: 복사·끌기 HTML 에 노트 복사 표지를 단다.
 * - transformPastedHTML: 이번 붙여넣기 HTML 이 노트 복사인지 기억만 한다(HTML 은 바꾸지 않는다).
 * - transformPasted: 글자 붙여넣기(plain)거나 노트 복사가 아니면 조각에서 모양을 뺀다. 같은 편집기 안 끌어다 놓기는 그대로.
 */
export const WikiPasteShape = Extension.create({
  name: 'wikiPasteShape',
  addProseMirrorPlugins() {
    // transformPastedHTML → (파싱) → transformPasted 가 한 붙여넣기 안에서 이어 불린다 — 그 사이에만 쓰는 표시.
    let htmlFromNote = false
    return [
      new Plugin({
        props: {
          clipboardSerializer: noteClipboardSerializer(this.editor.schema),
          transformPastedHTML(html) {
            htmlFromNote = isNoteCopyHtml(html)
            return html
          },
          transformPasted(slice, view, plain) {
            const internal = !plain && (htmlFromNote || !!view.dragging)
            htmlFromNote = false
            return internal ? slice : stripShapeFromSlice(slice)
          },
        },
      }),
    ]
  },
})
