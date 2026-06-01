// 전역 AI 진입 — 상단 중앙 칩(런처) + 펼침 패널. 하단을 점유하지 않아 페이지 UI와 충돌하지 않음.
import { Sparkles } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ChatTurn } from '@/types/home';

interface Props {
  /** 대화 transcript(상위 useHomeSession 소유). */
  turns: ChatTurn[];
  /** compose 진행 중 여부. */
  pending: boolean;
  /** 입력 제출 → 상위가 compose 실행. */
  onSubmit: (query: string) => void;
}

/**
 * 상단 중앙 AI 칩 런처 + 펼침 패널.
 *
 * <ul>
 *   <li>평소엔 작은 칩(런처)만 상단 중앙에 떠 있고, 클릭 또는 ⌘K 로 입력/transcript 패널을 펼친다.
 *   <li>하단을 점유하지 않아 페이지 자체의 하단 UI(이슈 chat composer, 삭제 버튼 등)와 충돌하지 않는다.
 *   <li>래퍼는 pointer-events-none — 빈 영역은 캔버스 클릭을 가로채지 않고, 칩·패널만 클릭을 받는다.
 *   <li>응답이 와도 패널을 자동으로 닫지 않는다(대화 유지).
 * </ul>
 * 상태는 상위 소유(controlled).
 */
export function FloatingChat({ turns, pending, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
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

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || pending) return;
    onSubmit(query);
    setInput('');
  };

  return (
    // pointer-events-none: 빈 영역은 캔버스/페이지 클릭을 통과시킨다. 칩/패널만 pointer-events-auto.
    // absolute top-2 — 상위 <main>(relative) 콘텐츠 영역 상단 중앙에 떠 있다(좌측 레일 위를 덮지 않음).
    <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex flex-col items-center">
      <button
        type="button"
        data-testid="chat-launcher"
        aria-label="AI 어시스턴트"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'pointer-events-auto inline-flex items-center gap-1.5 rounded-full border bg-card/90 px-4 py-1.5 text-sm shadow-md backdrop-blur transition-colors',
          open ? 'border-ai-accent text-ai-accent' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Sparkles className="h-4 w-4" />
        <span>AI</span>
        {pending && <span className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-ai-accent" />}
      </button>

      {open && (
        <div
          className="pointer-events-auto mt-2 flex max-h-[60vh] w-[min(32rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border bg-card shadow-xl"
          data-testid="chat-panel"
        >
          <div className="flex-1 overflow-auto p-3">
            {turns.length === 0 ? (
              <p className="text-sm text-muted-foreground">무엇을 보여드릴까요? (예: "이번 주 마감인 내 HIGH 이슈")</p>
            ) : (
              <ul className="space-y-2">
                {turns.map((t, i) => (
                  <li
                    key={i}
                    className={cn('text-sm', t.role === 'assistant' ? 'text-ai-accent' : 'text-foreground')}
                  >
                    {t.content}
                  </li>
                ))}
                {pending && <li className="text-sm text-muted-foreground" data-testid="chat-pending">구성 중…</li>}
              </ul>
            )}
          </div>
          <form onSubmit={submit} className="border-t p-2">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="AI 에게 요청…  (⌘K)"
                data-testid="chat-input"
              />
              <Button type="submit" disabled={pending} className="bg-ai-accent text-ai-accent-foreground">
                보내기
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
