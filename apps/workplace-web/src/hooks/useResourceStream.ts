// resource.changed SSE 핸들러 (WP-59) — 통합 스트림 라우터(useEventStream)가 호출.
// 서버의 범용 변경 이벤트를 리소스별 무효화 규칙(lib/resourceInvalidation)으로 풀어 배처에 넣는다.

import type { QueryClient } from '@tanstack/react-query';

import {
  createInvalidationBatcher,
  invalidationTargets,
  type ResourceChangedPayload,
} from '../lib/resourceInvalidation';

// QueryClient 는 앱에 하나 — 배처도 qc 당 하나를 재사용해 이벤트 간 중복을 합친다.
const batchers = new WeakMap<QueryClient, ReturnType<typeof createInvalidationBatcher>>();

export function handleResourceEvent(qc: QueryClient, data: unknown) {
  const p = data as ResourceChangedPayload | undefined;
  if (!p?.resource) return;
  let b = batchers.get(qc);
  if (!b) {
    b = createInvalidationBatcher(qc);
    batchers.set(qc, b);
  }
  b.enqueue(invalidationTargets(p));
}
