// 노트 페이지 「이동…」 위치 고르기(WP-839) — 끌기(마우스 가로 끌기) 없이 키보드·터치·스크린리더로 다른 페이지 하위에 넣는다.
// 데스크톱은 대화상자(고른 뒤 「옮기기」), 휴대폰은 공용 선택 시트(누르면 바로 옮김)로 같은 목록을 보인다.

import { FileText, Home } from 'lucide-react'
import { useMemo, useState } from 'react'

import { MobilePickerSheet, type PickerOption } from '@/components/mobile/MobilePickerSheet'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SearchInput } from '@/components/ui/search-input'
import { useIsMobile } from '@/hooks/useIsMobile'
import { SELECTED_ROW_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'

import type { WikiPageSummary } from '../../types/wiki'
import { moveTargets } from './wikiMoveTargets'

// 들여쓰기 1단계 폭(px) — 사이드바 트리와 같은 값.
const INDENT = 16
// 「최상위」 자리의 값 — 페이지 id 와 겹치지 않는 문자열.
const ROOT = 'root'

/**
 * 옮길 자리를 고르는 대화상자. 옮길 페이지와 그 하위는 목록에서 뺀다(자기 아래로는 옮길 수 없다).
 * 지금 부모는 「지금 위치」로 표시하고 고를 수 없다. onPick 은 새 부모 id(최상위면 null)를 받는다.
 */
export function WikiMovePageDialog({
  pages,
  pageId,
  onClose,
  onPick,
}: {
  pages: WikiPageSummary[]
  /** 옮길 페이지 — null 이면 닫혀 있다. */
  pageId: number | null
  onClose: () => void
  onPick: (parentId: number | null) => void
}) {
  const isMobile = useIsMobile()
  const moving = pages.find((p) => p.id === pageId)
  const title = `「${moving?.title || '제목 없음'}」 옮기기`
  const current = moving?.parentId != null ? String(moving.parentId) : ROOT
  const rows = useMemo(() => (pageId == null ? [] : moveTargets(pages, pageId)), [pages, pageId])

  const pick = (value: string) => {
    if (value === current) return
    onPick(value === ROOT ? null : Number(value))
  }

  if (isMobile) {
    const options: PickerOption[] = [
      { value: ROOT, label: '최상위', icon: <Home />, hint: current === ROOT ? '지금 위치' : undefined },
      ...rows.map(({ page, depth }) => ({
        value: String(page.id),
        label: page.title || '제목 없음',
        // 깊이는 아이콘 앞 빈칸으로 보인다 — 공용 시트 행이 아이콘·제목 순서라 여백을 아이콘 자리에 둔다.
        icon: (
          <span className="flex shrink-0 items-center" style={{ paddingLeft: depth * INDENT }}>
            <FileText />
          </span>
        ),
        hint: String(page.id) === current ? '지금 위치' : undefined,
      })),
    ]
    return (
      <MobilePickerSheet
        open={pageId != null}
        onClose={onClose}
        title={title}
        options={options}
        value={current}
        onSelect={pick}
        searchable
        testId="wiki-move-sheet"
      />
    )
  }

  return (
    <Dialog open={pageId != null} onOpenChange={(o) => !o && onClose()}>
      {/* key — 다른 페이지를 열면 고른 자리·검색어를 비운다. */}
      {pageId != null && (
        <MoveDialogBody key={pageId} title={title} rows={rows} current={current} onClose={onClose} onPick={pick} />
      )}
    </Dialog>
  )
}

/** 데스크톱 대화상자 본문 — 검색 + 트리 목록(하나 고르기) + 취소/옮기기. */
function MoveDialogBody({
  title,
  rows,
  current,
  onClose,
  onPick,
}: {
  title: string
  rows: { page: WikiPageSummary; depth: number }[]
  current: string
  onClose: () => void
  onPick: (value: string) => void
}) {
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const keyword = q.trim().toLowerCase()
  // 검색하면 제목이 맞는 페이지만 남긴다 — 깊이 들여쓰기는 그대로 둬 어느 갈래인지 보이게.
  const shown = keyword ? rows.filter((r) => (r.page.title || '제목 없음').toLowerCase().includes(keyword)) : rows
  const options = [
    ...(keyword ? [] : [{ value: ROOT, label: '최상위', depth: 0, root: true }]),
    ...shown.map((r) => ({ value: String(r.page.id), label: r.page.title || '제목 없음', depth: r.depth, root: false })),
  ]

  return (
    <DialogContent data-testid="wiki-move-dialog" className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>옮길 위치를 고르세요. 고른 페이지의 맨 아래 하위 페이지로 들어갑니다.</DialogDescription>
      </DialogHeader>
      <SearchInput
        value={q}
        onChange={setQ}
        placeholder="페이지 검색"
        className="max-w-none"
        inputTestId="wiki-move-search"
      />
      <div
        role="listbox"
        aria-label="옮길 위치"
        className="-mx-1 max-h-72 min-h-24 overflow-y-auto rounded-md border p-1"
        data-testid="wiki-move-list"
      >
        {options.map((o) => {
          const isCurrent = o.value === current
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={selected === o.value}
              aria-disabled={isCurrent || undefined}
              data-testid={`wiki-move-option-${o.value}`}
              onClick={() => !isCurrent && setSelected(o.value)}
              // 목록에서 Enter 두 번(고르기·옮기기) 대신 두 번 누르기로 바로 옮긴다.
              onDoubleClick={() => !isCurrent && onPick(o.value)}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent',
                isCurrent && 'cursor-default text-muted-foreground hover:bg-transparent',
                selected === o.value && SELECTED_ROW_CLASS,
              )}
              style={{ paddingLeft: 8 + o.depth * INDENT }}
            >
              {o.root ? (
                <Home className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {isCurrent && <span className="shrink-0 text-xs">지금 위치</span>}
            </button>
          )
        })}
        {options.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">맞는 페이지가 없습니다</p>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          취소
        </Button>
        <Button disabled={selected == null} onClick={() => selected != null && onPick(selected)} data-testid="wiki-move-confirm">
          옮기기
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
