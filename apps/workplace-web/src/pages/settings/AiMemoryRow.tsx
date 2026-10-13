// 메모리 카드의 한 줄(WP-55, 시안 A) — 종류 배지 + 내용 + 메타(AI가 저장/직접 추가 · 날짜) + 수정·삭제.
// 수정은 제자리 입력(300자 카운트, 취소/저장), 삭제는 즉시 + 되돌리기 토스트(훅). 터치 기기는 아이콘 버튼을 44px 로 키운다.
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDeleteAiMemory, useUpdateAiMemory } from '@/hooks/queries/useAiMemories';
import { formatDateOnly } from '@/lib/formatters';
import { AiMemoryContentEditor } from '@/pages/settings/AiMemoryContentEditor';
import type { AiMemoryItem } from '@/types/aiMemory';

/** 종류 배지 — 선호는 info, 맥락은 secondary(둘 다 라이트/다크 토큰 쌍). */
export const KIND_BADGE = {
  PREFERENCE: { label: '선호', variant: 'info' },
  CONTEXT: { label: '맥락', variant: 'secondary' },
} as const;

export function AiMemoryRow({ item }: { item: AiMemoryItem }) {
  const update = useUpdateAiMemory();
  const remove = useDeleteAiMemory();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const badge = KIND_BADGE[item.kind];

  const startEdit = () => {
    setDraft(item.content);
    setEditing(true);
  };
  const save = () => {
    // 바뀐 게 없으면 요청하지 않고 닫는다(updatedAt 이 바뀌어 맨 위로 튀지 않게).
    if (draft.trim() === item.content) return setEditing(false);
    update.mutate({ id: item.id, content: draft }, { onSuccess: () => setEditing(false) });
  };

  return (
    <li data-testid="ai-memory-row" data-id={item.id} className="flex items-start gap-2 px-3 py-2">
      <Badge variant={badge.variant} className="mt-0.5" data-testid="ai-memory-kind">
        {badge.label}
      </Badge>
      {editing ? (
        <div className="min-w-0 flex-1 space-y-1.5">
          <AiMemoryContentEditor
            value={draft}
            onChange={setDraft}
            onCancel={() => setEditing(false)}
            onSubmit={save}
            submitLabel="저장"
            pending={update.isPending}
            rows={2}
            ariaLabel="메모리 내용"
            testIds={{ input: 'ai-memory-edit-input', count: 'ai-memory-edit-count', submit: 'ai-memory-edit-save' }}
          />
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <p data-testid="ai-memory-content" className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
            {item.content}
          </p>
          <p data-testid="ai-memory-meta" className="text-xs text-muted-foreground">
            {item.source === 'AI' ? 'AI가 저장' : '직접 추가'} · {formatDateOnly(item.updatedAt)}
          </p>
        </div>
      )}
      {!editing && (
        <div className="flex shrink-0 gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 pointer-coarse:size-11"
            aria-label="수정"
            data-testid="ai-memory-edit"
            onClick={startEdit}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive pointer-coarse:size-11"
            aria-label="삭제"
            data-testid="ai-memory-delete"
            disabled={remove.isPending}
            onClick={() => remove.mutate(item)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </li>
  );
}
