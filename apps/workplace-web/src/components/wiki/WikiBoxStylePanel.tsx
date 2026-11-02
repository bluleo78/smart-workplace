import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { selectedBox, writeSelectedBoxStyle } from './wikiBox'
import {
  applyBoxStyle,
  BOX_BACKGROUNDS,
  BOX_COLORS,
  BOX_PRESETS,
  type BoxStyleChange,
  type BoxStyleFields,
  normalizeValue,
  parseBoxStyle,
  removedDeclCount,
  removedNote,
  styleToEditableText,
  styleToReact,
} from './wikiBoxStyle'
import { keepFocus } from './wikiPinVisible'
import { WikiStyleTextForm } from './WikiStyleTextForm'

/** 나란히 놓인 고르기 단추 묶음(세그먼트) — 지금 값은 눌린 상태(aria-pressed)로 보인다. */
function Segmented({
  label,
  name,
  options,
  value,
  onPick,
}: {
  label: string
  name: string
  options: readonly { key: string; label: string }[]
  value: string | null
  onPick: (key: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div role="group" aria-label={label} className="inline-flex rounded-md border bg-muted p-0.5">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={value === o.key}
            data-testid={`wiki-box-style-${name}-${o.key}`}
            onMouseDown={keepFocus}
            onClick={() => onPick(o.key)}
            className={cn(
              'rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground',
              value === o.key && 'bg-background text-foreground shadow-sm',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 색 견본 줄 — 배경(background)·글자색(color) 항목별 이름·견본 목록·data-testid 조각. */
const SWATCH_ROWS = {
  background: { label: '배경', name: 'bg', swatches: BOX_BACKGROUNDS },
  color: { label: '글자색', name: 'color', swatches: BOX_COLORS },
} as const

/**
 * 색 견본 줄 — 견본은 저장될 값 그대로(테마 변수 + 밝은 기본값) 칠해 다크 테마에서도 상자와 같은 색으로 보인다.
 * 비운 칸(배경 「없음」·글자색 「기본」)의 표시는 항목(field)으로 가른다.
 */
function Swatches({
  field,
  value,
  onPick,
}: {
  field: keyof typeof SWATCH_ROWS
  value: string | null
  onPick: (value: string | null) => void
}) {
  const { label, name, swatches } = SWATCH_ROWS[field]
  const current = normalizeValue(value)
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap justify-end gap-1">
        {swatches.map((s) => {
          const on = s.value === null ? value === null : normalizeValue(s.value) === current
          return (
            <button
              key={s.key}
              type="button"
              aria-label={`${label} ${s.label}`}
              title={s.label}
              aria-pressed={on}
              data-testid={`wiki-box-style-${name}-${s.key}`}
              onMouseDown={keepFocus}
              onClick={() => onPick(s.value)}
              className={cn(
                'relative flex size-6 items-center justify-center rounded-full border text-xs font-semibold',
                on && 'ring-2 ring-ring ring-offset-1 ring-offset-popover',
              )}
              // 견본은 그 색으로 칠한다(글자색 「흰색」을 흰 글자로 보이면 밝은 창에서 사라진다). 「없음」은 빗금, 글자색 「기본」은 본문색 「가」.
              style={s.value ? { background: s.value } : undefined}
            >
              {s.value === null &&
                (field === 'color' ? '가' : <span className="h-px w-4 rotate-45 bg-muted-foreground" aria-hidden="true" />)}
              {on && s.value !== null && <Check className="absolute size-3 text-white mix-blend-difference" aria-hidden="true" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 세그먼트로 고르는 항목 — 테두리·모서리·여백·그림자. */
type SegmentField = 'border' | 'radius' | 'padding' | 'shadow'

/** 세그먼트 줄 표 — 항목·이름·고를 값. 항목 이름이 data-testid 조각(wiki-box-style-<항목>-<값>)이 된다. 값 키는 항목 형식으로 검사된다. */
const SEGMENT_ROWS: readonly {
  [F in SegmentField]: { field: F; label: string; options: readonly { key: NonNullable<BoxStyleFields[F]>; label: string }[] }
}[SegmentField][] = [
  {
    field: 'border',
    label: '테두리',
    options: [
      { key: 'none', label: '없음' },
      { key: 'thin', label: '얇게' },
      { key: 'thick', label: '굵게' },
    ],
  },
  {
    field: 'radius',
    label: '모서리',
    options: [
      { key: 'square', label: '각지게' },
      { key: 'round', label: '둥글게' },
    ],
  },
  {
    field: 'padding',
    label: '여백',
    options: [
      { key: 'narrow', label: '좁게' },
      { key: 'normal', label: '보통' },
      { key: 'wide', label: '넓게' },
    ],
  },
  {
    field: 'shadow',
    label: '그림자',
    options: [
      { key: 'none', label: '없음' },
      { key: 'has', label: '있음' },
    ],
  },
]

/** 미리 만든 모양 칸이 그릴 style — 저장될 style 그대로 그리고 여백만 칸에 맞게 줄인다(묶음은 고정이라 한 번만 만든다). */
const PRESET_PREVIEWS = BOX_PRESETS.map((p) => ({ ...p, preview: { ...styleToReact(p.style), padding: '6px 4px' } }))

/**
 * 「상자 꾸미기」 창(WP-1304) — 상자 막대 「꾸미기」 아래에 열린다. 미리 만든 모양(기본·안내·주의·강조)·배경·글자색·테두리·모서리·여백·그림자와
 * 「CSS 로 직접 고치기」. 바꾸면 그 자리에서 상자 style 속성 하나를 바꾸는 거래가 나가 바로 보이고 동료에게도 간다.
 * - 단추는 mousedown 을 막아(keepFocus) 편집기 포커스·상자 통째 선택을 그대로 둔다 — 막대가 사라지지 않게.
 * - Esc 는 창만 닫고 상자 통째 선택으로 돌아간다(편집기·창 어디에 포커스가 있어도 문서 캡처 한곳에서 — 편집기의 Esc 「한 단계 바깥」보다 먼저 받는다).
 * - 보이는 값은 선택 거래마다 다시 읽는다(useEditorState) — 동료가 같은 상자를 꾸며도 따라간다.
 */
export function WikiBoxStylePanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [mode, setMode] = useState<'fields' | 'css'>('fields')
  const box = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      const hit = ed ? selectedBox(ed.state) : null
      return hit ? { pos: hit.pos, style: (hit.node.attrs.style as string | null) ?? null } : null
    },
  })

  const panelRef = useRef<HTMLDivElement>(null)

  // Esc — 편집기에 포커스가 있을 때(편집기의 상자 Esc 「바깥으로」보다 먼저)와 창 안 단추에 포커스가 있을 때(키보드 Tab) 모두
  // 문서 캡처 단계 한곳에서 받아 창만 닫는다. 「CSS 로 직접 고치기」 칸(textarea)의 Esc 는 칸이 받아 항목 화면으로만 돌아가게 둔다.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || !(e.target instanceof Node)) return
      if (e.target instanceof HTMLTextAreaElement) return
      if (!editor.view.dom.contains(e.target) && !panelRef.current?.contains(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [editor, onClose])

  if (!box) return null
  const fields = parseBoxStyle(box.style)
  const change = (c: BoxStyleChange) => writeSelectedBoxStyle(editor, (style) => applyBoxStyle(style, c))
  const backToFields = () => {
    setMode('fields')
    editor.view.focus()
  }

  return (
    <div
      role="dialog"
      aria-label="상자 꾸미기"
      ref={panelRef}
      data-testid="wiki-box-style-panel"
      className="absolute top-full left-0 z-10 mt-1 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
    >
      <p className="text-sm font-semibold">상자 꾸미기</p>
      {mode === 'css' ? (
        <WikiStyleTextForm
          initial={styleToEditableText(box.style)}
          label="이 상자의 CSS"
          testId="wiki-box-style-css"
          onApply={(text) => {
            // 정리·빈 style 자리 지킴은 저장하는 한곳(writeSelectedBoxStyle)이 하고, 칸에는 실제로 저장된 글자를 다시 보여 준다.
            const stored = writeSelectedBoxStyle(editor, () => text)
            if (stored === null) return null
            return { text: styleToEditableText(stored), note: removedNote(removedDeclCount(text)) }
          }}
          // 취소·적용 모두 항목 화면으로 돌아가며 편집기에 포커스를 돌린다 — 칸이 사라지면 포커스가 body 로 떨어져 Esc·Enter 가 먹지 않는다.
          onCancel={backToFields}
          onDone={backToFields}
        />
      ) : (
        <>
          <div role="group" aria-label="미리 만든 모양" className="grid grid-cols-4 gap-1.5">
            {PRESET_PREVIEWS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={fields.preset === p.key}
                data-testid={`wiki-box-style-preset-${p.key}`}
                onMouseDown={keepFocus}
                onClick={() => change({ field: 'preset', value: p.key })}
                className={cn('rounded-md p-0.5 text-xs', fields.preset === p.key && 'ring-2 ring-ring')}
              >
                <span className="block truncate text-center" style={p.preview}>
                  {p.label}
                </span>
              </button>
            ))}
          </div>
          <Swatches field="background" value={fields.background} onPick={(v) => change({ field: 'background', value: v })} />
          <Swatches field="color" value={fields.color} onPick={(v) => change({ field: 'color', value: v })} />
          {SEGMENT_ROWS.map((row) => (
            <Segmented
              key={row.field}
              label={row.label}
              name={row.field}
              options={row.options}
              value={fields[row.field]}
              // 표가 항목별 값 키를 검사하므로 여기서는 항목·값 짝을 바꾸기 하나로 넘긴다.
              onPick={(v) => change({ field: row.field, value: v } as BoxStyleChange)}
            />
          ))}
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto self-start p-0 text-xs"
            data-testid="wiki-box-style-css-open"
            onMouseDown={keepFocus}
            onClick={() => setMode('css')}
          >
            CSS 로 직접 고치기 →
          </Button>
        </>
      )}
    </div>
  )
}
