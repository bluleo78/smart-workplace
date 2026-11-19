// WP-1777: 이슈 목록 결과 건수를 스크린리더에 알리는 안내 문구를 만든다.
// 목록 건수가 바뀌어도 화면 낭독기는 자동으로 읽지 않으므로, 건수를 문장으로 만들어
// 별도 영역(live region)에 넣을 수 있게 순수 함수로 분리했다.

/**
 * 건수로 안내 문구를 만든다(조회 실패는 부르는 쪽이 성공일 때만 불러 거른다).
 * - total 이 없으면(아직 로딩 전 등) 건수를 알 수 없으므로 빈 문자열을 반환한다.
 * - 0건이면 「없음」 문구, 1건 이상이면 「태스크 N건」 문구를 반환한다.
 */
export function issueResultAnnouncement(total: number | undefined): string {
  if (total === undefined) return '';
  if (total === 0) return '조건에 맞는 태스크가 없습니다';
  return `태스크 ${total}건`;
}
