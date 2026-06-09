// src/components/ai/AIChatPanel.tsx
// AI 어시스턴트 공유 채팅 본문 — 세션 스위처 헤더 + 메시지 이력 + 입력바.
// side(AISidePanel) / fullscreen(AIFullscreen) 모두 재사용. 컨테이너(폭/포지션)는 호출측 책임.
import { ChevronDown, MessageSquare, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { DeleteSessionDialog } from '@/components/ai/DeleteSessionDialog';
import { relTime } from '@/components/ai/relTime';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import type { AssistantChat } from '@/hooks/useAssistantChat';
import { cn } from '@/lib/utils';

interface Props extends AssistantChat {
  /** 헤더 세션 스위처 표시 여부(기본 true). 풀스크린은 좌측 목록이 대신하므로 false. */
  showSessionSwitcher?: boolean;
  /** 마운트 시 입력에 포커스(패널 열림과 함께 호출). */
  autoFocus?: boolean;
}

/** AI 어시스턴트 채팅 본문(controlled). 컨테이너에 맞춰 h-full 로 채운다. */
export function AIChatPanel({
  turns,
  pending,
  onSubmit,
  sessions,
  currentSessionId,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  showSessionSwitcher = true,
  autoFocus = false,
}: Props) {
  const current = sessions.find((s) => s.id === currentSessionId);
  const [input, setInput] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const submit = () => {
    const query = input.trim();
    if (!query || pending) return;
    onSubmit(query);
    setInput('');
  };

  return (
    <div data-testid="chat-panel" className="flex h-full min-h-0 flex-col">
      {/* 대화 삭제 확인 — pendingDeleteId 설정 시 열림. */}
      <DeleteSessionDialog
        sessionId={pendingDeleteId}
        onConfirm={(id) => {
          onDeleteSession(id);
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />

      {/* 헤더 — 좌: 대화 선택 드롭다운 / 우: ＋새 대화. */}
      {showSessionSwitcher && (
        <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium hover:bg-muted"
              data-testid="chat-session-switcher"
            >
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="max-w-[16rem] truncate">{current?.title ?? '대화 선택'}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="z-[80] w-72">
              {sessions.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">저장된 대화가 없어요</div>
              ) : (
                sessions.map((s) => (
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
                      onClick={() => onSelectSession(s.id)}
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
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            data-testid="chat-new-session"
            onClick={onNewSession}
            className="flex items-center gap-1 rounded px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-4 w-4" /> 새 대화
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-3">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Sparkles className="h-9 w-9 text-muted-foreground/60" />
            <p className="text-base font-medium text-foreground">AI 어시스턴트에게 물어보세요</p>
            <p className="text-sm text-muted-foreground">무엇이든 질문해 보세요</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {turns.map((t, i) => (
              <li
                key={i}
                data-testid="chat-turn"
                className={cn('flex', t.role === 'assistant' ? 'justify-start' : 'justify-end')}
              >
                <span
                  className={cn(
                    'max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm',
                    t.role === 'assistant'
                      ? 'bg-muted text-foreground'
                      : 'bg-ai-accent text-ai-accent-foreground',
                  )}
                >
                  {t.content}
                </span>
              </li>
            ))}
            {pending && (
              <li className="text-sm text-muted-foreground" data-testid="chat-pending">
                구성 중…
              </li>
            )}
          </ul>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="border-t p-2"
      >
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="AI 에게 요청…  (⌘K)"
            data-testid="chat-input"
          />
          <Button
            type="submit"
            disabled={pending || !input.trim()}
            className="bg-ai-accent text-ai-accent-foreground"
          >
            보내기
          </Button>
        </div>
      </form>
    </div>
  );
}
