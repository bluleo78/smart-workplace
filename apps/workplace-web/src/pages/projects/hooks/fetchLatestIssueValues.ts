// 409 뒤 최신 이슈 상세를 받아 제목·본문 값과 version 으로 돌려준다(WP-2095) — 팀 이슈 상세·개인 작업 패널이 useVersionedPatch 의 fetchLatest 로 함께 쓴다.
// 왜: 두 화면이 같은 조회·변환을 따로 들고 있으면 한쪽만 고쳐 판정 재료가 어긋난다. 훅이 다루는 필드(title/body)는 호출부가 타입으로 좁힌다.
import type { QueryClient } from '@tanstack/react-query';

import { issueDetailQuery } from '@/hooks/queries/useIssue';

/** 캐시 신선도(staleTime)와 무관하게 실제로 다시 받아(staleTime 0) 필드별 충돌 판정 재료를 만든다. */
export async function fetchLatestIssueValues(queryClient: QueryClient, projectKey: string, number: number) {
  const latest = await queryClient.fetchQuery({ ...issueDetailQuery(projectKey, number), staleTime: 0 });
  // version 이 없으면 판정 기준을 만들 수 없다 — 0 으로 메우면 충돌 기준·덮어쓰기 저장이 version 0 으로 나가 또 409 가 되풀이되므로 던진다(훅은 최신을 못 받은 실패로 다룬다).
  const version = latest.summary.version;
  if (version === undefined) throw new Error('최신 이슈 상세에 version 이 없습니다');
  return { version, values: { title: latest.summary.title, body: latest.body ?? '' } };
}
