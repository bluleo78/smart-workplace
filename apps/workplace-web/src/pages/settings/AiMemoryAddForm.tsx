// 메모리 직접 추가 폼(WP-55, 2차 시안 wp55-memory-states) — 목록 맨 위에 열린다. 종류 세그먼트(선호·교정 / 업무 맥락, 기본 선호·교정)
// + 공용 입력 조각(AiMemoryContentEditor — n / 300, 취소/추가, 빈 내용·300자 초과면 추가 비활성).
// WP-379: 범위 고르기 — 기본은 공통, 공통이 가득이면 첫 빈 범위. 공통이면 POST 에 scope 를 싣지 않는다(구 API 와 같은 본문).
// WP-380: 기한(기본 없음) — 있으면 POST 에 expiresOn.
import { useState } from 'react';

import { useCreateAiMemory } from '@/hooks/queries/useAiMemories';
import { type AiMemoryScopeKey, defaultAddScope } from '@/lib/aiMemory';
import { cn } from '@/lib/utils';
import { AiMemoryContentEditor } from '@/pages/settings/AiMemoryContentEditor';
import { AiMemoryExpiryPicker } from '@/pages/settings/AiMemoryExpiryPicker';
import { AiMemoryScopeSelect } from '@/pages/settings/AiMemoryScopeSelect';
import type { AiMemoryKind } from '@/types/aiMemory';

const SEGMENTS: Array<{ kind: AiMemoryKind; label: string }> = [
  { kind: 'PREFERENCE', label: '선호·교정' },
  { kind: 'CONTEXT', label: '업무 맥락' },
];

export function AiMemoryAddForm({ onClose, fullScopes }: { onClose: () => void; fullScopes: ReadonlySet<AiMemoryScopeKey> }) {
  const create = useCreateAiMemory();
  const [kind, setKind] = useState<AiMemoryKind>('PREFERENCE');
  const [content, setContent] = useState('');
  // 카드는 모든 범위가 가득이면 폼을 열지 않는다 — null 은 방어용으로 공통.
  const [scope, setScope] = useState<AiMemoryScopeKey>(() => defaultAddScope(fullScopes) ?? 'COMMON');
  const [expiresOn, setExpiresOn] = useState<string | null>(null);
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
        onSubmit={() =>
          create.mutate(
            { kind, content, ...(scope !== 'COMMON' ? { scope } : {}), ...(expiresOn ? { expiresOn } : {}) },
            { onSuccess: onClose },
          )
        }
        submitLabel="추가"
        pending={create.isPending}
        rows={3}
        placeholder="예: 이슈 목록은 담당자만 붙인 짧은 목록으로 보여 준다"
        ariaLabel="기억할 내용"
        testIdPrefix="ai-memory-add"
        fields={
          <>
            <AiMemoryScopeSelect value={scope} onChange={setScope} fullScopes={fullScopes} testId="ai-memory-add-scope" />
            <AiMemoryExpiryPicker value={expiresOn} onChange={setExpiresOn} testId="ai-memory-add-expiry" />
          </>
        }
      />
    </div>
  );
}
