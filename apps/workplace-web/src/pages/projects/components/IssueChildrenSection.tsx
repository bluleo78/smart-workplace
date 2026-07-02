// 비SUBTASK 이슈의 자식 SUBTASK 영역(Phase 4a) + EPIC 이슈의 하위 이슈 영역(EPIC 계층 확장).
// 진행률(완료/전체) + 자식 리스트 + 인라인 추가 폼.
// parentTypeName === 'EPIC' 이면 추가 폼에 유형 선택(SUBTASK/EPIC 제외)이 노출되고,
// 그 외(일반 이슈)는 기존처럼 SUBTASK 고정 추가 폼을 사용한다.
// 자식 조회는 부모 number 필터로 별도 search 호출 (cache key 분리).

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { issuesApi, searchIssues } from '../../../api/issues';
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { handleApiError } from '../../../lib/api-error';
import { getIssueTypeLabel } from '../../../lib/issueTypeLabels';
import type { IssueResponse } from '../../../types/issue';
import { IssueStatusBadge } from './IssueStatusBadge';

export function IssueChildrenSection({
  projectKey,
  parentNumber,
  parentTypeName,
  childCount,
  childDoneCount,
}: {
  projectKey: string;
  parentNumber: number;
  parentTypeName: string;
  childCount: number;
  childDoneCount: number;
}) {
  const qc = useQueryClient();
  const types = useIssueTypes(projectKey);
  const isEpicParent = parentTypeName === 'EPIC';
  // 일반 이슈(비EPIC) 부모 — SUBTASK 시스템 유형의 id (인라인 생성에 필요).
  const subtaskTypeId =
    (types.data ?? []).find((t) => t.name === 'SUBTASK')?.id ?? null;
  // EPIC 부모 — 하위 이슈로 선택 가능한 유형(SUBTASK/EPIC 제외, 2단 초과 금지).
  const epicChildTypes = (types.data ?? []).filter(
    (t) => t.name !== 'SUBTASK' && t.name !== 'EPIC',
  );
  const [epicChildTypeId, setEpicChildTypeId] = useState<number | null>(null);

  // EPIC 유형 목록 로드 시 첫 항목(TASK 우선 정렬) 기본 선택.
  useEffect(() => {
    if (!isEpicParent || epicChildTypeId != null || epicChildTypes.length === 0) return;
    setEpicChildTypeId(epicChildTypes[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEpicParent, epicChildTypes.length]);

  // 자식 검색 — search API 의 parent 필터 활용. 페이지 사이즈는 100 (1단계 트리 한계).
  const children = useQuery({
    queryKey: ['issues', 'search', projectKey, 'children', parentNumber],
    queryFn: () =>
      searchIssues(
        projectKey,
        {
          q: '',
          statuses: [],
          priorities: [],
          assigneeIds: [],
          includeUnassigned: false,
          dueFrom: null,
          dueTo: null,
          labelIds: [],
          cycleIds: [],
          typeIds: [],
          parentNumber,
          topLevel: false,
          blocked: false,
        },
        null,
        100,
      ),
    enabled: !!projectKey && Number.isFinite(parentNumber),
  });

  // 생성 시간 오름차순 정렬 — 백엔드 기본 정렬(updatedAt desc)로 인해 신규 항목이
  // 최상단에 삽입되는 역방향 UX 방지 (refs #166).
  const items: IssueResponse[] = (children.data?.items ?? []).slice().sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);

  // 인라인 추가 — 제목 입력, 유형은 EPIC 부모면 선택된 값/일반 부모면 SUBTASK 고정, parentNumber 동봉.
  async function onAdd() {
    const t = newTitle.trim();
    const typeId = isEpicParent ? epicChildTypeId : subtaskTypeId;
    if (!t || !typeId) return;
    setAdding(true);
    try {
      await issuesApi.create(projectKey, {
        title: t,
        typeId,
        parentNumber,
      });
      setNewTitle('');
      // 자식 목록, 검색 캐시, 부모 detail 의 childCount 모두 갱신.
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
      toast.success(isEpicParent ? '하위 이슈를 추가했습니다' : '하위 태스크를 추가했습니다');
    } catch (e) {
      handleApiError(e, '하위 이슈 추가에 실패했습니다');
    } finally {
      setAdding(false);
    }
  }

  const pct = childCount === 0 ? 0 : Math.round((childDoneCount / childCount) * 100);
  const sectionLabel = isEpicParent ? '하위 이슈' : '하위 태스크';

  return (
    <section
      aria-label={sectionLabel}
      data-testid="issue-children-section"
      className="space-y-2"
    >
      <div className="flex items-center gap-2">
        {/* 섹션 헤딩 — 디자인 시스템 heading-group(H4) 토큰. */}
        <h3 className="text-base leading-6 font-medium">{sectionLabel}</h3>
        {/* 개수만 노출 — 하위 이슈가 있을 때만(0/0 은 무의미). */}
        {childCount > 0 && (
          <span className="text-xs text-muted-foreground" data-testid="child-progress-text">
            {childDoneCount}/{childCount}
          </span>
        )}
        {/* 진행률 트랙 — 하위 이슈가 있을 때만. 0/0 일 때 빈 회색 트랙이 우측에 divider 처럼 보이는 문제 제거. */}
        {childCount > 0 && (
          <div className="flex-1 bg-muted h-1 rounded overflow-hidden">
            <div
              className="bg-primary h-full"
              style={{ width: `${pct}%` }}
              data-testid="child-progress-bar"
            />
          </div>
        )}
      </div>

      {children.isLoading ? (
        <p className="text-xs text-muted-foreground">로딩 중…</p>
      ) : items.length === 0 ? null : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center gap-2 rounded px-1 text-sm hover:bg-accent/50"
              data-testid={`child-row-${it.number}`}
            >
              <span className="text-muted-foreground">└</span>
              {it.type && <IssueTypeBadge type={it.type} size="sm" iconOnly />}
              <Link
                to={`/projects/${projectKey}/issues/${it.number}`}
                className="flex-1 truncate hover:underline"
              >
                {it.title}
              </Link>
              <IssueStatusBadge status={it.status} />
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd();
        }}
        className="flex gap-2"
        data-testid="child-add-form"
      >
        {isEpicParent && (
          <Select
            value={epicChildTypeId != null ? String(epicChildTypeId) : ''}
            onValueChange={(v) => setEpicChildTypeId(Number(v))}
          >
            <SelectTrigger
              data-testid="epic-child-type-select"
              aria-label="하위 이슈 유형"
              className="w-32"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {epicChildTypes.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {getIssueTypeLabel(t.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder={
            isEpicParent
              ? '+ 하위 이슈 추가 — 제목 입력 후 Enter'
              : '+ 하위 태스크 추가 — 제목 입력 후 Enter'
          }
          maxLength={200}
          data-testid="child-add-input"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!newTitle.trim() || !(isEpicParent ? epicChildTypeId : subtaskTypeId) || adding}
        >
          추가
        </Button>
      </form>
    </section>
  );
}
