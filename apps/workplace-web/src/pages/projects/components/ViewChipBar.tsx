// 뷰 칩 바 — [전체] + 저장된 뷰 칩 + ＋뷰 저장. 칩 클릭 시 필터 복원.
import { PanelLeft, Pencil, Plus, RefreshCw, Star, Trash2, Users } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import {
  useDeleteSavedView,
  usePinSavedView,
  useSavedViews,
  useUpdateSavedView,
} from '../../../hooks/queries/useSavedViews'
import { filtersToParams, parseFilters, parseGroupBy, parseView } from '../../../lib/issueFilters'
import {
  normalizeIssueQueryIgnoringView,
  normalizeIssueQueryIgnoringViewAndGroup,
  queriesEqualIgnoringView,
} from '../../../lib/savedViewQuery'
import type { SavedViewResponse } from '../../../types/savedView'
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
  const [params, setParams] = useSearchParams()
  const views = useSavedViews(projectKey)
  const del = useDeleteSavedView(projectKey)
  const pin = usePinSavedView(projectKey)
  const update = useUpdateSavedView(projectKey)
  const [saveOpen, setSaveOpen] = useState(false)
  // 수정 중인 뷰 — null 이면 수정 다이얼로그 닫힘.
  const [editing, setEditing] = useState<SavedViewResponse | null>(null)
  // 삭제 확인 대화상자 대상 뷰 id — null 이면 닫힘.
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null)
  // 필터 갱신(#777) — "마지막으로 선택된 뷰" id. 칩 클릭/생성 직후엔 쿼리 내용으로 자동
  // 동기화되지만, 이후 사용자가 필터를 바꿔 더 이상 어떤 뷰의 쿼리와도 일치하지 않게 되어도
  // (dirty 상태) 이 값은 유지되어야 "뷰 업데이트" 대상이 누구인지 알 수 있다.
  const [selectedViewId, setSelectedViewId] = useState<number | null>(null)
  // matchingSignature 변화 감지용 — 렌더 중 setState 패턴에서 무한루프 방지.
  const [prevMatchingSignature, setPrevMatchingSignature] = useState<number | null | undefined>(undefined)
  // 업데이트 확인 대화상자 대상 뷰(SHARED 뷰만) — null 이면 닫힘.
  const [updateConfirmTarget, setUpdateConfirmTarget] = useState<SavedViewResponse | null>(null)

  // 현재 URL 필터를 canonical 쿼리스트링으로 — 저장 뷰 페이로드(뷰 저장/수정 다이얼로그)에 사용.
  // group 도 포함해야 그룹이 저장 뷰에 영속된다 (#58). view(list/board) 도 그대로 저장.
  const currentQuery = filtersToParams(parseFilters(params), parseView(params), parseGroupBy(params)).toString()
  // "전체" 칩 활성 판정은 view·group 을 모두 제외하고 비교한다 (#599, #773) — 리스트/보드
  // 전환이나 그룹 변경이 우연히 저장뷰의 쿼리와 일치해 전체 대신 그 저장뷰가 활성으로 보이거나,
  // 반대로 필터가 전혀 없는데도 그룹만 바꿨다는 이유로 전체 칩이 비활성으로 보이는 것을 방지.
  // group 은 필터가 아니라 표시 옵션이라 "필터 없음" 여부와는 무관해야 한다.
  const isAllActive = normalizeIssueQueryIgnoringViewAndGroup(currentQuery) === ''
  // "뷰 저장" 버튼 비활성 판정은 기존대로 group 을 포함해 비교한다 — group 만 설정된 상태도
  // 저장할 가치가 있는 뷰이기 때문(#58 그룹 영속 테스트). isAllActive(칩 강조용)와는 목적이 달라
  // 별도 변수로 분리한다.
  const hasNothingToSave = normalizeIssueQueryIgnoringView(currentQuery) === ''

  // 현재 쿼리 내용과 일치하는 저장 뷰(있다면) — 칩 클릭/생성 직후 selectedViewId 동기화에 사용.
  const matchingView = !isAllActive
    ? (views.data ?? []).find((v) => queriesEqualIgnoringView(currentQuery, v.query))
    : undefined
  // #777: 필터가 활성 뷰의 쿼리와 일치하는 동안에는 selectedViewId 를 그 뷰로 유지/동기화하고,
  // "전체" 로 돌아가면 초기화한다. 필터만 바뀌어 더 이상 일치하지 않는 경우(dirty)는 그대로 유지해
  // "뷰 업데이트" 대상을 잃지 않는다. 렌더 중 조건부 setState(React 권장 패턴)로 처리해
  // 불필요한 effect 왕복 렌더를 피한다 — matchingSignature 로 실제 변화가 있을 때만 반영.
  const matchingSignature = matchingView ? matchingView.id : isAllActive ? null : undefined
  if (matchingSignature !== undefined && matchingSignature !== prevMatchingSignature) {
    setPrevMatchingSignature(matchingSignature)
    setSelectedViewId(matchingSignature)
  }
  const activeView = selectedViewId != null ? (views.data ?? []).find((v) => v.id === selectedViewId) ?? null : null
  // dirty: 활성 뷰가 있고 현재 URL 쿼리가 그 뷰의 저장된 쿼리와 (view 무시) 다르다.
  const isViewDirty = !!activeView && !queriesEqualIgnoringView(currentQuery, activeView.query)

  // 쿼리스트링을 URL 로 적용 — 저장된 뷰/전체 칩 클릭 시 필터 복원.
  const apply = (query: string) => setParams(new URLSearchParams(query), { replace: true })

  // "뷰 업데이트" — 이름/가시성은 유지하고 query 만 현재 필터로 교체(재생성 아님, 동일 id PATCH).
  // 공유(SHARED) 뷰는 갱신이 다른 사람에게도 즉시 반영되므로 확인 대화상자를 거친다.
  const updateActiveView = (v: SavedViewResponse) => {
    if (v.visibility === 'SHARED') {
      setUpdateConfirmTarget(v)
      return
    }
    update.mutate({ id: v.id, body: { name: v.name, query: currentQuery, visibility: v.visibility } })
  }

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
        isViewDirty ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="update-view-button"
              onClick={() => updateActiveView(activeView)}
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
          disabled={hasNothingToSave}
          title={hasNothingToSave ? '필터를 먼저 적용하세요' : undefined}
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

      {/* #777: 공유(SHARED) 뷰 업데이트 확인 AlertDialog — 갱신이 다른 사람에게도 즉시
          반영되므로 즉시 실행 대신 한 번 확인시킨다. */}
      <AlertDialog
        open={updateConfirmTarget !== null}
        onOpenChange={(open) => { if (!open) setUpdateConfirmTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>공유된 뷰 업데이트</AlertDialogTitle>
            <AlertDialogDescription>
              &apos;{updateConfirmTarget?.name}&apos;은(는) 공유된 뷰입니다. 지금 업데이트하면 변경된 필터가
              이 뷰를 보는 다른 사람에게도 즉시 반영됩니다. 계속하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              data-testid="update-view-confirm"
              onClick={() => {
                if (updateConfirmTarget) {
                  update.mutate({
                    id: updateConfirmTarget.id,
                    body: { name: updateConfirmTarget.name, query: currentQuery, visibility: updateConfirmTarget.visibility },
                  })
                }
                setUpdateConfirmTarget(null)
              }}
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
