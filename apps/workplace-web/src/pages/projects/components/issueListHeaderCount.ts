// 그룹 헤더에 쓸 수(WP-472·WP-1929) — 서버 총계·임시(이전 필터) 총계·행 수 폴백의 판정을 한 함수로 모아
// 화면과 떨어져 단위 테스트로 지킨다(IssueListView 는 컴포넌트만 내보내야 fast-refresh 가 돈다).
import type { IssueClientGroupBy } from '../../../types/issue';

/**
 * 그룹 헤더에 쓸 수 — 서버 총계가 있는 그룹은 총계가 **로딩 중일 때만** 수를 두지 않는다.
 * 「불러온 행 수를 잠깐 보여주고 총계로 바꾸는」 깜빡임을 없애기 위한 것이다(WP-1929 리뷰 — 캐시에서 행이 먼저 와
 * 헤더가 먼저 그려질 수 있다). 다만 총계 요청이 실패하거나(4xx/5xx·오프라인) 응답에 그룹 키가 없으면
 * (0건 그룹은 서버가 내려주지 않고, 낙관적 변경으로 새로 생긴 그룹도 그렇다) 빈 수로 두지 않고 불러온 행 수로
 * 대체한다 — 요청이 실패했다고 헤더 수가 영영 안 뜨는 일을 막기 위해서다(WP-1929 리뷰 1·2).
 * `countsProvisional`(이전 필터 총계를 임시로 쓰는 중이고 아직 오류가 아님)일 때는 그 임시 총계를 그대로 보이지 않고
 * 두 경우에만 비운다(WP-1929 리뷰 3차 3·nit 1) — ① 임시 총계에 없는 그룹(실제 총계가 올 때 「행 수 → 총계」로
 * 깜빡이기 때문) ② `rowsUpdated`(행이 이미 새 결과로 바뀌어 임시 총계와 어긋나 보이는 경우). 행도 아직 이전 결과일
 * 때는 임시 총계를 그대로 써서 「필터를 바꾸면 헤더 수가 전부 사라졌다 다시 뜨는」 깜빡임을 막는다(WP-1929 리뷰 2차 3).
 * 에픽 그룹만 별도 집계 API 가 없어(IssueCountableGroupBy — 에픽 필터가 없다) 늘 불러온 행 수를 쓴다.
 *
 * @param countsLoading 총계를 기다리는 중(오류 아님·오프라인 아님·그룹 기준이 아직 이전 기준)인가
 * @param countsProvisional 지금 보이는 총계가 이전 필터의 값(placeholder)인가 — 화면(IssueListView)에서는 `countsJudgments().provisional` 로만 만든다
 * @param rowsUpdated 행은 이미 새 결과로 바뀌었는가(이전 결과 자리를 메우는 중이 아님)
 */
export function headerCount(
  groupBy: IssueClientGroupBy | null,
  key: string,
  rowCount: number,
  counts: ReadonlyMap<string, number>,
  countsLoading: boolean,
  countsProvisional: boolean,
  rowsUpdated: boolean,
): number | null {
  if (groupBy === 'epic') return rowCount;
  // 총계를 기다리는 동안만 비운다 — 실패·로드 이후엔 키 유무와 상관없이 아래 폴백으로 간다.
  if (countsLoading) return null;
  const total = counts.get(key);
  // 임시(이전 필터) 총계 — 키가 없거나 행이 이미 바뀌었으면 어긋남이 보이니 진짜 총계가 올 때까지 비운다.
  if (countsProvisional && (total === undefined || rowsUpdated)) return null;
  return total ?? rowCount;
}

/** `countsJudgments` 가 돌려주는 두 판정 — IssueListView 는 이 두 개로 총계 맵과 headerCount 인자를 정한다. */
export interface CountsJudgments {
  /** 지금 쓰는 총계 맵을 신뢰할 수 있는가(거짓이면 빈 맵 — headerCount 는 행 수로 내려간다) */
  usable: boolean;
  /** headerCount 에 넘길 임시(이전 필터) 총계 판정 */
  provisional: boolean;
}

/**
 * `countsJudgments` — 총계 맵 신뢰 판정과 `headerCount` 에 넘길 임시 판정(WP-1929 리뷰 3차 3·4차)을 한 곳에서 정해
 * 화면과 단위 테스트가 같은 규칙을 쓰게 한다.
 *
 * **오프라인 자리채움(placeholder) 총계는 신뢰하지 않는다**(4차). 오프라인에서 필터를 바꾸면 총계 요청이
 * `paused` 로 끝나지 않아 지금 보이는 값은 이전 필터의 총계다. 그럴 때 ① 임시 총계 갈래에 들어가면 행이 캐시에서
 * 바로 와 `rowsUpdated` 가 되는 순간 모든 그룹 헤더가 `null` 로 비어 온라인이 될 때까지 계속 비었다(3차 2 와 같은
 * 증상 — 기다림이 끝나지 않아 회복되지 않는다) ② 맵을 그대로 두면 이전 필터 총계가 새 필터 행 위에 그대로 뜬다
 * (3차 nit 1-3·1-5 와 같은 노출). 그래서 맵도 비우고 임시 갈래도 끈다 — 헤더는 그려져 있는 행 수로 내려간다.
 *
 * @param input.countsStaleBy 그룹 기준이 바뀌어 이전 기준 총계를 못 쓰는가
 * @param input.countsError 총계 요청이 실패했는가
 * @param input.countsOffline 총계 쿼리가 오프라인이라 멈춰 있는가(`fetchStatus === 'paused'`)
 * @param input.isPlaceholderData 지금 보이는 총계가 이전 쿼리의 값인가(자리채움 중)
 */
export function countsJudgments(input: {
  countsStaleBy: boolean;
  countsError: boolean;
  countsOffline: boolean;
  isPlaceholderData: boolean;
}): CountsJudgments {
  // 오프라인 자리채움은 총계 자리도 임시 자리도 쓰지 않는다.
  const offlinePlaceholder = input.countsOffline && input.isPlaceholderData;
  const usable = !input.countsStaleBy && !input.countsError && !offlinePlaceholder;
  return { usable, provisional: usable && !input.countsOffline && input.isPlaceholderData };
}