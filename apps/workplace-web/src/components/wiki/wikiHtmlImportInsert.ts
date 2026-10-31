import { type Editor, Extension } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { toast } from 'sonner'

import { convertHtmlToWiki, looksLikeHtmlDocument, newImportScopeClass, type WikiHtmlImportResult } from './wikiHtmlImport'
import { isNoteCopyHtml } from './wikiPasteShape'

/**
 * HTML 파일 들여오기(WP-1241)의 편집기 쪽 — 변환 결과(마크다운)를 커서 자리에 「믿는 들여오기」로 넣는다.
 *
 * 왜 붙여넣기 거르기(wikiPasteShape)에 걸리지 않는가: 그 거르기는 ProseMirror 의 transformPasted(클립보드·끌어다 놓기 조각)에만 걸린다.
 * 여기는 tiptap-markdown 의 insertContent(마크다운 → 공용 스키마 parseHTML)로 넣으므로 그 길을 지나지 않는다 — 들여온 모양(페이지 스타일·
 * 모양 영역·HTML 블록)이 그대로 남는다. 사용자가 파일·문서 소스를 일부러 고른 명시 경로라서다(웹 페이지 일반 복사는 지금처럼 거른다).
 */

/** HTML 블록이 글을 많이 품었을 때 알리는 문구 — 그 글은 블록 안이라 바로 고칠 수 없다. */
export const EMBED_CAPTURED_TEXT_NOTICE = '차트 영역이 커서 일부 글이 HTML 블록 안에 들어갔습니다'

/** 넣지 못했거나 편집할 수 없게 된 것을 알리는 문구 — 여럿이면 한 줄씩, 없으면 null. */
export function htmlImportNotice(result: Pick<WikiHtmlImportResult, 'droppedImages' | 'embedCapturedText'>): string | null {
  const lines: string[] = []
  if (result.droppedImages > 0) {
    lines.push(`이미지 ${result.droppedImages}개는 넣지 못했습니다 — 파일에 내장된 이미지·상대 주소 이미지는 따로 올려 주세요.`)
  }
  if (result.embedCapturedText) lines.push(EMBED_CAPTURED_TEXT_NOTICE)
  return lines.length ? lines.join('\n') : null
}

/** 들여올 HTML 파일 크기 상한(바이트) — 5MB. 아티팩트 HTML 은 보통 수백 KB 이고, 더 큰 파일은 변환·동기화 문서·저장 본문(100만 자 상한)을 무겁게 한다. */
export const HTML_IMPORT_MAX_BYTES = 5 * 1024 * 1024

/** 파일이 너무 크면 알리고 true — 읽기 전에 한곳(파일 선택기)에서 거른다. */
export function rejectOversizedHtmlFile(file: Pick<File, 'size'>): boolean {
  if (file.size <= HTML_IMPORT_MAX_BYTES) return false
  toast.error('HTML 파일이 너무 큽니다 — 5MB 이하 파일만 가져올 수 있습니다.')
  return true
}

/** HTML 파일을 글자로 읽는다 — 실패하면 알리고 null. 슬래시 「HTML 파일 넣기」와 「HTML 파일로 새 노트」가 함께 쓴다. */
export async function readHtmlFile(file: Pick<File, 'text'>): Promise<string | null> {
  try {
    return await file.text()
  } catch {
    toast.error('HTML 파일을 읽지 못했습니다.')
    return null
  }
}

/** 이 자리에 HTML 들여오기를 넣을 수 있는지 — 코드 블록·HTML 블록 소스 안(글자로 붙여야 한다)과 표 셀 안(모양·블록을 담지 못한다)은 아니다. */
export function canImportHtmlAt(state: EditorState): boolean {
  const { $from } = state.selection
  if ($from.parent.type.spec.code) return false
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name
    if (name === 'tableCell' || name === 'tableHeader') return false
  }
  return true
}

/**
 * 변환한 마크다운을 커서 자리에 넣는다 — 빈 문단이면 그 문단을 바꾸고, 아니면 tiptap 이 블록 경계에서 나눠 넣는다.
 * at 을 주면 그 위치로 커서를 옮긴 뒤 넣는다 — 파일 대화상자가 떠 있는 동안 편집기 선택이 바뀌어도(포커스를 잃음·원격 편집)
 * 메뉴를 고른 자리에 들어가게. at 은 호출부가 Yjs 상대 위치로 붙잡아 둔 값을 지금 위치로 푼 것이다(anchorPosition).
 */
export function insertHtmlImport(editor: Editor, markdown: string, at?: number): boolean {
  if (!markdown.trim()) return false
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      if (at == null) return true
      const pos = Math.max(0, Math.min(at, tr.doc.content.size))
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos)))
      return true
    })
    .insertContent(markdown)
    .run()
}

/**
 * HTML 문서 글자를 변환해 커서 자리에 넣고 알릴 것을 띄운다 — 파일 넣기·문서 붙여넣기 공용.
 * 기존 노트에 넣는 길이라 범위 class(wp-import-…)로 감싸 들여온 CSS 가 그 영역 안에만 걸리게 한다(scopeClass).
 */
export function importHtmlIntoEditor(editor: Editor, html: string, at?: number): boolean {
  const result = convertHtmlToWiki(html, { scopeClass: newImportScopeClass() })
  const inserted = insertHtmlImport(editor, result.markdown, at)
  const notice = htmlImportNotice(result)
  if (inserted && notice) toast.warning(notice)
  return inserted
}

/**
 * 붙여넣기에서 HTML 문서 소스를 꺼낸다 — 없으면 null(일반 붙여넣기).
 * - 노트끼리 복사(노트 복사 표지)는 늘 아니다 — text/plain 보다 먼저 본다.
 * - text/plain 이 `<!doctype html`·`<html` 로 시작하면(편집기·파일에서 소스를 복사) 그 글자.
 * - text/plain 이 없고 text/html 자체가 문서 전체면 그 HTML. 단, 노트끼리 복사 표지가 있거나 브라우저가 붙이는 조각 표시
 *   (`<!--StartFragment-->` — Windows 는 일반 웹 복사도 `<html><body>` 로 감싼다)가 있으면 일반 웹 복사라 아니다.
 * 일반 웹 페이지 복사(text/plain 은 보이는 글자)는 여기에 걸리지 않아 WP-1240 의 모양 거르기 붙여넣기로 간다.
 */
export function htmlDocumentFromClipboard(data: Pick<DataTransfer, 'getData'>): string | null {
  const html = data.getData('text/html')
  // 노트끼리 복사가 먼저다 — HTML 블록·코드 블록을 복사하면 text/plain 이 문서 소스여도 노트 블록 그대로 붙어야 한다.
  if (html && isNoteCopyHtml(html)) return null
  const text = data.getData('text/plain')
  if (text) return looksLikeHtmlDocument(text) ? text : null
  if (!html || !looksLikeHtmlDocument(html) || /<!--\s*StartFragment\s*-->/i.test(html)) return null
  return html
}

/**
 * HTML 문서 붙여넣기 확장 — 붙여넣은 글자가 HTML 문서 전체(파일 소스)면 일반 붙여넣기 대신 변환해 믿는 들여오기로 넣는다.
 * 코드 블록·HTML 블록 소스 칸·표 셀 안에서는 지금처럼 글자로 붙는다(소스를 코드로 붙이려는 것일 수 있다).
 * 노트 본문 편집기(wikiEditorExtensions)에만 넣는다 — 판 미리보기·공개 화면은 편집하지 않는다.
 */
export const WikiHtmlImportPaste = Extension.create({
  name: 'wikiHtmlImportPaste',
  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('wikiHtmlImportPaste'),
        props: {
          handlePaste(view, event) {
            // 같은 편집기 안에서 온 것(끌기 중)은 노트 안 이동이라 들여오지 않는다.
            if (!view.editable || view.dragging || !event.clipboardData || !canImportHtmlAt(view.state)) return false
            const html = htmlDocumentFromClipboard(event.clipboardData)
            if (!html) return false
            event.preventDefault()
            importHtmlIntoEditor(editor, html)
            return true
          },
        },
      }),
    ]
  },
})
