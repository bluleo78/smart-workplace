/**
 * 메일 작성기 서식 확장(WP-1524) — 글꼴·크기·글자색·배경색(글자 서식)과 정렬·줄 간격·들여쓰기(문단 서식).
 *
 * 왜 인라인 style 인가: 받는 쪽 메일 프로그램은 이 앱의 class·CSS 변수를 모른다. 그래서 글자 서식은 class 없는
 * `<span style="...">` 하나(textStyle 마크)에, 문단 서식은 `<p style="...">` 에 16진 색·px 값으로 싣는다. 밑줄만 `<u>`.
 *
 * 왜 값을 키로 들고 있나: 속성에는 정해 둔 목록의 키(글꼴·크기)나 팔레트 16진값(색)만 둔다. 붙여 넣은 HTML 은
 * parseHTML 에서 lib/mailFormat 의 정규화를 거쳐 목록 밖 값이 버려지고, 내보낼 때는 목록의 CSS 로 다시 쓰므로
 * 「저장 → 다시 열기」의 HTML 이 글자 하나 다르지 않다.
 */
import { type Editor, Extension, type Extensions, mergeAttributes } from '@tiptap/core'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'

import {
  MAIL_FONT_SIZES,
  MAIL_FONTS,
  MAIL_INDENT_MAX,
  MAIL_INDENT_STEP_PX,
  type MailAlign,
  type MailFontKey,
  type MailFontSizeKey,
  type MailLineHeight,
  matchLineHeight,
  matchMailFont,
  matchMailFontSize,
  parseIndentStep,
  toMailColorHex,
} from '@/lib/mailFormat'

import { domWithRawAttrs } from './mailRawAttrs'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mailFormat: {
      /** 선택 글자의 글꼴. 'default' 는 글꼴 선언을 지운다. */
      setMailFont: (key: MailFontKey) => ReturnType
      /** 선택 글자의 크기. 'normal' 은 크기 선언을 지운다. */
      setMailFontSize: (key: MailFontSizeKey) => ReturnType
      /** 선택 글자의 글자색(팔레트 text 16진). null 은 선언을 지운다. */
      setMailColor: (hex: string | null) => ReturnType
      /** 선택 글자의 배경색(팔레트 mark 16진). null 은 선언을 지운다. */
      setMailBackground: (hex: string | null) => ReturnType
      /** 선택 문단·제목의 줄 간격. null 은 선언을 지운다. */
      setMailLineHeight: (v: MailLineHeight | null) => ReturnType
      /** 들여쓰기 — 목록 항목이면 하위 목록으로, 아니면 문단 margin-left 한 단(최대 7단). */
      indentMail: () => ReturnType
      /** 내어쓰기 — 목록 항목이면 한 단 위 목록으로, 아니면 문단 margin-left 한 단 줄이기. */
      outdentMail: () => ReturnType
      /** 서식 지우기 — 굵게·기울임·밑줄·취소선·글자 서식과 문단 정렬·줄 간격·들여쓰기. 링크·목록·표는 남긴다. */
      clearMailFormat: () => ReturnType
    }
  }
}

/** 문단 서식을 받는 노드(표 칸 안 문단도 paragraph 다). */
const BLOCK_TYPES = ['paragraph', 'heading']

/** 키 → 글꼴 CSS. 'default'·모르는 키는 null(선언 없음). */
function fontCss(key: unknown): string | null {
  return MAIL_FONTS.find((f) => f.key === key)?.css ?? null
}

/** 키 → 글자 크기 px. 'normal'·모르는 키는 null(선언 없음). */
function fontPx(key: unknown): number | null {
  return MAIL_FONT_SIZES.find((s) => s.key === key)?.px ?? null
}

/** 요소 style 에 정해 둔 글자 서식이 하나라도 있는가 — 없으면 그 span 은 textStyle 로 받지 않는다(빈 span 방지). */
function hasMailInlineFormat(el: HTMLElement): boolean {
  const s = el.style
  return (
    (matchMailFont(s.fontFamily)?.css ?? null) !== null ||
    matchMailFontSize(s.fontSize) !== null ||
    toMailColorHex(s.color, 'color') !== null ||
    toMailColorHex(s.backgroundColor, 'background-color') !== null
  )
}

/**
 * textStyle 마크 — 기본 TextStyle 은 style 이 있는 span 이면 무엇이든 받아 속성이 비어도 `<span>` 을 남긴다.
 * 메일에서는 목록 안 서식이 하나라도 있는 span 만 받아, 붙여 넣은 목록 밖 서식 span 은 글자만 남게 한다.
 *
 * renderHTML 이 배열 명세 대신 요소를 직접 만드는 까닭은 domWithRawAttrs(mailRawAttrs) 주석 참고 — 16진 색을 그대로 보내려는 것이다.
 */
const MailTextStyle = TextStyle.extend({
  parseHTML() {
    return [{ tag: 'span', getAttrs: (el) => (hasMailInlineFormat(el as HTMLElement) ? {} : false) }]
  },
  renderHTML({ HTMLAttributes }) {
    const span = domWithRawAttrs('span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes))
    return { dom: span, contentDOM: span }
  },
  addCommands() {
    const parent = this.parent?.() ?? {}
    return {
      ...parent,
      // 기본 removeEmptyTextStyle 은 선택 범위의 글자만 보고 빈 선택(커서)의 stored mark 는 그대로 둔다 —
      // 커서에서 「크게 → 보통」처럼 마지막 서식을 지우면 속성이 모두 빈 textStyle 이 남아 이어 쓰는 글자가 style 없는 `<span>` 으로 나간다.
      // 그래서 빈 선택이면 속성이 모두 빈 stored textStyle 도 걷어 낸다.
      removeEmptyTextStyle: () => (props) => {
        const { tr } = props
        if (tr.selection.empty) {
          const stored = tr.storedMarks?.find((m) => m.type === this.type)
          if (stored && !Object.values(stored.attrs).some(Boolean)) tr.removeStoredMark(this.type)
        }
        return parent.removeEmptyTextStyle ? parent.removeEmptyTextStyle()(props) : true
      },
    }
  },
})

/** 글자 서식 속성(textStyle 위) — 속성 순서가 곧 내보내는 style 선언 순서다(글꼴·크기·글자색·배경색). */
export const MailInlineFormat = Extension.create({
  name: 'mailInlineFormat',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (el) => {
              const f = matchMailFont(el.style.fontFamily)
              return f && f.css ? f.key : null
            },
            renderHTML: (a) => {
              const css = fontCss(a.fontFamily)
              return css ? { style: `font-family: ${css}` } : {}
            },
          },
          fontSize: {
            default: null,
            parseHTML: (el) => {
              const key = matchMailFontSize(el.style.fontSize)
              return key && fontPx(key) !== null ? key : null
            },
            renderHTML: (a) => {
              const px = fontPx(a.fontSize)
              return px !== null ? { style: `font-size: ${px}px` } : {}
            },
          },
          color: {
            default: null,
            parseHTML: (el) => toMailColorHex(el.style.color, 'color'),
            renderHTML: (a) => (a.color ? { style: `color: ${a.color}` } : {}),
          },
          backgroundColor: {
            default: null,
            parseHTML: (el) => toMailColorHex(el.style.backgroundColor, 'background-color'),
            renderHTML: (a) => (a.backgroundColor ? { style: `background-color: ${a.backgroundColor}` } : {}),
          },
        },
      },
    ]
  },
})

/**
 * 선택 범위 문단·제목의 들여쓰기 단을 delta 만큼 바꾸는 명령 본체. 바뀐 문단이 하나도 없으면 false(=할 수 없음).
 * 목록 안 문단은 건드리지 않는다 — 목록 단계는 sink/liftListItem 이 맡는다.
 */
function changeIndent(delta: number) {
  return ({ state, tr, dispatch }: { state: Editor['state']; tr: Editor['state']['tr']; dispatch?: unknown }) => {
    const { from, to } = state.selection
    let changed = false
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === 'bulletList' || node.type.name === 'orderedList') return false
      if (!BLOCK_TYPES.includes(node.type.name)) return true
      const cur = Number(node.attrs.indent) || 0
      const next = Math.min(MAIL_INDENT_MAX, Math.max(0, cur + delta))
      if (next !== cur) {
        changed = true
        if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
      }
      return false
    })
    return changed
  }
}

/** 문단 서식 속성(paragraph·heading) 과 메일 서식 명령. */
export const MailBlockFormat = Extension.create({
  name: 'mailBlockFormat',
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) => matchLineHeight(el.style.lineHeight),
            renderHTML: (a) => (a.lineHeight ? { style: `line-height: ${a.lineHeight}` } : {}),
          },
          indent: {
            default: 0,
            parseHTML: (el) => parseIndentStep(el.style.marginLeft),
            renderHTML: (a) => {
              const step = Number(a.indent) || 0
              return step > 0 ? { style: `margin-left: ${step * MAIL_INDENT_STEP_PX}px` } : {}
            },
          },
        },
      },
    ]
  },
  addCommands() {
    return {
      // 「기본/보통/null」은 그 속성만 null 로 두고, 모든 속성이 빈 textStyle 마크는 removeEmptyTextStyle 이 걷어 낸다.
      setMailFont:
        (key) =>
        ({ chain }) =>
          chain()
            .setMark('textStyle', { fontFamily: fontCss(key) ? key : null })
            .removeEmptyTextStyle()
            .run(),
      setMailFontSize:
        (key) =>
        ({ chain }) =>
          chain()
            .setMark('textStyle', { fontSize: fontPx(key) !== null ? key : null })
            .removeEmptyTextStyle()
            .run(),
      // 팔레트 밖 값은 받지 않는다(false) — 보내는 HTML 에 정해 둔 16진값만 나가게.
      setMailColor:
        (hex) =>
        ({ chain }) => {
          const v = hex === null ? null : toMailColorHex(hex, 'color')
          if (hex !== null && v === null) return false
          return chain().setMark('textStyle', { color: v }).removeEmptyTextStyle().run()
        },
      setMailBackground:
        (hex) =>
        ({ chain }) => {
          const v = hex === null ? null : toMailColorHex(hex, 'background-color')
          if (hex !== null && v === null) return false
          return chain().setMark('textStyle', { backgroundColor: v }).removeEmptyTextStyle().run()
        },
      setMailLineHeight:
        (v) =>
        ({ commands }) =>
          BLOCK_TYPES.map((t) => commands.updateAttributes(t, { lineHeight: v })).some(Boolean),
      indentMail:
        () =>
        (props) => {
          // 목록 항목 안이면 목록 단계로만 다룬다(첫 항목처럼 내릴 수 없으면 아무것도 하지 않는다).
          if (props.editor.isActive('listItem')) return props.commands.sinkListItem('listItem')
          return changeIndent(1)(props)
        },
      outdentMail:
        () =>
        (props) => {
          if (props.editor.isActive('listItem')) return props.commands.liftListItem('listItem')
          return changeIndent(-1)(props)
        },
      clearMailFormat:
        () =>
        ({ commands }) => {
          for (const mark of ['bold', 'italic', 'underline', 'strike', 'textStyle']) commands.unsetMark(mark)
          // textAlign 은 'left' 가 기본값(선언 없음)이다.
          for (const t of BLOCK_TYPES) commands.updateAttributes(t, { textAlign: 'left', lineHeight: null, indent: 0 })
          return true
        },
    }
  },
})

/**
 * 정렬 — Tiptap TextAlign 은 기본값('left')도 `text-align: left` 로 내보낸다. 메일에서 왼쪽은 「선언 없음」이므로
 * 'left' 일 때는 style 을 내지 않게 renderHTML 만 바꾼다(읽기·명령은 그대로).
 */
const MailTextAlign = TextAlign.extend({
  addGlobalAttributes() {
    return (this.parent?.() ?? []).map((g) => ({
      ...g,
      attributes: Object.fromEntries(
        Object.entries(g.attributes).map(([name, attr]) => [
          name,
          name === 'textAlign'
            ? {
                ...attr,
                renderHTML: (a: Record<string, unknown>) =>
                  a.textAlign && a.textAlign !== 'left' ? { style: `text-align: ${String(a.textAlign)}` } : {},
              }
            : attr,
        ]),
      ),
    }))
  },
})

/**
 * 작성기에 더하는 서식 확장 묶음. StarterKit(2.x)에는 밑줄이 없고 작성기도 따로 등록하지 않으므로 Underline 은 여기서만 넣는다.
 * MailBlockFormat 이 TextAlign 앞이라 문단 style 은 「줄 간격; 여백; 정렬」 순서로 나간다.
 */
export const MAIL_FORMAT_EXTENSIONS: Extensions = [
  MailTextStyle,
  MailInlineFormat,
  MailBlockFormat,
  Underline,
  MailTextAlign.configure({ types: BLOCK_TYPES, alignments: ['left', 'center', 'right', 'justify'], defaultAlignment: 'left' }),
]

/** 도구 막대가 그리는 커서 자리 서식 상태. */
export interface MailFormatState {
  font: MailFontKey
  size: MailFontSizeKey
  color: string | null
  background: string | null
  align: MailAlign
  lineHeight: MailLineHeight | null
  canOutdent: boolean
}

/** 커서(선택 시작) 자리의 서식 — 글자 서식은 textStyle 마크, 문단 서식은 커서가 든 문단·제목에서 읽는다. */
export function readMailFormatState(editor: Editor): MailFormatState {
  const ts = editor.getAttributes('textStyle')
  const parent = editor.state.selection.$from.parent
  const block = BLOCK_TYPES.includes(parent.type.name) ? parent.attrs : {}
  const align = block.textAlign as MailAlign | null | undefined
  return {
    font: fontCss(ts.fontFamily) ? (ts.fontFamily as MailFontKey) : 'default',
    size: fontPx(ts.fontSize) !== null ? (ts.fontSize as MailFontSizeKey) : 'normal',
    color: (ts.color as string | null | undefined) ?? null,
    background: (ts.backgroundColor as string | null | undefined) ?? null,
    align: align ?? 'left',
    lineHeight: (block.lineHeight as MailLineHeight | null | undefined) ?? null,
    canOutdent: editor.can().outdentMail(),
  }
}
