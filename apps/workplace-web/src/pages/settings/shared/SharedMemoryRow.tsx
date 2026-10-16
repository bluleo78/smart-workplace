// WP-386 공용 메모리 한 줄 — 내용 + 메타(「김철수 요청」·「이영희 직접 추가」·「AI가 정리」·「대화에서 AI가 기억」 · 날짜) + 고치기·지우기(canEdit 일 때만).
// 고치기는 제자리 입력(개인 메모리와 같은 300자 편집기), 지우기는 바로 지우고 「기록에서 되돌릴 수 있어요」 토스트. 터치는 아이콘 44px.
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useDeleteSharedAiMemory, useUpdateSharedAiMemory } from '@/hooks/queries/useSharedAiMemories';
import { formatDateOnly } from '@/lib/formatters';
import { sharedRowMeta } from '@/lib/sharedAiMemory';
import { AiMemoryContentEditor } from '@/pages/settings/AiMemoryContentEditor';
import type { SharedAiMemoryItem, SharedSpaceRef } from '@/types/sharedAiMemory';

export function SharedMemoryRow({ item, space }: { item: SharedAiMemoryItem; space: SharedSpaceRef }) {
  const update = useUpdateSharedAiMemory(space);
  const remove = useDeleteSharedAiMemory(space);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const save = () => update.mutate({ id: item.id, content: draft.trim() }, { onSuccess: () => setEditing(false) });

  return (
    <li data-testid="shared-memory-row" className="flex items-start gap-2 px-3 py-2 pointer-coarse:py-3">
      {editing ? (
        <div className="min-w-0 flex-1 space-y-2">
          <AiMemoryContentEditor
            value={draft}
            onChange={setDraft}
            onCancel={() => setEditing(false)}
            onSubmit={save}
            submitLabel="저장"
            pending={update.isPending}
            rows={2}
            ariaLabel="공용 메모리 내용"
            testIdPrefix="shared-memory-edit"
          />
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p data-testid="shared-memory-content" className="break-keep text-sm [overflow-wrap:anywhere]">
              {item.content}
            </p>
            <p data-testid="shared-memory-meta" className="break-keep text-xs text-muted-foreground">
              {sharedRowMeta(item)} · <span className="whitespace-nowrap">{formatDateOnly(item.updatedAt)}</span>
            </p>
          </div>
          {item.canEdit && (
            <div className="flex shrink-0 gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 pointer-coarse:size-11"
                aria-label="수정"
                data-testid="shared-memory-edit"
                onClick={() => {
                  setDraft(item.content);
                  setEditing(true);
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive pointer-coarse:size-11"
                aria-label="삭제"
                data-testid="shared-memory-delete"
                disabled={remove.isPending}
                onClick={() => remove.mutate(item.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          )}
        </>
      )}
    </li>
  );
}
