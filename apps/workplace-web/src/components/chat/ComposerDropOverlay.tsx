// 채팅 입력창 위로 파일을 끌고 왔을 때 덮는 "여기에 놓아 첨부" 오버레이 (WP-235).
// 부모(입력창 래퍼)가 relative 여야 하고, 드롭 이벤트는 부모의 useComposerFileDrop 이 받는다 — 오버레이는 포인터를 통과시킨다.
import { Upload } from 'lucide-react';

export function ComposerDropOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary bg-background/90 text-sm font-medium text-primary"
      role="status"
      aria-live="polite"
      data-testid="composer-drop-overlay"
    >
      <Upload className="size-4" aria-hidden />
      여기에 놓아 첨부
    </div>
  );
}
