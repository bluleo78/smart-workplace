import { Extension } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { CalendarDays, File as FileIcon, FileText, type LucideIcon, Mail, MessageSquare, SquareKanban } from 'lucide-react'

import type { AppLinkCard } from '@/api/appLinks'
import { APP_LINK_KIND_LABEL, type AppHosts, type AppLink, parseAppLink } from '@/lib/appLinks'
import { ISSUE_STATUS_DOT_CLASS } from '@/lib/issueStatusBadgeType'
import { CHAT_LINK_RULES, splitLinks } from '@/lib/textLinks'
import type { IssueStatus } from '@/types/issue'

import { lucideSvg } from './lucideSvg'

/**
 * 노트 본문의 앱 링크 칩(WP-1147) — 본문에 붙인 Gen:iA Works 이슈·노트·파일 주소를 그 자리의 인라인 칩으로 보인다.
 *
 * 본문(Yjs 문서)에는 주소만 남고, 칩은 내 화면에만 그리는 데코레이션이다 — 보는 사람마다 자기 권한으로 받은 카드 칸(제목·상태)을
 * 그리므로 저장하면 남에게 내 권한의 제목이 새고, 공개 공유·내보내기도 주소 그대로 남는다. 칸을 못 받았으면(받는 중·볼 수 없음·없음)
 * 원래 링크를 그대로 둔다 — 자리가 덜 흔들리고 제목이 새지 않는다.
 *
 * 칩이 되는 것: 링크 글자가 주소 그대로인 링크(붙여 넣은 주소)와 링크를 걸지 않은 맨 주소. 글자를 따로 적은 링크(「[여기](…)」)는
 * 쓴 사람의 문장이라 그대로 둔다(Confluence 스마트 링크도 같다). 편집 중 커서가 그 링크에 닿으면 원래 글자를 드러내 고칠 수 있게 한다.
 */

/** 본문 안 앱 링크 한 자리 — [from, to) 가 주소 글자 범위. */
export interface AppLinkRange {
  from: number
  to: number
  link: AppLink
  /** 칩을 누르면 갈 앱 안 경로 — link.to 에 쓴 주소의 조각(#댓글 등)을 덧붙인 것. */
  nav: string
}

/**
 * 칩을 누르면 갈 앱 안 경로 — 카드를 받은 것과 같은 경로(link.to, 이슈 키를 대문자로 맞춘 것)에 쓴 주소의 조각(#댓글 등)만 덧붙인다.
 * 쓴 경로를 그대로 쓰면 소문자 키로 붙인 주소가 카드는 맞게 보이는데 누르면 다른 경로로 갔다.
 */
function navOf(href: string, link: AppLink): string {
  return `${link.to}${new URL(href).hash}`
}

/** 한 노트에서 칩 카드를 받는 최대 대상 수 — 링크가 아주 많은 노트가 요청을 쏟아내지 않게. 넘는 링크는 원래 링크로 남는다. */
export const MAX_WIKI_APP_LINK_CHIPS = 50

/** 받은 카드 — 대상 경로(link.to) → 카드. 화면(useWikiAppLinkChips)이 보는 사람 권한으로 받아 거래 메타로 넘긴다. */
export type AppLinkCards = ReadonlyMap<string, AppLinkCard>

/** 플러그인 상태 — 문서의 앱 링크 자리, 카드를 받을 대상(같은 대상 한 번·상한까지), 받은 카드, 그 자리에 지금 그린 칩. */
interface ChipsState {
  // 자리를 모을 때 쓴 앱 호스트들 — 공개 호스트가 늦게 오면(설정 응답) 바뀌어 자리를 다시 모은다(WP-1165).
  hosts: AppHosts
  ranges: AppLinkRange[]
  targets: AppLink[]
  cards: AppLinkCards
  decos: DecorationSet
}

export const appLinkChipsKey = new PluginKey<ChipsState>('wikiAppLinkChips')

/** 문단 하나의 앱 링크 자리 — 링크 마크는 같은 href 로 이어진 글자를 한 덩어리로(굵게 등으로 갈려도), 맨 주소는 글자 조각 안에서 찾는다. */
function rangesInTextblock(block: PmNode, start: number, appHosts: AppHosts, out: AppLinkRange[]) {
  let run: { from: number; to: number; href: string; text: string } | null = null
  const flush = () => {
    // 글자가 주소 그대로일 때만 — 끝 「/」 차이는 같은 주소로 본다. 링크 안 공백까지 숨기지 않게 다듬지 않고 비교한다.
    if (run && run.text.replace(/\/$/, '') === run.href.replace(/\/$/, '')) {
      const link = parseAppLink(run.href, appHosts)
      if (link) out.push({ from: run.from, to: run.to, link, nav: navOf(run.href, link) })
    }
    run = null
  }
  block.forEach((child, offset) => {
    const pos = start + offset
    if (!child.isText || !child.text) {
      flush()
      return
    }
    const href = child.marks.find((m) => m.type.name === 'link')?.attrs.href as string | undefined
    if (href) {
      if (run && run.href === href && run.to === pos) {
        run.to = pos + child.nodeSize
        run.text += child.text
      } else {
        flush()
        run = { from: pos, to: pos + child.nodeSize, href, text: child.text }
      }
      return
    }
    flush()
    // 코드 안의 주소는 글자 그대로 둔다(예시로 적은 주소).
    if (child.marks.some((m) => m.type.name === 'code')) return
    let at = 0
    for (const seg of splitLinks(child.text, CHAT_LINK_RULES)) {
      if (seg.type === 'link') {
        const link = parseAppLink(seg.href, appHosts)
        if (link) out.push({ from: pos + at, to: pos + at + seg.text.length, link, nav: navOf(seg.href, link) })
      }
      at += seg.text.length
    }
  })
  flush()
}

/** 본문 전체의 앱 링크 자리 — 문서 순서. 코드 블록 안은 건너뛴다. */
export function collectAppLinkRanges(doc: PmNode, appHosts: AppHosts): AppLinkRange[] {
  const out: AppLinkRange[] = []
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false
    if (!node.isTextblock) return true
    rangesInTextblock(node, pos + 1, appHosts, out)
    return false
  })
  return out
}

/** 카드를 받을 대상 — 같은 대상은 한 번, 문서 순서로 상한까지. 앞과 같으면 앞 배열을 그대로 돌려줘 화면이 다시 받지 않게 한다. */
function targetsOf(ranges: AppLinkRange[], prev: AppLink[]): AppLink[] {
  const out: AppLink[] = []
  const seen = new Set<string>()
  for (const r of ranges) {
    if (seen.has(r.link.to)) continue
    seen.add(r.link.to)
    out.push(r.link)
    if (out.length === MAX_WIKI_APP_LINK_CHIPS) break
  }
  return out.length === prev.length && out.every((l, i) => l.to === prev[i].to) ? prev : out
}

/** 지금 본문에서 카드를 받을 대상 — 화면이 읽는다. */
export function appLinkChipTargets(state: EditorState): AppLink[] {
  return appLinkChipsKey.getState(state)?.targets ?? []
}

// 종류별 아이콘 — 채팅 카드(AppLinkCard)의 아이콘과 같은 lucide 컴포넌트에서 모양을 읽는다(WP-1185).
const ICONS: Record<AppLink['kind'], LucideIcon> = {
  ISSUE: SquareKanban,
  PAGE: FileText,
  FILE: FileIcon,
  MESSAGE: MessageSquare,
  EVENT: CalendarDays,
  MAIL: Mail,
}

// 멘션 칩(WikiMentionChipView)과 같은 바탕 — 이슈 멘션과 이슈 링크 칩이 나란히 있어도 같아 보이게.
const CHIP_CLASS =
  'wiki-app-link-chip inline-flex max-w-full cursor-pointer items-baseline gap-1 rounded bg-accent px-1 font-medium text-accent-foreground no-underline align-baseline'

/** 칩 DOM — 앱 안 이동 경로를 data-app-link-to 로 단다(WikiEditor 의 본문 클릭이 읽는다). */
export function chipElement(link: AppLink, nav: string, card: AppLinkCard): HTMLElement {
  const el = document.createElement('a')
  el.href = nav
  el.className = CHIP_CLASS
  el.contentEditable = 'false'
  el.dataset.appLinkTo = nav
  el.dataset.kind = link.kind
  el.dataset.testid = 'wiki-app-link-chip'
  const label = `${APP_LINK_KIND_LABEL[link.kind]} ${card.issueKey ? `${card.issueKey} ` : ''}${card.title}${card.statusName ? ` · ${card.statusName}` : ''}`
  el.title = label
  el.setAttribute('aria-label', label)
  el.appendChild(lucideSvg(ICONS[link.kind], 'h-3.5 w-3.5 shrink-0 self-center'))
  if (card.statusCategory) {
    const dot = document.createElement('span')
    // 상태 배지(IssueStatusBadge)와 같은 의미 색 — 공용 정의(issueStatusBadgeType)에서 가져온다. 모르는 범주는 대기(TODO) 색.
    const color = ISSUE_STATUS_DOT_CLASS[card.statusCategory as IssueStatus] ?? ISSUE_STATUS_DOT_CLASS.TODO
    dot.className = `inline-block h-2 w-2 shrink-0 self-center rounded-full ${color}`
    dot.setAttribute('aria-hidden', 'true')
    el.appendChild(dot)
  }
  if (card.issueKey) {
    const key = document.createElement('span')
    key.className = 'shrink-0 font-mono text-xs text-muted-foreground'
    key.textContent = card.issueKey
    el.appendChild(key)
  }
  const title = document.createElement('span')
  title.className = 'truncate'
  title.textContent = card.title
  el.appendChild(title)
  // 누름이 편집기 선택을 옮기지 않게 — 옮기면 커서가 링크에 닿아 칩이 원래 글자로 바뀐 뒤에 클릭이 떨어진다.
  el.addEventListener('mousedown', (e) => e.preventDefault())
  return el
}

/**
 * 칩이 가린 원래 자리 — 터치 셸 편집 중 칩을 누르면 노트를 떠나지 않고 원래 링크를 고치게 하려고 쓴다(WikiEditor).
 * pos 는 원래 주소 글자의 시작(칩 위젯 자리), anchor 는 그 글자가 링크(<a>)면 그 요소, 맨 주소면 null.
 */
export function chipSource(view: EditorView, chip: Element): { pos: number; anchor: Element | null } {
  const pos = view.posAtDOM(chip, 0)
  const { node } = view.domAtPos(pos + 1)
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return { pos, anchor: el?.closest('.ProseMirror a[href]') ?? null }
}

/** 편집 중 선택이 그 자리에 닿았는가 — 닿으면 원래 글자를 드러내 고칠 수 있게 한다. */
function touches(state: EditorState, r: AppLinkRange): boolean {
  const { from, to } = state.selection
  return from <= r.to && to >= r.from
}

/**
 * 편집 중 선택이 닿은 자리 — 칩 대신 원래 글자를 드러낼 자리의 목록(문자열 키). 보기 전용이면 늘 비어 있다.
 * 선택만 바뀐 거래는 이 값이 같으면 칩을 다시 만들지 않는다 — 커서가 글자 사이를 움직일 때마다 문서 전체 칩을 다시 만들지 않게(WP-1185).
 */
function touchedKey(state: EditorState, ranges: AppLinkRange[], editable: boolean): string {
  if (!editable) return ''
  return ranges.flatMap((r) => (touches(state, r) ? [`${r.from}-${r.to}`] : [])).join(',')
}

/** 칩 데코레이션 — 카드를 받은 자리마다 원래 글자를 숨기고 그 앞에 칩을 둔다. */
export function chipDecorations(state: EditorState, ranges: AppLinkRange[], cards: AppLinkCards, editable: boolean) {
  const decos: Decoration[] = []
  for (const r of ranges) {
    const card = cards.get(r.link.to)
    if (!card || (editable && touches(state, r))) continue
    // key 에 보이는 칸을 넣는다 — 원격 입력마다 같은 칩 DOM 을 다시 쓰고, 제목·상태가 바뀌면 새로 그린다.
    const key = `app-link:${r.nav}:${card.title}:${card.statusCategory ?? ''}:${card.statusName ?? ''}`
    decos.push(
      Decoration.widget(r.from, () => chipElement(r.link, r.nav, card), { key, side: -1, stopEvent: () => true }),
      Decoration.inline(r.from, r.to, { class: 'hidden', 'data-app-link-src': '' }),
    )
  }
  return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty
}

/**
 * 받은 카드를 넘기거나(cards) 칩을 다시 고르게 한다(없으면) — 단계 없는 거래라 Yjs·실행 취소에 남지 않는다.
 */
export function refreshAppLinkChips(view: EditorView, cards?: AppLinkCards) {
  view.dispatch(view.state.tr.setMeta(appLinkChipsKey, { cards }).setMeta('addToHistory', false))
}

export interface WikiAppLinkChipsOptions {
  /** 지금 우리 앱 호스트들 — 거래마다 읽는다. 바뀌면(같은 배열이 아니면) 문서가 그대로여도 자리를 다시 모은다. */
  appHosts: () => AppHosts
}

/** 에디터 확장 — 본문 앱 링크 자리를 모으고(문서가 바뀔 때만) 받은 카드로 칩을 그린다. 카드는 useWikiAppLinkChips 가 넘긴다. */
export const WikiAppLinkChips = Extension.create<WikiAppLinkChipsOptions>({
  name: 'wikiAppLinkChips',
  addOptions() {
    return { appHosts: () => [] }
  },
  addProseMirrorPlugins() {
    const { appHosts } = this.options
    // 편집 가능 여부·한글 조합 여부는 뷰에만 있어 플러그인 view 로 잡아 둔다.
    let view: EditorView | null = null
    return [
      new Plugin<ChipsState>({
        key: appLinkChipsKey,
        state: {
          init: (_config, state) => {
            const hosts = appHosts()
            const ranges = collectAppLinkRanges(state.doc, hosts)
            return { hosts, ranges, targets: targetsOf(ranges, []), cards: new Map(), decos: DecorationSet.empty }
          },
          apply: (tr, prev, oldState, newState) => {
            const meta = tr.getMeta(appLinkChipsKey) as { cards?: AppLinkCards } | undefined
            // 문서·선택·카드 어느 것도 바뀌지 않은 거래(원격 커서 메타 등)는 그대로 둔다.
            if (!tr.docChanged && !tr.selectionSet && !meta) return prev
            const hosts = appHosts()
            const recollect = tr.docChanged || hosts !== prev.hosts
            // 선택만 바뀌었으면 커서가 칩 경계를 넘었을 때(닿은 자리가 달라졌을 때)만 다시 만든다(WP-1185).
            const editable = view?.editable ?? false
            if (!recollect && !meta && touchedKey(oldState, prev.ranges, editable) === touchedKey(newState, prev.ranges, editable)) return prev
            const ranges = recollect ? collectAppLinkRanges(newState.doc, hosts) : prev.ranges
            const targets = recollect ? targetsOf(ranges, prev.targets) : prev.targets
            const cards = meta?.cards ?? prev.cards
            // 한글 조합 중에는 칩을 다시 고르지 않고 자리만 옮긴다 — 조합 중인 글자 옆 DOM 이 바뀌면 조합이 깨진다(WP-333 과 같은 결).
            if (view?.composing) return { hosts, ranges, targets, cards, decos: prev.decos.map(tr.mapping, tr.doc) }
            return { hosts, ranges, targets, cards, decos: chipDecorations(newState, ranges, cards, editable) }
          },
        },
        view(v) {
          view = v
          // 편집 가능 여부는 거래 없이(setEditable) 바뀐다 — 바뀔 때마다 칩을 다시 고른다(커서가 닿은 링크의 드러냄이 따라가게).
          let editable = v.editable
          return {
            update() {
              if (v.editable === editable) return
              editable = v.editable
              queueMicrotask(() => {
                if (view === v) refreshAppLinkChips(v)
              })
            },
            destroy() {
              view = null
            },
          }
        },
        props: {
          decorations: (state) => appLinkChipsKey.getState(state)?.decos ?? DecorationSet.empty,
          handleDOMEvents: {
            // 조합 중에는 칩을 다시 고르지 않았으니 조합이 끝나면 한 번 다시 고른다 — 조합 뒤 문서가 더 바뀌지 않으면 주소가 칩이
            // 되지 않거나 지운 주소의 칩이 남았다(WP-1185). 조합 끝 처리(composing 해제)는 이 처리 뒤에 돌아 마이크로태스크로 미룬다.
            compositionend: (v) => {
              queueMicrotask(() => {
                if (view === v && !v.composing) refreshAppLinkChips(v)
              })
              return false
            },
          },
        },
      }),
    ]
  },
})
