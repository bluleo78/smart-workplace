// 뷰 칩 바 — [전체] + 저장된 뷰 칩 + ＋뷰 저장. 칩 클릭 시 필터 복원.
import { PanelLeft, Pencil, Plus, RefreshCw, Star, Trash2, Users } from 'lucide-react'
import { useState } from 'react'

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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { useDeleteSavedView, usePinSavedView } from '../../../hooks/queries/useSavedViews'
import type { SavedViewResponse } from '../../../types/savedView'
import { useSavedViewState } from '../hooks/useSavedViewState'
import { SaveViewDialog } from './SaveViewDialog'

export function ViewChipBar({
  projectKey,
  epicPanelOpen,
  onToggleEpicPanel,
}: {
  projectKey: string
  epicPanelOpen: boolean
  onToggleEpicPanel: () => void
}) {
  const s = useSavedViewState(projectKey)
  const del = useDeleteSavedView(projectKey)
  const pin = usePinSavedView(projectKey)
  const [saveOpen, setSaveOpen] = useState(false)
  // 수정 중인 뷰 — null 이면 수정 다이얼로그 닫힘.
  const [editing, setEditing] = useState<SavedViewResponse | null>(null)
  // 삭제 확인 대화상자 대상 뷰 id — null 이면 닫힘.
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)

  // 클로저(onClick) 안에서도 null 좁히기가 유지되도록 지역 상수로 꺼낸다.
  const activeView = s.activeView

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid="view-chip-bar">
      <button
        type="button"
        data-testid="view-chip-all"
        onClick={s.applyAll}
        className={cn(
          'rounded-full border px-3 py-1 text-sm',
          s.isAllActive ? 'border-foreground bg-accent font-medium' : 'text-muted-foreground hover:bg-accent/50',
        )}
      >
        전체
      </button>

      {s.views.map((v) => {
        // 칩 활성 판정(전체와 동시 활성 방지, #599)은 훅의 isViewActive 가 담당.
        const active = s.isViewActive(v)
        return (
          <div key={v.id} className="group flex items-center">
            <button
              type="button"
              data-testid={`view-chip-${v.id}`}
              onClick={() => s.apply(v.query)}
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
                  // hidden/inline-flex 토글 대신 opacity 로 시각적으로만 숨김 — 항상 레이아웃에 존재해야
                  // 메뉴 오픈 중 :hover 판정이 사라져도 트리거 rect 가 유효해 Radix Popper 앵커가 깨지지 않는다(#693).
                  className="ml-0.5 inline-flex min-w-6 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent focus-visible:opacity-100 data-[state=open]:opacity-100"
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

      {/* #777: 활성 뷰가 있고 필터가 바뀐(dirty) 상태면 "뷰 업데이트"/"새 뷰로 저장" 두 액션을
          제공한다. 활성 뷰가 있지만 dirty 가 아니면 저장할 변경이 없으므로 버튼 비활성(중복 뷰
          생성 방지). 활성 뷰가 없으면(전체 보기) 기존과 동일하게 "새 뷰로 저장"만 제공. */}
      {activeView ? (
        s.isViewDirty ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="update-view-button"
              onClick={() => s.updateActiveView(activeView)}
              className="flex items-center gap-1 rounded-full border border-foreground bg-accent px-3 py-1 text-sm font-medium hover:bg-accent/70"
            >
              <RefreshCw className="h-3.5 w-3.5" /> 뷰 업데이트
            </button>
            <button
              type="button"
              data-testid="save-view-button"
              onClick={() => setSaveOpen(true)}
              className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:bg-accent/50"
            >
              <Plus className="h-3.5 w-3.5" /> 새 뷰로 저장
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-testid="save-view-button"
            disabled
            title="변경된 필터가 없습니다"
            className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> 뷰 저장
          </button>
        )
      ) : (
        // 필터 미적용 시 비활성 — 빈 query 저장 방지(백엔드 NotBlank 위반 선제 차단).
        <button
          type="button"
          data-testid="save-view-button"
          onClick={() => setSaveOpen(true)}
          disabled={s.hasNothingToSave}
          title={s.hasNothingToSave ? '필터를 먼저 적용하세요' : undefined}
          className="flex items-center gap-1 rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <Plus className="h-3.5 w-3.5" /> 뷰 저장
        </button>
      )}

      {/* 에픽 패널 토글 — 우측 끝 고정(ml-auto). shadcn Toggle 프리미티브가 없어
          앱 관례(aria-pressed 토글 버튼)대로 Button + aria-pressed 로 구현. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="epic-panel-toggle"
        aria-pressed={epicPanelOpen}
        onClick={onToggleEpicPanel}
        className={cn('ml-auto rounded-full transition-colors', epicPanelOpen && 'bg-accent')}
      >
        <PanelLeft aria-hidden="true" /> 에픽
      </Button>

      <SaveViewDialog
        projectKey={projectKey}
        query={s.currentQuery}
        open={saveOpen}
        onOpenChange={setSaveOpen}
      />

      {/* 수정 다이얼로그 — key 로 리마운트해 선택한 뷰의 이름/가시성을 초기값으로 채운다. */}
      {editing && (
        <SaveViewDialog
          key={editing.id}
          projectKey={projectKey}
          query={s.currentQuery}
          editing={editing}
          open
          onOpenChange={(v) => {
            if (!v) setEditing(null)
          }}
        />
      )}

      {/* #777: 공유(SHARED) 뷰 업데이트 확인 AlertDialog — 갱신이 다른 사람에게도 즉시
          반영되므로 즉시 실행 대신 한 번 확인시킨다. */}
      <AlertDialog
        open={s.updateConfirmTarget !== null}
        onOpenChange={(open) => { if (!open) s.setUpdateConfirmTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>공유된 뷰 업데이트</AlertDialogTitle>
            <AlertDialogDescription>
              &apos;{s.updateConfirmTarget?.name}&apos;은(는) 공유된 뷰입니다. 지금 업데이트하면 변경된 필터가
              이 뷰를 보는 다른 사람에게도 즉시 반영됩니다. 계속하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              data-testid="update-view-confirm"
              onClick={s.confirmUpdate}
            >
              업데이트
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 삭제 확인 AlertDialog — 즉시 삭제 방지, 앱 전체 삭제 UX 패턴과 일관성 유지 (#188). */}
      <AlertDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => { if (!open) setDeleteTargetId(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>저장된 뷰 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              &apos;{s.views.find((v) => v.id === deleteTargetId)?.name}&apos; 뷰를 삭제하시겠습니까?
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
