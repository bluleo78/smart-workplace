import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  buildMailFolderTree,
  folderAncestorIds,
  folderIndentPx,
  type MailFolderRow,
  readCollapsed,
  visibleFolderRows,
  writeCollapsed,
} from '@/lib/mailFolders'
import { mailViewHref } from '@/lib/mailView'
import { SELECTED_ROW_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'
import type { MailServerFolder } from '@/types/mailFolder'

/** 접힘 집합에서 지금 연 메일함의 조상을 뺀다 — 연 메일함이 접힌 부모 안에 숨지 않게. */
function withoutAncestors(collapsed: ReadonlySet<number>, folders: readonly MailServerFolder[], activeId: number | null) {
  if (activeId == null) return collapsed
  const ancestors = folderAncestorIds(folders, activeId)
  if (!ancestors.some((id) => collapsed.has(id))) return collapsed
  const next = new Set(collapsed)
  ancestors.forEach((id) => next.delete(id))
  return next
}

/**
 * WP-961 메일 사이드바 「내 메일함」 — 사용자가 만든 서버 메일함을 parentId 계층으로 그린다.
 * - 하위가 있으면 ▸/▾ 로 접고 편다(기본 펼침). 접힘은 계정별 localStorage 에 남긴다 — 저장소를 못 써도 이번 화면에서는 동작한다.
 * - 열 수 있는 메일함은 링크(?box=<id>), 하위만 묶는 메일함(selectable=false)은 펼치기만 되는 버튼이다.
 *   접기 버튼은 링크 바깥에 둔다 — 모바일 시트는 링크를 누르면 닫히는데, 접기는 시트를 닫지 않아야 한다.
 * - 사용자 메일함이 하나도 없으면 구역째 그리지 않는다.
 * 계정이 바뀌면 부모가 key 로 새로 그려 접힘 상태를 그 계정 것으로 다시 읽는다.
 */
export function MailFolderTree({
  accountId,
  folders,
  activeFolderId,
  unreadOnly,
  countPill,
}: {
  accountId: number
  folders: readonly MailServerFolder[]
  /** 지금 연 서버 메일함 id(없으면 null) — 활성 표시와 조상 자동 펼침. */
  activeFolderId: number | null
  /** 「안 읽은 메일만」 토글 상태 — 다른 보기 링크처럼 메일함을 옮겨도 유지한다. */
  unreadOnly: boolean
  /** 사이드바 공용 안 읽은 수 pill(0 이면 숨김). */
  countPill: (n: number | undefined, testId: string, strong?: boolean) => ReactNode
}) {
  const { tree } = useMemo(() => buildMailFolderTree(folders), [folders])
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() =>
    withoutAncestors(readCollapsed(accountId), folders, activeFolderId),
  )
  // 다른 메일함으로 옮기면(뒤로 가기·딥링크 포함) 그 조상을 펼친다 — 렌더 중 이전 값 비교로 한 번만.
  const [seenActive, setSeenActive] = useState(activeFolderId)
  if (seenActive !== activeFolderId) {
    setSeenActive(activeFolderId)
    const next = withoutAncestors(collapsed, folders, activeFolderId)
    if (next !== collapsed) setCollapsed(next)
  }
  const rows = useMemo(() => visibleFolderRows(tree, collapsed), [tree, collapsed])

  if (tree.length === 0) return null

  const toggle = (id: number) => {
    const next = new Set(collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setCollapsed(next)
    writeCollapsed(accountId, next)
  }

  return (
    <>
      <div className="mt-4 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">내 메일함</div>
      <nav aria-label="내 메일함" data-testid="mail-user-folders" className="mt-1 space-y-1">
        {rows.map((row) => (
          <FolderRow
            key={row.folder.id}
            row={row}
            active={row.folder.id === activeFolderId}
            href={mailViewHref(accountId, { folderId: row.folder.id }, unreadOnly)}
            onToggle={() => toggle(row.folder.id)}
            pill={countPill(row.folder.unreadCount ?? undefined, `mail-count-box-${row.folder.id}`, row.folder.id === activeFolderId)}
          />
        ))}
      </nav>
    </>
  )
}

/** 트리 한 줄 — [접기 칸][폴더 아이콘 이름 pill]. 들여쓰기는 깊이 상한까지만(이름 칸이 넘치지 않게). */
function FolderRow({
  row,
  active,
  href,
  onToggle,
  pill,
}: {
  row: MailFolderRow
  active: boolean
  href: string
  onToggle: () => void
  pill: ReactNode
}) {
  const { folder, hasChildren, expanded } = row
  const name = folder.displayName
  const chevron = expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
  // 폴더 아이콘·이름·pill — 링크와 묶음 버튼이 같은 모양을 쓴다. 긴 이름은 말줄임, 전체 이름은 title.
  const body = (
    <>
      <Folder className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {pill}
    </>
  )
  return (
    <div
      data-testid={`mail-box-row-${folder.id}`}
      className={cn(
        'flex items-center gap-1.5 rounded-md pr-3 text-sm font-medium transition-colors',
        active ? SELECTED_ROW_CLASS : 'text-muted-foreground hover:bg-accent/50',
      )}
      style={{ paddingLeft: folderIndentPx(row.depth) }}
    >
      {folder.selectable ? (
        <>
          {hasChildren ? (
            <button
              type="button"
              data-testid={`mail-box-toggle-${folder.id}`}
              aria-label={`${name} ${expanded ? '접기' : '펼치기'}`}
              aria-expanded={expanded}
              onClick={onToggle}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {chevron}
            </button>
          ) : (
            <span aria-hidden className="w-5 shrink-0" />
          )}
          <Link
            to={href}
            data-testid={`mail-box-${folder.id}`}
            title={name}
            aria-current={active ? 'page' : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {body}
          </Link>
        </>
      ) : (
        // 하위만 묶는 메일함 — 열 메일이 없어 줄 전체가 펼치기 버튼(시트를 닫지 않는다). 트리 조립이 하위 없는 묶음은 뺀다.
        <button
          type="button"
          data-testid={`mail-box-${folder.id}`}
          title={name}
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
            {chevron}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-2">{body}</span>
        </button>
      )}
    </div>
  )
}
