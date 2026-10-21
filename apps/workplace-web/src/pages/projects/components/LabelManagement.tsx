// 프로젝트 설정 페이지의 라벨 관리 섹션.
// 생성은 프로젝트 멤버, 수정·삭제는 OWNER 또는 그 라벨을 만든 사람(WP-394) — 백엔드 가드가 최종 검증하고,
// 화면은 canCreate·라벨별 viewerCanManage 로 버튼을 숨긴다.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { settingsFieldClass, SettingsSection } from '@/components/layout/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { getLabelIssueCount } from '../../../api/labels';
import { LabelChip } from '../../../components/labels/LabelChip';
import { DeleteConfirmDialog, DeleteImpactNote } from '../../../components/ui/delete-confirm-dialog';
import {
  useCreateLabel,
  useDeleteLabel,
  useLabels,
  useUpdateLabel,
} from '../../../hooks/queries/useLabels';
import { deletionImpactNote } from '../../../lib/deletionImpact';
import { type ColorToken, DEFAULT_LABEL_COLOR } from '../../../types/label';
import { ColorTokenPicker, ProjectMetaEditDialog } from './ProjectMetaEditDialog';

export function LabelManagement({
  projectKey,
  canCreate,
  isOwner,
}: {
  projectKey: string;
  canCreate: boolean;
  isOwner: boolean;
}) {
  const labels = useLabels(projectKey);
  const create = useCreateLabel(projectKey);
  const update = useUpdateLabel(projectKey);
  const del = useDeleteLabel(projectKey);
  const [name, setName] = useState('');
  const [color, setColor] = useState<ColorToken>(DEFAULT_LABEL_COLOR);

  // 편집 Dialog 대상 — 이름·색상을 함께 고친다(#160 window.prompt 대체 → WP-660 색상까지)
  const [editTarget, setEditTarget] = useState<{
    id: number;
    name: string;
    colorToken: ColorToken;
  } | null>(null);

  // 생성 — trim 후 빈 문자열은 무시. submit 이벤트는 form 의 onSubmit 에서 처리.
  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await create.mutateAsync({ name: trimmed, colorToken: color });
      setName('');
      setColor(DEFAULT_LABEL_COLOR);
    } catch {
      // 에러 토스트는 mutation 의 onError 가 담당.
    }
  }

  return (
    <SettingsSection title="라벨" description="이슈를 분류하는 색 꼬리표예요.">

      {canCreate && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onCreate();
          }}
          className="flex flex-wrap gap-2 items-end"
          data-testid="label-create-form"
        >
          <div className={cn('flex-1 min-w-[160px] space-y-1', settingsFieldClass)}>
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
            <ColorTokenPicker value={color} onChange={setColor} ariaLabel="라벨 색상" testIdPrefix="label-color-" />
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
              className="flex items-center gap-2 border-b py-2 hover:bg-accent/50 transition-colors cursor-pointer"
              data-testid={`label-row-${l.id}`}
            >
              {/* LabelChip 의 색상 도트가 색상을 시각적으로 전달하므로 colorToken 원시값 텍스트 불필요 (#307) */}
              <LabelChip label={{ id: l.id, name: l.name, colorToken: l.colorToken }} />
              {/* 구 서버 응답엔 viewerCanManage 가 없다 — 그땐 예전처럼 OWNER 만 */}
              {(l.viewerCanManage ?? isOwner) && (
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setEditTarget({ id: l.id, name: l.name, colorToken: l.colorToken })
                    }
                    aria-label={`${l.name} 편집`}
                  >
                    편집
                  </Button>
                  {/* 삭제 — window.confirm 대신 shadcn AlertDialog (#148) */}
                  <DeleteConfirmDialog
                    entityName="라벨"
                    itemName={l.name}
                    impact={<LabelDeleteImpact projectKey={projectKey} labelId={l.id} />}
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

      {/* 편집 Dialog — 이름 중복(409) 등 실패는 창 안에 보이고 닫지 않는다(WP-660) */}
      <ProjectMetaEditDialog
        title="라벨 편집"
        target={editTarget}
        onSave={(v) => update.mutateAsync({ id: editTarget!.id, body: { name: v.name, colorToken: v.colorToken } })}
        onClose={() => setEditTarget(null)}
      />
    </SettingsSection>
  );
}

/** 라벨 삭제 확인창의 영향 안내(WP-488) — 확인창이 열릴 때(마운트) 이 라벨이 붙은 이슈 수를 받아 「이슈 N개에서 라벨이 빠집니다」를 보인다. */
function LabelDeleteImpact({ projectKey, labelId }: { projectKey: string; labelId: number }) {
  const count = useQuery({
    queryKey: ['labels', projectKey, labelId, 'issue-count'],
    queryFn: () => getLabelIssueCount(projectKey, labelId),
  });
  return <DeleteImpactNote note={deletionImpactNote('label', count.data)} />;
}
