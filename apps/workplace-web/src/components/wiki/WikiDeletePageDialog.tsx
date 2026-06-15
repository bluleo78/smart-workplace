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

/**
 * 노트 페이지 삭제 확인 — controlled(open/onOpenChange). 드롭다운 메뉴 항목에서 열기 위해
 * trigger 기반 DeleteConfirmDialog 대신 별도로 둔다. 하위 페이지 동반 삭제를 경고한다.
 */
export function WikiDeletePageDialog({
  open,
  onOpenChange,
  pageTitle,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pageTitle: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="wiki-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>페이지 삭제</AlertDialogTitle>
          <AlertDialogDescription>
            &quot;{pageTitle || '제목 없음'}&quot; 페이지를 삭제할까요? 하위 페이지도 함께 삭제되며 되돌릴 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          {/* 파괴적 작업 — destructive 변형으로 실수 클릭 방지 */}
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
