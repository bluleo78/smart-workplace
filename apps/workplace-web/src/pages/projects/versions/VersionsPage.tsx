// 프로젝트 버전 목록(WP-888) — 「미출시 N · 출시됨 N」 요약, 표(이름·상태·진행·시작일·출시일)와 ⋯ 메뉴, 보관한 버전 접기.
// 만들기·편집·출시·보관·삭제는 프로젝트 OWNER 와 테넌트 ADMIN(canManage) — 그 밖에는 읽기 전용. 모바일은 표 대신 카드 목록.
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';

import { useVersions } from '../../../hooks/queries/useVersions';
import { useCanManageProjectOf } from '../../../hooks/useCanManageProject';
import { EMPTY_GLYPH, kstDateKey } from '../../../lib/formatters';
import { versionDateText, versionDueState } from '../../../lib/versions';
import type { VersionResponse } from '../../../types/version';
import { useProjectTabs } from '../tabs/ProjectTabsContext';
import { TabScreen, TabToolbar } from '../tabs/TabToolbar';
import { useVersionActions } from './useVersionActions';
import { VersionDeleteDialog } from './VersionDeleteDialog';
import { VersionFormDialog } from './VersionFormDialog';
import { VersionProgressBar } from './VersionProgressBar';
import { VersionReleaseDialog } from './VersionReleaseDialog';
import { VersionRowMenu } from './VersionRowMenu';
import { VersionStatusBadge } from './VersionStatusBadge';

const EMPTY_HINT = '출시 단위로 이슈를 모으고 진행을 봐요. 버전을 만들면 이슈에 수정 버전·영향 버전 칸이 생겨요.';

export default function VersionsPage() {
  const { key = '' } = useParams();
  const isMobile = useIsMobile();
  // 프로젝트는 탭 레이아웃이 불러와 넘긴다 — 로딩·접근 불가(403·404) 화면도 레이아웃이 맡는다(WP-1477).
  const { project } = useProjectTabs();
  const canManage = useCanManageProjectOf(key, project);
  const versions = useVersions(key);
  const actions = useVersionActions(key);
  useDocumentTitle(['버전', project.name]);

  // 대화상자 대상 — 만들기('new')·편집은 form, 출시는 release, 삭제는 del.
  const [form, setForm] = useState<VersionResponse | 'new' | null>(null);
  const [release, setRelease] = useState<VersionResponse | null>(null);
  const [del, setDel] = useState<VersionResponse | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const list = versions.data ?? [];
  const active = list.filter((v) => v.status !== 'ARCHIVED');
  const archived = list.filter((v) => v.status === 'ARCHIVED');
  const unreleasedCount = list.filter((v) => v.status === 'UNRELEASED').length;
  const releasedCount = list.filter((v) => v.status === 'RELEASED').length;
  const today = kstDateKey(new Date());
  const handlers = {
    onEdit: (v: VersionResponse) => setForm(v),
    onRelease: (v: VersionResponse) => setRelease(v),
    onUnrelease: actions.cancelRelease,
    onArchive: actions.archive,
    onRestore: actions.restore,
    onDelete: (v: VersionResponse) => setDel(v),
  };
  const rowProps = { projectKey: key, canManage, today, isMobile, handlers };

  // 프로젝트 탭 레이아웃(WP-1477) 안의 버전 탭 — 머리줄은 레이아웃이 그리고, 주 액션(버전 만들기)은 본문 맨 위 도구 줄에 둔다.
  return (
    <TabScreen testId="versions-page">
      <TabToolbar>
        {canManage && (
          <Button onClick={() => setForm('new')} data-testid="version-new">
            <Plus /> 버전 만들기
          </Button>
        )}
      </TabToolbar>
      <Page.Body>
        {versions.isLoading ? (
          <p className="text-muted-foreground">로딩 중…</p>
        ) : list.length === 0 ? (
          <p className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="version-empty">
            {EMPTY_HINT}
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground" data-testid="version-summary">
              미출시 {unreleasedCount} · 출시됨 {releasedCount}
            </p>
            {active.length > 0 && <VersionRows rows={active} {...rowProps} />}
            {archived.length > 0 && (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2 text-muted-foreground"
                  aria-expanded={showArchived}
                  onClick={() => setShowArchived((s) => !s)}
                  data-testid="version-archived-toggle"
                >
                  {showArchived ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                  보관한 버전 {archived.length}개 보기
                </Button>
                {showArchived && <VersionRows rows={archived} {...rowProps} />}
              </div>
            )}
          </div>
        )}
      </Page.Body>

      <VersionFormDialog
        projectKey={key}
        open={form != null}
        target={form === 'new' ? null : form}
        onClose={() => setForm(null)}
      />
      <VersionReleaseDialog projectKey={key} version={release} onClose={() => setRelease(null)} />
      <VersionDeleteDialog projectKey={key} version={del} onClose={() => setDel(null)} />
    </TabScreen>
  );
}

interface RowsProps {
  rows: VersionResponse[];
  projectKey: string;
  canManage: boolean;
  today: string;
  isMobile: boolean;
  handlers: Parameters<typeof VersionRowMenu>[0]['handlers'];
}

/** 버전 행 묶음 — 데스크톱은 표, 모바일은 카드. */
function VersionRows({ rows, projectKey, canManage, today, isMobile, handlers }: RowsProps) {
  if (isMobile) {
    return (
      <ul className="space-y-3">
        {rows.map((v) => (
          <li key={v.id} className="flex items-start rounded border" data-testid={`version-row-${v.id}`}>
            <Link to={`/projects/${projectKey}/versions/${v.id}`} className="min-w-0 flex-1 space-y-1.5 py-3 pl-4">
              <span className="flex items-center gap-2">
                <span className="min-w-0 truncate font-medium">{v.name}</span>
                <VersionStatusBadge status={v.status} />
              </span>
              <VersionProgressBar progress={v.progress} compact />
              <span className="block text-xs text-muted-foreground">
                <DateRange v={v} today={today} />
              </span>
            </Link>
            <VersionRowMenu version={v} canManage={canManage} handlers={handlers} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-2 pr-4 font-medium">이름</th>
          <th className="py-2 pr-4 font-medium">상태</th>
          <th className="py-2 pr-4 font-medium">진행</th>
          <th className="py-2 pr-4 font-medium">시작일</th>
          <th className="py-2 pr-4 font-medium">출시일</th>
          <th className="w-11" />
        </tr>
      </thead>
      <tbody>
        {rows.map((v) => {
          const overdue = versionDueState(v, today) === 'overdue';
          return (
            <tr key={v.id} className="border-b" data-testid={`version-row-${v.id}`}>
              <td className="py-2 pr-4">
                <Link to={`/projects/${projectKey}/versions/${v.id}`} className="font-medium hover:underline">
                  {v.name}
                </Link>
              </td>
              <td className="py-2 pr-4">
                <VersionStatusBadge status={v.status} />
              </td>
              <td className="py-2 pr-4">
                <VersionProgressBar progress={v.progress} compact />
              </td>
              <td className="py-2 pr-4 tabular-nums text-muted-foreground">{versionDateText(v.startDate) ?? EMPTY_GLYPH}</td>
              <td className="py-2 pr-4 tabular-nums">
                <span className={cn(!overdue && 'text-muted-foreground')}>{versionDateText(v.releaseDate) ?? EMPTY_GLYPH}</span>
                {overdue && <span className="ml-1.5 text-xs font-medium text-destructive">지남</span>}
              </td>
              <td className="py-1 text-right">
                <VersionRowMenu version={v} canManage={canManage} handlers={handlers} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 모바일 카드의 「시작일 ~ 출시일」 한 줄 — 출시일이 지났으면 붉은 「지남」. */
function DateRange({ v, today }: { v: VersionResponse; today: string }) {
  const start = versionDateText(v.startDate);
  const rel = versionDateText(v.releaseDate);
  const overdue = versionDueState(v, today) === 'overdue';
  if (!start && !rel) return <>{EMPTY_GLYPH}</>;
  return (
    <>
      {start ?? EMPTY_GLYPH} ~ {rel ?? EMPTY_GLYPH}
      {overdue && <span className="ml-1.5 font-medium text-destructive">지남</span>}
    </>
  );
}
