// 뷰 칩 바 — [전체] + 저장된 뷰 칩 + ＋뷰 저장. 칩 클릭 시 필터 복원.
import { Pencil, Plus, Star, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { useDeleteSavedView, usePinSavedView, useSavedViews } from '../../../hooks/queries/useSavedViews'
import { filtersToParams, parseFilters, parseGroupBy, parseView } from '../../../lib/issueFilters'
import { normalizeIssueQueryIgnoringView, queriesEqualIgnoringView } from '../../../lib/savedViewQuery'
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
  // 삭제 확인 대화상자 대상 뷰 id — null 이면 닫힘.
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)

  // 현재 URL 필터를 canonical 쿼리스트링으로 — 저장 뷰 페이로드(뷰 저장/수정 다이얼로그)에 사용.
  // group 도 포함해야 그룹이 저장 뷰에 영속된다 (#58). view(list/board) 도 그대로 저장.
  const currentQuery = filtersToParams(parseFilters(params), parseView(params), parseGroupBy(params)).toString()
  // "전체"/저장뷰 활성 판정은 view 를 제외하고 비교한다 (#599) — 리스트/보드 전환이
  // 우연히 저장뷰의 쿼리와 일치해 전체 대신 그 저장뷰가 활성으로 보이는 것을 방지.
  const currentQueryIgnoringView = normalizeIssueQueryIgnoringView(currentQuery)
  const isAllActive = currentQueryIgnoringView === ''

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
        // 필터 없이 view 만 저장된 뷰(예: "view=board" 전용)는 view 무시 비교 시 빈 쿼리와
        // 같아져 "전체"와 동시에 활성화될 수 있다 — 그 영역은 전체의 몫이므로 제외한다 (#599).
        const active = !isAllActive && queriesEqualIgnoringView(currentQuery, v.query)
        return (
          <div key={v.id} className="group flex items-center">
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
                  className="ml-0.5 hidden group-hover:inline-flex min-w-6 rounded p-1 text-muted-foreground hover:bg-accent"
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
                    onSelect={() => setDeleteTargetId(v.id)}
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

      {/* 필터 미적용 시 비활성 — 빈 query 저장 방지(백엔드 NotBlank 위반 선제 차단). */}
      <button
        type="button"
        data-testid="save-view-button"
        onClick={() => setSaveOpen(true)}
        disabled={isAllActive}
        title={isAllActive ? '필터를 먼저 적용하세요' : undefined}
        className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
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

      {/* 삭제 확인 AlertDialog — 즉시 삭제 방지, 앱 전체 삭제 UX 패턴과 일관성 유지 (#188). */}
      <AlertDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => { if (!open) setDeleteTargetId(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>저장된 뷰 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              &apos;{(views.data ?? []).find((v) => v.id === deleteTargetId)?.name}&apos; 뷰를 삭제하시겠습니까?
              이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTargetId !== null) del.mutate(deleteTargetId)
                setDeleteTargetId(null)
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
