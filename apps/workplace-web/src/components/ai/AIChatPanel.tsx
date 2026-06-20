// src/components/ai/AIChatPanel.tsx
// AI 어시스턴트 공유 채팅 본문 — 세션 스위처 헤더 + 메시지 이력 + 입력바.
// side(AISidePanel) / fullscreen(AIFullscreen) 모두 재사용. 컨테이너(폭/포지션)는 호출측 책임.
import { ChevronDown, MessageSquare, Plus, Sparkles, Square, Trash2 } from 'lucide-react';
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
  onStop,
  sessions,
  currentSessionId,
  newSessionNonce,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  delegationLabel,
  pendingAction,
  onConfirmAction,
  onCancelAction,
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

  // '새 대화' 전이 시 미전송 입력 초안을 비운다(#204). side·fullscreen 의 '새 대화' 버튼은
  // 서로 다른 위치(헤더 스위처 / 풀스크린 좌측 목록)에 있지만, 둘 다 onNewSession 을 거쳐
  // newSessionNonce 를 증가시키므로 이 패널 공통 effect 하나로 양쪽이 함께 초기화된다.
  // nonce 는 newSession() 에서만 증가하므로 세션 선택(restore)·전송(submit) 시엔 초안이 보존된다.
  useEffect(() => {
    if (newSessionNonce > 0) setInput('');
  }, [newSessionNonce]);

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
        {/* #333 M2: delegationLabel 있는 경우 빈-상태 분기 대신 메시지 목록을 항상 렌더한다.
            progress 이벤트만 오고 delta 가 아직 없어도(turns 가 비어도) 버블이 보여야 하므로.
            빈 상태(대화 내용 없음)는 turns 도 없고 delegationLabel 도 없을 때만 표시. */}
        {turns.length === 0 && !delegationLabel ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Sparkles className="h-9 w-9 text-muted-foreground/60" />
            <p className="text-base font-medium text-foreground">AI 어시스턴트에게 물어보세요</p>
            <p className="text-sm text-muted-foreground">무엇이든 질문해 보세요</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {turns.map((t, i) =>
              // 빈 어시스턴트 턴은 아직 첫 토큰을 받지 않은 상태 — 3-dot 이 대신 렌더되므로 skip.
              t.role === 'assistant' && t.content === '' ? null : (
              <li
                key={i}
                data-testid="chat-turn"
                className={cn('flex', t.role === 'assistant' ? 'justify-start' : 'justify-end')}
              >
                <span
                  className={cn(
                    // whitespace-pre-wrap 로 공백/개행은 보존하되,
                    // [overflow-wrap:anywhere] 로 URL·토큰 등 무공백 긴 문자열도 강제 줄바꿈해
                    // 말풍선이 max-w-[80%] 를 넘어 가로 오버플로하지 않도록 한다 (#202)
                    'max-w-[80%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl px-3 py-1.5 text-sm',
                    t.role === 'assistant'
                      ? 'bg-muted text-foreground'
                      : 'bg-ai-accent text-ai-accent-foreground',
                  )}
                >
                  {t.content}
                </span>
              </li>
            ))}
            {/* #333 M2: 위임 진행 버블 — 서브에이전트 위임 중 한 단계 표시.
                assistant 말풍선과 동일 정렬(좌측·bg-muted·rounded-2xl)에 라벨 + 스피너 아이콘.
                완료(done) 시 delegationLabel 이 null 로 초기화되어 자동 제거된다. */}
            {delegationLabel && (
              <li className="flex justify-start" data-testid="chat-delegation">
                <span
                  className="flex items-center gap-2 rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground"
                  role="status"
                >
                  <Sparkles className="h-4 w-4 animate-pulse" />
                  {delegationLabel}
                </span>
              </li>
            )}
            {/* #333 M2: 확인 카드 — 외부/비가역 액션 제안. 승인 시 서버 실행기 호출, 취소 시 폐기. */}
            {pendingAction && (
              <li className="flex justify-start" data-testid="pending-action-card">
                <div className="max-w-[85%] rounded-2xl border bg-card p-3 text-sm">
                  <p className="font-medium text-foreground">확인이 필요해요</p>
                  <p className="mt-1 text-muted-foreground">{pendingAction.summary}</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" className="bg-ai-accent text-ai-accent-foreground" onClick={onConfirmAction}>
                      승인
                    </Button>
                    <Button size="sm" variant="outline" onClick={onCancelAction}>
                      취소
                    </Button>
                  </div>
                </div>
              </li>
            )}
            {/* 3-dot 로딩 — pending 이고 아직 첫 토큰이 오지 않은 경우에만 표시.
                첫 토큰 도착 후엔 assistant 말풍선 자체가 점진적으로 채워지므로 중복 표시 방지(#332). */}
            {pending && turns[turns.length - 1]?.content === '' && (
              <li className="flex justify-start" data-testid="chat-pending">
                {/* 응답 작성 중 — assistant 말풍선과 동일한 정렬·형태(좌측·bg-muted·rounded-2xl)에
                    타이핑 dot 모션을 둬, 완료된 짧은 메시지가 아니라 '진행 중' 상태로 읽히게 한다(#207). */}
                <span
                  className="flex items-center gap-1 rounded-2xl bg-muted px-3 py-2.5"
                  role="status"
                  aria-label="AI가 응답을 작성 중입니다"
                >
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
                </span>
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
          {/* #335: 스트리밍 중에는 '보내기'를 '중단' 버튼으로 전환 — 클릭 시 진행 중 응답을 멈춘다. */}
          {pending ? (
            <Button
              type="button"
              variant="outline"
              onClick={onStop}
              aria-label="응답 중단"
              data-testid="chat-stop"
            >
              <Square className="h-4 w-4 fill-current" /> 중단
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={!input.trim()}
              className="bg-ai-accent text-ai-accent-foreground"
            >
              보내기
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
