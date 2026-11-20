// WP-1777: 태스크 탭의 필터·검색 결과 건수를 스크린리더에 알리는 화면 밖(sr-only) live region.
// 목록이 바뀌어도 낭독기는 자동으로 읽지 않으므로, 조건이 바뀐 뒤 서버 총계가 오면 건수를 문장으로 넣어 읽게 한다.
import { useEffect, useState } from 'react';

import { useIssueTotal } from '../../../hooks/queries/useIssueGroupCounts';
import { withDefaultIssueScope, withoutSort } from '../../../lib/issueFilters';
import { issueResultAnnouncement } from '../../../lib/issueResultAnnouncement';
import type { IssueFilters } from '../../../types/issue';

/**
 * 결과 건수 안내 영역. 화면에는 보이지 않는다.
 * - 처음 렌더의 조건은 안내하지 않고 총계도 요청하지 않는다(첫 진입에 요청이 늘지 않게). 조건이 한 번이라도 바뀐 뒤부터 요청·안내한다.
 * - 정렬은 건수와 무관하므로 조건 키에서 뺀다.
 * - 조건이 바뀌면 문구를 먼저 비우고, 새 조건의 총계가 오면 다시 채운다 — 같은 건수여도 낭독기가 변화를 알아채게 한다.
 * - 같은 조건에서 이미 알렸다면 재조회로 건수가 달라져도 다시 읽지 않는다(편집 중 불쑥 읽히는 것 방지).
 */
export function IssueResultStatus({ projectKey, filters }: { projectKey: string; filters: IssueFilters }) {
  const scoped = withDefaultIssueScope(filters);
  const key = JSON.stringify(withoutSort(scoped));

  // 렌더 중 상태 보정 패턴(effect 대신) — 조건 키가 처음 바뀐 순간부터 총계를 요청·안내한다(한 번 바뀌면 계속 켜 둔다).
  // 프로젝트 전환은 부모가 key={projectKey} 로 다시 마운트해 새 프로젝트 첫 진입으로 다룬다(여기서 따로 보정하지 않는다).
  const [prevKey, setPrevKey] = useState(key);
  const [changed, setChanged] = useState(false);
  if (prevKey !== key) {
    setPrevKey(key);
    setChanged(true);
  }
  // 알린 문구는 그 조건 키와 함께 둔다 — 키가 바뀌면 지우는 코드 없이 곧바로 빈 문구가 되고, 같은 키의 재조회로는 다시 채우지 않는다.
  const [filled, setFilled] = useState<{ key: string; text: string } | null>(null);
  const text = filled?.key === key ? filled.text : '';

  const total = useIssueTotal(projectKey, scoped, changed);
  // 다시 받는 중이면 기다린다 — 예전에 본 조건으로 돌아오면 캐시의 옛 총계가 먼저 와, 그것을 읽으면 새 응답이 달라도 다시 읽지 않기 때문이다.
  const ready = changed && total.isSuccess && !total.isFetching;
  const alreadyFilled = filled?.key === key;

  // 총계 도착 시 한 틱 뒤에 채운다 — 비워진 상태가 먼저 렌더돼 같은 문구도 다시 낭독된다. 타이머는 정리한다.
  useEffect(() => {
    if (!ready || alreadyFilled) return;
    const timer = setTimeout(() => setFilled({ key, text: issueResultAnnouncement(total.data) }), 0);
    return () => clearTimeout(timer);
  }, [ready, alreadyFilled, key, total.data]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="issue-result-status">
      {text}
    </div>
  );
}
