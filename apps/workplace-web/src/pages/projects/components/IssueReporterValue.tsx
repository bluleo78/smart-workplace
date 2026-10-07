// 이슈 보고자(만든 사람) 읽기 전용 표시 — 아바타·이름 · 「N월 N일 생성」 (WP-272).
// 데스크톱 속성 레일(상태·담당 그룹 담당자 아래)과 모바일 ＋ 속성 시트(유형 아래)가 같은 표시를 공유한다.
// 보고자는 바꿀 수 없는 값이라 담당자 필드와 달리 버튼(편집 트리거)이 아닌 일반 텍스트로 렌더한다.
import { UserAvatar } from '../../../components/users/UserAvatar';
import { formatDateMonthDay, formatDateTimeMinute } from '../../../lib/formatters';
import type { UserSummary } from '../../../types/user';

export function IssueReporterValue({
  reporter,
  createdAt,
}: {
  /** 상세 응답 reporter — 사용자 행을 찾지 못하면 null(「알 수 없음」). */
  reporter: UserSummary | null | undefined;
  /** summary.createdAt — 이슈 생성 시각(UTC ISO). */
  createdAt: string;
}) {
  const createdDay = formatDateMonthDay(createdAt);
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-sm" data-testid="issue-reporter">
      {reporter ? (
        <>
          {/* AGENT 는 담당자 칩과 같은 아바타 표식(ring + Bot 마커)으로 사람과 구분한다. */}
          <UserAvatar user={reporter} size="xs" agent={reporter.kind === 'AGENT'} />
          <span className="truncate">{reporter.name}</span>
        </>
      ) : (
        <span className="text-muted-foreground">알 수 없음</span>
      )}
      {createdDay && (
        // 월·일만 보여주고, 정확한 생성 시각은 hover 툴팁으로 제공한다.
        <span
          className="shrink-0 text-xs text-muted-foreground"
          title={formatDateTimeMinute(createdAt)}
          data-testid="issue-reporter-created"
        >
          · {createdDay} 생성
        </span>
      )}
    </span>
  );
}
