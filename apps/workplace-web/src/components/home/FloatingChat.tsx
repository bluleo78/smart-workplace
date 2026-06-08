// 전역 AI 진입 — 상단 중앙 칩(런처) + 활성 시 나머지를 비활성화하는 하단 모달 도크.
import { ChevronDown, MessageSquare, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ChatTurn, HomeSessionSummary } from '@/types/home';

interface Props {
  /** 대화 transcript(상위 useHomeSession 소유). */
  turns: ChatTurn[];
  /** compose 진행 중 여부. */
  pending: boolean;
  /** 입력 제출 → 상위가 compose 실행. */
  onSubmit: (query: string) => void;
  /** 저장된 대화(세션) 목록 — 헤더 "대화 선택" 드롭다운. */
  sessions: HomeSessionSummary[];
  /** 현재 활성 대화 id(없으면 새 대화). */
  currentSessionId: string | null;
  /** ＋새 대화 — 로컬 리셋. */
  onNewSession: () => void;
  /** 기존 대화 선택 — 복원. */
  onSelectSession: (id: string) => void;
  /** 대화 삭제. */
  onDeleteSession: (id: string) => void;
}

// 상대 시각(분/시간/일) 간단 표기 — 대화 목록 행에 표시.
function relTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/**
 * 상단 중앙 AI 칩 런처 + 활성 시 하단 모달 도크.
 *
 * <ul>
 *   <li>평소엔 칩(런처)만 상단 중앙에 떠 있고, 클릭 또는 ⌘K 로 하단 모달 도크(입력바 + 이력)를 연다.
 *   <li>활성 시 스크림이 나머지 화면을 딤 처리(비활성 느낌). 스크림 클릭 또는 Esc 로 닫는다.
 *   <li>도크는 런처(상단)에서 아래로 확대되는 애니메이션으로 등장(origin-top + scaleY).
 *   <li>이력/말풍선은 모두 불투명(반투명 아님). 응답이 와도 자동으로 닫지 않는다(대화 유지).
 * </ul>
 * 상태는 상위 소유(controlled).
 */
export function FloatingChat({
  turns,
  pending,
  onSubmit,
  sessions,
  currentSessionId,
  onNewSession,
  onSelectSession,
  onDeleteSession,
}: Props) {
  const [open, setOpen] = useState(false);
  const current = sessions.find((s) => s.id === currentSessionId);
  const [input, setInput] = useState('');
  // 삭제 확인 대기 중인 세션 id — null 이면 AlertDialog 닫힘.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K/Ctrl+K 토글 + Esc 닫기.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 패널이 열리면 입력에 포커스.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // 폼 제출 — 이벤트 타입은 form 의 onSubmit 에서 추론(별도 FormEvent import 불필요)
  const submit = () => {
    const query = input.trim();
    if (!query || pending) return;
    onSubmit(query);
    setInput('');
  };

  return (
    <>
      {/* 런처 칩 — body 로 portal(fixed, 상단 중앙). 모달 스크림(z-60) 위(z-70)에 떠 토글을 유지한다.
          모달이 열려도 사라지지 않고 active(ai-accent) 상태로만 바뀐다.
          데스크톱은 좌측 레일(56px) 폭의 절반만큼 보정해 "콘텐츠" 중앙에 맞춘다. */}
      {createPortal(
        <button
          type="button"
          data-testid="chat-launcher"
          aria-label="AI 어시스턴트"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'fixed left-1/2 top-2 z-[70] inline-flex -translate-x-1/2 items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium shadow-md backdrop-blur transition-colors lg:left-[calc(50%+28px)]',
            open
              ? 'border-ai-accent bg-card text-ai-accent'
              : 'bg-card/90 text-muted-foreground hover:text-foreground',
          )}
        >
          <Sparkles className="h-[18px] w-[18px]" />
          <span>AI 어시스턴트</span>
          {pending && <span className="ml-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-ai-accent" />}
        </button>,
        document.body,
      )}

      {/* 활성(open) 시 — 스크림으로 나머지를 비활성화하고, 런처에서 아래로 내려오는 모달 도크를 띄운다.
          document.body 로 portal — main 안에 두면 fixed 가 main 에 갇혀 앱 레일을 못 덮으므로 뷰포트 전체를 덮게 한다. */}
      {/* 대화 삭제 확인 — pendingDeleteId 가 설정되면 AlertDialog 열림(portal 자체 처리). */}
      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(v) => !v && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>대화 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 대화를 삭제하시겠습니까? 삭제된 대화는 복구할 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            {/* 파괴적 작업 — destructive 스타일로 실수 방지 */}
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDeleteId) {
                  onDeleteSession(pendingDeleteId);
                  setPendingDeleteId(null);
                }
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[60] px-4 pb-4 pt-16 sm:px-6">
            {/* 스크림 — 앱 레일(z-50) 포함 모달 외 전 영역을 딤 처리(비활성 느낌). 클릭 시 닫힘. */}
            <button
              type="button"
              aria-label="닫기"
              data-testid="chat-scrim"
              onClick={() => setOpen(false)}
              className="absolute inset-0 cursor-default bg-black/40 animate-in fade-in duration-200"
            />
            {/* 모달 도크 — 불투명 카드. 높이 고정(FAB 아래 pt-16 ~ 하단 pb-4 밴드 전체, h-full).
                origin-top + 위에서 슬라이드(translateY)로 "살짝 내려오는" 등장(0.4s). */}
            <div
              data-testid="chat-panel"
              className="relative mx-auto flex h-full w-full max-w-[52rem] origin-top flex-col overflow-hidden rounded-xl border bg-card shadow-2xl animate-[chat-dock-expand_0.4s_cubic-bezier(0.16,1,0.3,1)]"
            >
            {/* 헤더 — 좌: 기존 대화 선택(드롭다운) / 우: ＋새 대화. 대화 이력 관리의 진입점. */}
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
                {/* 모달(z-60) 위에 뜨도록 z 상향. */}
                <DropdownMenuContent align="start" className="z-[80] w-72">
                  {sessions.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">저장된 대화가 없어요</div>
                  ) : (
                    sessions.map((s) => (
                      // 행 자체는 div(삭제 버튼과 select 충돌 방지).
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
                            // 부모 select 버튼 이벤트 전파 차단 + 확인 다이얼로그 진입.
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

            <div className="flex-1 overflow-auto p-3">
              {turns.length === 0 ? (
                // 빈 상태 — 대화가 없을 때 중앙 안내(아이콘 + 타이틀 + 서브).
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <Sparkles className="h-9 w-9 text-muted-foreground/60" />
                  <p className="text-base font-medium text-foreground">AI 어시스턴트에게 물어보세요</p>
                  <p className="text-sm text-muted-foreground">무엇이든 질문해 보세요</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {turns.map((t, i) => (
                    // 말풍선 — assistant 좌측(muted) / user 우측(ai-accent), 모두 불투명.
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
            {/* 입력바 — 도크 하단에 고정. */}
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
                {/* 입력이 비어 있거나 전송 중일 때 버튼 비활성화 — submit guard와 일치 */}
                <Button type="submit" disabled={pending || !input.trim()} className="bg-ai-accent text-ai-accent-foreground">
                  보내기
                </Button>
              </div>
            </form>
          </div>
          </div>,
          document.body,
        )}
    </>
  );
}
