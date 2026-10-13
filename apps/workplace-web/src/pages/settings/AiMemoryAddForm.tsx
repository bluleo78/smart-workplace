// 메모리 직접 추가 폼(WP-55, 2차 시안 wp55-memory-states) — 목록 맨 위에 열린다. 종류 세그먼트(선호·교정 / 업무 맥락, 기본 선호·교정)
// + 공용 입력 조각(AiMemoryContentEditor — n / 300, 취소/추가, 빈 내용·300자 초과면 추가 비활성).
import { useState } from 'react';

import { useCreateAiMemory } from '@/hooks/queries/useAiMemories';
import { cn } from '@/lib/utils';
import { AiMemoryContentEditor } from '@/pages/settings/AiMemoryContentEditor';
import type { AiMemoryKind } from '@/types/aiMemory';

const SEGMENTS: Array<{ kind: AiMemoryKind; label: string }> = [
  { kind: 'PREFERENCE', label: '선호·교정' },
  { kind: 'CONTEXT', label: '업무 맥락' },
];

export function AiMemoryAddForm({ onClose }: { onClose: () => void }) {
  const create = useCreateAiMemory();
  const [kind, setKind] = useState<AiMemoryKind>('PREFERENCE');
  const [content, setContent] = useState('');
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
      <AiMemoryContentEditor
        value={content}
        onChange={setContent}
        onCancel={onClose}
        onSubmit={() => create.mutate({ kind, content }, { onSuccess: onClose })}
        submitLabel="추가"
        pending={create.isPending}
        rows={3}
        placeholder="예: 이슈 목록은 담당자만 붙인 짧은 목록으로 보여 준다"
        ariaLabel="기억할 내용"
        testIds={{ input: 'ai-memory-add-input', count: 'ai-memory-add-count', submit: 'ai-memory-add-submit' }}
      />
    </div>
  );
}
