import { Extension } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { formatFileSize } from '@/lib/formatters'
import { attachmentMime } from '@/lib/mimeFromFilename'
import { parseWikiAttachmentUrl, type WikiAttachmentLink, wikiAttachmentMeta } from '@/lib/wikiAttachments'

import { fileTypeIconOf } from '../drive/fileTypeIconOf'
import { lucideSvg } from './lucideSvg'
import { isCodeText } from './wikiBlockExit'
import { wikiRevisionDiffKey } from './wikiRevisionDiffKey'

/**
 * 노트 본문 파일 첨부 칩(WP-1545) — 본문의 링크 `[파일이름](/api/v1/wiki/pages/{p}/attachments/{f}/content)` 을 그 자리의
 * 파일 칩(형식 아이콘 + 이름 + 아는 경우 크기)으로 보인다.
 *
 * 본문(Yjs 문서·마크다운)에는 일반 링크만 남고 칩은 내 화면에만 그리는 데코레이션이다 — 스키마 노드를 새로 두지 않아 마크다운
 * 왕복·동기화 서버 스키마가 그대로이고, 예전 앱·내보내기·AI 는 그냥 링크로 읽는다(앱 링크 칩 WP-1147 과 같은 방식).
 * 편집 중 커서가 그 링크에 닿으면 원래 글자를 드러내 이름을 고치거나 지울 수 있게 한다.
 * 칩을 누르면 화면이 첨부 뷰어를 연다 — 칩은 data-wiki-attachment 를 달고, 각 화면의 본문 클릭 위임이 읽는다(useWikiAttachmentViewer).
 * 칩은 `<a href>` 가 아니다 — 주소가 로그인(Bearer) 경로라 새 탭으로 열면 401 이다.
 *
 * TODO: 링크를 칩 데코로 바꾸는 골격(자리 모으기·커서 닿으면 드러내기·편집 여부 다시 고르기·조합 처리)이
 * wikiAppLinkChips.ts 와 이 파일(wikiAttachmentChips.ts)에 겹친다 — 칩이 하나 더 생기면 공용 도우미로 묶는다.
 */

/** 본문 안 첨부 링크 한 자리 — [from, to) 가 링크 글자(파일 이름) 범위. */
export interface AttachmentLinkRange {
  from: number
  to: number
  link: WikiAttachmentLink
  /** 링크 글자 — 칩에 보일 파일 이름. */
  name: string
}

export const attachmentChipsKey = new PluginKey<ChipsState>('wikiAttachmentChips')

interface ChipsState {
  ranges: AttachmentLinkRange[]
  decos: DecorationSet
}

/** 문단 하나의 첨부 링크 자리 — 같은 href 로 이어진 글자는 굵게 등으로 갈려도 한 덩어리로 본다. */
function rangesInTextblock(block: PmNode, start: number, out: AttachmentLinkRange[]) {
  let run: { from: number; to: number; href: string; text: string } | null = null
  const flush = () => {
    const link = run ? parseWikiAttachmentUrl(run.href) : null
    // 글자가 빈 링크는 칩으로 보일 이름이 없어 그대로 둔다(빈 링크는 화면에 보이지도 않는다).
    if (run && link && run.text.trim()) out.push({ from: run.from, to: run.to, link, name: run.text })
    run = null
  }
  block.forEach((child, offset) => {
    const pos = start + offset
    const href = child.isText ? (child.marks.find((m) => m.type.name === 'link')?.attrs.href as string | undefined) : undefined
    if (!child.isText || !child.text || !href) {
      flush()
      return
    }
    if (run && run.href === href && run.to === pos) {
      run.to = pos + child.nodeSize
      run.text += child.text
    } else {
      flush()
      run = { from: pos, to: pos + child.nodeSize, href, text: child.text }
    }
  })
  flush()
}

/** 본문 전체의 첨부 링크 자리 — 문서 순서. 코드 블록 안은 건너뛴다. */
export function collectAttachmentLinkRanges(doc: PmNode): AttachmentLinkRange[] {
  const out: AttachmentLinkRange[] = []
  doc.descendants((node, pos) => {
    if (isCodeText(node)) return false
    if (!node.isTextblock) return true
    rangesInTextblock(node, pos + 1, out)
    return false
  })
  return out
}

// 이슈 첨부 칩(IssueAttachmentStrip)과 같은 결 — 테두리 있는 작은 칩. 문단 줄 안에 들어가도록 인라인으로 둔다.
const CHIP_CLASS =
  'wiki-attachment-chip inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md border border-input bg-background px-1.5 align-baseline text-sm font-medium text-foreground no-underline hover:bg-accent'

/**
 * 칩 DOM — 뷰어가 쓸 주소·이름을 data 속성으로 단다. 크기는 이 화면에서 올린 파일만 안다(업로드 응답 기억) — 모르면 뺀다.
 * 버튼 역할이라 키보드(Enter·Space)로도 연다 — 클릭 이벤트를 다시 내 본문 클릭 위임이 같은 길로 받게 한다.
 */
export function attachmentChipElement(r: AttachmentLinkRange, diffClass?: string | null): HTMLElement {
  const meta = wikiAttachmentMeta(r.link.url)
  const mimeType = meta?.mimeType ?? attachmentMime(null, r.name)
  const el = document.createElement('span')
  el.className = diffClass ? `${CHIP_CLASS} ${diffClass}` : CHIP_CLASS
  el.contentEditable = 'false'
  el.setAttribute('role', 'button')
  el.tabIndex = 0
  el.dataset.wikiAttachment = ''
  el.dataset.url = r.link.url
  el.dataset.name = r.name
  el.dataset.mimeType = mimeType
  if (meta) el.dataset.sizeBytes = String(meta.sizeBytes)
  el.dataset.testid = 'wiki-attachment-chip'
  const size = meta ? formatFileSize(meta.sizeBytes) : null
  const label = `파일 ${r.name}${size ? ` · ${size}` : ''}`
  el.title = label
  el.setAttribute('aria-label', label)
  el.appendChild(lucideSvg(fileTypeIconOf(mimeType), 'h-3.5 w-3.5 shrink-0 text-muted-foreground'))
  const name = document.createElement('span')
  name.className = 'truncate'
  name.textContent = r.name
  el.appendChild(name)
  if (size) {
    const s = document.createElement('span')
    s.className = 'shrink-0 text-xs font-normal text-muted-foreground'
    s.textContent = size
    el.appendChild(s)
  }
  // 누름이 편집기 선택을 옮기지 않게 — 옮기면 커서가 링크에 닿아 칩이 원래 글자로 바뀐 뒤에 클릭이 떨어진다.
  el.addEventListener('mousedown', (e) => e.preventDefault())
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    el.click()
  })
  return el
}

/** 편집 중 선택이 그 자리에 닿았는가 — 닿으면 원래 글자를 드러내 고칠 수 있게 한다. */
function touches(state: EditorState, r: AttachmentLinkRange): boolean {
  const { from, to } = state.selection
  return from <= r.to && to >= r.from
}

/** 선택이 닿은 자리 목록(문자열 키) — 선택만 바뀐 거래는 이 값이 같으면 칩을 다시 만들지 않는다. */
function touchedKey(state: EditorState, ranges: AttachmentLinkRange[], editable: boolean): string {
  if (!editable) return ''
  return ranges.flatMap((r) => (touches(state, r) ? [`${r.from}-${r.to}`] : [])).join(',')
}

/**
 * 판 미리보기(WP-298)의 차이 표시가 이 자리 글자에 걸렸으면 그 클래스 — 원래 글자는 숨겨지므로 칩이 대신 표시를 단다.
 * 문단 통째 표시(노드 데코)는 칩을 감싼 블록에 붙어 이미 보이므로 글자 범위(inline) 데코만 본다.
 */
function diffClassOf(diff: DecorationSet | undefined, r: AttachmentLinkRange): string | null {
  if (!diff) return null
  for (const d of diff.find(r.from, r.to)) {
    if (d.from >= r.to || d.to <= r.from) continue // 경계에만 닿은 데코(위젯·이웃 글자)는 이 자리 표시가 아니다.
    // 글자 범위 차이는 「지운 글자」뿐이다(추가 글자는 문서 밖 위젯이라 링크 자리에 걸리지 않는다) — spec.kind 로 알아본다.
    if ((d.spec as { kind?: string }).kind === 'removed-text') return 'wiki-diff-removed'
  }
  return null
}

/** 칩 데코레이션 — 자리마다 원래 글자를 숨기고 그 앞에 칩을 둔다. 편집 중 커서가 닿은 자리는 원래 글자로 둔다. */
export function attachmentChipDecorations(
  state: EditorState,
  ranges: AttachmentLinkRange[],
  editable: boolean,
  diff?: DecorationSet,
): DecorationSet {
  const decos: Decoration[] = []
  for (const r of ranges) {
    if (editable && touches(state, r)) continue
    const meta = wikiAttachmentMeta(r.link.url)
    const diffClass = diffClassOf(diff, r)
    // key 에 보이는 칸을 넣는다 — 원격 입력마다 같은 칩 DOM 을 다시 쓰고, 이름·크기·차이 표시가 바뀌면 새로 그린다.
    const key = `wiki-attachment:${r.link.url}:${r.name}:${meta?.sizeBytes ?? ''}:${diffClass ?? ''}`
    decos.push(
      Decoration.widget(r.from, () => attachmentChipElement(r, diffClass), { key, side: -1, stopEvent: () => true }),
      Decoration.inline(r.from, r.to, { class: 'hidden', 'data-wiki-attachment-src': '' }),
    )
  }
  return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty
}

/** 칩을 다시 고르게 한다(편집 가능 여부가 바뀌었을 때) — 단계 없는 거래라 Yjs·실행 취소에 남지 않는다. */
function refreshAttachmentChips(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(attachmentChipsKey, true).setMeta('addToHistory', false))
}

/** 에디터 확장 — 본문 첨부 링크 자리를 모으고(문서가 바뀔 때만) 칩을 그린다. 편집기·판 미리보기·공개 공유가 같이 쓴다. */
export const WikiAttachmentChips = Extension.create({
  name: 'wikiAttachmentChips',
  addProseMirrorPlugins() {
    let view: EditorView | null = null
    // 차이 표시를 옮긴 칩 데코 — 칩 상태·차이 데코가 같으면 다시 쓴다(decorations 는 그릴 때마다 불린다).
    let diffCache: { chips: ChipsState; diff: DecorationSet; decos: DecorationSet } | null = null
    return [
      new Plugin<ChipsState>({
        key: attachmentChipsKey,
        state: {
          init: (_config, state) => {
            const ranges = collectAttachmentLinkRanges(state.doc)
            // 보기 전용 화면은 처음부터 칩이다(편집 여부는 뷰가 붙은 뒤 view.update 가 다시 고른다).
            return { ranges, decos: attachmentChipDecorations(state, ranges, false) }
          },
          apply: (tr, prev, oldState, newState) => {
            const forced = tr.getMeta(attachmentChipsKey) === true
            if (!tr.docChanged && !tr.selectionSet && !forced) return prev
            const editable = view?.editable ?? false
            if (!tr.docChanged && !forced && touchedKey(oldState, prev.ranges, editable) === touchedKey(newState, prev.ranges, editable)) return prev
            const ranges = tr.docChanged ? collectAttachmentLinkRanges(newState.doc) : prev.ranges
            // 한글 조합 중에는 칩을 다시 고르지 않고 자리만 옮긴다 — 조합 중인 글자 옆 DOM 이 바뀌면 조합이 깨진다(앱 링크 칩과 같은 결).
            if (view?.composing) return { ranges, decos: prev.decos.map(tr.mapping, tr.doc) }
            return { ranges, decos: attachmentChipDecorations(newState, ranges, editable) }
          },
        },
        view(v) {
          view = v
          // 편집 가능 여부는 거래 없이(setEditable) 바뀐다 — 바뀔 때마다(첫 마운트 포함) 칩을 다시 고른다.
          let editable: boolean | null = null
          const sync = () => {
            if (v.editable === editable) return
            editable = v.editable
            queueMicrotask(() => {
              if (view === v && !v.isDestroyed) refreshAttachmentChips(v)
            })
          }
          sync()
          return {
            update: sync,
            destroy() {
              view = null
            },
          }
        },
        props: {
          decorations: (state) => {
            const chips = attachmentChipsKey.getState(state)
            if (!chips) return DecorationSet.empty
            // 판 미리보기면 차이 표시를 칩에 옮긴다 — 차이 데코가 바뀔 때(같은 거래로 들어온다)만 한 번 다시 만든다.
            const diff = wikiRevisionDiffKey.getState(state)
            if (!diff || diff === DecorationSet.empty) return chips.decos
            if (diffCache?.chips !== chips || diffCache.diff !== diff) {
              diffCache = { chips, diff, decos: attachmentChipDecorations(state, chips.ranges, view?.editable ?? false, diff) }
            }
            return diffCache.decos
          },
          handleDOMEvents: {
            // 조합이 끝나면 한 번 다시 고른다 — 조합 중 자리만 옮긴 칩을 바로잡는다.
            compositionend: (v) => {
              queueMicrotask(() => {
                if (view === v && !v.composing && !v.isDestroyed) refreshAttachmentChips(v)
              })
              return false
            },
          },
        },
      }),
    ]
  },
})
