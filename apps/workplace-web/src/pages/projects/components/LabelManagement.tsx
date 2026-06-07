// 프로젝트 설정 페이지의 라벨 관리 섹션.
// OWNER 만 생성/수정/삭제 가능 (백엔드 가드가 최종 검증, isOwner 로 UI 숨김).

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { DeleteConfirmDialog } from '../../../components/ui/delete-confirm-dialog';
import { LabelChip } from '../../../components/labels/LabelChip';
import {
  useCreateLabel,
  useDeleteLabel,
  useLabels,
  useUpdateLabel,
} from '../../../hooks/queries/useLabels';
import { LABEL_COLORS } from '../../../lib/labelColors';
import { COLOR_TOKENS, type ColorToken } from '../../../types/label';

export function LabelManagement({
  projectKey,
  isOwner,
}: {
  projectKey: string;
  isOwner: boolean;
}) {
  const labels = useLabels(projectKey);
  const create = useCreateLabel(projectKey);
  const update = useUpdateLabel(projectKey);
  const del = useDeleteLabel(projectKey);
  const [name, setName] = useState('');
  const [color, setColor] = useState<ColorToken>('GRAY');

  // 생성 — trim 후 빈 문자열은 무시. submit 이벤트는 form 의 onSubmit 에서 처리.
  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await create.mutateAsync({ name: trimmed, colorToken: color });
      setName('');
      setColor('GRAY');
    } catch {
      // 에러 토스트는 mutation 의 onError 가 담당.
    }
  }

  return (
    <section className="space-y-3" aria-label="라벨 관리">
      <h2 className="text-lg font-semibold">라벨</h2>

      {isOwner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate();
          }}
          className="flex flex-wrap gap-2 items-end"
          data-testid="label-create-form"
        >
          <div className="flex-1 min-w-[160px] space-y-1">
            <label className="text-sm font-medium" htmlFor="new-label-name">
              이름
            </label>
            <Input
              id="new-label-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="예: 버그"
            />
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium">색상</span>
            <div role="group" aria-label="라벨 색상" className="flex gap-1 flex-wrap">
              {COLOR_TOKENS.map((tok) => (
                <button
                  key={tok}
                  type="button"
                  onClick={() => setColor(tok)}
                  aria-label={tok}
                  aria-pressed={color === tok}
                  className={`h-6 w-6 rounded-full ${LABEL_COLORS[tok].dot} ${
                    color === tok ? 'ring-2 ring-foreground' : ''
                  }`}
                  data-testid={`label-color-${tok}`}
                />
              ))}
            </div>
          </div>
          <Button type="submit" disabled={create.isPending}>
            추가
          </Button>
        </form>
      )}

      {labels.isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : (
        <ul className="space-y-1">
          {(labels.data ?? []).map((l) => (
            <li
              key={l.id}
              className="flex items-center gap-2 border-b py-2"
              data-testid={`label-row-${l.id}`}
            >
              <LabelChip label={{ id: l.id, name: l.name, colorToken: l.colorToken }} />
              <span className="text-xs text-muted-foreground">{l.colorToken}</span>
              {isOwner && (
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const next = prompt('새 이름', l.name);
                      if (next && next.trim()) {
                        update.mutate({
                          id: l.id,
                          body: { name: next.trim(), colorToken: l.colorToken },
                        });
                      }
                    }}
                    aria-label={`${l.name} 이름 변경`}
                  >
                    이름 변경
                  </Button>
                  {/* 삭제 — window.confirm 대신 shadcn AlertDialog (#148) */}
                  <DeleteConfirmDialog
                    entityName="라벨"
                    itemName={l.name}
                    onConfirm={() => del.mutate(l.id)}
                    trigger={
                      <Button variant="ghost" size="sm" aria-label={`${l.name} 삭제`}>
                        삭제
                      </Button>
                    }
                  />
                </div>
              )}
            </li>
          ))}
          {(labels.data ?? []).length === 0 && (
            <p className="text-muted-foreground py-4">라벨이 없습니다</p>
          )}
        </ul>
      )}
    </section>
  );
}
