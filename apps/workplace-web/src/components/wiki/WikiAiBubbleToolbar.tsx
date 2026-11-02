// Radix 원본을 직접 쓴다(아래 InlineMenuContent 주석 — 포털 없이 툴바 안에 그려야 tiptap 블러 숨김을 피한다). 공용 래퍼의 탭바 피하기는
// 필요 없다: 이 툴바는 노트 페이지 편집기(상세 화면)에만 떠 휴대폰 하단 탭바가 없는 화면이다(WP-806).
// eslint-disable-next-line no-restricted-imports
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { type Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import {
  Baseline,
  Bold,
  Check,
  ChevronDown,
  Highlighter,
  Italic,
  Link,
  SquareDashed,
  Strikethrough,
  Underline,
} from 'lucide-react'
import type { ComponentProps, ComponentType, ReactNode } from 'react'

import { AiLabel } from '@/components/ai/AiLabel'
import { EditorFloatingToolbar, EditorToolbarDivider } from '@/components/editor/EditorFloatingToolbar'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { Button } from '@/components/ui/button'
import { shortcutKeys } from '@/lib/platform'
import { ghostToggleClass } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'

import { LANGUAGE_PRESETS, TONE_PRESETS, TRANSFORM_ACTIONS, type TransformActionKey } from './wikiAiActions'
import { canWrapInBox, wrapInBox } from './wikiBox'
import { WIKI_TABLE_ALIGNS } from './wikiTableCommands'
import {
  type BlockSize,
  type ColorProp,
  colorValue,
  colorVar,
  currentBlockSize,
  FORMAT_COLORS,
  type SelectionFormat,
  selectionFormat,
  setBlockSize,
  setFormatColor,
  setTextAlign,
  toggleUnderline,
} from './wikiTextFormat'

// 단축키 표기 — macOS 계열은 ⌘·⇧, 그 밖은 Ctrl+·Shift+(lib/platform 의 shortcutKeys 한 곳에서 판정).
const { mod: MOD, shift: SHIFT } = shortcutKeys()

// 글자 모양 묶음(WP-1305) — 굵게·기울임·밑줄·취소선. 굵게·기울임·취소선은 마크다운 마크, 밑줄은 서식 span(wikiTextFormat.ts).
// 단축키 표시는 title 로 — StarterKit 기본(⌘B·⌘I·⌘⇧S)과 WikiTextFormatKeys(⌘U). 밑줄 눌림은 툴바가 한 번 계산한 선택 서식(fmt)을 쓴다.
const MARK_ACTIONS = [
  { key: 'bold', label: '굵게', shortcut: `${MOD}B`, icon: Bold, isActive: (e: Editor) => e.isActive('bold'), run: (e: Editor) => e.chain().focus().toggleBold().run() },
  { key: 'italic', label: '기울임', shortcut: `${MOD}I`, icon: Italic, isActive: (e: Editor) => e.isActive('italic'), run: (e: Editor) => e.chain().focus().toggleItalic().run() },
  { key: 'underline', label: '밑줄', shortcut: `${MOD}U`, icon: Underline, isActive: (_e: Editor, fmt: SelectionFormat) => fmt.underline, run: (e: Editor) => e.chain().focus().command(toggleUnderline).run() },
  { key: 'strike', label: '취소선', shortcut: `${MOD}${SHIFT}S`, icon: Strikethrough, isActive: (e: Editor) => e.isActive('strike'), run: (e: Editor) => e.chain().focus().toggleStrike().run() },
] as const

/** 메뉴 선택지 하나 — 값·글·testid 꼬리(key)·앞 아이콘(선택). 크기·정렬 메뉴가 함께 쓴다(ChoiceMenu). */
interface Choice<T> {
  value: T
  key: string
  label: string
  icon?: ComponentType<{ 'aria-hidden'?: boolean | 'true' }>
}

/** 글자 크기 메뉴 — 본문·제목1~3. 정렬은 그대로 옮긴다(setBlockSize). */
const SIZE_OPTIONS: readonly Choice<BlockSize>[] = [
  { value: 'paragraph', key: 'paragraph', label: '본문' },
  { value: 1, key: 'heading1', label: '제목1' },
  { value: 2, key: 'heading2', label: '제목2' },
  { value: 3, key: 'heading3', label: '제목3' },
]

/** 정렬 메뉴 — 표 열 정렬과 같은 선택지(왼쪽은 속성을 지우는 null)·글·아이콘을 그대로 쓴다. */
const ALIGN_OPTIONS = WIKI_TABLE_ALIGNS

/** 메뉴 트리거 버튼 — 클릭이 에디터 선택을 잃지 않게 mousedown 기본 동작을 막는다. */
function TriggerButton({ className, children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className={cn('gap-0.5 px-1.5', className)}
      onMouseDown={(e) => e.preventDefault()}
      {...props}
    >
      {children}
      <ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
    </Button>
  )
}

/**
 * 툴바 안에 그리는 메뉴 내용 — shadcn 의 DropdownMenuContent 대신 Radix Content 를 **portal 없이** 인라인으로 쓴다.
 * tiptap BubbleMenuPlugin 의 blurHandler 는 `element.parentNode.contains(relatedTarget)` 일 때만 hide 를 건너뛴다. shadcn Content 는
 * Portal 을 하드코딩해 body 로 나가므로, 메뉴가 열리며 포커스를 받는 순간 editor blur 의 relatedTarget 이 툴바 밖이 되어 tippy 가 hide →
 * popper 를 DOM 에서 제거 → Radix 가 앵커(트리거)를 잃고 메뉴를 0×0@(0,0) 기준으로 좌측 상단에 그렸다. 툴바 안에 렌더하면 blur-hide 가
 * 안 걸린다. Content 는 position:fixed 라 툴바 안에 있어도 잘리지 않는다. 하위 메뉴(DropdownMenuSubContent)도 포털 없이 그려진다.
 * className 은 shadcn DropdownMenuContent(components/ui/dropdown-menu.tsx)와 같게 유지한다.
 * onCloseAutoFocus 를 막는다 — 메뉴를 닫을 때 포커스가 트리거로 돌아가면 에디터가 포커스를 잃어 선택 강조가 사라진다(명령은 focus() 로 되돌린다).
 */
function InlineMenuContent({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <DropdownMenuPrimitive.Content
      data-slot="dropdown-menu-content"
      data-testid={testId}
      align="start"
      sideOffset={4}
      onCloseAutoFocus={(e) => e.preventDefault()}
      className={cn(
        'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md',
        className,
      )}
    >
      {children}
    </DropdownMenuPrimitive.Content>
  )
}

/** 메뉴 항목 앞 체크 자리 — 고른 값에만 ✓ 를 그리고, 나머지는 같은 폭을 비워 글자가 줄 맞게 둔다. */
function CheckSlot({ on }: { on: boolean }) {
  return <Check className={cn('size-3.5', on ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
}

/**
 * 선택지 메뉴(크기·정렬) — 트리거 + 고른 값에 ✓ 를 단 항목 목록. testid 는 wiki-format-<name>-menu·wiki-format-<name>-<key>.
 */
function ChoiceMenu<T>({
  name,
  options,
  current,
  onSelect,
  trigger,
}: {
  name: string
  options: readonly Choice<T>[]
  current: T | null
  onSelect: (value: T) => void
  trigger: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <InlineMenuContent testId={`wiki-format-${name}-menu`}>
        {options.map((o) => (
          <DropdownMenuItem key={o.key} data-testid={`wiki-format-${name}-${o.key}`} onSelect={() => onSelect(o.value)}>
            <CheckSlot on={current === o.value} />
            {o.icon && <o.icon aria-hidden="true" />}
            {o.label}
          </DropdownMenuItem>
        ))}
      </InlineMenuContent>
    </DropdownMenu>
  )
}

/** 색 메뉴 종류별 고정 값 — 글·testid 꼬리·견본 style 이 쓰는 CSS 속성. 견본 변수 이름은 colorVar 한 곳에서 만든다. */
const COLOR_MENUS: Record<ColorProp, { label: string; testId: string; swatch: 'color' | 'backgroundColor' }> = {
  color: { label: '글자색', testId: 'color', swatch: 'color' },
  'background-color': { label: '배경색', testId: 'highlight', swatch: 'backgroundColor' },
}

/**
 * 색 고르기 메뉴(글자색·배경색) — 「기본」(선언 지움) + 색 판. 견본은 화면 테마 변수(--wiki-text-*·--wiki-mark-*)로 그려 다크에서도
 * 실제 본문에 보일 색과 같다. 지금 값(current)은 툴바가 한 번 계산한 선택 서식에서 받는다.
 */
function ColorMenu({ editor, prop, current, trigger }: { editor: Editor; prop: ColorProp; current: string | null; trigger: ReactNode }) {
  const { label, testId, swatch } = COLOR_MENUS[prop]
  const apply = (value: string | null) => editor.chain().focus().command(setFormatColor(prop, value)).run()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <TriggerButton aria-label={label} title={label} data-testid={`wiki-format-tb-${testId}`}>
          {trigger}
        </TriggerButton>
      </DropdownMenuTrigger>
      <InlineMenuContent testId={`wiki-format-${testId}-menu`}>
        <DropdownMenuItem data-testid={`wiki-format-${testId}-default`} onSelect={() => apply(null)}>
          <CheckSlot on={current === null} />
          기본
        </DropdownMenuItem>
        {FORMAT_COLORS.map((c) => {
          const value = colorValue(prop, c)
          return (
            <DropdownMenuItem key={c.key} data-testid={`wiki-format-${testId}-${c.key}`} onSelect={() => apply(value)}>
              <CheckSlot on={current === value} />
              {/* 견본 — 글자색은 그 색 「가」, 배경색은 그 배경 위 「가」. 색은 테마 변수(토큰)라 hex 를 쓰지 않는다. */}
              <span
                aria-hidden="true"
                className="inline-flex size-5 items-center justify-center rounded-sm border text-xs font-semibold"
                style={{ [swatch]: `var(${colorVar(prop, c)})` }}
              >
                가
              </span>
              {c.label}
            </DropdownMenuItem>
          )
        })}
      </InlineMenuContent>
    </DropdownMenu>
  )
}

/** 선택 텍스트 서식·AI 변형 툴바(WP-1305 개편) — 비어있지 않은 선택에서 선택영역 위에 표시(tiptap BubbleMenu).
 *  묶음: 굵게·기울임·밑줄·취소선 | 크기 ▾ · 글자색 ▾ · 배경 ▾ · 정렬 ▾ | 링크 · 상자로 감싸기 | ✦ AI ▾ | 이슈로 만들기.
 *  AI 다듬기(톤·번역·확장·축약·다듬기)는 「✦ AI」 메뉴 안에 있고 동작은 전과 같다(onAction).
 *  disabled(뷰어/생성 중)면 아예 렌더하지 않는다. 터치 셸에서도 뜬다 — 휴대폰에서 링크를 거는 유일한 길이다(링크 버블만 터치에서 끈다).
 *  onCreateIssue: EDITOR 권한 사용자가 선택 텍스트를 이슈로 만들 때 호출된다.
 *  onLink: 선택 텍스트에 링크를 걸거나 고치는 주소 입력을 연다(WP-312). 입력이 열린 동안엔 suppressed 로 툴바를 숨긴다. */
export function WikiAiBubbleToolbar({
  editor,
  disabled,
  onAction,
  onCreateIssue,
  onLink,
  suppressed = false,
  aiHidden = false,
}: {
  editor: Editor | null
  disabled: boolean
  onAction: (action: TransformActionKey, param?: string) => void
  onCreateIssue?: () => void
  onLink?: () => void
  /** 링크 주소 입력이 열린 동안 표면을 감춘다(WP-312). */
  suppressed?: boolean
  /** AI 변형 메뉴를 감춘다 — 공유 링크로 연 편집 화면(WP-579 「하지 않는 것」). 서식·링크는 남는다. */
  aiHidden?: boolean
}) {
  if (!editor) return null

  // 선택 서식은 그릴 때마다 한 번만 훑는다 — 밑줄 눌림·색 메뉴 체크·정렬 메뉴가 같은 결과를 나눠 쓴다.
  const fmt = selectionFormat(editor.state)
  const size = currentBlockSize(editor.state)
  const sizeLabel = SIZE_OPTIONS.find((o) => o.value === size)?.label ?? '크기'
  const alignOption = ALIGN_OPTIONS.find((o) => o.value === fmt.align) ?? ALIGN_OPTIONS[0]
  const AlignIcon = alignOption.icon
  const linkActive = editor.isActive('link')

  return (
    <EditorFloatingToolbar
      editor={editor}
      // AI 툴바와 표 툴바가 한 에디터에 공존하므로 키를 분리한다(기본 키 공유 시 서로를 덮어쓴다).
      pluginKey="wikiAiBubble"
      // 선택이 비어있지 않을 때만. 표 툴바는 selection.empty 일 때만 뜨므로 두 술어는 상호배타다.
      // 기본 shouldShow 를 쓰면 메뉴가 열리는 순간 hasEditorFocus 가 false 가 되어 툴바가 사라지므로 이 override 는 필수다.
      // 이미지 등 노드를 클릭하면 비어있지 않은 NodeSelection 이 생기는데, 이 툴바의 동작은 텍스트 전용이므로 NodeSelection 일 때는 제외한다.
      // (전체선택 Ctrl+A 는 AllSelection 이라 TextSelection 이 아니므로, instanceof TextSelection 요구는 전체선택 변형을 깨뜨린다.)
      shouldShow={({ editor: ed, state }) =>
        !disabled && !state.selection.empty && !(state.selection instanceof NodeSelection) && ed.isEditable
      }
      ariaLabel="글자 서식"
      testId="wiki-ai-toolbar"
      suppressed={suppressed}
    >
      {/* 글자 모양 — 굵게·기울임·밑줄·취소선. 누름 상태는 선택 글자 전체 기준. */}
      {MARK_ACTIONS.map(({ key, label, shortcut, icon: Icon, isActive, run }) => {
        const active = isActive(editor, fmt)
        return (
          <Button
            key={key}
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            title={`${label} (${shortcut})`}
            aria-pressed={active}
            data-testid={`wiki-format-tb-${key}`}
            className={ghostToggleClass(active)}
            // mousedown 기본동작 차단 — 클릭이 에디터 선택을 잃지 않게 한다.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(editor)}
          >
            <Icon aria-hidden="true" />
          </Button>
        )
      })}
      <EditorToolbarDivider />
      {/* 크기 — 본문·제목1~3. 트리거에 지금 크기를 보인다(목록 안 등 그 밖 블록이면 「크기」). */}
      <ChoiceMenu
        name="size"
        options={SIZE_OPTIONS}
        current={size}
        onSelect={(value) => editor.chain().focus().command(setBlockSize(value)).run()}
        trigger={
          <TriggerButton aria-label={`글자 크기: ${sizeLabel}`} data-testid="wiki-format-tb-size">
            <span className="min-w-[2.5rem] text-left">{sizeLabel}</span>
          </TriggerButton>
        }
      />
      {/* 글자색 — 「A」 밑 막대가 지금 색(섞였거나 기본이면 글자색 그대로). */}
      <ColorMenu
        editor={editor}
        prop="color"
        current={fmt.color}
        trigger={
          <Baseline
            aria-hidden="true"
            // 아이콘 밑줄 획까지 현재 색으로 — lucide Baseline 은 「A」+ 밑 막대 한 벌이라 색을 통째 입힌다.
            style={fmt.color ? { color: fmt.color } : undefined}
          />
        }
      />
      <ColorMenu editor={editor} prop="background-color" current={fmt.background} trigger={<Highlighter aria-hidden="true" />} />
      {/* 정렬 — 문서·인용·상자 바로 안 문단·제목에만(공용 canAlignIn — 표는 셀 정렬 메뉴가 따로 있고, 목록 항목 안은 막는다). */}
      {fmt.canAlign && (
        <ChoiceMenu
          name="align"
          options={ALIGN_OPTIONS}
          current={fmt.align}
          onSelect={(value) => editor.chain().focus().command(setTextAlign(value)).run()}
          trigger={
            <TriggerButton aria-label={`정렬: ${alignOption.label}`} title="정렬" data-testid="wiki-format-tb-align">
              <AlignIcon aria-hidden="true" />
            </TriggerButton>
          }
        />
      )}
      <EditorToolbarDivider />
      {/* 링크 — 선택 범위에 링크를 걸고(이미 링크면 주소를 고친다) ⌘K/Ctrl+K 와 같은 입력을 연다(WP-312). */}
      {onLink && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="링크"
          title={`링크 (${MOD}K)`}
          aria-pressed={linkActive}
          data-testid="wiki-format-tb-link"
          className={ghostToggleClass(linkActive)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onLink}
        >
          <Link aria-hidden="true" />
        </Button>
      )}
      {/* 상자로 감싸기(WP-1303) — 고른 글이 걸친 블록들을 「기본」 모양 상자로 감싼다. 감쌀 수 없는 자리(표 안 등)면 두지 않는다.
          감싼 뒤엔 상자가 통째 선택돼 이 막대 대신 상자 막대가 뜬다. */}
      {canWrapInBox(editor.state) && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="상자로 감싸기"
          title="상자로 감싸기"
          data-testid="wiki-format-tb-box"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            wrapInBox(editor.state, editor.view.dispatch)
            editor.view.focus()
          }}
        >
          <SquareDashed aria-hidden="true" />
        </Button>
      )}
      {/* ✦ AI 메뉴 — 톤·번역(하위 메뉴로 프리셋)·확장·축약·다듬기. 공유 링크 화면(aiHidden)엔 두지 않는다.
          AI 마커는 트리거에 한 번만 — 메뉴 항목에 Sparkles 를 반복하지 않는다(마커 중첩 금지). */}
      {!aiHidden && (
        <>
          <EditorToolbarDivider />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <TriggerButton aria-label="AI 다듬기" data-testid="wiki-ai-tb-menu">
                <AiLabel>AI</AiLabel>
              </TriggerButton>
            </DropdownMenuTrigger>
            <InlineMenuContent testId="wiki-ai-menu">
              {TRANSFORM_ACTIONS.map((a) => {
                if (a.param === null) {
                  return (
                    <DropdownMenuItem key={a.key} data-testid={`wiki-ai-tb-${a.key}`} onSelect={() => onAction(a.key)}>
                      {a.label}
                    </DropdownMenuItem>
                  )
                }
                const presets = a.param === 'tone' ? TONE_PRESETS : LANGUAGE_PRESETS
                const testidPrefix = a.param === 'tone' ? 'wiki-ai-tone' : 'wiki-ai-lang'
                return (
                  <DropdownMenuSub key={a.key}>
                    <DropdownMenuSubTrigger data-testid={`wiki-ai-tb-${a.key}`}>{a.label}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {presets.map((p) => (
                        <DropdownMenuItem key={p.value} data-testid={`${testidPrefix}-${p.value}`} onSelect={() => onAction(a.key, p.value)}>
                          {p.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )
              })}
            </InlineMenuContent>
          </DropdownMenu>
        </>
      )}
      {/* "이슈로 만들기" — EDITOR(onCreateIssue 전달 시)만 노출. AI 메뉴 뒤에 위치. */}
      {onCreateIssue && (
        <>
          <EditorToolbarDivider />
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-testid="wiki-ai-tb-create-issue"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onCreateIssue}
          >
            이슈로 만들기
          </Button>
        </>
      )}
    </EditorFloatingToolbar>
  )
}
