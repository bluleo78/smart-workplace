import { useEffect } from 'react';

import { registerUnsavedInputSource } from '@/lib/unsavedInput';

// 저장되지 않은 입력값이 있을 때 브라우저 새로고침/닫기를 시도하면 표준 beforeunload
// 확인 다이얼로그를 띄운다 (#620). 값 자동저장(localStorage 등)은 하지 않는 최소 조치 —
// 사용자가 실수로 새로고침해 입력을 날리는 사고만 막는다.
// 브라우저는 커스텀 문구를 지원하지 않고 자체 기본 문구만 표시하므로 returnValue 는
// 값 존재 여부(트리거)로만 쓰인다.
// 켜져 있는 동안 「저장 안 한 입력」으로도 등록한다 — 다른 창이 새 버전을 적용해도 이 창은 자동 새로고침하지 않는다(WP-664).
export function useUnsavedChangesWarning(hasUnsavedChanges: boolean) {
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    const unregister = registerUnsavedInputSource(() => true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      unregister();
    };
  }, [hasUnsavedChanges]);
}
