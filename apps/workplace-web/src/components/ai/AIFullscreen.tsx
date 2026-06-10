// src/components/ai/AIFullscreen.tsx
// 풀스크린(2단) — 콘텐츠 영역만 덮는다(<main>의 absolute inset-0 자식, AppRail 미포함).
// 좌: 세션 목록 / 우: 채팅 본문.
import { Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { useAssistant } from '@/components/ai/AIAssistantContext';
import { AIChatPanel } from '@/components/ai/AIChatPanel';
import { DeleteSessionDialog } from '@/components/ai/DeleteSessionDialog';
import { relTime } from '@/components/ai/relTime';
import { useAssistantChat } from '@/hooks/useAssistantChat';
import { cn } from '@/lib/utils';

/** mode==='fullscreen' 일 때만 렌더. */
export function AIFullscreen() {
  const { mode, close } = useAssistant();
  const chat = useAssistantChat();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  if (mode !== 'fullscreen') return null;

  return (
    <div
      data-testid="ai-fullscreen"
      className="absolute inset-0 z-40 flex bg-background animate-in fade-in duration-200"
    >
      {/* 삭제 확인 다이얼로그 */}
      <DeleteSessionDialog
        sessionId={pendingDeleteId}
        onConfirm={(id) => {
          chat.onDeleteSession(id);
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />

      {/* 좌: 세션 목록 */}
      <div className="flex w-[260px] shrink-0 flex-col border-r" data-testid="ai-fs-sessions">
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
          <span className="text-sm font-medium">대화</span>
          <button
            type="button"
            data-testid="chat-new-session"
            onClick={chat.onNewSession}
            className="flex items-center gap-1 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-4 w-4" /> 새 대화
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {chat.sessions.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">저장된 대화가 없어요</div>
          ) : (
            chat.sessions.map((s) => (
              <div
                key={s.id}
                data-testid="chat-session-item"
                className={cn(
                  'flex items-center gap-2 rounded px-2 py-1.5 text-sm',
                  s.id === chat.currentSessionId && 'bg-ai-accent-subtle',
                )}
              >
                <button
                  type="button"
                  data-testid="chat-session-select"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => chat.onSelectSession(s.id)}
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
                    setPendingDeleteId(s.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 우: 채팅 본문(헤더 스위처 off — 좌측 목록이 대신). */}
      {/* #206 occlusion 방지: 우측 pane 상단에 좌측 세션목록 헤더(h-12)와 정합하는 헤더 바를 둔다.
          기존엔 닫기 X 가 absolute 라 헤더 여백이 없어, 첫 chat-turn 이 상단 고정 AI 칩과
          우상단 닫기 X 에 가려졌다. 헤더 바로 여백을 확보하고 닫기 버튼을 일반 배치로 옮긴다. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 상단 바 — 좌측 세션목록 헤더(h-12 border-b)와 높이/구분선 정합. 닫기 버튼을 우측 정렬. */}
        <div className="flex h-12 shrink-0 items-center justify-end border-b px-3">
          <button
            type="button"
            aria-label="닫기"
            data-testid="ai-fs-close"
            onClick={close}
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* 헤더 아래 영역에 채팅 패널 배치 — 첫 turn 이 헤더 영역 아래로 내려가 occlusion 해소. */}
        <div className="min-h-0 flex-1">
          <AIChatPanel {...chat} showSessionSwitcher={false} autoFocus />
        </div>
      </div>
    </div>
  );
}
