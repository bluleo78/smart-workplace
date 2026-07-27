import type { Editor } from '@tiptap/core'

import { EditorFloatingToolbar } from '@/components/editor/EditorFloatingToolbar'
import { Button } from '@/components/ui/button'

import {
  isTableCommandEnabled,
  readTableRect,
  readTableSnapshot,
  runTableCommand,
  WIKI_TABLE_COMMANDS,
} from './wikiTableCommands'

/** 표 조작 툴바 — 커서가 표 안에 있고 선택이 비어 있을 때 표 위에 뜬다.
 *  선택이 비어 있지 않을 때는 AI 변형 툴바가 뜨므로(셀 안 텍스트 요약·번역이 그대로 동작),
 *  두 술어는 상호배타라 우선순위 로직이 필요 없다.
 *  뷰어 권한(!canEdit)이면 disabled 로 아예 렌더하지 않는다. AI 생성 중에도 표 편집은
 *  막지 않는 게 의도라 disabled 조건에 스트리밍 상태는 포함하지 않는다. */
export function WikiTableToolbar({
  editor,
  disabled,
}: {
  editor: Editor | null
  disabled: boolean
}) {
  if (!editor) return null

  const snap = readTableSnapshot(editor)

  return (
    <EditorFloatingToolbar
      editor={editor}
      pluginKey="wikiTableBubble"
      shouldShow={({ editor: ed, state }) =>
        !disabled && state.selection.empty && ed.isEditable && readTableSnapshot(ed).inTable
      }
      ariaLabel="표 편집"
      testId="wiki-table-toolbar"
      // 기본 앵커는 선택 좌표(= 커서가 있는 셀)라 툴바가 표 한가운데 떠 셀을 가린다.
      // 표 DOM 의 사각형으로 바꿔 표 상단에 붙인다. 가로 스크롤 컨테이너 안이어도
      // 뷰포트 기준 좌표라 그대로 성립한다.
      getReferenceClientRect={() => readTableRect(editor)}
    >
      {WIKI_TABLE_COMMANDS.map((cmd, i) => {
        const Icon = cmd.icon
        // 파괴적 명령 앞에 구분선 — 삽입 4종과 삭제 3종을 시각적으로 가른다.
        const divider = cmd.destructive && !WIKI_TABLE_COMMANDS[i - 1]?.destructive
        return (
          <span key={cmd.key} className="flex items-center gap-1">
            {divider && <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={cmd.label}
              title={cmd.label}
              data-testid={`wiki-table-cmd-${cmd.key}`}
              disabled={!isTableCommandEnabled(cmd.key, snap)}
              // mousedown 기본동작 차단 — 클릭이 에디터 커서를 잃지 않게 한다.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runTableCommand(editor, cmd.key)}
              className={cmd.destructive ? 'text-destructive' : undefined}
            >
              <Icon aria-hidden="true" />
            </Button>
          </span>
        )
      })}
    </EditorFloatingToolbar>
  )
}
