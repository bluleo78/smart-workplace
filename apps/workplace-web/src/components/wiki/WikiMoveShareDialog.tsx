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

import { type CoveringShare,coveringShareName as shareName } from './wikiShare'

/**
 * 하위 포함 공유 안팎으로 페이지를 옮기기 전 확인(WP-579) — 공유 범위는 지금 트리 위치로 정해지므로
 * 옮기는 순간 링크로 보이던 페이지(와 그 하위)가 사라지거나 새로 보인다. 확정하면 공유 기록에도 남는다(서버).
 */
export function WikiMoveShareDialog({
  state,
  onCancel,
  onConfirm,
}: {
  state: { impact: { leaving: CoveringShare[]; entering: CoveringShare[] }; title: string } | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const leaving = state?.impact.leaving ?? []
  const entering = state?.impact.entering ?? []
  return (
    <AlertDialog open={state != null} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent data-testid="wiki-move-share-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>공유 범위가 바뀝니다</AlertDialogTitle>
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
