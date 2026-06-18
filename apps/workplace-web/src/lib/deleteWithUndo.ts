// 메시지 삭제 Undo 토스트(#125).
// soft-delete 복구 API 가 없으므로 "지연 삭제" 패턴을 쓴다 — 실제 DELETE 호출을 일정 시간 미루고
// 그동안 '실행 취소' 기회를 준다. 토스트가 자동으로 닫히거나(=지연 만료) X 로 닫히면 execute() 로 삭제를 확정하고,
// '실행 취소' 액션을 누르면 타이머를 취소해 삭제 자체가 일어나지 않는다.
import { toast } from 'sonner';

// 실행 취소 가능 시간(ms). 토스트 노출 시간과 동일하게 맞춰 시각적으로 동기화한다.
export const UNDO_DELETE_DELAY_MS = 5000;

// execute: 지연 후 실제로 호출할 삭제 동작(보통 mutation.mutate(id)).
export function deleteMessageWithUndo(execute: () => void, delayMs = UNDO_DELETE_DELAY_MS) {
  let cancelled = false;
  const timer = setTimeout(() => {
    if (!cancelled) execute();
  }, delayMs);

  toast.success('메시지를 삭제했습니다', {
    duration: delayMs,
    action: {
      label: '실행 취소',
      onClick: () => {
        cancelled = true;
        clearTimeout(timer);
      },
    },
  });
}
