// 태스크 필터/검색 + 뷰(list/board) 토글 바.
// URL 의 SearchParams 가 단일 source of truth — 내부 state 는 q 입력 debounce 버퍼뿐.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { LabelChip } from '../../../components/labels/LabelChip';
import { useCycles } from '../../../hooks/queries/useCycles';
import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { useLabels } from '../../../hooks/queries/useLabels';
import { filtersToParams, parseFilters, parseGroupBy, parseView } from '../../../lib/issueFilters';
import type { IssueFilters, IssueGroupBy, IssueView } from '../../../types/issue';

const STATUS_OPTIONS = [
  { value: 'TODO', label: '할 일' },
  { value: 'IN_PROGRESS', label: '진행 중' },
  { value: 'DONE', label: '완료' },
  { value: 'CANCELED', label: '취소' },
];

// 본 코드베이스의 IssuePriority 는 LOW/MID/HIGH (URGENT 없음) — 백엔드 enum 일치.
const PRIORITY_OPTIONS = [
  { value: 'LOW', label: '낮음' },
  { value: 'MID', label: '보통' },
  { value: 'HIGH', label: '높음' },
];

// 그룹 기준 옵션 (#58). null = 그룹 없음(평탄 리스트 / 상태 보드).
const GROUP_OPTIONS: { value: IssueGroupBy | null; label: string }[] = [
  { value: null, label: '없음' },
  { value: 'status', label: '상태' },
  { value: 'assignee', label: '담당자' },
  { value: 'priority', label: '우선순위' },
];

export function IssueFilterBar({ projectKey }: { projectKey: string }) {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const view = parseView(params);
  const groupBy = parseGroupBy(params);
  const [qDraft, setQDraft] = useState(filters.q);
  const labels = useLabels(projectKey);
  const cycles = useCycles(projectKey);
  const types = useIssueTypes(projectKey);

  // URL 의 q 가 외부 변경(예: 초기화 버튼)으로 바뀌면 입력값을 동기화한다.
  useEffect(() => {
    setQDraft(filters.q);
  }, [filters.q]);

  // 검색어는 300ms debounce 후 URL 에 반영 — 매 키 입력마다 네트워크 호출을 막는다.
  useEffect(() => {
    if (qDraft === filters.q) return;
    const t = setTimeout(() => {
      writeFilters({ ...filters, q: qDraft }, view, groupBy);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft]);

  // view·groupBy 는 IssueFilters 와 분리된 URL 키 — 필터 변경 시에도 함께 보존해야 한다.
  function writeFilters(
    next: IssueFilters,
    nextView: IssueView,
    nextGroupBy: IssueGroupBy | null,
  ) {
    setParams(filtersToParams(next, nextView, nextGroupBy), { replace: true });
  }

  function toggleStatus(s: string) {
    const has = filters.statuses.includes(s);
    writeFilters(
      {
        ...filters,
        statuses: has
          ? filters.statuses.filter((x) => x !== s)
          : [...filters.statuses, s],
      },
      view,
      groupBy,
    );
  }

  function togglePriority(p: string) {
    const has = filters.priorities.includes(p);
    writeFilters(
      {
        ...filters,
        priorities: has
          ? filters.priorities.filter((x) => x !== p)
          : [...filters.priorities, p],
      },
      view,
      groupBy,
    );
  }

  // 라벨 다중 토글 — AND 결합이므로 선택할수록 결과는 좁아진다.
  function toggleLabel(id: number) {
    const has = filters.labelIds.includes(id);
    writeFilters(
      {
        ...filters,
        labelIds: has
          ? filters.labelIds.filter((x) => x !== id)
          : [...filters.labelIds, id],
      },
      view,
      groupBy,
    );
  }

  // 사이클 다중 토글 — OR 결합. 선택된 사이클 중 하나에 속한 이슈 매칭.
  function toggleCycle(id: number) {
    const has = filters.cycleIds.includes(id);
    writeFilters(
      {
        ...filters,
        cycleIds: has
          ? filters.cycleIds.filter((x) => x !== id)
          : [...filters.cycleIds, id],
      },
      view,
      groupBy,
    );
  }

  // 유형 다중 토글 — OR 결합. 선택된 유형 중 하나에 속한 이슈 매칭.
  function toggleType(id: number) {
    const has = filters.typeIds.includes(id);
    writeFilters(
      {
        ...filters,
        typeIds: has
          ? filters.typeIds.filter((x) => x !== id)
          : [...filters.typeIds, id],
      },
      view,
      groupBy,
    );
  }

  function setView(v: IssueView) {
    writeFilters(filters, v, groupBy);
  }

  // 그룹 기준 변경 — 필터/view 는 유지하고 group 만 교체 (#58).
  function setGroupBy(g: IssueGroupBy | null) {
    writeFilters(filters, view, g);
  }

  // 초기화는 view·group 은 유지하고 나머지 필터만 비운다.
  function reset() {
    const p = new URLSearchParams();
    if (view === 'board') p.set('view', 'board');
    if (groupBy) p.set('group', groupBy);
    setParams(p, { replace: true });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <Input
        value={qDraft}
        onChange={(e) => setQDraft(e.target.value)}
        placeholder="태스크 검색"
        className="w-64"
        aria-label="태스크 검색"
      />

      <div className="flex items-center gap-1" role="group" aria-label="상태 필터">
        {STATUS_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={filters.statuses.includes(opt.value) ? 'default' : 'outline'}
            size="sm"
            onClick={() => toggleStatus(opt.value)}
            aria-pressed={filters.statuses.includes(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="우선순위 필터">
        {PRIORITY_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={filters.priorities.includes(opt.value) ? 'default' : 'outline'}
            size="sm"
            onClick={() => togglePriority(opt.value)}
            aria-pressed={filters.priorities.includes(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={filters.labelIds.length > 0 ? 'default' : 'outline'}
            size="sm"
            aria-label="라벨 필터"
            data-testid="label-filter-trigger"
          >
            라벨{filters.labelIds.length > 0 ? ` (${filters.labelIds.length})` : ''}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2">
          <div className="max-h-64 overflow-y-auto space-y-1">
            {(labels.data ?? []).map((l) => (
              <label
                key={l.id}
                className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-accent"
                data-testid={`label-filter-option-${l.id}`}
              >
                <input
                  type="checkbox"
                  checked={filters.labelIds.includes(l.id)}
                  onChange={() => toggleLabel(l.id)}
                  aria-label={l.name}
                />
                <LabelChip
                  label={{ id: l.id, name: l.name, colorToken: l.colorToken }}
                  size="sm"
                />
              </label>
            ))}
            {(labels.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground py-2 text-center">
                라벨이 없습니다
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* 사이클 필터 — 라벨 필터와 동일 패턴으로 멀티셀렉트 구현 */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={filters.cycleIds.length > 0 ? 'default' : 'outline'}
            size="sm"
            aria-label="사이클 필터"
            data-testid="cycle-filter-trigger"
          >
            사이클{filters.cycleIds.length > 0 ? ` (${filters.cycleIds.length})` : ''}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2">
          <div className="max-h-64 overflow-y-auto space-y-1">
            {(cycles.data ?? []).map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-accent"
                data-testid={`cycle-filter-option-${c.id}`}
              >
                <input
                  type="checkbox"
                  checked={filters.cycleIds.includes(c.id)}
                  onChange={() => toggleCycle(c.id)}
                  aria-label={c.name}
                />
                <span className="text-sm">{c.name}</span>
                <span className="ml-auto text-[10px] uppercase text-muted-foreground">
                  {c.status}
                </span>
              </label>
            ))}
            {(cycles.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground py-2 text-center">
                사이클이 없습니다
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant={filters.typeIds.length > 0 ? 'default' : 'outline'}
            size="sm"
            aria-label="유형 필터"
            data-testid="issue-type-filter-trigger"
          >
            유형{filters.typeIds.length > 0 ? ` (${filters.typeIds.length})` : ''}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2">
          <div className="max-h-64 overflow-y-auto space-y-1">
            {(types.data ?? []).map((t) => (
              <label
                key={t.id}
                className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-accent"
                data-testid={`issue-type-filter-option-${t.id}`}
              >
                <input
                  type="checkbox"
                  checked={filters.typeIds.includes(t.id)}
                  onChange={() => toggleType(t.id)}
                  aria-label={t.name}
                />
                <IssueTypeBadge
                  type={{
                    id: t.id,
                    name: t.name,
                    colorToken: t.colorToken,
                    icon: t.icon,
                  }}
                  size="sm"
                />
              </label>
            ))}
            {(types.data ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground py-2 text-center">
                유형이 없습니다
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex items-center gap-1 ml-auto" role="group" aria-label="그룹 기준">
        <span className="text-xs text-muted-foreground">그룹</span>
        {GROUP_OPTIONS.map((opt) => (
          <Button
            key={opt.value ?? 'none'}
            variant={groupBy === opt.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setGroupBy(opt.value)}
            aria-pressed={groupBy === opt.value}
            data-testid={`group-by-${opt.value ?? 'none'}`}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="뷰 전환">
        <Button
          variant={view === 'list' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setView('list')}
          aria-pressed={view === 'list'}
        >
          리스트
        </Button>
        <Button
          variant={view === 'board' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setView('board')}
          aria-pressed={view === 'board'}
        >
          보드
        </Button>
      </div>

      <Button variant="ghost" size="sm" onClick={reset}>
        초기화
      </Button>
    </div>
  );
}
