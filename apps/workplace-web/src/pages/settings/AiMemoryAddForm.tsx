// 메모리 직접 추가 폼(WP-55, 2차 시안 wp55-memory-states) — 목록 맨 위에 열린다. 종류 세그먼트(선호·교정 / 업무 맥락, 기본 선호·교정)
// + 여러 줄 입력 + n / 300 + 취소/추가. 빈 내용·300자 초과면 추가 비활성(초과 시 카운트 빨강, 자르지 않음).
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCreateAiMemory } from '@/hooks/queries/useAiMemories';
import { canSubmitContent, contentCountTone, MEMORY_MAX_CHARS, memoryLength } from '@/lib/aiMemory';
import { cn } from '@/lib/utils';
import type { AiMemoryKind } from '@/types/aiMemory';

const SEGMENTS: Array<{ kind: AiMemoryKind; label: string }> = [
  { kind: 'PREFERENCE', label: '선호·교정' },
  { kind: 'CONTEXT', label: '업무 맥락' },
];

export function AiMemoryAddForm({ onClose }: { onClose: () => void }) {
  const create = useCreateAiMemory();
  const [kind, setKind] = useState<AiMemoryKind>('PREFERENCE');
  const [content, setContent] = useState('');
  const len = memoryLength(content);
  return (
    <div data-testid="ai-memory-add-form" className="space-y-2 rounded-md border p-3">
      <div role="group" aria-label="종류" className="inline-flex rounded-md border p-0.5">
        {SEGMENTS.map((s) => (
          <button
            key={s.kind}
            type="button"
            aria-pressed={kind === s.kind}
            data-testid={`ai-memory-kind-${s.kind}`}
            onClick={() => setKind(s.kind)}
            className={cn(
              'rounded px-2.5 py-1 text-xs pointer-coarse:min-h-11 pointer-coarse:px-4 pointer-coarse:text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
              kind === s.kind ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <Textarea
        data-testid="ai-memory-add-input"
        aria-label="기억할 내용"
        rows={3}
        autoFocus
        placeholder="예: 이슈 목록은 담당자만 붙인 짧은 목록으로 보여 준다"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <span data-testid="ai-memory-add-count" className={cn('text-xs tabular-nums', contentCountTone(len))}>
          {len} / {MEMORY_MAX_CHARS}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          취소
        </Button>
        <Button
          size="sm"
          data-testid="ai-memory-add-submit"
          disabled={!canSubmitContent(content) || create.isPending}
          onClick={() => create.mutate({ kind, content }, { onSuccess: onClose })}
        >
          추가
        </Button>
      </div>
    </div>
  );
}
