import { useEffect } from 'react';

import { registerUnsavedInputSource } from '@/lib/unsavedInput';

// 저장되지 않은 입력값이 있을 때 beforeunload 확인과 자동 새로고침 차단을 선택적으로 제공한다 (#620).
// 브라우저는 커스텀 문구를 지원하지 않고 자체 기본 문구만 표시하므로 returnValue 는 값 존재 여부(트리거)로만 쓴다.
// sessionStorage 는 새로고침에는 남아도 탭을 닫으면 사라지므로 미저장 입력이 있으면 항상 이탈 확인을 띄운다.
// 등록된 입력은 다른 화면의 자동 새로고침도 막는다(WP-664).
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
