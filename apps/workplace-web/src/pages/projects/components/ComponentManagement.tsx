// 프로젝트 설정의 「구성요소」 섹션(WP-933) — 라벨 아래. 개인 프로젝트에서는 그리지 않는다(호출부).
// 표(이름·설명·담당자·이슈 수·편집/보관) + 「＋ 구성요소 추가」 + 「보관한 구성요소 N개 보기」 접기.
// 추가·편집·보관·복원·삭제는 프로젝트 OWNER 와 테넌트 ADMIN(canManage) — 그 밖에는 읽기 전용. 백엔드 가드가 최종 검증한다.
// 삭제는 보관한 구성요소에서만 — 쓰던 영역을 바로 지우면 붙은 이슈에서 빠지므로, 보관(새로 못 붙임)을 먼저 거치게 한다.

import { AlertTriangle, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { SettingsSection } from '@/components/layout/SettingsSection';
import { Button } from '@/components/ui/button';

import { ComponentChip } from '../../../components/components/ComponentChip';
import { DeleteConfirmDialog, DeleteImpactNote } from '../../../components/ui/delete-confirm-dialog';
import {
  useComponents,
  useCreateComponent,
  useDeleteComponent,
  useUpdateComponent,
} from '../../../hooks/queries/useComponents';
import { handleApiError } from '../../../lib/api-error';
import { deletionImpactNote } from '../../../lib/deletionImpact';
import { type ComponentDraft,componentPatch } from '../../../lib/issueComponents';
import type { ComponentResponse } from '../../../types/component';
import { ComponentEditDialog } from './ComponentEditDialog';

const EMPTY_HINT = '영역별로 이슈를 나누고 영역 담당자를 자동으로 붙여요. 구성요소를 추가하면 이슈에 칸이 생겨요.';

export function ComponentManagement({ projectKey, canManage }: { projectKey: string; canManage: boolean }) {
  const components = useComponents(projectKey);
  const create = useCreateComponent(projectKey);
  const update = useUpdateComponent(projectKey);
  const del = useDeleteComponent(projectKey);
  // 편집 창 — null 닫힘, 'new' 추가, 그 밖은 편집 대상.
  const [editing, setEditing] = useState<ComponentResponse | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const list = components.data ?? [];
  const active = list.filter((c) => !c.archived);
  const archived = list.filter((c) => c.archived);

  // 저장 — 추가는 그대로, 편집은 바뀐 필드만(componentPatch). 바뀐 게 없으면 요청 없이 닫는다.
  function save(draft: ComponentDraft): Promise<unknown> {
    if (editing === 'new') {
      return create.mutateAsync({
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        defaultAssigneeId: draft.assigneeId,
      });
    }
    if (!editing) return Promise.resolve();
    const body = componentPatch(editing, draft);
    if (Object.keys(body).length === 0) return Promise.resolve();
    return update.mutateAsync({ id: editing.id, body }).then(() => toast.success('구성요소를 수정했어요'));
  }

  // 보관·복원 — 결과를 토스트로 알리고, 실패(권한 등)는 서버 문구를 토스트로.
  function setArchived(c: ComponentResponse, value: boolean) {
    update.mutate(
      { id: c.id, body: { archived: value } },
      {
        onSuccess: () => toast.success(value ? '구성요소를 보관했어요' : '구성요소를 복원했어요'),
        onError: (e) => handleApiError(e, value ? '보관하지 못했습니다' : '복원하지 못했습니다'),
      },
    );
  }

  return (
    <SettingsSection
      title="구성요소"
      description="이슈를 영역으로 나누고, 영역 담당자를 새 이슈에 자동으로 붙여요."
      data-testid="component-section"
    >
      {canManage && (
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing('new')} data-testid="component-add">
          <Plus aria-hidden /> 구성요소 추가
        </Button>
      )}

      {components.isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : active.length === 0 && archived.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground" data-testid="component-empty">{EMPTY_HINT}</p>
      ) : (
        <>
          {active.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground" data-testid="component-empty">{EMPTY_HINT}</p>
          ) : (
            <ComponentTable
              rows={active}
              canManage={canManage}
              onEdit={setEditing}
              onArchive={(c) => setArchived(c, true)}
            />
          )}
          {archived.length > 0 && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 text-muted-foreground"
                aria-expanded={showArchived}
                onClick={() => setShowArchived((v) => !v)}
                data-testid="component-archived-toggle"
              >
                {showArchived ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                보관한 구성요소 {archived.length}개 보기
              </Button>
              {showArchived && (
                <ComponentTable
                  rows={archived}
                  canManage={canManage}
                  onRestore={(c) => setArchived(c, false)}
                  onDelete={(c) => del.mutate(c.id)}
                />
              )}
            </div>
          )}
        </>
      )}

      <ComponentEditDialog
        projectKey={projectKey}
        open={editing != null}
        target={editing === 'new' ? null : editing}
        onSave={save}
        onClose={() => setEditing(null)}
      />
    </SettingsSection>
  );
}

/**
 * 구성요소 행 목록 — 사용 중(편집·보관)과 보관한 것(복원·삭제)이 같은 모양을 쓴다. 설정 칸 폭이 좁아(모바일 포함) 표 대신 줄마다
 * 이름·설명 / 담당자 / 이슈 수 / 동작을 감싸 흐르게 둔다.
 */
function ComponentTable({
  rows,
  canManage,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  rows: ComponentResponse[];
  canManage: boolean;
  onEdit?: (c: ComponentResponse) => void;
  onArchive?: (c: ComponentResponse) => void;
  onRestore?: (c: ComponentResponse) => void;
  onDelete?: (c: ComponentResponse) => void;
}) {
  return (
    <ul className="divide-y border-y">
      {rows.map((c) => (
        <li key={c.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-2" data-testid={`component-row-${c.id}`}>
          {/* 첫 줄(칩·담당자·이슈 수·버튼)을 같은 높이(h-6 = 24px) 줄로 맞춘다 — 버튼(h-8)은 -mt-1 로 그 줄 가운데에 걸친다. */}
          <div className="min-w-0 flex-1 basis-40 space-y-0.5">
            <div className="flex h-6 items-center">
              <ComponentChip component={c} />
            </div>
            {c.description && <p className="text-xs text-muted-foreground">{c.description}</p>}
          </div>
          <div className="w-36 min-w-0 text-sm" data-testid={`component-row-${c.id}-assignee`}>
            {c.defaultAssignee ? (
              <>
                <span className="block h-6 truncate leading-6">{c.defaultAssignee.name}</span>
                {!c.defaultAssigneeValid && (
                  <span className="flex items-start gap-1 text-xs text-warning-text" data-testid={`component-row-${c.id}-assignee-warning`}>
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                    프로젝트 구성원이 아니에요 — 자동 지정을 건너뛰어요
                  </span>
                )}
              </>
            ) : (
              <span className="block h-6 leading-6 text-muted-foreground">담당자 없음</span>
            )}
          </div>
          <div className="h-6 w-16 text-sm leading-6 text-muted-foreground tabular-nums" data-testid={`component-row-${c.id}-count`}>
            이슈 {c.issueCount}
          </div>
          {canManage && (
            <div className="-mt-1 ml-auto flex gap-1">
              {onEdit && (
                <Button variant="ghost" size="sm" onClick={() => onEdit(c)} aria-label={`${c.name} 편집`}>
                  편집
                </Button>
              )}
              {onArchive && (
                <Button variant="ghost" size="sm" onClick={() => onArchive(c)} aria-label={`${c.name} 보관`}>
                  보관
                </Button>
              )}
              {onRestore && (
                <Button variant="ghost" size="sm" onClick={() => onRestore(c)} aria-label={`${c.name} 복원`}>
                  복원
                </Button>
              )}
              {onDelete && (
                <DeleteConfirmDialog
                  entityName="구성요소"
                  itemName={c.name}
                  impact={<DeleteImpactNote note={deletionImpactNote('component', c.issueCount)} />}
                  onConfirm={() => onDelete(c)}
                  confirmTestId="component-delete-confirm"
                  trigger={
                    <Button variant="ghost" size="sm" aria-label={`${c.name} 삭제`}>
                      삭제
                    </Button>
                  }
                />
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
