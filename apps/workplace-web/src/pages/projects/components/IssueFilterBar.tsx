// 태스크 필터/검색 + 뷰(list/board) 토글 바.
// URL 의 SearchParams 가 단일 source of truth — 내부 state 는 q 입력 debounce 버퍼뿐.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { filtersToParams, parseFilters, parseView } from '../../../lib/issueFilters';
import type { IssueFilters, IssueView } from '../../../types/issue';

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

export function IssueFilterBar() {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const view = parseView(params);
  const [qDraft, setQDraft] = useState(filters.q);

  // URL 의 q 가 외부 변경(예: 초기화 버튼)으로 바뀌면 입력값을 동기화한다.
  useEffect(() => {
    setQDraft(filters.q);
  }, [filters.q]);

  // 검색어는 300ms debounce 후 URL 에 반영 — 매 키 입력마다 네트워크 호출을 막는다.
  useEffect(() => {
    if (qDraft === filters.q) return;
    const t = setTimeout(() => {
      writeFilters({ ...filters, q: qDraft }, view);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft]);

  function writeFilters(next: IssueFilters, nextView: IssueView) {
    setParams(filtersToParams(next, nextView), { replace: true });
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
    );
  }

  function setView(v: IssueView) {
    writeFilters(filters, v);
  }

  // 초기화는 view 만 유지하고 나머지 모두 비운다.
  function reset() {
    setParams(new URLSearchParams(view === 'board' ? 'view=board' : ''), {
      replace: true,
    });
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

      <div className="flex items-center gap-1 ml-auto" role="group" aria-label="뷰 전환">
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
