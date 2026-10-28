// 프로젝트 이슈 유형 관리 — 프로젝트 설정 페이지의 한 섹션.
// OWNER 에게만 추가/수정/삭제 UI 노출. 시스템 4종은 편집 비활성.

import { useState } from 'react';

import { settingsFieldClass, SettingsSection } from '@/components/layout/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { DeleteConfirmDialog } from '../../../components/ui/delete-confirm-dialog';
import {
  useCreateIssueType,
  useDeleteIssueType,
  useIssueTypes,
  useUpdateIssueTypeDef,
} from '../../../hooks/queries/useIssueTypes';
import { type IconName } from '../../../types/issueType';
import { type ColorToken } from '../../../types/label';
import { ColorTokenPicker, IssueTypeIconPicker, ProjectMetaEditDialog } from './ProjectMetaEditDialog';

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

  // 편집 Dialog 대상 — 이름·색상·아이콘을 함께 고친다(#160 window.prompt 대체 → WP-660 색상·아이콘까지)
  const [editTarget, setEditTarget] = useState<{
    id: number;
    name: string;
    colorToken: ColorToken;
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
    <SettingsSection title="이슈 유형" description="이슈를 만들 때 고르는 종류예요.">

      {isOwner && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate();
          }}
          className="flex flex-wrap gap-3 items-end"
          data-testid="issue-type-create-form"
        >
          <div className={cn('flex-1 min-w-[160px] space-y-1', settingsFieldClass)}>
            <label className="text-sm font-medium block" htmlFor="new-type-name">
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
            <ColorTokenPicker value={color} onChange={setColor} ariaLabel="유형 색상" />
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium block">아이콘</span>
            <IssueTypeIconPicker value={icon} onChange={setIcon} testIdPrefix="issue-type-icon-" />
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
              className="flex items-center gap-2 row-divider py-2"
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
                      setEditTarget({
                        id: t.id,
                        name: t.name,
                        // 서버 응답 타입은 string 이지만 값은 12색 화이트리스트 중 하나다.
                        colorToken: t.colorToken as ColorToken,
                        icon: t.icon,
                      })
                    }
                    aria-label={`${t.name} 편집`}
                  >
                    편집
                  </Button>
                  {/* 삭제 — window.confirm 대신 shadcn AlertDialog (#148) */}
                  <DeleteConfirmDialog
                    entityName="이슈 유형"
                    itemName={t.name}
                    onConfirm={() => del.mutate(t.id)}
                    trigger={
                      <Button variant="ghost" size="sm" aria-label={`${t.name} 삭제`}>
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

      {/* 편집 Dialog — 이름 중복(409) 등 실패는 창 안에 보이고 닫지 않는다(WP-660) */}
      <ProjectMetaEditDialog
        title="이슈 유형 편집"
        target={editTarget}
        onSave={(v) =>
          update.mutateAsync({
            id: editTarget!.id,
            body: { name: v.name, colorToken: v.colorToken, icon: v.icon ?? editTarget!.icon },
          })
        }
        onClose={() => setEditTarget(null)}
      />
    </SettingsSection>
  );
}
