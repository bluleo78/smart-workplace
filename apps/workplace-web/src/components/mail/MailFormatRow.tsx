/**
 * 메일 작성 서식 둘째 줄(WP-1524) — 데스크톱(dock·fill) 작성창의 「서식」 토글이 여는 줄.
 * 묶음: [글꼴 · 크기 · 밑줄 · 글자색 · 배경색] | [정렬 · 내어쓰기 · 들여쓰기 · 줄 간격] | [표 넣기 · 서식 지우기].
 *
 * 모든 단추·메뉴 트리거는 누를 때 편집기 초점을 뺏지 않는다(onMouseDown preventDefault) — 선택 범위를 지킨 채 서식을 건다.
 * 메뉴·팝오버를 닫을 때 초점을 트리거로 돌려보내지 않는다(onCloseAutoFocus preventDefault) — 명령이 chain().focus() 로
 * 편집기에 초점을 돌려 둔 뒤 Radix 가 트리거로 다시 옮기면 편집기 선택 강조가 사라진다(노트 서식 막대와 같은 처리).
 */
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import {
  Baseline,
  Check,
  ChevronDown,
  Highlighter,
  ListIndentDecrease,
  ListIndentIncrease,
  RemoveFormatting,
  Table,
  Underline,
  UnfoldVertical,
} from 'lucide-react'
import { type ComponentProps, type ReactNode, useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/overlay/popover'
import { Separator } from '@/components/ui/separator'
import {
  MAIL_ALIGNS,
  MAIL_COLORS,
  MAIL_FONT_SIZES,
  MAIL_FONTS,
  MAIL_LINE_HEIGHTS,
  type MailLineHeight,
} from '@/lib/mailFormat'
import { ghostToggleClass } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'

import { readMailFormatState } from './mailFormatExtensions'
import { ALIGN_ICONS, keepEditorFocus, MAIL_BOXED_ROW_CLASS, MAIL_COLOR_KINDS, toggleLineHeight } from './mailFormatUi'
import { insertMailTable, MAIL_TABLE_GRID_MAX } from './mailTable'
import { MailTableGridPicker } from './MailTableGridPicker'
import { ToolbarButton } from './MailToolbarButton'

/**
 * 메뉴·팝오버 트리거 단추 — ToolbarButton 과 같은 모양·초점 지키기. Radix Trigger(asChild)가 넘기는 props 를 그대로 받는다.
 * open 이면 눌린 모양으로 칠해 지금 열린 메뉴를 보인다.
 */
function TriggerButton({ className, children, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      onMouseDown={(e) => {
        props.onMouseDown?.(e)
        e.preventDefault()
      }}
      className={cn(
        'flex items-center gap-0.5 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-4',
        ghostToggleClass(props['aria-expanded'] === true),
        className,
      )}
    >
      {children}
    </button>
  )
}

/** 메뉴 항목 앞 체크 자리 — 지금 값에만 ✓, 나머지는 같은 폭을 비워 줄을 맞춘다. */
function CheckSlot({ on }: { on: boolean }) {
  return <Check className={cn('size-3.5', on ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
}

/** 색 메뉴 종류별 고정 값 — 공용 색 종류(이름·16진 필드)에 단추 아이콘을 더한다. */
const COLOR_MENUS = {
  color: { ...MAIL_COLOR_KINDS.color, icon: Baseline },
  background: { ...MAIL_COLOR_KINDS.background, icon: Highlighter },
} as const

/**
 * 색 고르기 메뉴 — 「기본」(선언 지움) + 팔레트 7색 = 8칸. 항목 이름은 「글자색 빨강」처럼 메뉴 이름 + 색 이름.
 * 견본 칸만 16진값을 인라인 배경으로 그린다(보내는 메일과 같은 색을 미리 보이려는 예외).
 */
function ColorMenu({
  kind,
  current,
  onPick,
}: {
  kind: keyof typeof COLOR_MENUS
  current: string | null
  onPick: (hex: string | null) => void
}) {
  const { label, icon: Icon, field } = COLOR_MENUS[kind]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TriggerButton aria-label={label} title={label}>
          <Icon />
        </TriggerButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={keepEditorFocus}>
        <DropdownMenuItem aria-label={`${label} 기본`} onSelect={() => onPick(null)}>
          <CheckSlot on={current === null} />
          <span aria-hidden="true" className="size-4 rounded-sm border bg-background" />
          기본
        </DropdownMenuItem>
        {MAIL_COLORS.map((c) => {
          const hex = c[field]
          return (
            <DropdownMenuItem key={c.key} aria-label={`${label} ${c.label}`} onSelect={() => onPick(hex)}>
              <CheckSlot on={current === hex} />
              <span aria-hidden="true" className="size-4 rounded-sm border" style={{ backgroundColor: hex }} />
              {c.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * 하나를 고르는 메뉴(글꼴·크기·정렬·줄 간격) — 지금 값을 menuitemradio 의 체크로 보인다.
 * 항목은 onSelect 로 직접 건다 — RadioGroup 의 onValueChange 는 같은 값을 다시 고르면 부르지 않기 때문이다(줄 간격 끄기에 필요).
 */
function ChoiceMenu<T extends string>({
  label,
  trigger,
  current,
  options,
  onPick,
}: {
  label: string
  trigger: ReactNode
  current: T | null
  options: readonly { value: T; label: string; style?: React.CSSProperties; icon?: ReactNode }[]
  onPick: (value: T) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TriggerButton aria-label={label} title={label}>
          {trigger}
        </TriggerButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={keepEditorFocus}>
        <DropdownMenuRadioGroup value={current ?? ''}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} style={o.style} onSelect={() => onPick(o.value)}>
              {o.icon}
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 글꼴 메뉴 항목 — 각 항목을 그 글꼴로 그린다(기본은 작성창 글꼴 그대로). */
const FONT_OPTIONS = MAIL_FONTS.map((f) => ({
  value: f.key,
  label: f.label,
  style: f.css ? { fontFamily: f.css } : undefined,
}))

/** 크기 메뉴 항목 — 각 항목을 그 px 로 그린다(보통은 작성창 기본 크기). */
const SIZE_OPTIONS = MAIL_FONT_SIZES.map((s) => ({
  value: s.key,
  label: s.label,
  style: s.px !== null ? { fontSize: `${s.px}px` } : undefined,
}))

/** 정렬 메뉴 항목 — 아이콘 + 이름. */
const ALIGN_OPTIONS = MAIL_ALIGNS.map((a) => {
  const Icon = ALIGN_ICONS[a.value]
  return { value: a.value, label: a.label, icon: <Icon aria-hidden="true" /> }
})

/** 줄 간격 메뉴 항목 — 값 글자 그대로. */
const LINE_HEIGHT_OPTIONS = MAIL_LINE_HEIGHTS.map((v) => ({ value: v, label: v }))

/** 묶음 사이 세로 구분선. */
function GroupSeparator() {
  return <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />
}

/**
 * 데스크톱 서식 둘째 줄. 커서 자리 서식은 useEditorState 로 구독해(readMailFormatState 결과가 바뀔 때만 다시 그림)
 * 트리거 글자(지금 글꼴·크기)·체크·내어쓰기 가능 여부에 반영한다.
 */
export function MailFormatRow({ editor, layout, id }: { editor: Editor; layout: 'dock' | 'fill'; id?: string }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({ ...readMailFormatState(ed), underline: ed.isActive('underline') }),
  })
  // 표 격자 팝오버 열림 — 표를 넣으면 닫는다.
  const [tableOpen, setTableOpen] = useState(false)

  const fontLabel = MAIL_FONTS.find((f) => f.key === state.font)?.label ?? '기본'
  const sizeLabel = MAIL_FONT_SIZES.find((s) => s.key === state.size)?.label ?? '보통'
  const AlignIcon = ALIGN_ICONS[state.align]

  return (
    <div id={id} data-testid="mail-composer-format-row" className={MAIL_BOXED_ROW_CLASS}>
      {/* 글자 묶음 */}
      <ChoiceMenu
        label="글꼴"
        trigger={
          <>
            <span className="max-w-24 truncate text-xs">{fontLabel}</span>
            <ChevronDown />
          </>
        }
        current={state.font}
        options={FONT_OPTIONS}
        onPick={(key) => editor.chain().focus().setMailFont(key).run()}
      />
      <ChoiceMenu
        label="글자 크기"
        trigger={
          <>
            <span className="text-xs">{sizeLabel}</span>
            <ChevronDown />
          </>
        }
        current={state.size}
        options={SIZE_OPTIONS}
        onPick={(key) => editor.chain().focus().setMailFontSize(key).run()}
      />
      <ToolbarButton
        label="밑줄"
        title="밑줄"
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline />
      </ToolbarButton>
      <ColorMenu kind="color" current={state.color} onPick={(hex) => editor.chain().focus().setMailColor(hex).run()} />
      <ColorMenu
        kind="background"
        current={state.background}
        onPick={(hex) => editor.chain().focus().setMailBackground(hex).run()}
      />

      <GroupSeparator />

      {/* 문단 묶음 */}
      <ChoiceMenu
        label="정렬"
        trigger={<AlignIcon />}
        current={state.align}
        options={ALIGN_OPTIONS}
        onPick={(v) => editor.chain().focus().setTextAlign(v).run()}
      />
      <ToolbarButton
        label="내어쓰기"
        title="내어쓰기"
        disabled={!state.canOutdent}
        onClick={() => editor.chain().focus().outdentMail().run()}
      >
        <ListIndentDecrease />
      </ToolbarButton>
      <ToolbarButton label="들여쓰기" title="들여쓰기" onClick={() => editor.chain().focus().indentMail().run()}>
        <ListIndentIncrease />
      </ToolbarButton>
      <ChoiceMenu<MailLineHeight>
        label="줄 간격"
        trigger={<UnfoldVertical />}
        current={state.lineHeight}
        options={LINE_HEIGHT_OPTIONS}
        // 지금 값을 다시 고르면 선언을 지운다(「선택 안 함 = 선언 없음」으로 돌아가는 길).
        onPick={(v) => editor.chain().focus().setMailLineHeight(toggleLineHeight(v, state.lineHeight)).run()}
      />

      <GroupSeparator />

      {/* 표·지우기 묶음 */}
      <Popover open={tableOpen} onOpenChange={setTableOpen}>
        <PopoverTrigger asChild>
          <TriggerButton aria-label="표 넣기" title="표 넣기">
            <Table />
          </TriggerButton>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0" onCloseAutoFocus={keepEditorFocus}>
          <MailTableGridPicker
            max={MAIL_TABLE_GRID_MAX[layout]}
            touch={false}
            onPick={(rows, cols) => {
              insertMailTable(editor, rows, cols)
              setTableOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      <ToolbarButton label="서식 지우기" title="서식 지우기" onClick={() => editor.chain().focus().clearMailFormat().run()}>
        <RemoveFormatting />
      </ToolbarButton>
    </div>
  )
}
