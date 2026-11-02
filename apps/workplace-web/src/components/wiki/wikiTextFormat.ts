// 노트 선택 서식 도구(WP-1305) — 밑줄·글자색·배경색·글자 크기(본문/제목)·정렬을 고르는 명령과 상태 판정.
//
// 저장 형식(스키마 판 5):
// - 굵게·기울임·취소선·링크·제목: 지금 마크다운 그대로(StarterKit·WikiLink).
// - 밑줄·글자색·배경색: 새 마크 없이 인라인 모양 마크 wikiHtmlSpan(WP-1240)의 style 에 선언으로 쓴다 — class 없는 span 하나(「서식 span」)에
//   모아 `<span style="text-decoration: underline; color: …">` 로 저장한다. 같은 글자에 색을 더해도 span 이 겹겹이 늘지 않고, 선언 하나만
//   빼면(밑줄 끄기) 그 선언만 사라진다. class 를 지닌 모양 span(가져온 배지 등)은 그대로 두고 같은 속성 선언만 걷어 서식 span 쪽으로 옮긴다
//   (안쪽·바깥 span 이 서로 다른 색을 들고 있어 무엇이 이기는지 헷갈리지 않게).
// - 정렬: 문단·제목 textAlign 속성(공용 스키마 textAlign.ts) — <div align> 감싸개로 저장한다. 문서 최상위·인용·상자 바로 안만 정렬한다
//   (공용 canAlignIn — 목록 항목·표 셀은 막는다. 표는 셀 정렬 WP-584 를 쓴다).
// 색 값은 테마 변수 + 저장용 16진 대체값(var(--wiki-text-red, #dc2626)) — 앱 화면(편집기·공개 공유)은 index.css 의 변수로 다크에서도 읽히는
// 색을 쓰고, 변수가 없는 화면(내보낸 마크다운을 다른 곳에서 열 때)은 대체값을 쓴다.
import {
  canAlignIn,
  type FormatProp,
  parseDeclarations,
  parseTextAlign,
  type WikiTextAlign,
} from '@smart-workplace/wiki-editor-schema'
import { type Command, Extension } from '@tiptap/core'
import type { Mark, MarkType, Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'

export type { FormatProp }

/** 색 묶음 하나 — 글자색(text)·배경색(mark)의 저장용 대체값. 화면 값은 index.css 의 --wiki-text-<key>·--wiki-mark-<key>. */
export interface FormatColor {
  key: string
  label: string
  text: string
  mark: string
}

/** 색 고르기 판(기본 + 7색) — 「기본」은 선언을 지운다(목록 밖에서 따로 둔다). 대체값은 Tailwind 600(글자)·100~200(배경) 계열. */
export const FORMAT_COLORS: readonly FormatColor[] = [
  { key: 'gray', label: '회색', text: '#6b7280', mark: '#e5e7eb' },
  { key: 'red', label: '빨강', text: '#dc2626', mark: '#fee2e2' },
  { key: 'orange', label: '주황', text: '#ea580c', mark: '#ffedd5' },
  { key: 'yellow', label: '노랑', text: '#ca8a04', mark: '#fef08a' },
  { key: 'green', label: '초록', text: '#16a34a', mark: '#dcfce7' },
  { key: 'blue', label: '파랑', text: '#2563eb', mark: '#dbeafe' },
  { key: 'purple', label: '보라', text: '#9333ea', mark: '#f3e8ff' },
]

/** 색 고르기 대상 — 글자색(color)·배경색(background-color). */
export type ColorProp = 'color' | 'background-color'

/** 화면 테마 변수 이름 — 글자색은 --wiki-text-<key>, 배경색은 --wiki-mark-<key>(index.css). 저장 값·메뉴 견본이 같은 이름을 쓴다. */
export function colorVar(prop: ColorProp, c: FormatColor): string {
  return `--wiki-${prop === 'color' ? 'text' : 'mark'}-${c.key}`
}

/** 색 저장 값 — 테마 변수 + 대체값. */
export function colorValue(prop: ColorProp, c: FormatColor): string {
  return `var(${colorVar(prop, c)}, ${prop === 'color' ? c.text : c.mark})`
}

/** 글자색 저장 값 — 테마 변수 + 대체값. */
export function textColorValue(c: FormatColor): string {
  return colorValue('color', c)
}

/** 배경색 저장 값 — 테마 변수 + 대체값. */
export function markColorValue(c: FormatColor): string {
  return colorValue('background-color', c)
}

const SPAN = 'wikiHtmlSpan'

/** 선언 하나의 값 — 없으면 null. 같은 속성이 여러 번이면 뒤 값(CSS 와 같다). */
export function readDecl(style: string | null | undefined, prop: string): string | null {
  let found: string | null = null
  for (const [p, v] of parseDeclarations(style)) if (p === prop) found = v
  return found
}

/**
 * 마크 하나의 선언 표(속성 → 값, 같은 속성은 뒤 값) — 마크는 바뀌지 않는 값이라 마크별로 한 번만 파싱해 둔다.
 * 툴바는 선택이 바뀔 때마다 선택 글자 전체의 마크를 다시 읽으므로 같은 style 글자를 반복해 자르지 않게 한다.
 */
const declCache = new WeakMap<Mark, Map<string, string>>()
function markDecls(mark: Mark): Map<string, string> {
  let decls = declCache.get(mark)
  if (!decls) {
    decls = new Map(parseDeclarations(mark.attrs.style))
    declCache.set(mark, decls)
  }
  return decls
}

/** 마크의 선언 하나 — 없으면 null. */
function markDecl(mark: Mark, prop: string): string | null {
  return markDecls(mark).get(prop) ?? null
}

/**
 * 선언 하나를 바꾸거나(value) 지운(null) style — 남는 선언이 없으면 null. 다른 선언은 순서·글자 그대로 두고, 같은 속성은 한 번만 남긴다.
 * 결과는 sanitizeInlineStyle 의 정규형('; ' 잇기)과 같아 저장 → 재로드 → 재저장이 바이트 같다.
 */
export function withDecl(style: string | null | undefined, prop: string, value: string | null): string | null {
  const decls = parseDeclarations(style)
  const out: string[] = []
  let placed = false
  for (const [p, v] of decls) {
    if (p !== prop) out.push(`${p}: ${v}`)
    else if (value !== null && !placed) {
      out.push(`${p}: ${value}`)
      placed = true
    }
  }
  if (value !== null && !placed) out.push(`${prop}: ${value}`)
  return out.length ? out.join('; ') : null
}

/** text-decoration 값에 underline 이 들었는지. */
export function hasUnderline(value: string | null): boolean {
  return !!value && /(^|\s)underline(\s|$)/i.test(value)
}

/** 밑줄을 뺀 text-decoration 값(line-through 등은 남긴다) — 남는 게 없으면 null. */
function withoutUnderline(value: string | null): string | null {
  const rest = (value ?? '').split(/\s+/).filter((t) => t && t.toLowerCase() !== 'underline')
  return rest.length ? rest.join(' ') : null
}

/** 서식 span(class 없는 wikiHtmlSpan) — 마크 목록에서 첫 번째. 고칠 대상이라 서식 선언만 지녔는지는 따지지 않는다. */
function formatSpanOf(marks: readonly Mark[]): Mark | null {
  return marks.find((m) => m.type.name === SPAN && !m.attrs.className) ?? null
}

/** 마크 목록에서 이 속성의 실제 값 — 서식 span 우선, 없으면 class span 의 선언. */
function propIn(marks: readonly Mark[], prop: FormatProp): string | null {
  const fmt = formatSpanOf(marks)
  const own = fmt ? markDecl(fmt, prop) : null
  if (own !== null) return own
  for (const m of marks) if (m.type.name === SPAN) {
    const v = markDecl(m, prop)
    if (v !== null) return v
  }
  return null
}

/** 선택의 글자 노드마다 [시작, 끝, 노드] — 빈 선택이면 없다. 마크를 받을 수 없는 자리(코드 블록 등)는 뺀다. */
function textRanges(state: EditorState, type: MarkType): [number, number, PMNode][] {
  const out: [number, number, PMNode][] = []
  for (const { $from, $to } of state.selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
      if (!node.isText || !parent?.type.allowsMarkType(type)) return
      const start = Math.max(pos, $from.pos)
      const end = Math.min(pos + node.nodeSize, $to.pos)
      if (start < end) out.push([start, end, node])
    })
  }
  return out
}

/** 선택의 서식 상태 — 툴바 한 번 그릴 때 한 번 계산한다. 값이 섞였거나 없으면 null, 밑줄은 선택 글자 전체가 밑줄일 때만 참. */
export interface SelectionFormat {
  color: string | null
  background: string | null
  underline: boolean
  /** 선택 첫 정렬 가능 문단·제목의 정렬(없으면 기본). */
  align: WikiTextAlign
  /** 정렬 메뉴를 쓸 수 있는지 — 선택이 정렬 가능한 자리(canAlignIn)의 문단·제목에 걸쳐 있을 때만. */
  canAlign: boolean
}

const EMPTY_FORMAT: SelectionFormat = { color: null, background: null, underline: false, align: null, canAlign: false }

/** 두 값이 같으면 그 값, 다르면 null(섞임) — undefined 는 「아직 본 글자 없음」. 한 번 섞이면 끝까지 null 이다. */
function same(prev: string | null | undefined, v: string | null): string | null {
  return prev === undefined || prev === v ? v : null
}

/** 마크 목록 하나의 서식 상태(정렬 제외) — 빈 선택(커서)의 저장된 마크·앞 글자 마크용. */
function marksFormat(marks: readonly Mark[]): SelectionFormat {
  return {
    ...EMPTY_FORMAT,
    color: propIn(marks, 'color'),
    background: propIn(marks, 'background-color'),
    underline: hasUnderline(propIn(marks, 'text-decoration')),
  }
}

/**
 * 선택의 서식 상태를 문서 한 번 훑기로 모은다 — 글자색·배경색(모두 같으면 그 값)·밑줄(모두 밑줄인지)·정렬.
 * 빈 선택이면 커서 자리 마크(저장된 마크 → 앞 글자 마크)를 본다(⌘U 끄고 켜기 판정). 정렬은 바로 위 부모가 정렬 가능한 자리인 문단·제목만 센다.
 */
export function selectionFormat(state: EditorState): SelectionFormat {
  const type = state.schema.marks[SPAN]
  if (!type) return EMPTY_FORMAT
  if (state.selection.empty) return marksFormat(state.storedMarks ?? state.selection.$from.marks())
  let color: string | null | undefined
  let background: string | null | undefined
  let underline = true
  let sawText = false
  let align: WikiTextAlign = null
  let canAlign = false
  for (const { $from, $to } of state.selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
      if (node.isText) {
        // textRanges 와 같은 거르기 — 마크를 받을 수 없는 자리(코드 블록 등)·선택 밖 글자는 세지 않는다.
        if (!parent?.type.allowsMarkType(type) || Math.max(pos, $from.pos) >= Math.min(pos + node.nodeSize, $to.pos)) return
        sawText = true
        color = same(color, propIn(node.marks, 'color'))
        background = same(background, propIn(node.marks, 'background-color'))
        underline &&= hasUnderline(propIn(node.marks, 'text-decoration'))
        return
      }
      if ((node.type.name === 'paragraph' || node.type.name === 'heading') && parent && canAlignIn(parent.type.name) && !canAlign) {
        canAlign = true
        align = parseTextAlign(node.attrs.textAlign)
      }
      return true
    })
  }
  return { color: color ?? null, background: background ?? null, underline: sawText && underline, align, canAlign }
}

/**
 * 마크 목록 하나에 속성 바꾸기를 적용한 새 마크 목록 — class span 의 같은 속성은 걷고, 서식 span 에 값을 쓰거나 지운다.
 * next(현재 값) → 새 값(null 이면 지움). 바뀐 게 없으면 같은 배열.
 */
function applyToMarks(marks: readonly Mark[], type: MarkType, prop: FormatProp, next: (cur: string | null) => string | null): readonly Mark[] {
  const fmt = formatSpanOf(marks)
  const current = propIn(marks, prop)
  const value = next(current)
  let changed = false
  const out: Mark[] = []
  for (const m of marks) {
    // 서식 span 은 아래에서 새 값으로 다시 만들어 넣으므로 여기선 뺀다.
    if (m === fmt) continue
    if (m.type !== type) {
      out.push(m)
      continue
    }
    // class span 에 든 같은 속성 선언은 걷는다 — 값은 서식 span 하나가 들고 있게.
    if (markDecl(m, prop) === null) {
      out.push(m)
      continue
    }
    changed = true
    // 걷고 나서 class·style 이 둘 다 없으면 빈 span 이라 마크째 뗀다(저장하면 속성 없는 <span> 이 되고 다시 읽으면 사라져 문서가 흔들린다).
    const style = withDecl(m.attrs.style, prop, null)
    if (m.attrs.className || style) out.push(type.create({ className: m.attrs.className, style }))
  }
  const fmtStyle = withDecl(fmt?.attrs.style ?? null, prop, value)
  if ((fmt?.attrs.style ?? null) !== fmtStyle) changed = true
  if (!changed) return marks
  return fmtStyle ? type.create({ className: null, style: fmtStyle }).addToSet(out) : out
}

/** 마크 목록을 통째로 바꾼다 — 빠진 마크는 지우고, 새 마크는 더한다(같은 종류 여러 개를 허용하는 wikiHtmlSpan 이라 하나씩 지정한다). */
function replaceMarks(tr: Transaction, from: number, to: number, before: readonly Mark[], after: readonly Mark[]) {
  for (const m of before) if (!m.isInSet(after)) tr.removeMark(from, to, m)
  for (const m of after) if (!m.isInSet(before)) tr.addMark(from, to, m)
}

/** 속성 바꾸기 명령 — 빈 선택이면 다음에 칠 글자의 마크(저장된 마크)를 바꾼다. */
function updateSpanProp(prop: FormatProp, next: (cur: string | null) => string | null): Command {
  return ({ state, tr, dispatch }) => {
    const type = state.schema.marks[SPAN]
    if (!type) return false
    if (state.selection.empty) {
      const marks = state.storedMarks ?? state.selection.$from.marks()
      const after = applyToMarks(marks, type, prop, next)
      if (after !== marks && dispatch) tr.setStoredMarks(after)
      return true
    }
    const ranges = textRanges(state, type)
    if (!ranges.length) return false
    if (dispatch) {
      for (const [from, to, node] of ranges) {
        replaceMarks(tr, from, to, node.marks, applyToMarks(node.marks, type, prop, next))
      }
    }
    return true
  }
}

/** 글자색·배경색 고르기 — value null 이면 「기본」(선언을 지운다). */
export function setFormatColor(prop: 'color' | 'background-color', value: string | null): Command {
  return updateSpanProp(prop, () => value)
}

/** 밑줄 켜고 끄기(⌘U·도구 버튼) — 선택이 모두 밑줄이면 끄고, 아니면 모두 켠다. 취소선 등 다른 text-decoration 값은 남긴다. */
export const toggleUnderline: Command = (props) => {
  const on = !selectionFormat(props.state).underline
  return updateSpanProp('text-decoration', (cur) => {
    const rest = withoutUnderline(cur)
    return on ? (rest ? `underline ${rest}` : 'underline') : rest
  })(props)
}

// ── 블록: 글자 크기(본문·제목1~3)·정렬 ──────────────────────────────────────────────

/** 선택이 걸친 정렬 가능한 문단·제목 위치 — 바로 위 부모가 정렬 가능한 자리(canAlignIn)인 것만. 표·목록 안은 빠진다. */
function alignableBlocks(state: EditorState): number[] {
  const out: number[] = []
  for (const { $from, $to } of state.selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
      if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true
      if (parent && canAlignIn(parent.type.name)) out.push(pos)
      return false
    })
  }
  return out
}

/** 정렬 바꾸기 — 선택이 걸친 정렬 가능한 문단·제목 모두. null 은 기본(왼쪽). */
export function setTextAlign(align: WikiTextAlign): Command {
  return ({ state, tr, dispatch }) => {
    const blocks = alignableBlocks(state)
    if (!blocks.length) return false
    if (dispatch) for (const pos of blocks) tr.setNodeAttribute(pos, 'textAlign', align)
    return true
  }
}

/** 글자 크기 단계 — 본문(문단)·제목1~3. */
export type BlockSize = 'paragraph' | 1 | 2 | 3

/** 선택 첫 글자 블록의 크기 — 문단·제목1~3 밖(제목4 이상·코드 블록 등)이면 null. */
export function currentBlockSize(state: EditorState): BlockSize | null {
  const parent = state.selection.$from.parent
  if (parent.type.name === 'paragraph') return 'paragraph'
  if (parent.type.name === 'heading' && [1, 2, 3].includes(parent.attrs.level)) return parent.attrs.level as BlockSize
  return null
}

/**
 * 크기 바꾸기 — 선택이 걸친 글자 블록을 문단 또는 제목 N 으로. 정렬(textAlign)은 그대로 옮긴다
 * (tiptap setHeading·setParagraph 는 속성을 기본값으로 되돌려 가운데 제목이 본문이 되며 정렬을 잃는다).
 */
export function setBlockSize(size: BlockSize): Command {
  return ({ state, tr, dispatch }) => {
    const type = size === 'paragraph' ? state.schema.nodes.paragraph : state.schema.nodes.heading
    if (!type) return false
    if (dispatch) {
      for (const { $from, $to } of state.selection.ranges) {
        tr.setBlockType($from.pos, $to.pos, type, (old) => ({
          ...(size === 'paragraph' ? {} : { level: size }),
          textAlign: old.attrs.textAlign ?? null,
        }))
      }
    }
    return true
  }
}

// ── 단축키 ────────────────────────────────────────────────────────────────────

/** ⌘U/Ctrl+U 밑줄 — 굵게(⌘B)·기울임(⌘I)·취소선(⌘⇧S)·제목(⌘⌥1~3)은 StarterKit 기본 단축키가 그대로 맡는다. 스키마를 바꾸지 않는다. */
export const WikiTextFormatKeys = Extension.create({
  name: 'wikiTextFormatKeys',
  addKeyboardShortcuts() {
    return {
      // 편집 중엔 밑줄을 걸 글자가 없어도(이미지 노드 선택 등) 키를 삼킨다 — 넘기면 Chrome 의 Ctrl+U(페이지 소스 보기)가 열린다.
      'Mod-u': () => {
        if (!this.editor.isEditable) return false
        this.editor.commands.command(toggleUnderline)
        return true
      },
    }
  },
})
