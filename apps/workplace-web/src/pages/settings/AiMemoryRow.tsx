// 메모리 카드의 한 줄(WP-55, 시안 A) — 종류 배지 + 내용 + 메타(AI가 저장/직접 추가 · 날짜) + 수정·삭제.
// 수정은 제자리 입력(300자 카운트, 취소/저장), 삭제는 즉시 + 되돌리기 토스트(훅). 터치 기기는 아이콘 버튼을 44px 로 키운다.
// 배치: 데스크톱은 [배지][내용+메타][아이콘] 한 줄. 터치(모바일)는 아이콘 두 개(88px)가 오른쪽을 먹어 내용이 11자 폭으로 접히던 문제가 있어
// 아이콘을 메타 줄 오른쪽으로 내리고(내용은 아이콘 아래 폭까지 쓴다), 44px 터치 영역은 음수 마진으로 줄 높이를 늘리지 않은 채 유지한다.
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDeleteAiMemory, useUpdateAiMemory } from '@/hooks/queries/useAiMemories';
import { formatDateOnly } from '@/lib/formatters';
import { AiMemoryContentEditor } from '@/pages/settings/AiMemoryContentEditor';
import type { AiMemoryItem } from '@/types/aiMemory';

/** 종류 배지 — 선호는 AI 보라(ai-accent), 맥락은 info(하늘). 둘 다 라이트/다크 토큰 쌍(시안 A). */
export const KIND_BADGE = {
  PREFERENCE: { label: '선호', variant: 'ai' },
  CONTEXT: { label: '맥락', variant: 'info' },
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
    <li
      data-testid="ai-memory-row"
      data-id={item.id}
      // 3열 격자(배지·내용·아이콘). 터치는 2열로 접고 내용(p)이 아이콘 열까지 가로지르며, 아이콘은 메타 줄(2행)로 내려온다.
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-2 pointer-coarse:py-3.5"
    >
      <Badge variant={badge.variant} className="col-[1] row-[1/span_2] mt-0.5" data-testid="ai-memory-kind">
        {badge.label}
      </Badge>
      {editing ? (
        <div className="col-[2/span_2] row-[1/span_2] min-w-0 space-y-1.5">
          <AiMemoryContentEditor
            value={draft}
            onChange={setDraft}
            onCancel={() => setEditing(false)}
            onSubmit={save}
            submitLabel="저장"
            pending={update.isPending}
            rows={2}
            ariaLabel="메모리 내용"
            testIdPrefix="ai-memory-edit"
          />
        </div>
      ) : (
        <>
          <p
            data-testid="ai-memory-content"
            className="col-[2] row-[1] min-w-0 whitespace-pre-wrap break-keep text-sm [overflow-wrap:anywhere] pointer-coarse:col-[2/span_2]"
          >
            {item.content}
          </p>
          {/* 날짜(2026-10-12)는 하이픈에서 끊기지 않게 한 덩어리로 — 출처와 날짜 사이 " · " 에서만 줄이 바뀐다. */}
          <p data-testid="ai-memory-meta" className="col-[2] row-[2] min-w-0 text-xs text-muted-foreground">
            {item.source === 'AI' ? 'AI가 저장' : '직접 추가'} · <span className="whitespace-nowrap">{formatDateOnly(item.updatedAt)}</span>
          </p>
          <div className="col-[3] row-[1/span_2] flex gap-0.5 pointer-coarse:row-[2] pointer-coarse:-my-3.5 pointer-coarse:-mr-1.5">
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
        </>
      )}
    </li>
  );
}
