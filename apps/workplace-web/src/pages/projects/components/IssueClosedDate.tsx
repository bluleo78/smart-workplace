// 보드 카드·모바일 메타의 「완료일」 조각(WP-873) — 「✓ 10월 23일」(취소는 「⊘ 10월 18일」) + 늦음 「+2일」.
// 마감일 자리를 대신하는 짧은 표기라 카드(데스크톱 메타 줄)와 IssueMobileMeta 가 같은 문구·늦음 톤을 쓰도록 공용화했다.
// 늦음은 경고 토큰(text-warning-text)에 「+N일」 문구까지 붙여 색에만 의존하지 않는다. testid 는 호출부가 접두를 정한다.
import { formatInstantMonthDay } from '../../../lib/formatters';
import { closedGlyph, type ClosedInfo } from '../../../lib/issueClosedInfo';

export function IssueClosedDate({ info, testIdPrefix }: { info: ClosedInfo; testIdPrefix: string }) {
  return (
    // 바깥 span 이 전체(날짜+늦음)를 감싸 한 덩어리로 줄바꿈 없이 이어지고, 테스트·스크린리더도 한 문구로 읽는다.
    <span className="whitespace-nowrap" data-testid={`${testIdPrefix}-closed`}>
      {closedGlyph(info.kind)} {formatInstantMonthDay(info.closedAt)}
      {info.lateDays !== null && (
        <>
          {/* 스크린리더가 날짜와 「+N일」 을 붙여 읽지 않게 구분어를 둔다 — 화면엔 보이지 않아(sr-only) 모양은 그대로. */}
          <span className="sr-only">, 마감 </span>
          <span className="ml-1 font-medium text-warning-text" data-testid={`${testIdPrefix}-closed-late`}>
            +{info.lateDays}일
          </span>
        </>
      )}
    </span>
  );
}
