// 이슈 상세의 「완료·취소 시각」 한 줄(WP-873) — 상태 선택/칩 바로 아래에 「✓ 10월 23일 (금) 오후 2:05 완료」.
// 데스크톱 속성 레일(상태 아래)과 모바일 칩 줄(칩 아래)이 공유한다. 읽기 전용 표기라 버튼이 아닌 일반 텍스트다.
// 종료 상태가 아니거나 closedAt 이 없으면(재오픈·구버전 응답) 줄 자체를 그리지 않는다.
// DONE 이 마감일보다 늦게 끝났으면 「마감 +N일」을 경고 톤으로 덧붙여 뜻을 문구로도 전달한다(색에만 의존하지 않음).
import { formatDateTimeMinute, formatMonthDayWeekdayClock } from '../../../lib/formatters';
import { closedGlyph, closedInfo, closedVerb } from '../../../lib/issueClosedInfo';
import { cn } from '../../../lib/utils';

export function IssueClosedLine({
  status,
  closedAt,
  dueDate,
  className,
}: {
  status: string;
  /** 서버가 내려주는 종료 시각(UTC ISO) — 구버전 응답엔 없을 수 있다. */
  closedAt?: string | null;
  dueDate: string | null;
  className?: string;
}) {
  const info = closedInfo({ status, closedAt, dueDate });
  if (!info) return null;
  return (
    <p
      // 정확한 시각은 hover 툴팁으로 — 본문은 요일·시각까지만(보고자 생성일 표기와 같은 방식).
      title={formatDateTimeMinute(info.closedAt)}
      className={cn('flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground', className)}
      data-testid="issue-closed-line"
    >
      <span>
        {closedGlyph(info.kind)} {formatMonthDayWeekdayClock(info.closedAt)} {closedVerb(info.kind)}
      </span>
      {info.lateDays !== null && (
        <span className="font-medium text-warning-text" data-testid="issue-closed-late">
          마감 +{info.lateDays}일
        </span>
      )}
    </p>
  );
}
