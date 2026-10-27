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

import { blockedShareNotice, coveringShareName as shareName, type ShareMoveImpact } from './wikiShare'

/**
 * 하위 포함 공유 안팎으로 페이지를 옮기기 전 확인(WP-579) — 공유 범위는 지금 트리 위치로 정해지므로
 * 옮기는 순간 링크로 보이던 페이지(와 그 하위)가 사라지거나 새로 보인다. 확정하면 공유 기록에도 남는다(서버).
 * 상위 공유에서 제외된 페이지(WP-987)는 새 위치의 공유로도 열리지 않으므로 그렇다고 알린다(WP-1031, blocked).
 */
export function WikiMoveShareDialog({
  state,
  onCancel,
  onConfirm,
}: {
  state: { impact: ShareMoveImpact; title: string } | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const leaving = state?.impact.leaving ?? []
  const entering = state?.impact.entering ?? []
  const blocked = state?.impact.blocked ?? []
  // 제외된 페이지를 옮기면 공유 범위는 그대로다(blocked 가 있으면 leaving·entering 은 늘 비어 있다 — impactOf)
  // — 「바뀝니다」 대신 열리지 않는다는 제목을 단다.
  const unchanged = blocked.length > 0
  return (
    <AlertDialog open={state != null} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent data-testid="wiki-move-share-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{unchanged ? '새 위치의 공유 링크로는 열리지 않습니다' : '공유 범위가 바뀝니다'}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>「{state?.title || '제목 없음'}」 페이지(하위 페이지 포함)를 여기로 옮기면</p>
              <ul className="list-disc space-y-1 pl-5">
                {leaving.map((s) => (
                  <li key={`out-${s.pageId}`}>{shareName(s)}로 더 이상 보이지 않습니다.</li>
                ))}
                {entering.map((s) => (
                  <li key={`in-${s.pageId}`} className={s.audience === 'PUBLIC' ? 'font-medium text-foreground' : undefined}>
                    {shareName(s)}로 새로 보이게 됩니다.
                  </li>
                ))}
                {blocked.map((s) => (
                  <li key={`blocked-${s.pageId}`} data-testid="wiki-move-share-blocked">
                    {blockedShareNotice(s)}
                  </li>
                ))}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>옮기기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
