// 프로젝트 상태 목록 관문(WP-870) — 목록·보드는 상태 목록을 받은 뒤에만 그린다.
// 받기 전에 그리면 목록은 범주 버킷으로, 보드는 빈 보드로 먼저 그렸다가 상태별로 바뀌며 튄다. 그래서 받기 전엔 로딩,
// 실패면 다시 시도를 보이고, 자식(목록·보드)은 늘 비어 있지 않은 상태 목록을 전제한다(프로젝트는 늘 기본 4상태를 가진다).
// 실패 화면은 IssueLoadErrorState 를 쓰지 않는다 — 그쪽은 「이슈를」 못 불러왔다고 말하고 4xx 에 「필터 초기화」를 내미는데,
// 상태 목록 실패는 필터와 무관하다. 설정 「상태」 섹션도 같은 관문을 쓴다(설명 문구·testid·로딩 여백이 다르고,
// 실패 화면은 compact — 페이지급 빈 상태(큰 아이콘·60vh)가 섹션 높이를 키워 #statuses 진입 첫 화면을 넘지 않게 섹션 안 한 덩어리로, WP-809).

import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { ResourceErrorState } from '@/components/layout/ResourceErrorState';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { useProjectStatuses } from '../../../hooks/queries/useProjectStatuses';

export function ProjectStatusesGate({
  projectKey,
  children,
  description = '이슈 목록과 보드를 그릴 수 없습니다. 잠시 후 다시 시도해 주세요.',
  testId = 'project-statuses-error',
  loadingClassName = 'w-full p-6',
  compact = false,
}: {
  projectKey: string;
  children: ReactNode;
  // 실패 화면 설명 — 기본은 목록·보드용 문구.
  description?: string;
  // 실패 화면 testid.
  testId?: string;
  // 로딩 문구 여백 — 설정 섹션은 섹션 여백이 이미 있어 비운다.
  loadingClassName?: string;
  // 섹션 안 인라인 오류(작은 아이콘 + 제목·설명 + 「다시 시도」) — 설정 섹션용. 기본은 목록·보드 자리를 채우는 큰 빈 상태.
  compact?: boolean;
}) {
  const query = useProjectStatuses(projectKey);
  if (query.data) return children;
  // 다시 시도로 다시 부르는 동안엔 오류 대신 로딩 — 연타가 진행 중 요청을 겹쳐 보내지 않게.
  if (query.isError && !query.isFetching) {
    if (compact) {
      return (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border px-3 py-2.5"
          data-testid={testId}
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">상태 목록을 불러오지 못했습니다</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            다시 시도
          </Button>
        </div>
      );
    }
    // 감싸는 div 도 flex 로 늘린다 — ResourceErrorState 의 flex-1 이 flex 부모(타임라인 본문)에서 로딩 문구와 같은 높이를 채워
    // 실패 화면이 로딩 자리보다 위로 튀지 않게(WP-938). 목록·보드는 부모가 블록이라 영향이 없다.
    return (
      <div data-testid={testId} className="flex flex-1 flex-col">
        <ResourceErrorState
          icon={TriangleAlert}
          title="상태 목록을 불러오지 못했습니다"
          description={description}
          actionLabel="다시 시도"
          onAction={() => void query.refetch()}
        />
      </div>
    );
  }
  return <p className={cn(loadingClassName, 'text-muted-foreground')}>로딩 중…</p>;
}
