// 노트 페이지 「이동…」 위치 고르기(WP-839) — 끌기(마우스 가로 끌기) 없이 키보드·터치·스크린리더로 다른 페이지 하위에 넣는다.
// 데스크톱은 대화상자(고른 뒤 「옮기기」), 휴대폰은 공용 선택 시트(누르면 바로 옮김)로 같은 목록을 보인다.

import { FileText, Home, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'

import { MobilePickerSheet, type PickerOption } from '@/components/mobile/MobilePickerSheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select'
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
import { isEditRole } from '@/lib/collab/collabStatus'
import { SELECTED_ROW_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'

import { useWikiMovePreview } from '../../hooks/queries/useWikiMutations'
import { useWikiTree } from '../../hooks/queries/useWikiTree'
import type { WikiMovePreview, WikiPageSummary, WikiSpace } from '../../types/wiki'
import { moveTargets } from './wikiMoveTargets'
import { blockedShareNotice, coveringShareName, shareMoveAcrossImpact, type ShareMoveImpact } from './wikiShare'

// 들여쓰기 1단계 폭(px) — 사이드바 트리와 같은 값.
const INDENT = 16
// 「최상위」 자리의 값 — 페이지 id 와 겹치지 않는 문자열.
const ROOT = 'root'

/**
 * 옮길 자리를 고르는 대화상자. 옮길 페이지와 그 하위는 목록에서 뺀다(자기 아래로는 옮길 수 없다).
 * 지금 부모는 「지금 위치」로 표시하고 고를 수 없다. onPick 은 새 부모 id(최상위면 null)와 대상 스페이스 id 를 받는다.
 * 데스크톱은 편집할 수 있는 다른 스페이스도 고를 수 있다(WP-988) — 휴대폰 시트는 지금 스페이스 안에서만 옮긴다.
 */
export function WikiMovePageDialog({
  spaceId,
  spaces,
  pages,
  pageId,
  onClose,
  onPick,
}: {
  /** 지금 보는(원본) 스페이스. */
  spaceId: number
  spaces: WikiSpace[] | undefined
  pages: WikiPageSummary[]
  /** 옮길 페이지 — null 이면 닫혀 있다. */
  pageId: number | null
  onClose: () => void
  onPick: (parentId: number | null, targetSpaceId: number) => void
}) {
  const isMobile = useIsMobile()
  const moving = pages.find((p) => p.id === pageId)
  const title = `「${moving?.title || '제목 없음'}」 옮기기`
  const current = moving?.parentId != null ? String(moving.parentId) : ROOT
  const rows = useMemo(() => (pageId == null ? [] : moveTargets(pages, pageId)), [pages, pageId])

  const pick = (value: string) => {
    if (value === current) return
    onPick(value === ROOT ? null : Number(value), spaceId)
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
        <MoveDialogBody
          key={pageId}
          pageId={pageId}
          spaceId={spaceId}
          // 옮길 수 있는 곳 — 내가 편집할 수 있는 스페이스(원본 포함).
          spaces={(spaces ?? []).filter((s) => s.id === spaceId || isEditRole(s.role))}
          title={title}
          sourcePages={pages}
          rows={rows}
          current={current}
          onClose={onClose}
          onPick={onPick}
        />
      )}
    </Dialog>
  )
}

/** 데스크톱 대화상자 본문 — 검색 + 트리 목록(하나 고르기) + 취소/옮기기. */
function MoveDialogBody({
  pageId,
  spaceId,
  spaces,
  title,
  sourcePages,
  rows: sourceRows,
  current: sourceCurrent,
  onClose,
  onPick,
}: {
  pageId: number
  spaceId: number
  spaces: WikiSpace[]
  title: string
  sourcePages: WikiPageSummary[]
  rows: { page: WikiPageSummary; depth: number }[]
  current: string
  onClose: () => void
  onPick: (parentId: number | null, targetSpaceId: number) => void
}) {
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [targetSpaceId, setTargetSpaceId] = useState(spaceId)
  const cross = targetSpaceId !== spaceId
  // 다른 스페이스를 골랐을 때만 그 트리를 받는다 — 옮길 페이지는 그 트리에 없으므로 자기 하위 제외는 필요 없지만 같은 계산을 쓴다.
  const targetTree = useWikiTree(cross ? targetSpaceId : null)
  const rows = useMemo(
    () => (cross ? moveTargets(targetTree.data ?? [], pageId) : sourceRows),
    [cross, targetTree.data, pageId, sourceRows],
  )
  // 지금 위치 표시는 같은 스페이스 안에서만 의미가 있다.
  const current = cross ? '' : sourceCurrent
  const preview = useWikiMovePreview(pageId, cross ? targetSpaceId : null)
  // 대상 트리를 받는 중 — 빈 목록을 「맞는 페이지가 없습니다」로 보이거나 트리를 보기 전에 최상위로 옮기지 않게 한다.
  const treeLoading = cross && targetTree.isLoading
  // 경고를 보기 전에 옮기지 않게 미리보기·대상 트리가 올 때까지 막는다.
  const previewPending = cross && (!preview.data || treeLoading)
  // 고른 자리로 옮기면 빠지는·새로 들어가는 하위 포함 공유 — 같은 스페이스 안 이동의 확인 창과 같은 내용을 경고에 보인다.
  const shareImpact = useMemo(
    () =>
      cross && selected != null
        ? shareMoveAcrossImpact(
            sourcePages,
            pageId,
            targetTree.data ?? [],
            selected === ROOT ? null : Number(selected),
            // 옮기며 해제되는 자기 공유는 옮긴 뒤에는 없다 — 새 위치의 공유로 열리는지 판정에 반영한다.
            preview.data?.revokedShares.map((r) => r.pageId),
          )
        : null,
    [cross, selected, sourcePages, pageId, targetTree.data, preview.data],
  )
  /** 고른 값(ROOT 또는 페이지 id) → 새 부모 id 로 바꿔 대상 스페이스와 함께 넘긴다. */
  const pick = (value: string) => onPick(value === ROOT ? null : Number(value), targetSpaceId)
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
      {spaces.length > 1 && (
        <Select
          value={String(targetSpaceId)}
          onValueChange={(v) => {
            setTargetSpaceId(Number(v))
            setSelected(null)
            setQ('')
          }}
        >
          <SelectTrigger className="h-8 w-full text-sm" aria-label="옮길 스페이스" data-testid="wiki-move-space">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {spaces.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
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
              onDoubleClick={() => !isCurrent && !previewPending && pick(o.value)}
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
        {treeLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground" data-testid="wiki-move-tree-loading">
            페이지 목록을 불러오는 중…
          </p>
        ) : (
          options.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">맞는 페이지가 없습니다</p>
        )}
      </div>
      {cross && preview.data && <MoveSpaceWarning preview={preview.data} shareImpact={shareImpact} />}
      {cross && preview.isError && (
        <p role="alert" className="text-xs text-destructive" data-testid="wiki-move-preview-error">
          옮겼을 때의 영향을 불러오지 못했습니다. 이 스페이스에 편집 권한이 있는지 확인하고 다시 골라 주세요.
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          취소
        </Button>
        <Button
          disabled={selected == null || previewPending}
          onClick={() => selected != null && pick(selected)}
          data-testid="wiki-move-confirm"
        >
          옮기기
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

/** 다른 스페이스로 옮길 때의 영향 경고 — 접근을 잃는 사람 수, 따라가는·해제되는 공유, 고른 자리에서 빠지는·새로 들어가는 상위 공유. */
function MoveSpaceWarning({
  preview,
  shareImpact,
}: {
  preview: WikiMovePreview
  shareImpact: ShareMoveImpact | null
}) {
  const names = (list: { title: string }[]) => list.map((p) => `「${p.title || '제목 없음'}」`).join(', ')
  return (
    <div
      role="status"
      data-testid="wiki-move-space-warning"
      className="flex gap-2 rounded-md border border-warning/40 bg-warning-subtle p-3 text-xs"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
      <ul className="min-w-0 list-disc space-y-1 pl-4">
        <li>하위 페이지를 포함해 {preview.pageCount}개 페이지가 함께 옮겨집니다. 예전 주소는 새 주소로 연결됩니다.</li>
        {preview.lostMemberCount > 0 && (
          <li>지금 스페이스 멤버 {preview.lostMemberCount}명은 새 스페이스 멤버가 아니라 이 페이지를 볼 수 없게 됩니다.</li>
        )}
        {preview.gainedMemberCount > 0 && (
          <li className="font-medium">새 스페이스 멤버 {preview.gainedMemberCount}명이 이 페이지를 볼 수 있게 됩니다.</li>
        )}
        {preview.keptShares.length > 0 && <li>{names(preview.keptShares)} 공유 링크는 그대로 유지됩니다.</li>}
        {preview.revokedShares.length > 0 && (
          <li className="font-medium">
            {names(preview.revokedShares)} 공유 링크는 공유한 사람이 새 스페이스 편집자가 아니라 해제됩니다.
          </li>
        )}
        {shareImpact?.leaving.map((s) => (
          <li key={`out-${s.pageId}`}>{coveringShareName(s)}로 더 이상 보이지 않습니다.</li>
        ))}
        {shareImpact?.entering.map((s) => (
          <li key={`in-${s.pageId}`} className={s.audience === 'PUBLIC' ? 'font-medium' : undefined}>
            {coveringShareName(s)}로 새로 보이게 됩니다.
          </li>
        ))}
        {/* 상위 공유에서 제외됐거나 자기 공유가 살아 있는 페이지(WP-1031·WP-1043) — 새 위치의 공유로도 열리지 않는다. */}
        {shareImpact?.blocked.map((s) => (
          <li key={`blocked-${s.pageId}`} data-testid="wiki-move-share-blocked">
            {blockedShareNotice(s)}
          </li>
        ))}
      </ul>
    </div>
  )
}
