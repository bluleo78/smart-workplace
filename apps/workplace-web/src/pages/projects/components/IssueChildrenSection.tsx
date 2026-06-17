// 비SUBTASK 이슈의 자식 SUBTASK 영역 (Phase 4a).
// 진행률(완료/전체) + 자식 리스트 + 인라인 SUBTASK 추가 폼.
// 자식 조회는 부모 number 필터로 별도 search 호출 (cache key 분리).

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { issuesApi, searchIssues } from '../../../api/issues';
import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { handleApiError } from '../../../lib/api-error';
import type { IssueResponse } from '../../../types/issue';

import { IssueStatusBadge } from './IssueStatusBadge';

export function IssueChildrenSection({
  projectKey,
  parentNumber,
  childCount,
  childDoneCount,
}: {
  projectKey: string;
  parentNumber: number;
  childCount: number;
  childDoneCount: number;
}) {
  const qc = useQueryClient();
  const types = useIssueTypes(projectKey);
  // SUBTASK 시스템 유형의 id — 인라인 생성에 필요.
  const subtaskTypeId =
    (types.data ?? []).find((t) => t.name === 'SUBTASK')?.id ?? null;

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

  // SUBTASK 인라인 추가 — 제목만 입력, 유형은 SUBTASK 고정, parentNumber 동봉.
  async function onAdd() {
    const t = newTitle.trim();
    if (!t || !subtaskTypeId) return;
    setAdding(true);
    try {
      await issuesApi.create(projectKey, {
        title: t,
        typeId: subtaskTypeId,
        parentNumber,
      });
      setNewTitle('');
      // 자식 목록, 검색 캐시, 부모 detail 의 childCount 모두 갱신.
      qc.invalidateQueries({ queryKey: ['issues', 'search', projectKey] });
      qc.invalidateQueries({ queryKey: ['issues', projectKey, 'detail'] });
      toast.success('하위 태스크를 추가했습니다');
    } catch (e) {
      handleApiError(e, '하위 태스크 추가에 실패했습니다');
    } finally {
      setAdding(false);
    }
  }

  const pct = childCount === 0 ? 0 : Math.round((childDoneCount / childCount) * 100);

  return (
    <section
      aria-label="하위 태스크"
      data-testid="issue-children-section"
      className="space-y-2"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">하위 태스크</h3>
        <span className="text-xs text-muted-foreground" data-testid="child-progress-text">
          {childDoneCount}/{childCount}
        </span>
        <div className="flex-1 bg-muted h-1 rounded overflow-hidden">
          <div
            className="bg-primary h-full"
            style={{ width: `${pct}%` }}
            data-testid="child-progress-bar"
          />
        </div>
      </div>

      {children.isLoading ? (
        <p className="text-xs text-muted-foreground">로딩 중…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">하위 태스크가 없습니다</p>
      ) : (
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
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="+ 하위 태스크 추가 — 제목 입력 후 Enter"
          maxLength={200}
          data-testid="child-add-input"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!newTitle.trim() || !subtaskTypeId || adding}
        >
          추가
        </Button>
      </form>
    </section>
  );
}
