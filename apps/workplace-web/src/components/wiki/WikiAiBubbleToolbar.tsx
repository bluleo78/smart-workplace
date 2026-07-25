import { type Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/react'
import { ChevronDown } from 'lucide-react'

import { AiLabel } from '@/components/ai/AiLabel'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
    <BubbleMenu
      editor={editor}
      // 선택이 비어있지 않고 비활성이 아닐 때만 노출. 기본 shouldShow 를 쓰면 톤/번역 드롭다운
      // (Radix — body 로 portal)이 열리는 순간 hasEditorFocus·isChildOfMenu 가 모두 false 가 되어
      // 툴바가 사라지므로 이 override 는 필수다. isEditable 만 추가로 확인한다.
      shouldShow={({ editor: ed, state }) => !disabled && !state.selection.empty && ed.isEditable}
      // updateDelay 0 — 기본 250ms 는 빠른 드래그 선택에서 툴바가 안 뜬 것처럼 느껴진다.
      updateDelay={0}
      tippyOptions={{
        placement: 'top',
        // appendTo 를 명시하지 않으면 tippy 가 interactive:true 기본 동작으로 popper 를
        // .ProseMirror 의 부모(= overflow-y-auto 스크롤 컨테이너 내부)에 붙여, 선택 위치가 아닌
        // 좌측 상단에 렌더된다(#733).
        //
        // 그렇다고 document.body 로 붙이면(슬래시 메뉴가 쓰는 방식) 이 툴바는 동작하지 않는다:
        // 슬래시 메뉴는 ReactRenderer 로 자체 React 루트를 만들지만, 이 툴바는 부모 트리가 렌더한
        // JSX 이고 React 는 루트 컨테이너(#root)에서 이벤트를 위임받으므로 #root 밖으로 나가면
        // onClick 이 영구히 죽는다(클릭은 도달해 포커스만 이동 → 버튼이 먹통).
        // 따라서 스크롤 컨테이너는 벗어나면서 #root 안에는 남는 위치로 붙인다.
        appendTo: () => document.getElementById('root') ?? document.body,
        // 툴바는 버튼 6개의 가로 flex 행 — tippy 기본 maxWidth 350px 면 줄바꿈된다.
        // 다만 상한을 완전히 없애면 좁은 뷰포트에서 화면을 넘치므로 뷰포트 폭으로 가드한다.
        maxWidth: 'calc(100vw - 2rem)',
      }}
    >
      {/* 플로팅 레이어 표면 — bg-popover 는 다크에서 유일하게 솔리드로 정의된 토큰(뒤가 비치지 않음).
          bg-card 는 다크에서 알파라 이 용도에 부적합. shadow-md·rounded-lg 는 팝오버급 규정 값. */}
      <div
        data-testid="wiki-ai-toolbar"
        // role 은 group — ARIA toolbar 롤은 화살표 이동 + roving tabindex 를 약속하지만 여기엔
        // Radix DropdownMenuTrigger(자체 포커스 관리)가 섞여 있어 로빙과 충돌한다.
        role="group"
        aria-label="AI 텍스트 변형"
        className="flex items-center gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
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
              <DropdownMenuContent align="start">
                {presets.map((p) => (
                  <DropdownMenuItem
                    key={p.value}
                    data-testid={`${testidPrefix}-${p.value}`}
                    onSelect={() => onAction(a.key, p.value)}
                  >
                    {p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
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
      </div>
    </BubbleMenu>
  )
}
