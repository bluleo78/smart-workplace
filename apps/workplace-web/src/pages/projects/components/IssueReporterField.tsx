// 이슈 보고자(만든 사람) 읽기 전용 필드 — 「보고자」 레이블 + 아바타·이름 · 「N월 N일 생성」 (WP-272).
// 데스크톱 속성 레일(상태·담당 그룹 담당자 아래, 세로 배치)과 모바일 ＋ 속성 시트(유형 아래, 가로 배치)가 공유한다.
// 보고자는 바꿀 수 없는 값이라 담당자 필드와 달리 버튼(편집 트리거)이 아닌 일반 텍스트로 렌더한다.
import { UserAvatar } from '../../../components/users/UserAvatar';
import { formatDateMonthDay, formatDateTimeMinute } from '../../../lib/formatters';
import type { UserSummary } from '../../../types/user';

const LABEL_CLASS = 'text-xs font-medium text-muted-foreground';

export function IssueReporterField({
  reporter,
  createdAt,
  layout,
}: {
  /**
   * 상세 응답 reporter — null 이면 사용자 행을 찾지 못한 것(「알 수 없음」).
   * undefined 는 필드가 없는 구버전 서버 응답(롤링 배포 중)이라 「알 수 없음」으로 오해하지 않게 필드째 숨긴다.
   */
  reporter: UserSummary | null | undefined;
  /** summary.createdAt — 이슈 생성 시각(UTC ISO). */
  createdAt: string;
  /** rail = 레이블 위·값 아래(담당자 필드와 같은 px-3 들여쓰기), sheet = 레이블 왼쪽·값 오른쪽 한 줄. */
  layout: 'rail' | 'sheet';
}) {
  if (reporter === undefined) return null;
  const createdDay = formatDateMonthDay(createdAt);
  const value = (
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
  if (layout === 'sheet') {
    return (
      <div className="flex items-center justify-between gap-2" data-testid="issue-more-props-reporter">
        <span className={LABEL_CLASS}>보고자</span>
        {value}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <span className={LABEL_CLASS}>보고자</span>
      <div className="px-3 py-2">{value}</div>
    </div>
  );
}
