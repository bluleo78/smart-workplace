// 굵게·기울임·취소선이 겹친 글자를 저장할 때 마크다운이 깨지지 않게 하는 직렬화 상태(WP-1318).
//
// 왜: tiptap-markdown 0.8.10 의 직렬화 상태는 여닫는 표시가 여닫을 수 없는 자리(CommonMark flanking 규칙)에 오면
// 표시를 앞뒤로 밀어 맞추는데(trimInline), 열린 표시를 쌓는 스택이 닫힐 때 마크를 가리지 않고 맨 위를 꺼낸다.
// 그래서 마크 여럿이 같은 자리에서 여닫히면 엉뚱한 마크의 표시를 밀어 「가***~~나~~~~*다」처럼 깨졌다.
// 게다가 글자 사이(가·다)에 붙은 「***~~」처럼 종류가 다른 표시가 맞붙으면 CommonMark 로는 아예 나타낼 수 없다
// — 「가***~~나~~***다」도 다시 읽으면 굵게·기울임이 글자로 남는다.
//
// 어떻게: tiptap-markdown 상태 대신 이 상태로 직렬화한다(wikiMarkdownSerializer 확장이 serializer.serialize 를 바꿔 끼운다).
// - 표시 위치를 마크별로 짝지어 기록하고, 글 묶음(문단·셀) 하나를 다 쓴 뒤 한꺼번에 처리한다.
// - 종류가 다른 표시가 맞붙은 묶음이 글자에 바로 붙어 있으면 그 마크들은 HTML 태그(<strong>·<em>·<s>)로 쓴다.
//   노트는 html:true 로 파싱하므로 다시 읽으면 같은 마크가 된다.
// - 나머지는 tiptap-markdown 과 같은 방식(trimInline)으로 표시를 민다. 다만 tiptap-markdown 은 문서 맨 앞(자리 0)에서
//   시작한 마크는 밀지 않았는데(start 가 0 이라 거짓으로 봄) 여기서는 그 마크도 민다 — 맨 앞의 「**"인용"**다」처럼 다시 읽으면
//   굵게가 풀리던 저장이 문단 가운데와 같게 「**"인용**"다」가 된다. 그 밖의 겹치지 않은 마크는 수정 전과 같게 저장된다.
import { Extension } from '@tiptap/core'
import { type MarkdownSerializer, MarkdownSerializerState } from '@tiptap/pm/markdown'
import type { Mark as PMMark, Node as PMNode } from '@tiptap/pm/model'
import markdownit from 'markdown-it'

/** HTML 태그로 바꿔 쓸 수 있는 마크 — expelEnclosingWhitespace 를 쓰는 셋이다. */
const HTML_TAG: Record<string, string> = { bold: 'strong', italic: 'em', strike: 's' }

// ---- tiptap-markdown 0.8.10 의 표시 밀기(trimInline) — 겹치지 않은 마크 결과를 같게 두려고 그대로 옮겼다 ----
const md = markdownit()
function scanDelims(text: string, pos: number) {
  const state = new md.inline.State(text, md, {}, [])
  return state.scanDelims(pos, true)
}
function shiftDelim(text: string, delim: string, start: number, offset: number): string {
  let res = text.substring(0, start) + text.substring(start + delim.length)
  res = res.substring(0, start + offset) + delim + res.substring(start + offset)
  return res
}
function trimInline(text: string, delim: string, from: number, to: number): string {
  let res = text
  let pos = from
  while (pos < to) {
    if (scanDelims(res, pos).can_open) break
    res = shiftDelim(res, delim, pos, 1)
    pos++
  }
  const start = pos
  pos = to
  while (pos > start) {
    if (scanDelims(res, pos).can_close) break
    res = shiftDelim(res, delim, pos, -1)
    pos--
  }
  // 밀다가 안이 비면 표시 둘을 지운다.
  if (pos - start < delim.length + 1) res = res.substring(0, start) + res.substring(pos + delim.length)
  return res
}

/** 마크 하나가 이 글 묶음에 남긴 여는·닫는 표시 자리. end 는 닫는 표시를 쓰기 직전 위치. */
interface Inline {
  mark: PMMark
  open: string
  close: string
  start: number
  end?: number
}

/** 공백·문장부호가 아닌 글자(=표시가 바로 붙으면 flanking 이 깨지는 글자)인가. 글 묶음 끝(빈 글자)은 아니다. */
function isWordChar(ch: string | undefined): boolean {
  return !!ch && !/\s/.test(ch) && !/[\p{P}\p{S}]/u.test(ch)
}

// prosemirror-markdown 1.13 타입은 상태 생성자를 @internal 로 숨긴다 — 런타임 시그니처(nodes, marks, options)로 다시 적는다.
const BaseState = MarkdownSerializerState as unknown as new (
  nodes: MarkdownSerializer['nodes'],
  marks: MarkdownSerializer['marks'],
  options: MarkdownSerializer['options'],
) => MarkdownSerializerState

export class WikiMarkdownSerializerState extends BaseState {
  /** 표 직렬화기(tiptap-markdown·tableNode.ts)가 셀을 쓰는 동안 켜는 플래그 — tiptap-markdown 상태와 같게 둔다. */
  inTable = false
  private inlines: Inline[] = []
  // 아래 둘은 prosemirror-markdown 1.13 의 @internal 멤버 — 런타임에는 있고 타입에만 빠져 있다.
  declare out: string
  declare marks: { [mark: string]: { expelEnclosingWhitespace?: boolean } }

  markString(mark: PMMark, open: boolean, parent: PMNode, index: number): string {
    const str = super.markString(mark, open, parent, index)
    const info = this.marks[mark.type.name]
    if (!info?.expelEnclosingWhitespace) return str
    // 표시는 곧 text() 로 쓰이는데, text() 는 먼저 write() 로 앞 블록의 빈 줄·줄 머리 접두어(> 등)를 내보낸다.
    // 그 전에 자리를 재면 접두어 앞을 가리키므로 여기서 미리 내보내고 잰다(write 는 거듭 불러도 한 번만 쓴다).
    this.write()
    if (open) {
      this.inlines.push({ mark, open: str, close: '', start: this.out.length })
    } else {
      // 닫는 마크와 짝인, 아직 닫히지 않은 가장 안쪽 기록을 찾는다(tiptap-markdown 은 여기서 맨 위를 꺼내 짝이 어긋났다).
      for (let i = this.inlines.length - 1; i >= 0; i--) {
        const it = this.inlines[i]
        if (it.end === undefined && it.mark.eq(mark)) {
          it.end = this.out.length
          it.close = str
          break
        }
      }
    }
    return str
  }

  renderInline(parent: PMNode, fromBlockStart = true): void {
    // 표 셀처럼 글 묶음 안에서 다시 불릴 수 있어 묶음마다 기록을 따로 둔다.
    const outer = this.inlines
    this.inlines = []
    super.renderInline(parent, fromBlockStart)
    this.fixInlines(this.inlines.filter((it) => it.end !== undefined))
    this.inlines = outer
  }

  /** 글 묶음 하나의 표시들을 처리한다 — 맞붙어 나타낼 수 없는 것은 HTML 로, 나머지는 trimInline 으로. */
  private fixInlines(items: Inline[]): void {
    if (!items.length) return
    const toHtml = new Set<Inline>()
    // 같은 자리에서 잇따라 여는(닫는) 표시 묶음 — 종류가 둘 이상이고 바깥 글자가 붙어 있으면 CommonMark 로 못 쓴다.
    const chains = (pos: (it: Inline) => number, len: (it: Inline) => string) => {
      const byPos = new Map<number, Inline>()
      for (const it of items) byPos.set(pos(it), it)
      const afterEnds = new Set(items.map((o) => pos(o) + len(o).length))
      const out: Inline[][] = []
      for (const it of items) {
        // 앞에 붙은 표시가 없는 것부터 체인을 잇는다.
        if (afterEnds.has(pos(it))) continue
        const chain = [it]
        let cur = it
        for (let next = byPos.get(pos(cur) + len(cur).length); next; next = byPos.get(pos(cur) + len(cur).length)) {
          chain.push(next)
          cur = next
        }
        out.push(chain)
      }
      return out
    }
    for (const chain of chains((it) => it.start, (it) => it.open)) {
      if (new Set(chain.map((it) => it.open[0])).size > 1 && isWordChar(this.out[chain[0].start - 1])) chain.forEach((it) => toHtml.add(it))
    }
    for (const chain of chains((it) => it.end!, (it) => it.close)) {
      const last = chain[chain.length - 1]
      if (new Set(chain.map((it) => it.close[0])).size > 1 && isWordChar(this.out[last.end! + last.close.length])) chain.forEach((it) => toHtml.add(it))
    }

    // 이 글 묶음 앞부분만 잘라 처리한다(표시 앞 글자 하나는 flanking 판단에 필요해 함께) — 문서 전체를 매번 다시 만들지 않게.
    const base = Math.max(0, Math.min(...items.map((it) => it.start)) - 1)
    let block = this.out.slice(base)
    for (const it of items) {
      it.start -= base
      it.end! -= base
    }
    // 안쪽(먼저 닫힌 것)부터 처리하고, 길이가 바뀐 만큼 뒤쪽 기록의 자리를 옮긴다.
    const ordered = [...items].sort((a, b) => a.end! - b.end! || b.start - a.start)
    const shift = (at: number, delta: number, self: Inline) => {
      if (!delta) return
      for (const o of items) {
        if (o === self) continue
        if (o.start >= at) o.start += delta
        if (o.end! >= at) o.end! += delta
      }
    }
    for (const it of ordered) {
      const tag = HTML_TAG[it.mark.type.name]
      // 기록 자리에 표시가 그대로 있을 때만 고친다(어긋났으면 손대지 않는다).
      if (block.substring(it.start, it.start + it.open.length) !== it.open) continue
      if (block.substring(it.end!, it.end! + it.close.length) !== it.close) continue
      if (toHtml.has(it) && tag) {
        const open = `<${tag}>`
        const close = `</${tag}>`
        block = block.substring(0, it.end!) + close + block.substring(it.end! + it.close.length)
        shift(it.end! + it.close.length, close.length - it.close.length, it)
        block = block.substring(0, it.start) + open + block.substring(it.start + it.open.length)
        shift(it.start + 1, open.length - it.open.length, it)
        continue
      }
      const before = block.length
      block = trimInline(block, it.open, it.start, it.end!)
      shift(it.start, block.length - before, it)
    }
    this.out = this.out.slice(0, base) + block
  }
}

/**
 * tiptap-markdown 직렬화기가 위 상태를 쓰게 하는 확장 — Markdown 확장(priority 50)의 onBeforeCreate 가 storage.markdown 을
 * 만든 뒤에 돌아야 해서 priority 를 그보다 낮게 둔다(낮을수록 나중).
 * getMarkdown()·docToMarkdown 모두 serializer.serialize 를 거치므로 여기 하나만 바꾸면 된다.
 */
export const WikiMarkdownSerializer = Extension.create({
  name: 'wikiMarkdownSerializer',
  priority: 49,
  onBeforeCreate() {
    const serializer = (this.editor.storage as { markdown: { serializer: SerializerLike } }).markdown.serializer
    serializer.serialize = (content: PMNode) => {
      // tiptap-markdown MarkdownSerializer.serialize 와 같은 옵션(HardBreak 노드 이름 — StarterKit 의 hardBreak).
      const state = new WikiMarkdownSerializerState(serializer.nodes, serializer.marks, { hardBreakNodeName: 'hardBreak' })
      state.renderContent(content)
      return state.out
    }
  },
})

/** tiptap-markdown MarkdownSerializer 중 여기서 쓰는 부분. */
interface SerializerLike {
  nodes: MarkdownSerializer['nodes']
  marks: MarkdownSerializer['marks']
  serialize(content: PMNode): string
}
