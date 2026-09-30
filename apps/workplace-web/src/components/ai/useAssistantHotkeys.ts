// src/components/ai/useAssistantHotkeys.ts
// AI 어시스턴트 전역 단축키 — ⌘K/Ctrl+K 토글, Esc 닫기.
// 예전엔 AI 칩(데스크톱 전용) 안에 있어 lg 미만(좁은 데스크톱 창·키보드 붙인 iPad)에선 단축키가 사라졌다.
// 셸과 무관하게 AppLayout 이 한 번만 등록하도록 훅으로 분리한다(칩은 버튼만 렌더 — 이중 리스너 없음).
import { useEffect } from 'react';

import { useAssistant } from '@/components/ai/AIAssistantContext';

/** enabled=false(AI 미사용 워크스페이스)면 리스너를 달지 않는다. AIAssistantProvider 안에서 호출해야 한다. */
export function useAssistantHotkeys(enabled: boolean): void {
  const { toggle, close } = useAssistant();
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'Escape' && !e.defaultPrevented) {
        // Radix AlertDialog/DropdownMenu 가 Esc 를 먼저 처리하면 defaultPrevented=true →
        // 그 경우 패널까지 닫지 않는다(다이얼로그만 닫힘).
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, toggle, close]);
}
