// 메시지 삭제 Undo 토스트(#125). soft-delete 복구 API 가 없어 실제 DELETE 를 토스트가 떠 있는 동안 미룬다.
// 삭제 시점은 토스트가 정한다(WP-238): 자동으로 닫히거나 사용자가 닫으면(스와이프 등) 삭제, '실행 취소'면 취소.
// 별도 타이머를 두면 Sonner 가 hover·탭 숨김 동안 카운트다운을 멈출 때 어긋나, 삭제 뒤에도 '실행 취소'가 남았다.
import { toast } from 'sonner';

// 실행 취소 가능 시간(ms) = 토스트 노출 시간.
export const UNDO_DELETE_DELAY_MS = 5000;

// execute: 토스트가 닫힐 때 호출할 삭제 동작(보통 mutation.mutate(id)).
export function deleteMessageWithUndo(execute: () => void) {
  // 닫힘 경로(자동 닫힘·직접 닫기·실행 취소)는 한 번만 결론을 낸다 — 액션 클릭 뒤 onDismiss 가 이어져도 삭제되지 않게.
  let settled = false;
  const settle = (shouldDelete: boolean) => () => {
    if (settled) return;
    settled = true;
    if (shouldDelete) execute();
  };

  toast.success('메시지를 삭제했습니다', {
    duration: UNDO_DELETE_DELAY_MS,
    onAutoClose: settle(true),
    onDismiss: settle(true),
    action: {
      label: '실행 취소',
      onClick: settle(false),
    },
  });
}
