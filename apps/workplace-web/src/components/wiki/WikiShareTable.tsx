import { ExternalLink, Link2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/overlay/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TableEmptyRow } from '@/components/ui/table-empty'
import { TableSkeletonRows } from '@/components/ui/table-skeleton'
import { formatDateOnly, formatListTime } from '@/lib/formatters'

import type { WikiShareAudience, WikiShareListItem } from '../../types/wiki'
import { copyShareLink, isShareExpired, shareScopeLabel } from './wikiShare'

/** 범위 거르기 선택지. */
const AUDIENCE_FILTER: { value: 'ALL' | WikiShareAudience; label: string }[] = [
  { value: 'ALL', label: '모든 범위' },
  { value: 'PUBLIC', label: '외부 공개' },
  { value: 'WORKSPACE', label: '워크스페이스 전체' },
  { value: 'PEOPLE', label: '지정한 사람' },
]

/** 범위 표시 — 외부 공개는 눈에 띄는 배지, 나머지는 「대상 · 권한」 글자. 넓은 화면은 범위 칸, 휴대폰은 제목 아래에 쓴다(WP-1127). */
function ShareScope({ item }: { item: WikiShareListItem }) {
  return item.audience === 'PUBLIC' ? (
    <Badge variant="destructive" className="font-normal">
      외부 공개
    </Badge>
  ) : (
    <span className="text-sm">{shareScopeLabel(item.audience, item.permission, item.peopleCount, item.groupCount)}</span>
  )
}

/** 만료 칸 — 지났으면 「만료됨」, 없으면 「없음」. */
function expiryLabel(iso: string | null, now = new Date()): string {
  if (!iso) return '없음'
  return isShareExpired(iso, now) ? '만료됨' : `${formatDateOnly(iso)}까지`
}

/**
 * 스페이스를 가로지르는 노트 공유 목록 표(WP-579) — 설정 › 내 공유와 관리자 › 노트 공유가 함께 쓴다.
 * 범위·스페이스로 거르고 제목·만든 사람으로 찾는다. selectable 이면 여러 줄을 골라 한 번에 해제한다(관리자).
 */
export function WikiShareTable({
  items,
  isPending,
  isError,
  showCreator,
  selectable,
  onOpenPage,
  onRevoke,
  revoking,
}: {
  items: WikiShareListItem[] | undefined
  isPending: boolean
  isError: boolean
  /** 만든 사람 칸 — 관리자 목록에서만(내 공유는 모두 나). */
  showCreator: boolean
  selectable: boolean
  onOpenPage: (item: WikiShareListItem) => void
  /** 해제 요청 — 확인은 부르는 쪽이 받는다. */
  onRevoke: (pageIds: number[]) => void
  revoking: boolean
}) {
  const [audience, setAudience] = useState<'ALL' | WikiShareAudience>('ALL')
  const [spaceId, setSpaceId] = useState<string>('ALL')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const spaces = useMemo(() => {
    const m = new Map<number, string>()
    for (const i of items ?? []) m.set(i.spaceId, i.spaceName)
    return [...m.entries()]
  }, [items])
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (items ?? []).filter(
      (i) =>
        (audience === 'ALL' || i.audience === audience) &&
        (spaceId === 'ALL' || String(i.spaceId) === spaceId) &&
        (!needle || i.title.toLowerCase().includes(needle) || i.createdBy.name.toLowerCase().includes(needle)),
    )
  }, [items, audience, spaceId, q])
  // 해제·재조회로 목록에서 사라진 줄의 선택은 비운다 — 같은 페이지가 다시 공유돼 돌아와도 체크된 채 나타나지 않게.
  // (렌더 중 상태 보정: 목록이 아직 없을 때(undefined)는 건드리지 않는다.)
  if (items && selected.size > 0) {
    const live = new Set(items.map((i) => i.pageId))
    if ([...selected].some((id) => !live.has(id))) setSelected(new Set([...selected].filter((id) => live.has(id))))
  }
  // 거르기로 안 보이게 된 줄은 선택에서 뺀다 — 보이지 않는 것을 해제하지 않게.
  const visibleSelected = rows.filter((r) => selected.has(r.pageId)).map((r) => r.pageId)
  const columns = 6 + (showCreator ? 1 : 0) + (selectable ? 1 : 0)

  const toggle = (id: number, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })


  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-64">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={showCreator ? '페이지 제목·만든 사람' : '페이지 제목'}
            aria-label="공유 찾기"
            className="h-9 pl-8"
          />
        </div>
        <Select value={audience} onValueChange={(v) => setAudience(v as 'ALL' | WikiShareAudience)}>
          <SelectTrigger className="h-9 w-40" aria-label="범위">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUDIENCE_FILTER.map((a) => (
              <SelectItem key={a.value} value={a.value}>
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={spaceId} onValueChange={setSpaceId}>
          <SelectTrigger className="h-9 w-44" aria-label="스페이스">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">모든 스페이스</SelectItem>
            {spaces.map(([id, name]) => (
              <SelectItem key={id} value={String(id)}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectable && visibleSelected.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            className="ml-auto h-9"
            disabled={revoking}
            onClick={() => onRevoke(visibleSelected)}
            data-testid="wiki-share-table-revoke-selected"
          >
            {visibleSelected.length}개 해제
          </Button>
        )}
      </div>
      <Table aria-label="공유 목록" data-testid="wiki-share-table">
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-10">
                <Checkbox
                  aria-label="모두 고르기"
                  checked={rows.length > 0 && visibleSelected.length === rows.length}
                  onCheckedChange={(v) => setSelected(v === true ? new Set(rows.map((r) => r.pageId)) : new Set())}
                />
              </TableHead>
            )}
            <TableHead>페이지</TableHead>
            <TableHead className="hidden md:table-cell">범위</TableHead>
            {showCreator && <TableHead className="hidden md:table-cell">만든 사람</TableHead>}
            <TableHead className="hidden md:table-cell">만료</TableHead>
            <TableHead className="hidden md:table-cell">마지막 열람</TableHead>
            <TableHead className="hidden text-right md:table-cell">열람</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <TableSkeletonRows columns={columns} rows={3} />
          ) : isError ? (
            <TableRow>
              <TableCell colSpan={columns} className="py-8 text-center text-destructive">
                목록을 불러오지 못했습니다.
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableEmptyRow colSpan={columns} message={items?.length ? '조건에 맞는 공유가 없습니다.' : '공유 중인 페이지가 없습니다.'} />
          ) : (
            rows.map((i) => (
              <TableRow key={i.pageId} data-testid={`wiki-share-row-${i.pageId}`}>
                {selectable && (
                  <TableCell>
                    <Checkbox
                      aria-label={`${i.title} 고르기`}
                      checked={selected.has(i.pageId)}
                      onCheckedChange={(v) => toggle(i.pageId, v === true)}
                    />
                  </TableCell>
                )}
                {/* 제목 칸은 다른 칸이 쓰고 남은 폭만 차지하고(w-full + max-w-0) 그 안에서 말줄임한다 — 긴 제목 하나가 표를
                    넓혀 행마다 「해제」가 화면 밖으로 밀리던 것을 막는다(WP-1127). 화면 폭·고르기 칸 유무와 상관없이 맞는다.
                    휴대폰에서는 범위 칸을 숨기고 범위를 제목 아래 줄로 옮긴다(줄바꿈 허용 — 권한까지 보이게). */}
                <TableCell className="w-full max-w-0">
                  <span className="block truncate font-medium">{i.title || '제목 없음'}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {i.spaceName}
                    {i.includeChildren && ' · 하위 페이지 포함'}
                  </span>
                  <div className="mt-1 whitespace-normal md:hidden" data-testid="wiki-share-scope-mobile">
                    <ShareScope item={i} />
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <ShareScope item={i} />
                </TableCell>
                {showCreator && <TableCell className="hidden md:table-cell">{i.createdBy.name}</TableCell>}
                <TableCell className="hidden text-sm md:table-cell">{expiryLabel(i.expiresAt)}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                  {i.lastAccessedAt ? formatListTime(i.lastAccessedAt) : '아직 없음'}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{i.viewCount}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-0.5">
                    {/* 만료된 링크는 열리지 않으므로 복사하지 않는다(WP-1086). */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label="링크 복사"
                      disabled={isShareExpired(i.expiresAt)}
                      onClick={() => void copyShareLink(i.token)}
                    >
                      <Link2 aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8" aria-label="페이지 열기" onClick={() => onOpenPage(i)}>
                      <ExternalLink aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-destructive hover:text-destructive"
                      disabled={revoking}
                      onClick={() => onRevoke([i.pageId])}
                    >
                      해제
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
