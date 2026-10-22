import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'

import {
  DESTRUCTIVE_TABLE_COMMANDS,
  INSERT_TABLE_COMMANDS,
  isTableCommandEnabled,
  readTableSnapshot,
  runTableCommand,
  setTableColumnAlign,
  WIKI_TABLE_ALIGNS,
  type WikiTableCommand,
} from './wikiTableCommands'


/** 표 셀 우클릭 메뉴 — 툴바와 같은 명령 집합을 마우스 위치에서 바로 제공한다.
 *  표 밖 우클릭은 가로채지 않아 브라우저 기본 메뉴가 그대로 뜬다.
 *
 *  우클릭 지점의 셀을 대상으로 삼기 위해 posAtCoords 로 커서를 먼저 옮긴다. 브라우저가
 *  contenteditable 우클릭에서 캐럿을 옮겨주긴 하지만 동작이 브라우저마다 달라, 명령이
 *  엉뚱한 셀에 적용되지 않도록 직접 확정한다.
 *
 *  이 메뉴는 BubbleMenu 안이 아니라 에디터 형제로 렌더되므로 shadcn 의 Portal 사용
 *  DropdownMenuContent 를 그대로 써도 된다(툴바 안이었다면 Portal 이 blur-hide 를 유발한다). */
export function WikiTableContextMenu({
  editor,
  disabled,
}: {
  editor: Editor | null
  disabled: boolean
}) {
  // 메뉴 앵커 좌표. null 이면 닫힌 상태.
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!editor || disabled) return
    const dom = editor.view.dom

    function onContextMenu(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      // 표 안이 아니면 브라우저 기본 메뉴를 그대로 둔다.
      if (!target?.closest('table')) return
      const pos = editor!.view.posAtCoords({ left: e.clientX, top: e.clientY })
      if (!pos) return
      e.preventDefault()
      // 여러 셀을 고른 채 그 안을 우클릭하면 선택을 지킨다 — 열 정렬을 고른 열 전체에 한 번에 적용한다(WP-584).
      if (!isInsideCellSelection(editor!, target)) {
        // near() 를 쓴다 — posAtCoords 가 텍스트가 아닌 위치를 돌려줄 수 있고 그때 create() 는 throw 한다.
        const tr = editor!.state.tr.setSelection(
          TextSelection.near(editor!.state.doc.resolve(pos.pos)),
        )
        editor!.view.dispatch(tr)
      }
      setAnchor({ x: e.clientX, y: e.clientY })
    }

    dom.addEventListener('contextmenu', onContextMenu)
    return () => {
      dom.removeEventListener('contextmenu', onContextMenu)
    }
  }, [editor, disabled])

  if (!editor || disabled || !anchor) return null

  const snap = readTableSnapshot(editor)

  /** 표 명령 메뉴 항목 하나 — 삽입·삭제 묶음이 함께 쓴다. */
  const renderCommand = (cmd: WikiTableCommand) => {
    const Icon = cmd.icon
    return (
      <DropdownMenuItem
        key={cmd.key}
        data-testid={`wiki-table-ctx-${cmd.key}`}
        disabled={!isTableCommandEnabled(cmd.key, snap)}
        variant={cmd.destructive ? 'destructive' : 'default'}
        onSelect={() => {
          runTableCommand(editor, cmd.key)
          setAnchor(null)
        }}
      >
        <Icon aria-hidden="true" />
        {cmd.label}
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenu open onOpenChange={(open) => !open && setAnchor(null)}>
      {/* 마우스 좌표에 0×0 트리거를 띄워 앵커로 쓴다(Radix 는 트리거 기준으로 배치한다). */}
      <DropdownMenuTrigger
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: 'fixed', left: anchor.x, top: anchor.y, width: 0, height: 0 }}
      />
      <DropdownMenuContent align="start" data-testid="wiki-table-context-menu">
        {/* 삽입 | 열 정렬(WP-584, 지금 정렬에 체크) | 삭제 — 툴바와 같은 묶음. */}
        {INSERT_TABLE_COMMANDS.map(renderCommand)}
        <DropdownMenuSeparator />
        {WIKI_TABLE_ALIGNS.map((a) => {
          const AlignIcon = a.icon
          return (
            <DropdownMenuItem
              key={a.key}
              data-testid={`wiki-table-ctx-align-${a.key}`}
              onSelect={() => {
                setTableColumnAlign(editor, a.value)
                setAnchor(null)
              }}
            >
              <AlignIcon aria-hidden="true" />
              {a.label}
              {snap.columnAlign === a.value && <Check className="ml-auto" aria-label="현재 정렬" />}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        {DESTRUCTIVE_TABLE_COMMANDS.map(renderCommand)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 우클릭한 셀이 지금 여러 셀 선택(CellSelection) 안에 있는지 — 그때는 선택을 바꾸지 않는다. 고른 셀에는 prosemirror-tables 가 selectedCell 클래스를 단다. */
function isInsideCellSelection(editor: Editor, target: HTMLElement): boolean {
  return editor.state.selection instanceof CellSelection && !!target.closest('.selectedCell')
}
