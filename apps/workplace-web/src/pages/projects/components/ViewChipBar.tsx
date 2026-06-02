// 뷰 칩 바 — [전체] + 저장된 뷰 칩 + ＋뷰 저장. 칩 클릭 시 필터 복원.
import { Pencil, Plus, Star, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { useDeleteSavedView, usePinSavedView, useSavedViews } from '../../../hooks/queries/useSavedViews'
import { filtersToParams, parseFilters, parseGroupBy, parseView } from '../../../lib/issueFilters'
import { queriesEqual } from '../../../lib/savedViewQuery'
import type { SavedViewResponse } from '../../../types/savedView'
import { SaveViewDialog } from './SaveViewDialog'

export function ViewChipBar({ projectKey }: { projectKey: string }) {
  const [params, setParams] = useSearchParams()
  const views = useSavedViews(projectKey)
  const del = useDeleteSavedView(projectKey)
  const pin = usePinSavedView(projectKey)
  const [saveOpen, setSaveOpen] = useState(false)
  // 수정 중인 뷰 — null 이면 수정 다이얼로그 닫힘.
  const [editing, setEditing] = useState<SavedViewResponse | null>(null)

  // 현재 URL 필터를 canonical 쿼리스트링으로 — 저장/활성칩 판정에 동일 기준 사용.
  // group 도 포함해야 그룹이 저장 뷰에 영속되고 활성 칩 판정에 반영된다 (#58).
  const currentQuery = filtersToParams(parseFilters(params), parseView(params), parseGroupBy(params)).toString()
  const isAllActive = currentQuery === ''

  // 쿼리스트링을 URL 로 적용 — 저장된 뷰/전체 칩 클릭 시 필터 복원.
  const apply = (query: string) => setParams(new URLSearchParams(query), { replace: true })

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid="view-chip-bar">
      <button
        type="button"
        data-testid="view-chip-all"
        onClick={() => apply('')}
        className={cn(
          'rounded-full border px-3 py-1 text-sm',
          isAllActive ? 'border-foreground bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50',
        )}
      >
        전체
      </button>

      {(views.data ?? []).map((v) => {
        const active = queriesEqual(currentQuery, v.query)
        return (
          <div key={v.id} className="flex items-center">
            <button
              type="button"
              data-testid={`view-chip-${v.id}`}
              onClick={() => apply(v.query)}
              className={cn(
                'flex items-center gap-1 rounded-full border py-1 pl-3 pr-2 text-sm',
                active ? 'border-foreground bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              {v.visibility === 'SHARED' && <Users className="h-3.5 w-3.5" aria-label="공유" />}
              <span>{v.name}</span>
            </button>
            {v.mine && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  data-testid={`view-chip-menu-${v.id}`}
                  aria-label="뷰 메뉴"
                  className="ml-0.5 rounded p-1 text-muted-foreground hover:bg-accent"
                >
                  ⋯
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    data-testid={`view-pin-${v.id}`}
                    onSelect={() => pin.mutate({ id: v.id, pinned: !v.pinned })}
                  >
                    <Star className={cn('mr-2 h-4 w-4', v.pinned && 'fill-current')} />
                    {v.pinned ? '고정 해제' : '사이드바에 고정'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid={`view-edit-${v.id}`}
                    onSelect={() => setEditing(v)}
                  >
                    <Pencil className="mr-2 h-4 w-4" /> 수정
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid={`view-delete-${v.id}`}
                    onSelect={() => del.mutate(v.id)}
                    className="text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> 삭제
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )
      })}

      <button
        type="button"
        data-testid="save-view-button"
        onClick={() => setSaveOpen(true)}
        className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:bg-accent/50"
      >
        <Plus className="h-3.5 w-3.5" /> 뷰 저장
      </button>

      <SaveViewDialog
        projectKey={projectKey}
        query={currentQuery}
        open={saveOpen}
        onOpenChange={setSaveOpen}
      />

      {/* 수정 다이얼로그 — key 로 리마운트해 선택한 뷰의 이름/가시성을 초기값으로 채운다. */}
      {editing && (
        <SaveViewDialog
          key={editing.id}
          projectKey={projectKey}
          query={currentQuery}
          editing={editing}
          open
          onOpenChange={(v) => {
            if (!v) setEditing(null)
          }}
        />
      )}
    </div>
  )
}
