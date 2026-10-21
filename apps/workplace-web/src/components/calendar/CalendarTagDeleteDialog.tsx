// 태그 지우기 확인 (WP-714) — 공통 삭제 확인창(DeleteConfirmDialog)에 태그 문구만 얹는다.
// 무엇이 사라지는지(붙은 일정 수·구독 주소)와, Outlook 범주에서 온 태그는 다시 생길 수 있음을 함께 알린다(설계 노트 「지우기」).
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import type { CalendarTag } from '@/types/calendar'

interface CalendarTagDeleteDialogProps {
  /** 지울 태그 — null 이면 닫힘 */
  tag: CalendarTag | null
  onCancel: () => void
  onConfirm: () => void
  /** 내 캘린더에 Outlook 등 연동 계정이 있는지 — 있으면 「범주에서 온 태그는 다시 생길 수 있어요」 안내를 덧붙인다 */
  hasLinkedAccount: boolean
}

export function CalendarTagDeleteDialog({ tag, onCancel, onConfirm, hasLinkedAccount }: CalendarTagDeleteDialogProps) {
  const eventCount = tag?.eventCount ?? 0
  return (
    <DeleteConfirmDialog
      open={tag != null}
      onOpenChange={(o) => !o && onCancel()}
      entityName="태그"
      itemName={tag?.name ?? ''}
      description={
        <>
          「{tag?.name}」 태그를 지울까요? 일정은 그대로 남아요.
          {tag?.hasFeed && ' 이 태그의 구독 주소도 함께 막혀요.'}
          {hasLinkedAccount && ' Outlook 범주에서 온 태그는 다음 동기화 때 범주가 남아 있으면 다시 생겨요.'}
        </>
      }
      // 붙은 일정이 없으면 영향 안내를 생략한다(공통 확인창 규칙, WP-488)
      impact={eventCount > 0 ? `붙어 있던 일정 ${eventCount}개에서 태그가 빠집니다.` : undefined}
      onConfirm={onConfirm}
      contentTestId="calendar-tag-delete-confirm"
      confirmTestId="calendar-tag-delete-submit"
    />
  )
}
