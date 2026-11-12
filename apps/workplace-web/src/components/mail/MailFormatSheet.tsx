/**
 * 모바일 메일 서식판(WP-1524) — 키보드 위 서식 줄의 「서식(Aa)」 단추가 여는 판.
 *
 * Radix Sheet(대화상자)가 아니라 서식 줄 바로 위에 붙는 고정 패널이다 — 대화상자는 초점을 가져가 가상 키보드가 닫히고
 * 본문 선택이 풀린다. 판의 모든 칩은 누를 때 편집기 초점을 뺏지 않아(onMouseDown preventDefault) 키보드·선택이 그대로다.
 *
 * 칸 순서: 첫 칸(자주 쓰는 것) 크기·글자색·정렬·목록, 그 아래 글꼴·배경색·줄 간격·표.
 * 데스크톱 둘째 줄(MailFormatRow)의 메뉴는 가져오지 않는다 — 드롭다운은 손가락으로 두 번 눌러야 하니 값을 칩으로 펼쳐 한 번에 고른다.
 * 색 이름(「글자색 빨강」)·줄 간격 끄기(지금 값 다시 누르기) 규칙은 데스크톱과 같게 맞춘다.
 */
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { List, ListOrdered } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'

import {
  MAIL_ALIGNS,
  MAIL_COLORS,
  MAIL_FONT_SIZES,
  MAIL_FONTS,
  MAIL_LINE_HEIGHTS,
} from '@/lib/mailFormat'
import { TOGGLE_ON_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'

import { readMailFormatState } from './mailFormatExtensions'
import { ALIGN_ICONS, keepEditorFocus, MAIL_COLOR_KINDS, toggleLineHeight } from './mailFormatUi'
import { MAIL_MOBILE_PANEL_CLASS } from './mailMobileBars'
import { insertMailTable, MAIL_TABLE_GRID_MAX } from './mailTable'
import { MailTableGridPicker } from './MailTableGridPicker'

/**
 * 칩 하나 — 44px 터치 대상(min-h-11 min-w-11), 켜짐은 aria-pressed + 토글 색.
 * label 을 주면 그것이 접근 이름(아이콘·견본 칩), 없으면 글자가 이름이다.
 */
function Chip({
  active,
  label,
  style,
  className,
  onClick,
  children,
}: {
  active: boolean
  label?: string
  style?: CSSProperties
  className?: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={keepEditorFocus}
      onClick={onClick}
      style={style}
      className={cn(
        'flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border px-3 text-sm text-foreground [&_svg]:size-5',
        active && TOGGLE_ON_CLASS,
        className,
      )}
    >
      {children}
    </button>
  )
}

/** 판의 한 칸 — role=group + aria-label(칸 제목), 눈에 보이는 작은 제목과 칩 줄. scroll 이면 칩을 한 줄로 두고 가로로 민다. */
function Section({ title, scroll = false, children }: { title: string; scroll?: boolean; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="flex flex-col gap-1.5">
      <div aria-hidden="true" className="text-xs text-muted-foreground">
        {title}
      </div>
      <div className={cn('flex gap-1.5', scroll ? 'overflow-x-auto' : 'flex-wrap')}>{children}</div>
    </div>
  )
}

/** 색 칩 줄 — 「기본」(선언 지움) + 팔레트 7색. 견본만 16진 인라인 배경(보내는 메일 색을 미리 보이는 예외). */
function ColorChips({
  kind,
  current,
  onPick,
}: {
  kind: keyof typeof MAIL_COLOR_KINDS
  current: string | null
  onPick: (hex: string | null) => void
}) {
  const { label, field } = MAIL_COLOR_KINDS[kind]
  return (
    <>
      <Chip active={current === null} label={`${label} 기본`} className="px-0" onClick={() => onPick(null)}>
        <span aria-hidden="true" className="size-6 rounded-sm border bg-background" />
      </Chip>
      {MAIL_COLORS.map((c) => {
        const hex = c[field]
        return (
          <Chip key={c.key} active={current === hex} label={`${label} ${c.label}`} className="px-0" onClick={() => onPick(hex)}>
            <span aria-hidden="true" className="size-6 rounded-sm border" style={{ backgroundColor: hex }} />
          </Chip>
        )
      })}
    </>
  )
}

/**
 * 모바일 서식판. 커서 자리 서식은 useEditorState 로 구독해(readMailFormatState·목록 상태가 바뀔 때만 다시 그림) 칩 눌림에 반영한다.
 * 표를 넣어도 판은 열어 둔다 — 판을 닫는 것은 서식 단추(펼침 기억)의 몫이다.
 */
export function MailFormatSheet({ editor, id }: { editor: Editor; id?: string }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      ...readMailFormatState(ed),
      bulletList: ed.isActive('bulletList'),
      orderedList: ed.isActive('orderedList'),
    }),
  })

  return (
    <div
      id={id}
      data-testid="mail-format-sheet"
      // 칩 사이 빈 곳·제목을 눌러도 본문 초점이 빠지지 않게 판 전체에서도 막는다(표 격자 칸은 자체로 막지 않는다).
      onMouseDown={keepEditorFocus}
      className={cn(MAIL_MOBILE_PANEL_CLASS, 'flex flex-col gap-3 px-3 py-3')}
    >
      {/* 첫 칸 — 자주 쓰는 서식 */}
      <Section title="크기">
        {MAIL_FONT_SIZES.map((s) => (
          <Chip
            key={s.key}
            active={state.size === s.key}
            onClick={() => editor.chain().focus().setMailFontSize(s.key).run()}
          >
            {s.label}
          </Chip>
        ))}
      </Section>
      <Section title="글자색" scroll>
        <ColorChips
          kind="color"
          current={state.color}
          onPick={(hex) => editor.chain().focus().setMailColor(hex).run()}
        />
      </Section>
      <Section title="정렬">
        {MAIL_ALIGNS.map((a) => {
          const Icon = ALIGN_ICONS[a.value]
          return (
            <Chip
              key={a.value}
              active={state.align === a.value}
              label={a.label}
              onClick={() => editor.chain().focus().setTextAlign(a.value).run()}
            >
              <Icon aria-hidden="true" />
            </Chip>
          )
        })}
      </Section>
      <Section title="목록">
        <Chip
          active={state.bulletList}
          label="글머리 목록"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List aria-hidden="true" />
        </Chip>
        <Chip
          active={state.orderedList}
          label="번호 목록"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered aria-hidden="true" />
        </Chip>
      </Section>

      {/* 그 아래 — 덜 쓰는 서식 */}
      <div aria-hidden="true" className="border-t" />
      <Section title="글꼴" scroll>
        {MAIL_FONTS.map((f) => (
          <Chip
            key={f.key}
            active={state.font === f.key}
            // 칩 글자를 그 글꼴로 그려 미리 보인다(기본은 작성창 글꼴 그대로).
            style={f.css ? { fontFamily: f.css } : undefined}
            className="whitespace-nowrap"
            onClick={() => editor.chain().focus().setMailFont(f.key).run()}
          >
            {f.label}
          </Chip>
        ))}
      </Section>
      <Section title="배경색" scroll>
        <ColorChips
          kind="background"
          current={state.background}
          onPick={(hex) => editor.chain().focus().setMailBackground(hex).run()}
        />
      </Section>
      <Section title="줄 간격">
        {MAIL_LINE_HEIGHTS.map((v) => (
          <Chip
            key={v}
            active={state.lineHeight === v}
            // 지금 값을 다시 누르면 선언을 지운다(데스크톱과 같은 「선택 안 함」으로 돌아가는 길).
            onClick={() => editor.chain().focus().setMailLineHeight(toggleLineHeight(v, state.lineHeight)).run()}
          >
            {v}
          </Chip>
        ))}
      </Section>
      <div role="group" aria-label="표">
        {/* 격자가 자기 제목(「표 넣기」)을 그리므로 칸 제목은 따로 두지 않는다. */}
        <MailTableGridPicker
          max={MAIL_TABLE_GRID_MAX.mobile}
          touch
          onPick={(rows, cols) => insertMailTable(editor, rows, cols)}
        />
      </div>
    </div>
  )
}
