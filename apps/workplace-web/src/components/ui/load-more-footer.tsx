// 무한 스크롤 목록 끝 공용 푸터 — sentinel + 로딩 표시 + 다음 페이지 실패 시 "다시 시도" (WP-182).
// 평소엔 끝에 닿으면 자동 로드, 실패하면 자동 로드를 멈추고(공용 훅이 실패 요청 무한 반복을 막는다)
// 사용자가 직접 다시 시도할 수 있게 버튼을 보인다. 이슈 보드 컬럼·설정 목록·연락처 등이 함께 쓴다.
// manualLabel 을 주면 자동 로드 대신 그 문구의 버튼을 눌러야 다음 묶음을 불러온다 — 구간을 여러 개 쌓은 목록에서
// 마지막이 아닌 구간이 스크롤로 자라 아래 구간 사이에 행이 끼어드는 것을 막는 예외(디자인 시스템 05 §A-3, WP-876).
// WP-1862: 실패 안내는 sr-only status 영역으로 알리고, 다시 시도 중에도 같은 버튼을 남겨 포커스를 지킨다.
// 사용처는 첫 페이지 실패 화면을 failedWithoutData(lib/queryFailure)로 그려야 한다 — isError 는 다음 페이지 실패에도
// true 라서, 그걸로 분기하면 이미 받은 목록이 오류 화면으로 덮이고 이 푸터의 다시 시도도 사라진다.
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { type ReactNode, useId } from 'react';

import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { type LoadMoreQuery, useLoadMoreSentinel } from '@/hooks/useLoadMoreSentinel';
import { cn } from '@/lib/utils';

// 다음 묶음을 불러오는 동안의 문구 — 자동 로드·수동 버튼·다시 시도 버튼이 같은 문구를 쓴다.
const LOADING_LABEL = '불러오는 중…';

// 직접 만든 어댑터(메일 이전 메일·캘린더 일정 등)는 다시 시도 요청이 도는 동안 isFetchingNextPage 를 true 로,
// 끝날 때까지 isFetchNextPageError 를 유지해야 한다 — 푸터는 그 값으로 같은 버튼을 남기고 겹친 요청을 막는다(WP-1862).
type LoadMoreFooterQuery = LoadMoreQuery &
  Pick<UseInfiniteQueryResult<InfiniteData<unknown>, Error>, 'isFetchingNextPage'>;

export function LoadMoreFooter({
  query,
  root = null,
  enabled = true,
  errorLabel = '불러오지 못했습니다 — 다시 시도',
  manualLabel,
  manualHint,
  className,
  'data-testid': testId,
}: {
  query: LoadMoreFooterQuery;
  // sentinel 을 감싼 스크롤 컨테이너 — 목록이 자체 스크롤하면 반드시 넘긴다(useLoadMoreSentinel 참조).
  root?: Element | null;
  // false 면 자동 로드 observer 를 끈다(useLoadMoreSentinel enabled 참조).
  enabled?: boolean;
  // 다음 페이지 실패 시 다시 시도 버튼 문구 — 일부만 실패해 받은 목록은 남는 경우(캘린더 일정 목록, WP-136) 사실에 맞게 바꾼다.
  errorLabel?: string;
  // 주면 수동 모드 — sentinel 을 끄고 대기 중엔 이 문구의 버튼을 보인다.
  manualLabel?: string;
  // 수동 버튼 문구 뒤에 흐리게 붙는 보조 정보(예: 「전체 120건 중 50건 표시」, WP-1231).
  manualHint?: string;
  className?: string;
  'data-testid'?: string;
}) {
  const manual = manualLabel != null;
  const hintId = useId();
  const ref = useLoadMoreSentinel(query, root, enabled && !manual);
  const retrying = query.isFetchingNextPage;

  // 다음 페이지 실패 → 다시 시도. 오류를 먼저 본다 — 수동 모드도 실패하면 같은 다시 시도로 바뀐다.
  // WP-1862: 다시 시도 중에도 같은 버튼을 남겨(TanStack v5 는 재시도 중에도 isError 가 유지돼 두 플래그가 함께 true)
  // 눌렀던 키보드 포커스가 body 로 떨어지지 않게 하고, 그동안은 aria-disabled + 문구만 바꿔 요청이 겹치지 않게 한다.
  // 목록 전체 백그라운드 재조회 중에는 두 플래그가 모두 false 라 실패 줄이 잠깐 사라진다(v5 의미, 기존 동작).
  let body: ReactNode = null;
  if (query.isFetchNextPageError) {
    body = (
      <button
        type="button"
        // 다시 시도 중에는 오류처럼 보이지 않게 일반 로딩 문구 색으로 바꾼다(빨강·밑줄은 실패 상태에서만).
        className={retrying ? 'text-muted-foreground' : 'text-destructive underline'}
        aria-disabled={retrying}
        onClick={() => {
          if (!retrying) void query.fetchNextPage();
        }}
      >
        {retrying ? LOADING_LABEL : errorLabel}
      </button>
    );
  } else if (manual) {
    // 수동 모드 — 불러오는 동안에도 같은 버튼을 남겨(문구만 바꿈) 눌렀던 키보드 초점이 body 로 떨어지지 않게 한다.
    // 백그라운드 재조회(무효화) 중에 눌러도 그 재조회를 취소하지 않는다(sentinel 과 같은 cancelRefetch: false).
    body = (
      // 행 폭 테두리 버튼 + 아이콘 + 표시 중인 수(WP-1231) — 흐린 작은 글자만으로는 구간에 이슈가 더 있다는 것을 놓치기 쉬웠다.
      <Button
        variant="outline"
        size="sm"
        className="w-full gap-1.5 text-xs font-medium text-foreground/80"
        aria-disabled={query.isFetchingNextPage}
        // 접근 이름은 문구만 — 바뀌는 수(보조 정보)는 설명으로 읽혀 이름이 페이지마다 바뀌지 않게 한다.
        aria-label={query.isFetchingNextPage ? undefined : manualLabel}
        aria-describedby={!query.isFetchingNextPage && manualHint ? hintId : undefined}
        onClick={() => {
          if (!query.isFetchingNextPage) void query.fetchNextPage({ cancelRefetch: false });
        }}
      >
        {query.isFetchingNextPage ? (
          LOADING_LABEL
        ) : (
          <>
            <ChevronDown aria-hidden="true" className="size-3.5" />
            {manualLabel}
            {manualHint && <span id={hintId} className="font-normal text-muted-foreground">· {manualHint}</span>}
          </>
        )}
      </Button>
    );
  } else if (query.isFetchingNextPage) {
    body = LOADING_LABEL;
  }

  return (
    <>
      {/* WP-1862: 실패 안내를 알리는 polite live region — 처음부터 붙어 있어야 내용 변화가 읽히므로 다음 페이지가 없을 때도
          빈 채로 둔다(실패와 함께 hasNextPage 가 켜지는 어댑터 — 캘린더 일정 목록). 재시도 중엔 비워 다시 실패하면 다시 읽힌다. */}
      <span role="status" className="sr-only">
        {query.isFetchNextPageError && !retrying ? errorLabel : ''}
      </span>
      {query.hasNextPage && (
        <div ref={ref} data-testid={testId} className={cn('py-3 text-center text-xs text-muted-foreground', className)}>
          {body}
        </div>
      )}
    </>
  );
}
