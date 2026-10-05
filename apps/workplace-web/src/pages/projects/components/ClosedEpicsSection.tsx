// 에픽 패널 맨 아래 「종료된 에픽 N」 구역(WP-245) — 완료·취소 에픽을 기본 접힘으로 두고, 펼치면 흐리게 보여 필터·상세 열기로 쓴다.
// Linear 의 닫힌 그룹 패턴. 종료 에픽은 드롭 대상이 아니라 드래그 중에는 패널이 이 구역을 아예 그리지 않는다(EpicSidePanel).
// 펼침: 사용자가 누른 값이 없으면 「선택된 에픽이 종료 목록에 있음」으로 정한다 — URL 로 종료 에픽에 들어와도 선택이 보이고, 누르면 접힌다.
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/utils';

import { ClosedStatusBadge } from '../../../components/issues/ClosedStatusBadge';
import { useClosedEpics } from '../../../hooks/queries/useProjectEpics';
import { avatarColorClass } from '../../../lib/avatarColor';

export function ClosedEpicsSection({
  projectKey, selectedEpic, onSelect,
}: { projectKey: string; selectedEpic: number | null; onSelect: (epicNumber: number) => void }) {
  const { epics } = useClosedEpics(projectKey);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const autoOpen = selectedEpic != null && epics.some((e) => e.number === selectedEpic);
  const open = toggled ?? autoOpen;
  if (epics.length === 0) return null;

  return (
    <div data-testid="epic-closed-section" className="mt-2 border-t pt-2">
      <button
        type="button"
        aria-expanded={open}
        data-testid="epic-closed-toggle"
        onClick={() => setToggled(!open)}
        className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden="true" />
        <span className="flex-1 text-left">종료된 에픽</span>
        <span>{epics.length}</span>
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {epics.map((ep) => {
            const selected = selectedEpic === ep.number;
            return (
              <div key={ep.number} className="group relative">
                <button
                  type="button"
                  aria-pressed={selected}
                  data-testid={`epic-closed-filter-${ep.number}`}
                  onClick={() => onSelect(ep.number)}
                  className={cn(
                    'w-full rounded px-2 py-1.5 text-left text-sm transition-colors pointer-coarse:pr-8',
                    selected ? 'bg-accent font-medium' : 'hover:bg-muted/50 group-hover:bg-muted/50',
                  )}
                >
                  {/* 흐림은 제목·색점에만 — 배지는 또렷하게 둬 상태를 읽을 수 있게 한다. */}
                  <span className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full opacity-50', avatarColorClass(ep.number).split(' ')[0])} aria-hidden="true" />
                    <span
                      className={cn('min-w-0 flex-1 truncate text-muted-foreground', ep.status === 'CANCELED' && 'line-through')}
                      title={ep.title}
                    >
                      {ep.title}
                    </span>
                    <ClosedStatusBadge status={ep.status} className="group-hover:invisible group-kbd:invisible" />
                  </span>
                </button>
                {/* ↗ 상세 — 진행 중 에픽 항목(EpicItemButton)과 같은 겹침 링크 패턴(hover·키보드 포커스·터치 상시). */}
                <Link
                  to={`/projects/${projectKey}/issues/${ep.number}`}
                  aria-label={`${ep.title} 상세 열기`}
                  title="에픽 상세 열기"
                  data-testid={`epic-closed-open-${ep.number}`}
                  className="pointer-events-none absolute right-1 top-1 flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:pointer-events-auto group-hover:opacity-100 group-kbd:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-['']"
                >
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
