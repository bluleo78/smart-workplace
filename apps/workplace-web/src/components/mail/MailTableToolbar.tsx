/**
 * 메일 표 막대(WP-1524) — 커서가 표 안이면 행·열 추가·삭제 일곱 명령을 보인다.
 *
 * 명령 목록·이름·가드(머리글 행 삭제 금지·마지막 열 삭제 금지)는 노트 표 명령(wikiTableCommands)을 그대로 쓴다 —
 * 메일 표도 표준 노드 이름이라 같은 명령이 돌고, 목록을 복제하면 두 편집기의 말·가드가 갈라진다.
 * 노트 막대의 열 정렬은 넣지 않는다 — 메일 표 셀은 인라인 style 만 싣고(mailTable) 정렬 속성을 내보내지 않는다.
 *
 * 데스크톱은 표 위에 뜨는 막대(EditorFloatingToolbar), 모바일(touch)은 떠 있는 막대가 가상 키보드·손가락에 가리므로
 * 키보드 위 서식 줄 바로 위에 고정한 한 줄로 그린다.
 */
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'

import { EditorFloatingToolbar, EditorToolbarDivider } from '@/components/editor/EditorFloatingToolbar'
import {
  DESTRUCTIVE_TABLE_COMMANDS,
  INSERT_TABLE_COMMANDS,
  isTableCommandEnabled,
  readTableRect,
  readTableSnapshot,
  runTableCommand,
  type WikiTableCommand,
} from '@/components/wiki/wikiTableCommands'
import { cn } from '@/lib/utils'

import { MAIL_MOBILE_TABLE_ROW_CLASS, MAIL_MOBILE_TABLE_ROW_ID } from './mailMobileBars'
import { ToolbarButton } from './MailToolbarButton'

/**
 * 모바일 고정 줄 — 서식 줄 바로 위(MAIL_MOBILE_TABLE_ROW_CLASS: 키보드 높이 + safe-area 여백을 포함한 서식 줄 높이)에 붙인다.
 * 좁은 화면에서 넘치면 가로로 밀어 본다(overflow-x-auto).
 */
const TOUCH_ROW_CLASS = cn(MAIL_MOBILE_TABLE_ROW_CLASS, 'flex items-center gap-1 overflow-x-auto px-2')

/**
 * 표 막대. touch 면 표 안일 때만 고정 줄을, 아니면 표 위에 뜨는 막대를 그린다.
 * touchRowHidden — 모바일 서식판·표 격자 패널이 같은 자리(서식 줄 바로 위)를 쓰는 동안 고정 줄을 감춘다.
 * 사용자가 방금 연 패널이 우선이고, 패널을 닫으면(커서가 아직 표 안이면) 다시 보인다.
 */
export function MailTableToolbar({
  editor,
  touch,
  touchRowHidden = false,
}: {
  editor: Editor
  touch: boolean
  touchRowHidden?: boolean
}) {
  // 커서 자리 표 상태를 구독한다 — 선택이 바뀌어 스냅샷(표 안·머리글 행·열 수)이 달라질 때만 다시 그린다.
  const snap = useEditorState({ editor, selector: ({ editor: ed }) => readTableSnapshot(ed) })

  /** 명령 단추 하나 — 삽입·삭제 묶음이 함께 쓴다. 삭제 3종은 파괴적 색. */
  const renderCommand = (cmd: WikiTableCommand) => {
    const Icon = cmd.icon
    return (
      <ToolbarButton
        key={cmd.key}
        touch={touch}
        label={cmd.label}
        title={cmd.label}
        disabled={!isTableCommandEnabled(cmd.key, snap)}
        // 실행 지점에서도 가드를 다시 본다(runTableCommand) — 렌더 뒤 커서가 머리글 행으로 옮긴 경합을 막는다.
        onClick={() => runTableCommand(editor, cmd.key)}
        // 고정 줄이 좁으면 단추가 줄어들지 않고 가로 스크롤되게 shrink-0.
        className={cn(touch && 'shrink-0', cmd.destructive && 'text-destructive hover:text-destructive')}
      >
        <Icon aria-hidden="true" />
      </ToolbarButton>
    )
  }

  // 삽입 4종 | 삭제 3종 — 구분선으로 두 묶음을 가른다(노트 막대와 같은 순서).
  const commands = (
    <>
      {INSERT_TABLE_COMMANDS.map(renderCommand)}
      <EditorToolbarDivider />
      {DESTRUCTIVE_TABLE_COMMANDS.map(renderCommand)}
    </>
  )

  // 떠 있는 막대(BubbleMenu)는 touch 여부와 상관없이 늘 그려 둔다 — 같은 작성창이 셸 전환으로 fill↔mobile 을 오가므로(MailComposeDock),
  // touch 일 때 빼 버리면 tiptap 이 이미 떼어 낸 DOM 을 React 가 지우려다 NotFoundError 로 화면이 죽는다(insertBefore 함정과 같은 뿌리).
  // touch 동안은 shouldShow 가 false 이고, 떠 있던 채로 바뀌어도 suppressed 로 표면을 감춘다.
  // 모바일 고정 줄은 그 뒤 조건부 형제로 둔다 — 넣고 뺄 때 기준점이 늘 붙어 있는 다음 형제(EditorContent)라 안전하다.
  return (
    <>
      <EditorFloatingToolbar
        editor={editor}
        // 한 에디터의 BubbleMenu 마다 키가 달라야 한다(EditorFloatingToolbar 주석).
        pluginKey="mailTableToolbar"
        placement="top"
        // 텍스트를 고른 동안은 숨긴다 — 표 명령은 커서 자리 기준이라 빈 선택일 때만 뜬다(노트 표 막대와 같은 술어).
        shouldShow={({ editor: ed, state }) =>
          !touch && state.selection.empty && ed.isEditable && readTableSnapshot(ed).inTable
        }
        suppressed={touch}
        ariaLabel="표 편집"
        testId="mail-table-toolbar"
        // 기본 앵커(커서 셀)면 막대가 표 가운데 떠 셀을 가린다 — 표 사각형 위에 붙인다.
        getReferenceClientRect={() => readTableRect(editor)}
      >
        {!touch && commands}
      </EditorFloatingToolbar>
      {touch && snap.inTable && !touchRowHidden && (
        <div id={MAIL_MOBILE_TABLE_ROW_ID} data-testid="mail-table-toolbar" role="group" aria-label="표 편집" className={TOUCH_ROW_CLASS}>
          {commands}
        </div>
      )}
    </>
  )
}
