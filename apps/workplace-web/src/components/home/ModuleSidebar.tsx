import { Link } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

// 모듈 nav 항목 — 홈은 현재 활성, 이슈는 프로젝트 목록으로 이동.
const MODULES = [
  { key: 'home', label: '홈', active: true },
  { key: 'issues', label: '이슈', to: '/projects' },
];
// 향후 추가될 모듈(아직 비활성) — 시각적으로만 노출.
const SOON = ['Chat', 'Wiki', 'Drive'];

/** 좌측 모듈 사이드바 + 팀 섹션(본인 + AI 동료, 상태 점). 동적 로스터는 7c 범위 외. */
export function ModuleSidebar() {
  const { user } = useAuth();
  return (
    <aside className="flex w-56 flex-col border-r bg-card/40 p-3" data-testid="module-sidebar">
      <nav className="space-y-1">
        {MODULES.map((m) => {
          const className = cn(
            'block rounded px-3 py-2 text-sm',
            m.active ? 'bg-ai-accent-subtle font-medium text-ai-accent' : 'text-foreground',
          );
          // 활성 모듈(홈)은 비링크, 그 외(이슈)는 해당 라우트로 이동.
          return m.to ? (
            <Link key={m.key} to={m.to} className={className}>
              {m.label}
            </Link>
          ) : (
            <div key={m.key} className={className}>
              {m.label}
            </div>
          );
        })}
        {SOON.map((s) => (
          <div key={s} className="px-3 py-2 text-sm text-muted-foreground/50">
            {s} <span className="text-xs">(예정)</span>
          </div>
        ))}
      </nav>
      {/* 팀 섹션(최소) — 본인 + AI 동료만. 동적 전체 사용자 로스터는 엔드포인트 부재로 7c 제외. */}
      <div className="mt-6">
        <div className="px-3 text-xs uppercase text-muted-foreground">팀</div>
        <ul className="mt-2 space-y-1">
          <li className="flex items-center gap-2 px-3 py-1 text-sm">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {user?.name ?? '나'}
          </li>
          <li className="flex items-center gap-2 px-3 py-1 text-sm">
            <span className="h-2 w-2 rounded-full bg-ai-accent" />
            <span className="text-ai-accent">AI 동료</span>
          </li>
        </ul>
      </div>
    </aside>
  );
}
