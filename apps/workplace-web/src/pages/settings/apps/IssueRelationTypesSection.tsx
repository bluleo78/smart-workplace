// 설정 › 앱 설정 › 작업 관리 — 「이슈 관계 유형」 묶음(WP-887).
// 표: 이름 · 이 이슈는(A 쪽 말) · 상대 쪽(B 쪽 말) · 구분(기본/추가) · 쓰는 곳(건수) · 동작.
// 기본 유형은 이름·말을 바꾸거나 지울 수 없고(AI·MCP·가져오기가 코드로 부른다) 차단 외에는 숨길 수만 있다.
// 관리자가 추가한 유형은 숨기기·편집·삭제. 좁은 폭에선 말·구분·건수 열을 이름 아래 줄로 모아 가로로 넘치지 않게 한다.

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { SettingsSection } from '@/components/layout/SettingsSection';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableEmptyRow } from '@/components/ui/table-empty';
import { TableSkeletonRows } from '@/components/ui/table-skeleton';
import { BLOCKS_CODE, displayRelationLabel, relationTypeUsage } from '@/lib/issueRelations';

import {
  useAdminIssueRelationTypes,
  useSetIssueRelationTypeHidden,
} from '../../../hooks/queries/useIssueRelationTypes';
import type { IssueRelationTypeAdmin } from '../../../types/issue';
import { DeleteIssueRelationTypeDialog } from './DeleteIssueRelationTypeDialog';
import { IssueRelationTypeDialog } from './IssueRelationTypeDialog';

/** 동작 열 글자 버튼 — 표 줄 높이를 키우지 않게 작게, 터치에선 44px. */
const actionClass = 'h-7 px-2 text-xs pointer-coarse:h-11';

/** 상대 쪽 말 칸 — 방향 없으면 「(같음)」, 외부 전용(에픽에 속함)은 상대 쪽 말이 없다. */
function inwardText(t: IssueRelationTypeAdmin): string {
  if (!t.directed) return '(같음)';
  return t.inwardLabel ? displayRelationLabel(t.code, t.inwardLabel) : '—';
}

/** 구분·외부 전용·숨김 배지 묶음 — 넓은 폭의 구분 열과 좁은 폭의 이름 아래 줄이 같이 쓴다. */
function KindBadges({ t }: { t: IssueRelationTypeAdmin }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {t.code ? <Badge variant="outline">기본</Badge> : <Badge variant="secondary">추가</Badge>}
      {t.externalOnly && <Badge variant="outline">외부 링크만</Badge>}
    </span>
  );
}

export function IssueRelationTypesSection() {
  const types = useAdminIssueRelationTypes();
  const setHidden = useSetIssueRelationTypeHidden();
  // 추가·편집 창 — editing 이 null 이면 추가.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<IssueRelationTypeAdmin | null>(null);
  // 삭제 창 — 대상은 목록에서 매번 다시 찾는다(409 뒤 다시 받은 건수를 반영하려고). 지운 뒤엔 목록에서 사라지므로
  // 연 순간의 값을 붙들어 두고 그걸로 대신한다 — 닫히는 동안 창이 비어 보이지 않게.
  const [deleteSnapshot, setDeleteSnapshot] = useState<IssueRelationTypeAdmin | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const list = types.data ?? [];
  const deleteTarget = list.find((t) => t.id === deleteSnapshot?.id) ?? deleteSnapshot;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <SettingsSection
      title="이슈 관계 유형"
      description="이슈 사이 관계의 종류예요. 모든 프로젝트에 같이 쓰이고, 이슈 화면 「관계」 묶음의 제목이 돼요."
      data-testid="issue-relation-types-section"
    >
      <div className="flex justify-end">
        <Button onClick={openCreate} data-testid="relation-type-add">
          <Plus className="h-4 w-4" />
          관계 유형 추가
        </Button>
      </div>

      <div className="rounded-md border">
        <Table aria-label="이슈 관계 유형">
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead className="hidden @min-[560px]:table-cell">이 이슈는</TableHead>
              <TableHead className="hidden @min-[560px]:table-cell">상대 쪽</TableHead>
              <TableHead className="hidden @min-[960px]:table-cell">구분</TableHead>
              <TableHead className="hidden @min-[960px]:table-cell text-right">쓰는 곳</TableHead>
              <TableHead className="w-[1%]">
                <span className="sr-only">동작</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.isPending ? (
              <TableSkeletonRows columns={6} rows={6} />
            ) : types.isError ? (
              <TableEmptyRow colSpan={6} message="관계 유형을 불러오지 못했습니다. 새로고침해 주세요." />
            ) : list.length === 0 ? (
              <TableEmptyRow colSpan={6} message="관계 유형이 없습니다." />
            ) : (
              list.map((t) => {
                const used = relationTypeUsage(t);
                const isBlocks = t.code === BLOCKS_CODE;
                return (
                  <TableRow key={t.id} data-testid={`relation-type-row-${t.id}`} className={t.hidden ? 'text-muted-foreground' : undefined}>
                    <TableCell className="whitespace-normal align-middle">
                      <span className="font-medium">{t.name}</span>
                      {t.hidden && (
                        <Badge variant="outline" className="ml-1.5" data-testid={`relation-type-hidden-${t.id}`}>
                          숨김
                        </Badge>
                      )}
                      {/* 좁은 폭 전용 — 숨긴 열의 말·구분·건수를 이름 아래 줄로. */}
                      <p className="mt-1 text-xs text-muted-foreground @min-[560px]:hidden">
                        {t.outwardLabel}
                        {t.directed && t.inwardLabel ? ` ↔ ${inwardText(t)}` : ''}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground @min-[960px]:hidden">
                        <KindBadges t={t} />
                        <span>{used}건</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden align-middle @min-[560px]:table-cell">{t.outwardLabel}</TableCell>
                    <TableCell className="hidden align-middle @min-[560px]:table-cell">
                      <span className={!t.directed || !t.inwardLabel ? 'text-muted-foreground' : undefined}>{inwardText(t)}</span>
                    </TableCell>
                    <TableCell className="hidden align-middle @min-[960px]:table-cell">
                      <KindBadges t={t} />
                    </TableCell>
                    <TableCell
                      className="hidden align-middle text-right tabular-nums @min-[960px]:table-cell"
                      title={`이슈 사이 ${t.relationCount}건 · 외부 링크 ${t.externalLinkCount}건`}
                      data-testid={`relation-type-usage-${t.id}`}
                    >
                      {used}건
                    </TableCell>
                    <TableCell className="align-middle">
                      <div className="flex justify-end gap-0.5 whitespace-nowrap">
                        {isBlocks ? (
                          // 차단은 숨길 수도 없다 — 블로커 계산·차단 필터가 기대고 있다.
                          <span className="px-2 py-1 text-xs text-muted-foreground">고정</span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className={actionClass}
                            aria-label={t.hidden ? `${t.name} 다시 보이기` : `${t.name} 숨기기`}
                            disabled={setHidden.isPending}
                            onClick={() => setHidden.mutate({ id: t.id, hidden: !t.hidden })}
                            data-testid={`relation-type-toggle-hidden-${t.id}`}
                          >
                            {t.hidden ? '보이기' : '숨기기'}
                          </Button>
                        )}
                        {t.code == null && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={actionClass}
                              aria-label={`${t.name} 편집`}
                              onClick={() => {
                                setEditing(t);
                                setFormOpen(true);
                              }}
                              data-testid={`relation-type-edit-${t.id}`}
                            >
                              편집
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`${actionClass} text-destructive hover:text-destructive`}
                              aria-label={`${t.name} 삭제`}
                              onClick={() => {
                                setDeleteSnapshot(t);
                                setDeleteOpen(true);
                              }}
                              data-testid={`relation-type-delete-${t.id}`}
                            >
                              삭제
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <IssueRelationTypeDialog open={formOpen} onOpenChange={setFormOpen} editing={editing} />
      <DeleteIssueRelationTypeDialog target={deleteTarget} types={list} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </SettingsSection>
  );
}
