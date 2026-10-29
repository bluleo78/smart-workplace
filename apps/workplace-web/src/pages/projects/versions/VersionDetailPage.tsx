// 버전 상세(WP-888) — 머리(이름·상태·기간·설명·편집·출시), 진행 막대, 「영향 버전으로 붙은 결함 N건」, 두 탭
// (이 버전에 나가는 것 = 수정 버전 / 이 버전에서 난 결함 = 영향 버전). 각 탭은 이슈를 유형별로 묶어(프로젝트 유형 순서) 보인다.
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useRegisterAiScreenContext } from '@/components/ai/screen-context/useAiScreenContext';
import { IssueStatusIcon } from '@/components/issues/IssueStatusIcon';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useIsMobile } from '@/hooks/useIsMobile';

import { IssueTypeBadge } from '../../../components/issueTypes/IssueTypeBadge';
import { useIssueTypes } from '../../../hooks/queries/useIssueTypes';
import { useVersionIssues, useVersions, type VersionIssueKind } from '../../../hooks/queries/useVersions';
import { useCanManageProject } from '../../../hooks/useCanManageProject';
import { buildVersionDetailContext } from '../../../lib/aiScreenContext/builders/version';
import { kstDateKey } from '../../../lib/formatters';
import { peopleSummary } from '../../../lib/userStatus';
import {
  alsoInOtherVersions,
  daysLeftLabel,
  groupIssuesByType,
  versionDateText,
  versionDueState,
  versionIssuesUrl,
} from '../../../lib/versions';
import type { IssueResponse } from '../../../types/issue';
import { IssueStatusBadge } from '../components/IssueStatusBadge';
import { ProjectUnavailableState } from '../components/ProjectUnavailableState';
import { useVersionActions } from './useVersionActions';
import { VersionFormDialog } from './VersionFormDialog';
import { VersionProgressBar } from './VersionProgressBar';
import { VersionReleaseDialog } from './VersionReleaseDialog';
import { VersionStatusBadge } from './VersionStatusBadge';

export default function VersionDetailPage() {
  const { key = '', versionId = '' } = useParams();
  const id = Number(versionId);
  const navigate = useNavigate();
  const { project, canManage } = useCanManageProject(key);
  const versions = useVersions(key);
  const types = useIssueTypes(key);
  const fixIssues = useVersionIssues(key, 'fixVersion', id);
  const affectsIssues = useVersionIssues(key, 'affectsVersion', id);
  const actions = useVersionActions(key);
  // 모바일 헤더는 meta(상태 배지)를 그리지 않는다 — 모바일에선 같은 배지를 본문 기간 줄 위에 보인다(WP-1089).
  // 헤더가 모바일 모양으로 바뀌는 판정(useIsMobile)과 같은 훅을 써야 두 곳에 함께 보이거나 둘 다 빠지는 폭이 없다.
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<VersionIssueKind>('fixVersion');
  const [editing, setEditing] = useState(false);
  const [releasing, setReleasing] = useState(false);

  const version = (versions.data ?? []).find((v) => v.id === id) ?? null;
  const today = kstDateKey(new Date());
  useDocumentTitle([version?.name ?? '버전', project.data?.name]);
  // AI 화면 컨텍스트 — 조기 반환 앞에서 한 번만 등록한다(버전을 못 찾으면 null).
  useRegisterAiScreenContext(version ? buildVersionDetailContext({ projectKey: key, version, today }) : null);

  if (project.error) return <ProjectUnavailableState />;

  const back = () => navigate(`/projects/${key}/versions`);
  const dueLabel = version ? daysLeftLabel(version, today) : null;
  const overdue = version ? versionDueState(version, today) === 'overdue' : false;
  const start = versionDateText(version?.startDate);
  const rel = versionDateText(version?.releaseDate);
  const statusBadge = version ? <VersionStatusBadge status={version.status} /> : undefined;

  return (
    <Page width="reading" data-testid="version-detail-page">
      <Page.Header
        icon={
          <Button variant="ghost" size="icon" aria-label="버전 목록으로 돌아가기" onClick={back}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        }
        title={version?.name ?? '버전'}
        meta={statusBadge}
        actions={
          version &&
          canManage && (
            <>
              <Button variant="outline" onClick={() => setEditing(true)} data-testid="version-edit">
                편집
              </Button>
              {version.status === 'UNRELEASED' && (
                <Button onClick={() => setReleasing(true)} data-testid="version-release">
                  출시
                </Button>
              )}
              {version.status === 'RELEASED' && (
                <Button variant="outline" onClick={() => actions.cancelRelease(version)} data-testid="version-unrelease">
                  출시 취소
                </Button>
              )}
              {version.status === 'ARCHIVED' && (
                <Button variant="outline" onClick={() => actions.restore(version)} data-testid="version-restore">
                  복원
                </Button>
              )}
            </>
          )
        }
      />
      <Page.Body>
        {versions.isLoading ? (
          <p className="text-muted-foreground">로딩 중…</p>
        ) : !version ? (
          <div className="space-y-3" data-testid="version-not-found">
            <p className="text-sm text-muted-foreground">버전을 찾을 수 없어요. 지워졌거나 다른 프로젝트의 버전일 수 있어요.</p>
            <Button variant="outline" onClick={back}>
              버전 목록으로
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-2">
              {isMobile && (
                <div data-testid="version-status-mobile">{statusBadge}</div>
              )}
              <p className="text-sm text-muted-foreground" data-testid="version-period">
                {start ?? '시작일 없음'} ~ {rel ?? '출시일 없음'}
                {dueLabel && (
                  <span className={overdue ? 'ml-2 font-medium text-destructive' : 'ml-2'}>{dueLabel}</span>
                )}
              </p>
              {version.description && <p className="whitespace-pre-wrap text-sm">{version.description}</p>}
            </section>
            {/* 이슈도 영향 결함도 없으면 칸을 비워 두지 않는다 — 빈 칸도 위아래 간격을 한 번 더 차지한다(WP-1136). */}
            {(version.progress.done + version.progress.inProgress + version.progress.todo > 0 || version.affectsCount > 0) && (
              <section className="space-y-2">
                <VersionProgressBar progress={version.progress} testId="version-progress" />
                {version.affectsCount > 0 && (
                  <p className="text-sm text-muted-foreground" data-testid="version-affects-note">
                    영향 버전으로 붙은 결함 {version.affectsCount}건
                  </p>
                )}
              </section>
            )}

            <Tabs value={tab} onValueChange={(t) => setTab(t as VersionIssueKind)}>
              <TabsList>
                <TabsTrigger value="fixVersion" data-testid="version-tab-fix">
                  이 버전에 나가는 것 {fixIssues.data?.length ?? 0}
                </TabsTrigger>
                <TabsTrigger value="affectsVersion" data-testid="version-tab-affects">
                  이 버전에서 난 결함 {affectsIssues.data?.length ?? 0}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <IssueGroups
              projectKey={key}
              versionId={id}
              kind={tab}
              query={tab === 'fixVersion' ? fixIssues : affectsIssues}
              types={types.data ?? []}
            />
          </div>
        )}
      </Page.Body>

      <VersionFormDialog projectKey={key} open={editing} target={version} onClose={() => setEditing(false)} />
      <VersionReleaseDialog projectKey={key} version={releasing ? version : null} onClose={() => setReleasing(false)} />
    </Page>
  );
}

/** 한 탭의 이슈 — 유형별 묶음 + 「이슈 목록에서 열기」. */
function IssueGroups({
  projectKey,
  versionId,
  kind,
  query,
  types,
}: {
  projectKey: string;
  versionId: number;
  kind: VersionIssueKind;
  query: { isLoading: boolean; isError: boolean; data: IssueResponse[] | undefined };
  types: Parameters<typeof groupIssuesByType>[1];
}) {
  const issues = query.data ?? [];
  // 묶음은 이슈·유형 목록이 바뀔 때만 다시 만든다(탭 전환·대화상자 열기 같은 다른 렌더에선 그대로).
  const groups = useMemo(() => groupIssuesByType(query.data ?? [], types), [query.data, types]);
  return (
    <div className="space-y-4" data-testid={`version-issues-${kind}`}>
      {query.isLoading ? (
        <p className="text-muted-foreground">로딩 중…</p>
      ) : query.isError ? (
        <p className="text-sm text-destructive">이슈를 불러오지 못했어요.</p>
      ) : issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {kind === 'fixVersion' ? '이 버전에 나가는 이슈가 아직 없어요.' : '이 버전에서 난 결함이 아직 없어요.'}
        </p>
      ) : (
        <>
          <Link
            to={versionIssuesUrl(projectKey, kind, versionId)}
            className="inline-block text-sm text-primary hover:underline"
            data-testid="version-open-list"
          >
            이슈 목록에서 열기
          </Link>
          {groups.map((g) => (
            <section key={g.type?.id ?? 'none'} className="space-y-1" data-testid={`version-group-${g.type?.id ?? 'none'}`}>
              <h3 className="flex items-center gap-2 text-sm font-medium">
                {g.type ? <IssueTypeBadge type={g.type} /> : <span>유형 없음</span>}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">{g.issues.length}</span>
              </h3>
              <ul className="divide-y border-y">
                {g.issues.map((it) => (
                  <IssueRow key={it.number} issue={it} projectKey={projectKey} versionId={versionId} showAlso={kind === 'fixVersion'} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

/** 이슈 한 줄 — 상태 아이콘·키·제목·(다른 버전에도 포함)·상태·담당자. */
function IssueRow({
  issue: it,
  projectKey,
  versionId,
  showAlso,
}: {
  issue: IssueResponse;
  projectKey: string;
  versionId: number;
  showAlso: boolean;
}) {
  const also = showAlso ? alsoInOtherVersions(it, versionId) : [];
  // 정지된 첫 담당자는 「(비활성)」 꼬리(WP-1080 — 작업 목록·담당자 칸과 같은 표기), 「외 N」에 묶인 정지된 사람은 「(비활성 n)」(WP-1100)
  const { first, others, othersInactive } = peopleSummary(it.assignees);
  const assignee =
    first === null ? null : others === 0 ? first : [`${first} 외 ${others}`, othersInactive].filter(Boolean).join(' ');
  return (
    <li>
      <Link
        to={`/projects/${projectKey}/issues/${it.number}`}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 hover:bg-accent"
        data-testid={`version-issue-${it.number}`}
      >
        <IssueStatusIcon status={it.status} name={it.statusName} color={it.statusColor} />
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {projectKey}-{it.number}
        </span>
        <span className="min-w-0 flex-1 basis-48 truncate text-sm">{it.title}</span>
        {also.length > 0 && (
          <span className="text-xs text-muted-foreground" data-testid={`version-issue-${it.number}-also`}>
            {also.map((n) => `${n} 에도 포함`).join(' · ')}
          </span>
        )}
        <IssueStatusBadge status={it.status} name={it.statusName} className="max-w-32" />
        {/* 좁은 칸이라 「(비활성 n)」 꼬리가 잘릴 수 있어 전체 글을 title 로도 보인다(WP-1100). */}
        {assignee && (
          <span className="max-w-28 truncate text-xs text-muted-foreground" title={assignee}>
            {assignee}
          </span>
        )}
      </Link>
    </li>
  );
}
