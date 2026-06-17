// 프로젝트 이슈 유형 관리 — 프로젝트 설정 페이지의 한 섹션.
// OWNER 에게만 추가/수정/삭제 UI 노출. 시스템 4종은 편집 비활성.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { DeleteConfirmDialog } from '../../../components/ui/delete-confirm-dialog';
import { RenameDialog } from '../../../components/ui/rename-dialog';
import {
  useCreateIssueType,
  useDeleteIssueType,
  useIssueTypes,
  useUpdateIssueTypeDef,
} from '../../../hooks/queries/useIssueTypes';
import { ISSUE_TYPE_ICONS } from '../../../lib/issueTypeIcons';
import { LABEL_COLORS } from '../../../lib/labelColors';
import { ICON_NAMES, type IconName } from '../../../types/issueType';
import { COLOR_TOKENS, type ColorToken } from '../../../types/label';

export function IssueTypeManagement({
  projectKey,
  isOwner,
}: {
  projectKey: string;
  isOwner: boolean;
}) {
  const types = useIssueTypes(projectKey);
  const create = useCreateIssueType(projectKey);
  const update = useUpdateIssueTypeDef(projectKey);
  const del = useDeleteIssueType(projectKey);
  const [name, setName] = useState('');
  const [color, setColor] = useState<ColorToken>('BLUE');
  const [icon, setIcon] = useState<IconName>('Circle');

  // 이름 변경 Dialog 상태 — window.prompt() 대체 (#160)
  const [renameTarget, setRenameTarget] = useState<{
    id: number;
    name: string;
    colorToken: string;
    icon: IconName;
  } | null>(null);

  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await create.mutateAsync({ name: trimmed, colorToken: color, icon });
      setName('');
      setColor('BLUE');
      setIcon('Circle');
    } catch {
      // toast 는 훅에서 처리
    }
  }

  return (
    <section className="space-y-3" aria-label="이슈 유형 관리">
      <h2 className="text-lg font-semibold">이슈 유형</h2>

      {isOwner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate();
          }}
          className="flex flex-wrap gap-3 items-end"
          data-testid="issue-type-create-form"
        >
          <div className="flex-1 min-w-[160px] space-y-1">
            <label className="text-sm font-medium" htmlFor="new-type-name">
              이름
            </label>
            <Input
              id="new-type-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              aria-label="이름"
            />
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium block">색상</span>
            <div role="group" aria-label="유형 색상" className="flex gap-1">
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
                />
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium block">아이콘</span>
            <div role="group" aria-label="유형 아이콘" className="flex gap-1">
              {ICON_NAMES.map((n) => {
                const I = ISSUE_TYPE_ICONS[n];
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setIcon(n)}
                    aria-label={n}
                    aria-pressed={icon === n}
                    data-testid={`issue-type-icon-${n}`}
                    className={`h-6 w-6 inline-flex items-center justify-center rounded-full border ${
                      icon === n ? 'ring-2 ring-foreground' : ''
                    }`}
                  >
                    <I className="h-3 w-3" />
                  </button>
                );
              })}
            </div>
          </div>
          <Button type="submit" disabled={create.isPending}>
            추가
          </Button>
        </form>
      )}

      {types.isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : (
        <ul className="space-y-1">
          {(types.data ?? []).map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 border-b py-2"
              data-testid={`issue-type-row-${t.id}`}
            >
              <IssueTypeBadge
                type={{
                  id: t.id,
                  name: t.name,
                  colorToken: t.colorToken,
                  icon: t.icon,
                }}
              />
              {t.isSystem && (
                <span className="text-xs text-muted-foreground">시스템</span>
              )}
              {isOwner && !t.isSystem && (
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setRenameTarget({
                        id: t.id,
                        name: t.name,
                        colorToken: t.colorToken,
                        icon: t.icon,
                      })
                    }
                    aria-label={`${t.name} 이름 변경`}
                  >
                    이름 변경
                  </Button>
                  {/* 삭제 — window.confirm 대신 shadcn AlertDialog (#148) */}
                  <DeleteConfirmDialog
                    entityName="이슈 유형"
                    itemName={t.name}
                    onConfirm={() => del.mutate(t.id)}
                    trigger={
                      <Button variant="ghost" size="sm">
                        삭제
                      </Button>
                    }
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* 이름 변경 Dialog — window.prompt() 대체 (#160) */}
      <RenameDialog
        open={renameTarget != null}
        title="이슈 유형 이름 변경"
        initialValue={renameTarget?.name ?? ''}
        onConfirm={(newName) => {
          if (!renameTarget) return;
          update.mutate({
            id: renameTarget.id,
            body: { name: newName, colorToken: renameTarget.colorToken, icon: renameTarget.icon },
          });
        }}
        onClose={() => setRenameTarget(null)}
      />
    </section>
  );
}
