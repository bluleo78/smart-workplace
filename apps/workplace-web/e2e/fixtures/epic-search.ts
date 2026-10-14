// 에픽 검색 서버 규칙 목(WP-389) — status(CSV)와 hideInactiveClosed(#876)를 서버처럼 적용한다.
// 패널 위쪽 목록은 status 없이 hideInactiveClosed 로(진행 중 + 진행 중 사이클 소속 종료), 「종료된 에픽」 구역은 status=DONE,CANCELED 로 조회한다.
import type { IssueResponse } from '../../src/types/issue';

/** epics 중 요청 조건에 맞는 것 — activeCycle 은 진행 중 사이클에 할당된 에픽 번호(종료 에픽의 숨김 해제 기준). */
export function serverEpicFilter(url: URL, epics: IssueResponse[], activeCycle: number[] = []): IssueResponse[] {
  const statuses = (url.searchParams.get('status') ?? '').split(',').filter(Boolean);
  const hideInactiveClosed = url.searchParams.get('hideInactiveClosed') === 'true';
  return epics.filter(
    (e) =>
      (statuses.length === 0 || statuses.includes(e.status)) &&
      (!hideInactiveClosed || (e.status !== 'DONE' && e.status !== 'CANCELED') || activeCycle.includes(e.number)),
  );
}
