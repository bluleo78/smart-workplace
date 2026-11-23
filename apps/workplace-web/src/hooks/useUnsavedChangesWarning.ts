import { useEffect } from 'react';

import { registerUnsavedInputSource } from '@/lib/unsavedInput';

// 저장되지 않은 입력값이 있을 때 beforeunload 확인과 자동 새로고침 차단을 선택적으로 제공한다 (#620).
// 브라우저는 커스텀 문구를 지원하지 않고 자체 기본 문구만 표시하므로 returnValue 는
// 값 존재 여부(트리거)로만 쓰인다. 입력이 안전하게 복원되는 화면은 다이얼로그 없이도
// 「저장 안 한 입력」으로 등록해 다른 창의 자동 새로고침만 막을 수 있다(WP-664).
export function useUnsavedChangesWarning(
  hasUnsavedChanges: boolean,
  { warnOnBeforeUnload = true }: { warnOnBeforeUnload?: boolean } = {},
) {
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    if (warnOnBeforeUnload) window.addEventListener('beforeunload', handleBeforeUnload);
    const unregister = registerUnsavedInputSource(() => true);
    return () => {
      if (warnOnBeforeUnload) window.removeEventListener('beforeunload', handleBeforeUnload);
      unregister();
    };
  }, [hasUnsavedChanges, warnOnBeforeUnload]);
}
