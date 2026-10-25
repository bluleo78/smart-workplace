// 이슈 상세 「관계」 그룹 본문(WP-887, 옛 「의존성」 그룹 자리) — 차단·이슈 사이 관계·외부 링크를 말 묶음으로 보인다.
// 묶음은 줄이 있는 말만 그린다: 차단됨 → 차단 중 → 유형 정렬 순 → 「외부 링크」. 전부 비면 「없음」 한 줄.
// 차단 줄은 의존성 API 로 지우고(블로커 계산이 그대로라서), 관계 줄은 관계 API 로 지운다.
// 편집 권한이 없으면(disabled) 추가·제거·수정 조작을 그리지 않는다 — 서버는 멤버만 허용한다(WP-503).

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { HIT_AREA_Y_COARSE } from '@/lib/hitArea';
import { groupRelations, type RelationRow } from '@/lib/issueRelations';

import { IssueExternalLinkRow } from '../../../components/issues/IssueExternalLinkRow';
import { IssueLinkRow } from '../../../components/issues/IssueLinkRow';
import { useRemoveIssueDependency } from '../../../hooks/queries/useIssueDependencies';
import { useRemoveIssueExternalLink, useRemoveIssueRelation } from '../../../hooks/queries/useIssueRelations';
import { useIssueRelationTypes } from '../../../hooks/queries/useIssueRelationTypes';
import type { IssueExternalLinkView, IssueLinkSummary, IssueRelationView } from '../../../types/issue';
import { AddIssueRelationDialog } from './AddIssueRelationDialog';

export function IssueRelationsSection({
  projectKey,
  issueNumber,
  blockedBy,
  blocks,
  relations,
  externalLinks,
  disabled = false,
}: {
  projectKey: string;
  issueNumber: number;
  blockedBy: IssueLinkSummary[];
  blocks: IssueLinkSummary[];
  relations: IssueRelationView[];
  externalLinks: IssueExternalLinkView[];
  /** 워크플로 편집 권한 없음(OPEN 비멤버) — 제거·수정 조작을 그리지 않는다. */
  disabled?: boolean;
}) {
  // 묶음 정렬에 유형 정렬 순이 필요할 때만(관계가 있을 때) 유형 목록을 받는다.
  const types = useIssueRelationTypes(relations.length > 0);
  const groups = groupRelations(blockedBy, blocks, relations, types.data);

  const removeDependency = useRemoveIssueDependency(projectKey, issueNumber);
  const removeRelation = useRemoveIssueRelation(projectKey, issueNumber);
  const removeExternal = useRemoveIssueExternalLink(projectKey, issueNumber);
  // 고칠 외부 링크와 수정 창 열림 — 따로 둬서 닫히는 동안에도 창 내용이 「관계 추가」로 바뀌어 보이지 않게 한다.
  const [editing, setEditing] = useState<IssueExternalLinkView | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // 줄 조작 핸들러 — 편집할 수 없으면 만들지 않는다(undefined 를 넘기면 줄이 제거·수정 조작을 그리지 않는다).
  const handlers = disabled
    ? null
    : {
        remove: (row: RelationRow) =>
          row.kind === 'blocking'
            ? () => removeDependency.mutate({ otherNumber: row.link.number, direction: row.direction })
            : () => removeRelation.mutate({ relationId: row.relation.id, other: row.relation.issue }),
        editExternal: (l: IssueExternalLinkView) => () => {
          setEditing(l);
          setEditOpen(true);
        },
        removeExternal: (l: IssueExternalLinkView) => () => removeExternal.mutate(l.id),
      };

  if (groups.length === 0 && externalLinks.length === 0) {
    return (
      <section aria-label="관계" data-testid="issue-relations-section">
        <p className="text-xs text-muted-foreground">없음</p>
      </section>
    );
  }

  return (
    <section aria-label="관계" data-testid="issue-relations-section" className="space-y-3">
      {groups.map((g) => (
        <div key={g.key}>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground" data-testid={`issue-relation-group-heading-${g.key}`}>
            {g.label}
          </h3>
          <ul data-testid={g.testId}>
            {g.rows.map((row) =>
              row.kind === 'blocking' ? (
                <IssueLinkRow
                  key={`${row.direction}-${row.link.number}`}
                  projectKey={projectKey}
                  link={row.link}
                  onRemove={handlers?.remove(row)}
                />
              ) : (
                <IssueLinkRow
                  key={`r-${row.relation.id}`}
                  projectKey={row.relation.issue.projectKey}
                  currentProjectKey={projectKey}
                  link={row.relation.issue}
                  onRemove={handlers?.remove(row)}
                  removeLabel="관계 제거"
                  testIdPrefix="issue-relation"
                  testIdKey={row.relation.id}
                />
              ),
            )}
          </ul>
        </div>
      ))}

      {externalLinks.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">외부 링크</h3>
          <ul data-testid="issue-external-links">
            {externalLinks.map((l) => (
              <IssueExternalLinkRow
                key={l.id}
                link={l}
                onEdit={handlers?.editExternal(l)}
                onRemove={handlers?.removeExternal(l)}
              />
            ))}
          </ul>
        </div>
      )}

      {handlers && (
        <AddIssueRelationDialog
          projectKey={projectKey}
          issueNumber={issueNumber}
          open={editOpen}
          onOpenChange={setEditOpen}
          editing={editing}
        />
      )}
    </section>
  );
}

/**
 * 그룹 머리의 「＋ 관계 추가」 — 그룹이 접혀 있어도 머리에 보이고, 창은 이 버튼과 함께 산다(접힌 그룹 본문은 마운트되지 않으므로).
 * 편집 권한이 없으면 호출 측이 그리지 않는다.
 */
export function AddIssueRelationButton({ projectKey, issueNumber }: { projectKey: string; issueNumber: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        // 그룹 머리 줄 높이에 맞춰 작게 두고, 터치에서는 접기 버튼과 같이 위아래 눌림 영역만 넓힌다(WP-734).
        className={`h-6 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground ${HIT_AREA_Y_COARSE}`}
        onClick={() => setOpen(true)}
        data-testid="issue-relation-add"
      >
        <Plus className="h-3.5 w-3.5" />
        관계 추가
      </Button>
      <AddIssueRelationDialog projectKey={projectKey} issueNumber={issueNumber} open={open} onOpenChange={setOpen} />
    </>
  );
}
