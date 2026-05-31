import { useCallback, useEffect, useRef, useState } from 'react';
import { useHomeCompose } from '@/hooks/queries/useHomeQueries';
import type { WidgetSpec } from '@/types/home';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  /** compose 결과 위젯을 캔버스에 적용. */
  onCompose: (specs: WidgetSpec[]) => void;
}

/** 떠있는 챗 레이어 — 평소 입력창만, ⌘K/포커스 시 메시지 패널 펼침, 응답 완료 시 자동 접힘. */
export function FloatingChat({ onCompose }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const compose = useHomeCompose();

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

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const query = input.trim();
      if (!query || compose.isPending) return;
      setTurns((t) => [...t, { role: 'user', content: query }]);
      setInput('');
      compose.mutate(
        { sessionId, query },
        {
          onSuccess: (res) => {
            setSessionId(res.sessionId); // follow-up 연속성(7c 는 in-memory 추적만)
            setTurns((t) => [...t, { role: 'assistant', content: res.message }]);
            onCompose(res.widgets);
            setOpen(false); // 응답 완료 → 자동 접힘(결과 전면)
          },
        },
      );
    },
    [input, compose, sessionId, onCompose],
  );

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
                {compose.isPending && <li className="text-sm text-muted-foreground" data-testid="chat-pending">구성 중…</li>}
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
            <Button type="submit" disabled={compose.isPending} className="bg-ai-accent text-ai-accent-foreground">
              보내기
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
