// AI 대화 세션 행 목록 — 헤더 드롭다운(AIChatPanel)·시트 드롭다운(MobileAiSheet)·풀스크린 좌측 목록(AIFullscreen)이 공유한다.
// 호출하는 패널이 자기 React 트리 안에서 렌더해야 한다(WP-54: 포털 드롭다운도 React 이벤트가 패널 루트로 전파돼 AI 표면으로 판별됨).
import { Trash2 } from 'lucide-react';

import { relTime } from '@/components/ai/relTime';
import { cn } from '@/lib/utils';
import type { HomeSessionSummary } from '@/types/home';

export function AISessionItems({
  sessions,
  currentSessionId,
  onSelect,
  onDelete,
}: {
  sessions: HomeSessionSummary[];
  currentSessionId: string | null;
  /** 행 선택 — 선택 후 메뉴 닫기 같은 부수 동작은 호출 측이 이 콜백 안에서 처리한다. */
  onSelect: (id: string) => void;
  /** 삭제 버튼 — 확인 다이얼로그 열기는 호출 측 몫. */
  onDelete: (id: string) => void;
}) {
  if (sessions.length === 0) {
    return <div className="px-2 py-1.5 text-sm text-muted-foreground">저장된 대화가 없어요</div>;
  }
  return (
    <>
      {sessions.map((s) => (
        <div
          key={s.id}
          data-testid="chat-session-item"
          className={cn(
            'flex items-center gap-2 rounded px-2 py-1.5 text-sm',
            s.id === currentSessionId && 'bg-ai-accent-subtle',
          )}
        >
          <button
            type="button"
            data-testid="chat-session-select"
            className="min-w-0 flex-1 text-left"
            onClick={() => onSelect(s.id)}
          >
            <div className="truncate">{s.title}</div>
            <div className="text-xs text-muted-foreground">{relTime(s.lastMessageAt)}</div>
          </button>
          <button
            type="button"
            aria-label="대화 삭제"
            data-testid="chat-session-delete"
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(s.id);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
    </>
  );
}
