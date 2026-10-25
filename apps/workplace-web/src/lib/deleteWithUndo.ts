// 메시지 삭제 Undo 토스트(#125). soft-delete 복구 API 가 없어 실제 DELETE 를 토스트가 떠 있는 동안 미룬다.
// 삭제 시점은 토스트가 정한다(WP-238): 자동으로 닫히거나 사용자가 닫으면(스와이프 등) 삭제, '실행 취소'면 취소.
// 별도 타이머를 두면 Sonner 가 hover·탭 숨김 동안 카운트다운을 멈출 때 어긋나, 삭제 뒤에도 '실행 취소'가 남았다.
// WP-962: 메일 보관·옮기기·삭제도 같은 방식(토스트가 닫히면 실행, 실행 취소면 취소)이라 일반형 runWithUndoToast 로 뺐다.
import { toast } from 'sonner';

// 실행 취소 가능 시간(ms) = 토스트 노출 시간.
export const UNDO_DELETE_DELAY_MS = 5000;

/** runWithUndoToast 가 돌려주는 손잡이 — 이미 결론이 났는지 보고, 토스트를 기다리지 않고 바로 결론을 낼 때 쓴다. */
export interface UndoToastHandle {
  /** 실행·취소 중 하나로 결론이 났는가. */
  settled(): boolean
  /**
   * 토스트를 기다리지 않고 결론을 낸다 — 이미 났으면 아무것도 하지 않는다. run=false 면 execute 도 onUndo 도 부르지 않는다
   * (페이지를 떠날 때 호출 측이 다른 방법으로 보냈을 때). 토스트는 닫는다.
   */
  settleNow(run: boolean): void
}

/**
 * 성공 토스트 + 「실행 취소」. 토스트가 자동으로 닫히거나 사용자가 닫으면 execute, 「실행 취소」면 onUndo.
 * 닫힘 경로(자동 닫힘·직접 닫기·실행 취소)는 한 번만 결론을 낸다 — 액션 클릭 뒤 onDismiss 가 이어져도 실행되지 않게.
 */
export function runWithUndoToast(
  message: string,
  execute: () => void,
  opts: { onUndo?: () => void } = {},
): UndoToastHandle {
  let settled = false;
  const settle = (shouldRun: boolean) => () => {
    if (settled) return;
    settled = true;
    if (shouldRun) execute();
    else opts.onUndo?.();
  };

  const id = toast.success(message, {
    duration: UNDO_DELETE_DELAY_MS,
    onAutoClose: settle(true),
    onDismiss: settle(true),
    action: {
      label: '실행 취소',
      onClick: settle(false),
    },
  });

  return {
    settled: () => settled,
    settleNow: (run: boolean) => {
      if (settled) return;
      settled = true;
      if (run) execute();
      // 결론이 났으니 토스트를 내린다 — onDismiss 가 다시 불려도 settled 라 아무것도 하지 않는다.
      if (id != null) toast.dismiss(id);
    },
  };
}

// execute: 토스트가 닫힐 때 호출할 삭제 동작(보통 mutation.mutate(id)).
export function deleteMessageWithUndo(execute: () => void) {
  runWithUndoToast('메시지를 삭제했습니다', execute);
}
