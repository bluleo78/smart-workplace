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
 * 노트 팀 스페이스 삭제 확인 — controlled(open/onOpenChange). 사이드바 스페이스 메뉴에서 연다(WP-580).
 * 노트 페이지는 휴지통 없이 영구 삭제되므로, 함께 사라지는 페이지 수를 문구에 넣어 규모를 알린다.
 */
export function WikiDeleteSpaceDialog({
  open,
  onOpenChange,
  spaceName,
  pageCount,
  pending = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  spaceName: string
  /** 스페이스 안 페이지 수 — 0 이면 스페이스만, 모르면(트리 미로딩) null 이고 수 없이 안내한다. */
  pageCount: number | null
  pending?: boolean
  onConfirm: () => void
}) {
  // 안내 문구 — 페이지가 없으면 스페이스만, 있으면 함께 지워지는 규모(수를 모르면, 즉 트리 미로딩이면 수 없이)와 첨부·이력까지.
  const message =
    pageCount === 0
      ? `"${spaceName}" 스페이스가 영구 삭제됩니다. 되돌릴 수 없습니다.`
      : `"${spaceName}" 스페이스와 ${pageCount == null ? '모든 페이지' : `페이지 ${pageCount}개`}가 함께 영구 삭제됩니다. ` +
        '페이지의 첨부 파일과 변경 이력도 사라지며 되돌릴 수 없습니다.'
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="wiki-space-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>스페이스 삭제</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          {/* 파괴적 작업 — destructive 변형으로 실수 클릭 방지 */}
          <AlertDialogAction
            variant="destructive"
            data-testid="wiki-space-delete-confirm"
            disabled={pending}
            // 기본 동작(바로 닫기)을 막는다 — 요청이 끝날 때까지 창을 두고, 성공하면 호출처가 닫는다(실패하면 그대로 다시 시도).
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
          >
            {pending ? '삭제 중…' : '삭제'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
