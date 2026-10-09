import { type Editor, posToDOMRect } from '@tiptap/core'
import { ExternalLink, Pencil, Unlink } from 'lucide-react'
import { useState } from 'react'

import { EditorFloatingToolbar } from '@/components/editor/EditorFloatingToolbar'
import { Button } from '@/components/ui/button'

import { linkAtCaret } from './wikiLinkRange'
import { displayLinkHref, openableHref } from './wikiLinkUrl'

const BUBBLE_TEST_ID = 'wiki-link-bubble'
const BUBBLE_SELECTOR = `[data-testid="${BUBBLE_TEST_ID}"]`

/** 포커스가 링크 버블 안에 있는지. */
function focusInBubble(): boolean {
  return document.activeElement?.closest(BUBBLE_SELECTOR) != null
}

/** 떠 있는 링크 버블의 첫 버튼으로 포커스를 옮긴다(에디터의 Alt+F10). 버블이 없으면 false. */
// eslint-disable-next-line react-refresh/only-export-components
export function focusLinkBubble(): boolean {
  const first = document.querySelector<HTMLElement>(`${BUBBLE_SELECTOR}:not([hidden]) :is(a, button)`)
  first?.focus()
  return first != null
}

/**
 * 링크 버블(WP-312, 데스크톱) — 커서가 링크 안이면 주소·열기·고치기·해제. 편집 중엔 클릭으로 링크를 열지 않으므로(WP-300) 여는 길이다.
 * AI 선택 툴바(비어 있지 않은 선택)와 겹치지 않고, 터치 셸은 시트를 쓴다(disabled). canModify=false 면 열기만.
 * 키보드: Alt+F10 으로 들어와(focusLinkBubble) Tab 으로 옮기고 Esc 로 본문에 돌아간다 — 포커스가 안에 있으면 숨기지 않는다.
 * 위치: 링크 범위 top-start, 위에 자리가 없으면(첫 줄) 아래로. 경계는 본문이라 제목·사이드바를 침범하지 않는다.
 */
export function WikiLinkBubble({
  editor,
  disabled,
  suppressed,
  canModify,
  onEdit,
  onUnlink,
}: {
  editor: Editor | null
  disabled: boolean
  /** 링크 주소 입력이 열린 동안 표면을 감춘다. */
  suppressed: boolean
  canModify: boolean
  onEdit: () => void
  onUnlink: () => void
}) {
  // 포커스가 버블 안인지 — 키보드로 들어와 에디터가 포커스를 잃어도 감추지 않는다.
  const [focusWithin, setFocusWithin] = useState(false)
  if (!editor) return null
  const rawHref = linkAtCaret(editor.state)?.href ?? ''
  const href = openableHref(rawHref)

  return (
    <EditorFloatingToolbar
      editor={editor}
      // AI·표 툴바와 상태를 덮어쓰지 않게 고유 키.
      pluginKey="wikiLinkBubble"
      // 링크 안 커서 + 편집 가능 + 포커스가 에디터나 버블 안(다른 곳에 포커스가 있을 때 원격 편집으로 떠오르지 않게).
      shouldShow={({ editor: ed, state }) =>
        !disabled && ed.isEditable && linkAtCaret(state) != null && (ed.view.hasFocus() || focusInBubble())
      }
      // 커서 좌표가 아니라 링크 범위에 붙는다.
      getReferenceClientRect={() => {
        const r = linkAtCaret(editor.state)
        return r ? posToDOMRect(editor.view, r.from, r.to) : null
      }}
      placement="top-start"
      boundary={editor.view.dom}
      ariaLabel="링크"
      testId={BUBBLE_TEST_ID}
      // 포커스가 에디터·버블 밖이면 감춘다(버튼 클릭 직후 blur 는 tiptap 이 숨기지 않는다).
      suppressed={suppressed || (!editor.isFocused && !focusWithin)}
    >
      {/* 포커스 추적·Esc 복귀용 래퍼 — display:contents 라 툴바의 가로 배치에 끼어들지 않는다. */}
      <div
        className="contents"
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false)
        }}
        onKeyDown={(e) => {
          // Esc — 버블에서 본문(링크 안 커서)으로 돌아간다.
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            editor.commands.focus()
          }
        }}
      >
        {/* 주소는 식별자라 code-inline(text-sm font-mono, 승인 시안 WP-312) — 긴 주소는 한 줄로 자르고 전체는 title 로 본다. */}
        <span
          data-testid="wiki-link-bubble-url"
          title={displayLinkHref(rawHref)}
          className="max-w-60 truncate px-1.5 font-mono text-sm text-muted-foreground"
        >
          {displayLinkHref(rawHref)}
        </span>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        {href && (
          <Button asChild type="button" variant="ghost" size="xs">
            {/* 새 탭 + opener 차단(열린 페이지가 이 탭을 조작하지 못하게) — 보기 전용 렌더와 같은 속성. */}
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="wiki-link-open"
              onMouseDown={(e) => e.preventDefault()}
            >
              <ExternalLink aria-hidden="true" />
              열기
            </a>
          </Button>
        )}
        {canModify && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="wiki-link-edit"
              // mousedown 기본동작 차단 — 클릭이 에디터 선택을 잃지 않게 한다.
              onMouseDown={(e) => e.preventDefault()}
              onClick={onEdit}
            >
              <Pencil aria-hidden="true" />
              고치기
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-testid="wiki-link-unlink"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onUnlink}
            >
              <Unlink aria-hidden="true" />
              해제
            </Button>
          </>
        )}
      </div>
    </EditorFloatingToolbar>
  )
}
