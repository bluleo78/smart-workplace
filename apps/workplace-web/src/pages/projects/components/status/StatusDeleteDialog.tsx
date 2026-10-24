// 상태 삭제 창(WP-809) — 열릴 때 삭제 영향(이슈 수·저장된 뷰·에픽 차단)을 받아 네 갈래로 보인다.
// (1) 이슈 0개: 간단 확인 「삭제」 (2) 이슈 있음: 「옮길 상태」를 골라 「이슈 N개 옮기고 삭제」
// (3) 다른 범주를 고르면 범주가 바뀐다는 경고 (4) 미완료 하위가 있는 에픽이 있으면 완료 범주로는 옮길 수 없어 버튼을 막는다.
// 이슈 수·버튼 문구는 영향 응답 값을 쓴다(목록의 group-counts 는 잠깐 낡았을 수 있다). 서버 거절은 창 안에 보이고 닫지 않는다.
// 이슈 0개로 보고 지웠는데 그새 이슈가 생겨 400 이면 영향을 다시 받아 옮길 상태 선택으로 바꾼다.
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { getStatusDeletionImpact } from '@/api/projectStatuses'
import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/overlay/select'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useDeleteProjectStatus } from '@/hooks/queries/useProjectStatuses'
import { useIsMobile } from '@/hooks/useIsMobile'
import { extractApiError } from '@/lib/api-error'
import { defaultMoveTarget, deletionWarning, moveTargetGroups } from '@/lib/projectStatuses'
import { directionParticle } from '@/lib/utils'
import type { ProjectStatus, StatusDeletionImpact } from '@/types/projectStatus'

/** 완료 범주로 옮기면 미완료 하위가 있는 에픽이 「완료」가 돼 WP-689 불변식이 깨진다 — 그때만 막는다(원래 완료 범주면 이미 완료). */
function blocksEpics(deleting: ProjectStatus, target: ProjectStatus | undefined, impact: StatusDeletionImpact): boolean {
  return target?.category === 'DONE' && deleting.category !== 'DONE' && impact.blockedEpicCount > 0
}

export function StatusDeleteDialog({
  projectKey,
  status,
  statuses,
  issueCount,
  onClose,
}: {
  projectKey: string
  /** 지울 상태 — null 이면 닫힘. */
  status: ProjectStatus | null
  statuses: readonly ProjectStatus[]
  /** 목록에 보이던 이슈 수 — 영향을 받기 전 설명에만 쓴다. */
  issueCount: number | undefined
  onClose: () => void
}) {
  // 모바일(<1024)은 같은 내용을 바텀시트로 — 가운데 창보다 엄지가 닿기 쉽고 긴 경고도 화면 폭을 다 쓴다(시안 「모바일은 바텀시트」).
  const isMobile = useIsMobile()
  const open = status != null
  const onOpenChange = (next: boolean) => !next && onClose()
  // 대상이 바뀌면 고른 옮길 상태·오류를 새로 시작한다(key).
  const body = status && (
    <DeleteBody
      key={status.id}
      layout={isMobile ? 'sheet' : 'dialog'}
      projectKey={projectKey}
      status={status}
      statuses={statuses}
      issueCount={issueCount}
      onClose={onClose}
    />
  )
  return isMobile ? (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {body}
    </Sheet>
  ) : (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {body}
    </AlertDialog>
  )
}

function DeleteBody({
  layout,
  projectKey,
  status,
  statuses,
  issueCount,
  onClose,
}: {
  /** dialog: 데스크톱 가운데 확인창, sheet: 모바일 바텀시트 — 내용은 같고 겉틀만 다르다. */
  layout: 'dialog' | 'sheet'
  projectKey: string
  status: ProjectStatus
  statuses: readonly ProjectStatus[]
  issueCount: number | undefined
  onClose: () => void
}) {
  // 삭제 영향 — 열 때마다 새로 받는다. 키를 ['projectStatuses'] 밖에 둬 삭제 성공 무효화·SSE 가 지운 상태의 영향을 다시 묻지 않게.
  const impact = useQuery({
    queryKey: ['statusDeletionImpact', projectKey, status.id],
    queryFn: () => getStatusDeletionImpact(projectKey, status.id),
    staleTime: 0,
    gcTime: 0,
  })
  const remove = useDeleteProjectStatus(projectKey)
  // 지우는 동안 목록이 갱신돼도 창 안 선택지가 흔들리지 않게 연 순간의 목록을 쓴다.
  const [list] = useState(statuses)
  const [moveToId, setMoveToId] = useState<number | undefined>(() => defaultMoveTarget(list, status)?.id)
  const [error, setError] = useState<string | null>(null)

  const data = impact.data
  const n = data?.issueCount ?? issueCount ?? 0
  const hasIssues = data ? data.issueCount > 0 : (issueCount ?? 0) > 0
  const target = list.find((s) => s.id === moveToId)
  const groups = moveTargetGroups(list, status)
  const warning = hasIssues && target ? deletionWarning(status.category, target.category, n) : null
  const blocked = data != null && hasIssues && blocksEpics(status, target, data)

  async function confirm() {
    setError(null)
    try {
      await remove.mutateAsync({ id: status.id, moveTo: hasIssues ? moveToId : undefined })
      toast.success(`「${status.name}」 상태를 삭제했어요`)
      onClose()
    } catch (e) {
      setError(extractApiError(e, '상태를 삭제하지 못했어요'))
      // 연 뒤에 이 상태로 이슈가 옮겨 오면 열 때 받은 영향(이슈 0개)이 낡아 서버가 「옮길 상태를 골라 주세요」(400)로 거절한다 —
      // 영향을 다시 받아 옮길 상태 선택이 나타나게 한다(창은 연 채로, 서버 문구는 위에 보인다). 400 일 때만 — 다른 거절은 영향과 무관하다.
      if (!hasIssues && axios.isAxiosError(e) && e.response?.status === 400) void impact.refetch()
    }
  }

  const title = `「${status.name}」 상태를 삭제할까요?`
  const description = hasIssues
    ? `이 상태의 이슈 ${n}개를 다른 상태로 옮긴 뒤 삭제해요.`
    : '이 상태에 이슈가 없어요. 보드에서 이 컬럼이 사라져요.'
  const content = (
    <div className="min-w-0 space-y-3 text-sm">
      {impact.isError && (
        <p role="alert" className="text-destructive">
          {extractApiError(impact.error, '삭제 영향을 확인하지 못했어요')}
        </p>
      )}

      {hasIssues && (
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="status-move-target">
            옮길 상태
          </label>
          <Select value={moveToId != null ? String(moveToId) : undefined} onValueChange={(v) => setMoveToId(Number(v))}>
            <SelectTrigger id="status-move-target" data-testid="status-move-target" className="w-full">
              <SelectValue placeholder="옮길 상태를 고르세요" />
            </SelectTrigger>
            <SelectContent position="popper">
              {groups.same.length > 0 && (
                <SelectGroup>
                  <SelectLabel>같은 범주</SelectLabel>
                  {groups.same.map((s) => (
                    <MoveTargetItem key={s.id} status={s} />
                  ))}
                </SelectGroup>
              )}
              {groups.same.length > 0 && groups.other.length > 0 && <SelectSeparator />}
              {groups.other.length > 0 && (
                <SelectGroup>
                  <SelectLabel>다른 범주</SelectLabel>
                  {groups.other.map((s) => (
                    <MoveTargetItem key={s.id} status={s} />
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* 다른 범주 경고 — 확인 전에 읽게 하는 안내라 role=alert 로 끼어들지 않고 경고 톤으로만 둔다. */}
      {warning && (
        <p
          data-testid="status-delete-warning"
          className="flex gap-2 rounded-md border border-warning/40 bg-warning-subtle p-3 text-warning-text"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0">{warning}</span>
        </p>
      )}

      {blocked && data && (
        <p data-testid="status-delete-blocked" className="text-destructive">
          미완료 하위가 있는 에픽 {data.blockedEpicCount}개 때문에 완료 범주로 옮길 수 없어요
        </p>
      )}

      {/* 저장된 뷰 안내 — 이슈가 있으면 필터가 옮길 상태로 바뀌고, 없으면 필터가 비는 뷰만 알린다. */}
      {data && hasIssues && data.savedViewCount > 0 && target && (
        <p className="rounded-md bg-muted p-3 text-muted-foreground">
          저장된 뷰 {data.savedViewCount}개의 필터도 &apos;{target.name}&apos;{directionParticle(target.name)} 바뀌어요
        </p>
      )}
      {data && !hasIssues && data.emptiedFilterViewCount > 0 && (
        <p className="rounded-md bg-muted p-3 text-muted-foreground">
          저장된 뷰 {data.emptiedFilterViewCount}개에서 이 상태 필터가 빠져요
        </p>
      )}

      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
  // AlertDialogAction 은 누르면 바로 닫혀 서버 거절을 창 안에 보일 수 없다 — 일반 버튼으로 두고 성공 때만 닫는다.
  const confirmButton = (
    <Button
      type="button"
      variant="destructive"
      data-testid="status-delete-confirm"
      disabled={!data || blocked || (hasIssues && !target) || remove.isPending}
      onClick={() => void confirm()}
    >
      {hasIssues ? `이슈 ${n}개 옮기고 삭제` : '삭제'}
    </Button>
  )

  if (layout === 'sheet') {
    return (
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid="status-delete-dialog"
        data-layout="sheet"
        className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-muted-foreground/30" />
        <SheetHeader className="p-0 pb-3 text-left">
          <SheetTitle className="break-words">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {content}
        {/* 엄지 영역 — 주 동작을 위에, 취소를 아래에 꽉 찬 폭으로. */}
        <div className="mt-4 flex flex-col gap-2 [&>button]:w-full">
          {confirmButton}
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
        </div>
      </SheetContent>
    )
  }

  return (
    <AlertDialogContent data-testid="status-delete-dialog" data-layout="dialog">
      <AlertDialogHeader>
        <AlertDialogTitle className="break-words">{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      {content}
      <AlertDialogFooter>
        <AlertDialogCancel>취소</AlertDialogCancel>
        {confirmButton}
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}

/**
 * 옮길 상태 선택지 — 상태 아이콘(모양=범주) + 이름. 고른 값이 트리거에 그대로 비치므로 범주 라벨은 덧붙이지 않고,
 * 범주는 아이콘 모양과 묶음 제목(같은/다른 범주)으로, 바뀌는 범주는 아래 경고로 알린다.
 */
function MoveTargetItem({ status }: { status: ProjectStatus }) {
  return (
    <SelectItem value={String(status.id)}>
      <IssueStatusIcon status={status.category} color={status.color} decorative className="h-4 w-4" />
      <span className="min-w-0 truncate">{status.name}</span>
    </SelectItem>
  )
}
