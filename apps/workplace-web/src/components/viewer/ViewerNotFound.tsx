import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

/**
 * 뷰어 딥링크 대상이 목록에도 클릭 스냅숏에도 없을 때(삭제·이동·권한 상실)의 안내(WP-208 → WP-277 공용화).
 * 조용히 URL 을 고치지 않고 안내한 뒤, 닫으면 호출부가 ?preview 를 지운다(onClose).
 */
export function ViewerNotFound({
  onClose,
  description = '삭제되었거나 다른 폴더로 이동한 파일입니다.',
}: {
  onClose: () => void
  /** 화면별 안내 문구 — 기본은 드라이브 문구. */
  description?: string
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent data-testid="preview-not-found">
        <DialogHeader>
          <DialogTitle>파일을 찾을 수 없습니다</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}
