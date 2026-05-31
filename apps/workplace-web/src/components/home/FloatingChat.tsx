import { type FocusEvent, type FormEvent, useEffect, useRef, useState } from 'react';

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
 * 하단 도크형 챗 — 비차단(배경 dim 없음, 캔버스와 동시 조작 가능, #51).
 *
 * <ul>
 *   <li>입력바는 항상 하단에 떠 있고, 입력 포커스/⌘K 시 위로 transcript 패널이 펼쳐진다.
 *   <li>응답이 와도 패널을 자동으로 닫지 않는다(예전엔 자동 접힘이 답변을 가려 대화가 초기화된 듯 보였다).
 *   <li>포커스가 폼 밖(캔버스 등)으로 빠지면 패널만 접혀 입력바만 남는다. Esc/⌘K 로도 접는다.
 *   <li>래퍼는 pointer-events-none — 빈 영역은 캔버스 클릭을 가로채지 않고, 패널·입력바만 클릭을 받는다.
 * </ul>
 * 상태는 상위 소유(controlled).
 */
export function FloatingChat({ turns, pending, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // ⌘K/Ctrl+K 토글 + Esc 닫기.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => {
          const next = !v;
          if (next) setTimeout(() => inputRef.current?.focus(), 0);
          return next;
        });
      } else if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || pending) return;
    onSubmit(query);
    setInput('');
    // 버튼 클릭 제출로 포커스가 빠져도 패널을 유지하도록 입력에 다시 포커스.
    inputRef.current?.focus();
  };

  // 포커스가 폼 밖으로 나가면(캔버스 클릭 등) transcript 를 접는다. 폼 내부(보내기 버튼) 이동은 무시.
  const handleBlur = (e: FocusEvent) => {
    if (formRef.current?.contains(e.relatedTarget as Node | null)) return;
    setOpen(false);
  };

  return (
    // pointer-events-none: 빈 영역은 캔버스 클릭을 통과시킨다. 실제 패널/입력바만 pointer-events-auto.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center">
      {open && (
        <div
          className="pointer-events-auto mb-2 max-h-[50vh] w-full max-w-2xl overflow-auto rounded-lg border bg-card p-3 shadow-lg"
          data-testid="chat-panel"
        >
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
      )}
      <form
        ref={formRef}
        onSubmit={submit}
        onBlur={handleBlur}
        className="pointer-events-auto mb-4 w-full max-w-2xl px-4"
      >
        <div className="flex gap-2 rounded-lg border bg-card p-2 shadow-lg">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder="AI 에게 요청…  (⌘K)"
            data-testid="chat-input"
          />
          <Button type="submit" disabled={pending} className="bg-ai-accent text-ai-accent-foreground">
            보내기
          </Button>
        </div>
      </form>
    </div>
  );
}
