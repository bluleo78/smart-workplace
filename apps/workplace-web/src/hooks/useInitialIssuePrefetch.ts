// 인증 뒤 첫 주소가 이슈 상세면 상세 데이터를 미리 요청한다(WP-2074).
// 상세 페이지 청크를 받은 뒤에야 useIssue 가 요청을 내던 직렬 구간을, 청크 받기와 나란히 돌려 첫 화면을 앞당긴다.
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { matchIssueDetailPath } from '@/lib/issueDetailPath';
import { navigatesInPlace, peekPendingPushTarget } from '@/lib/push/openTarget';

import { issueDetailQuery } from './queries/useIssue';

// 문서당 한 번만 — 이슈 상세 주소에서 요청을 보냈거나, 앱 셸(AppLayout)이 첫 커밋 뒤에 한 번 불렀으면 true 다.
// 토큰 직후 경로(AuthContext)가 상세가 아닌 주소(예: /login)에서 불린 것은 소비하지 않아, 로그인 뒤 셸의 첫 호출이 상세 주소면 요청할 수 있다.
// 그러나 셸의 첫 호출은 주소와 무관하게 소비한다 — 「첫 진입」 한정이라 처음 다른 화면에서 열린 뒤 나중에 상세로 옮겨 가면 요청하지 않는다.
let done = false;

/** 테스트 전용 — 문서당 한 번 플래그를 되돌린다. */
export function resetInitialIssuePrefetchForTest(): void {
  done = false;
}

/**
 * 첫 주소가 이슈 상세면 상세 데이터를 미리 요청한다 — 문서당 한 번(WP-2087).
 * AuthContext 가 토큰을 받은 직후(users/me 와 병렬)에 먼저 부르고, 그때 못 불린 경로는 AppLayout 훅이 첫 커밋 뒤에 부른다.
 * 어느 쪽이 먼저든 `done` 을 공유해 한 번만 나간다.
 */
export function startInitialIssuePrefetch(queryClient: QueryClient, pathname: string = window.location.pathname): void {
  if (done) return;
  const target = matchIssueDetailPath(pathname);
  // 상세 주소가 아니면 done 을 세우지 않는다 — /login 에서 시작해 상세로 이동하는 경우처럼 나중 호출(셸 훅)이 요청할 수 있어야 한다.
  if (!target) return;
  done = true;
  const query = issueDetailQuery(target.projectKey, target.number);
  // 재시도는 앱 전역 정책(shouldRetryQuery — 5xx·네트워크 1회) 그대로 둔다 — 청크가 먼저 와 페이지의 useIssue 가 이 진행 중 요청에 붙으면
  // 이 요청의 재시도 설정을 따르므로, 여기서 재시도를 끄면 일시 5xx 에 페이지가 재시도 없이 오류 화면을 낸다.
  void queryClient.prefetchQuery(query).then(() => {
    // 아무도 보기 전에 실패로 끝났으면 실패 캐시를 지운다 — 남겨 두면 나중에 마운트한 페이지가 오류 상태로 시작해
    // 오류 화면을 먼저 비춘 뒤 다시 요청한다. 지우면 페이지가 로딩부터 새로 요청하고 오류 처리는 페이지 한 곳에 남는다.
    // 그래서 없는·권한 없는 이슈(404·403)는 상세 요청이 두 번 나간다 — 오류 처리를 페이지 한 곳에 두려고 감수한다.
    const cached = queryClient.getQueryCache().find({ queryKey: query.queryKey, exact: true });
    if (cached?.state.status === 'error' && cached.getObserversCount() === 0) {
      queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  });
}

/** AppLayout 첫 커밋 뒤 미리 요청 — 토큰 직후 경로가 이미 돌았으면 아무것도 하지 않는다. */
export function useInitialIssuePrefetch(): void {
  const queryClient = useQueryClient();
  const { activeTenant } = useAuth();
  const activeTenantId = activeTenant?.tenantId ?? null;
  useEffect(() => {
    // WP-2116: 알림을 탭해 로그인한 경우 로그인 뒤 셸이 `/` 에서 먼저 떠 「첫 기회」를 소비해 버린다 — 상세는 이 직후 대기 목적지로 이동한다.
    // 그래서 대기 목적지를 엿보아(지우지 않는다 — 이동은 AppLayout 이 한다) 같은 테넌트의 상세면 그 주소로 미리 요청한다.
    // 다른 테넌트면 전환·리로드가 일어나므로 요청하지 않는다.
    // 이미 돌았으면(토큰 직후 경로·앞선 셸 마운트) 대기 목적지도 읽지 않는다.
    if (done) return;
    const pending = peekPendingPushTarget();
    if (!pending) startInitialIssuePrefetch(queryClient);
    else if (navigatesInPlace(pending, activeTenantId)) {
      // safeTarget 을 거친 같은 origin 상대 경로라 new URL 이 던지지 않는다 — 쿼리·해시를 떼고 경로만 본다.
      startInitialIssuePrefetch(queryClient, new URL(pending.url, window.location.origin).pathname);
    }
    // 셸의 첫 호출은 상세 주소였든 아니든 소비한다 — 이후 앱 안 이동·셸 재마운트에서 「첫 진입 미리 요청」이 다시 돌지 않게 한다.
    done = true;
    // 첫 커밋 뒤 한 번만 — 테넌트 변경으로 다시 돌지 않게 activeTenantId 는 의존성에서 뺀다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);
}
