import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { type Editor } from '@tiptap/core'
import { ChevronDown } from 'lucide-react'

import { AiLabel } from '@/components/ai/AiLabel'
import { EditorFloatingToolbar } from '@/components/editor/EditorFloatingToolbar'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

import {
  LANGUAGE_PRESETS,
  TONE_PRESETS,
  TRANSFORM_ACTIONS,
  type TransformActionKey,
} from './wikiAiActions'

/** 선택 텍스트 변형 툴바 — 비어있지 않은 선택에서 선택영역 위에 표시(tiptap BubbleMenu).
 *  param 액션(톤/번역)은 드롭다운으로 프리셋을 고른 뒤, 그 외는 즉시 onAction 을 호출한다.
 *  disabled(뷰어/생성 중)면 아예 렌더하지 않는다.
 *  onCreateIssue: EDITOR 권한 사용자가 선택 텍스트를 이슈로 만들 때 호출된다. */
export function WikiAiBubbleToolbar({
  editor,
  disabled,
  onAction,
  onCreateIssue,
}: {
  editor: Editor | null
  disabled: boolean
  onAction: (action: TransformActionKey, param?: string) => void
  onCreateIssue?: () => void
}) {
  if (!editor) return null

  return (
    <EditorFloatingToolbar
      editor={editor}
      // AI 툴바와 표 툴바가 한 에디터에 공존하므로 키를 분리한다(기본 키 공유 시 서로를 덮어쓴다).
      pluginKey="wikiAiBubble"
      // 선택이 비어있지 않을 때만. 표 툴바는 selection.empty 일 때만 뜨므로 두 술어는 상호배타다.
      // 기본 shouldShow 를 쓰면 톤/번역 드롭다운이 열리는 순간 hasEditorFocus 가 false 가 되어
      // 툴바가 사라지므로 이 override 는 필수다.
      shouldShow={({ editor: ed, state }) => !disabled && !state.selection.empty && ed.isEditable}
      ariaLabel="AI 텍스트 변형"
      testId="wiki-ai-toolbar"
    >
      {/* AI 마커는 컨테이너 레벨에서 1회만 — 내부 버튼에 Sparkles 를 반복하지 않는다(마커 중첩 금지). */}
      <AiLabel className="px-1">AI</AiLabel>
      {TRANSFORM_ACTIONS.map((a) => {
        if (a.param === null) {
          return (
            <Button
              key={a.key}
              type="button"
              variant="ghost"
              size="xs"
              data-testid={`wiki-ai-tb-${a.key}`}
              // mousedown 기본동작 차단 — 클릭이 에디터 선택을 잃지 않게 한다.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onAction(a.key)}
            >
              {a.label}
            </Button>
          )
        }
        const presets = a.param === 'tone' ? TONE_PRESETS : LANGUAGE_PRESETS
        const testidPrefix = a.param === 'tone' ? 'wiki-ai-tone' : 'wiki-ai-lang'
        return (
          <DropdownMenu key={a.key}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                data-testid={`wiki-ai-tb-${a.key}`}
                onMouseDown={(e) => e.preventDefault()}
              >
                {a.label}
                <ChevronDown className="text-muted-foreground" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            {/* shadcn 의 DropdownMenuContent 대신 Radix Content 를 **portal 없이** 인라인으로 쓴다.
                tiptap BubbleMenuPlugin 의 blurHandler 는 `element.parentNode.contains(relatedTarget)`
                일 때만 hide 를 건너뛴다. shadcn Content 는 Portal 을 하드코딩해 body 로 나가므로,
                메뉴가 열리며 포커스를 받는 순간 editor blur 의 relatedTarget 이 툴바 밖이 되어
                tippy 가 hide → popper 를 DOM 에서 제거 → Radix 가 앵커(트리거)를 잃고 메뉴를
                0×0@(0,0) 기준으로 좌측 상단에 그렸다. 툴바 안에 렌더하면 blur-hide 가 아예 안 걸린다.
                Content 는 position:fixed 라 툴바 안에 있어도 클리핑되지 않는다.
                className 은 shadcn DropdownMenuContent(components/ui/dropdown-menu.tsx)와 동일하게 유지한다. */}
            <DropdownMenuPrimitive.Content
              data-slot="dropdown-menu-content"
              align="start"
              sideOffset={4}
              className="bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md"
            >
              {presets.map((p) => (
                <DropdownMenuItem
                  key={p.value}
                  data-testid={`${testidPrefix}-${p.value}`}
                  onSelect={() => onAction(a.key, p.value)}
                >
                  {p.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuPrimitive.Content>
          </DropdownMenu>
        )
      })}
      {/* "이슈로 만들기" — EDITOR(onCreateIssue 전달 시)만 노출. 변형 버튼 뒤에 위치. */}
      {onCreateIssue && (
        <>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
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
