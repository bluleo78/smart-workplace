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

/** 목록에서 공유 해제 확인(WP-579) — 한 개든 여러 개든 링크와 열린 화면이 바로 막힌다는 것을 알린다. */
export function WikiRevokeSharesDialog({
  count,
  onCancel,
  onConfirm,
}: {
  /** 해제할 공유 수 — 0 이면 닫힘. */
  count: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={count > 0} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent data-testid="wiki-revoke-shares-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{count > 1 ? `공유 ${count}개를 해제할까요?` : '공유를 해제할까요?'}</AlertDialogTitle>
          <AlertDialogDescription>
            링크가 바로 막히고, 그 링크로 보고 있던 사람도 화면이 닫힙니다. 스페이스 멤버는 그대로 볼 수 있습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            해제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
