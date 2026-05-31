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

/** 떠있는 챗 레이어 — 평소 입력창만, ⌘K/포커스 시 패널 펼침, 응답 완료 시 자동 접힘. 상태는 상위 소유(controlled). */
export function FloatingChat({ turns, pending, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const prevPending = useRef(false);

  // ⌘K / Ctrl+K 토글.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => {
          const next = !v;
          if (next) setTimeout(() => inputRef.current?.focus(), 0);
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 응답 완료(pending true→false) 시 자동 접힘(결과 전면).
  useEffect(() => {
    if (prevPending.current && !pending) setOpen(false);
    prevPending.current = pending;
  }, [pending]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || pending) return;
    onSubmit(query);
    setInput('');
  };

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="챗 닫기"
          className="fixed inset-0 z-10 bg-background/60"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="fixed inset-x-0 bottom-0 z-20 flex flex-col items-center">
        {open && (
          <div
            className="mb-2 max-h-[50vh] w-full max-w-2xl overflow-auto rounded-lg border bg-card p-3 shadow-lg"
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
        <form onSubmit={submit} className="mb-4 w-full max-w-2xl px-4">
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
    </>
  );
}
