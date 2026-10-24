// 개인 체크리스트 행의 마감 표시 규칙(WP-412) — PersonalChecklistRow 에서 뺀 순수 함수.
// 화면 없이 "오늘/내일/어제·연도 생략·색" 규칙을 단위 테스트로 고정하려고 분리했다. now 는 테스트 주입용(기본 현재 시각).

// 마감일 yyyy-MM-dd 는 로컬 날짜로 해석한다(UTC 로 읽으면 KST 에서 하루 밀린다) — 일수 차는 공용 daysUntilLocalDate 를 쓴다.
import { formatListDueDate } from '@/lib/formatters';
import { daysUntilLocalDate } from '@/lib/myTasks';

/** 마감 색 — 지남=빨강, 오늘=주황(warning). 완료/이후=muted. */
export function dueClass(due: string, done: boolean, now: Date = new Date()): string {
  if (done) return 'text-muted-foreground';
  const days = daysUntilLocalDate(due, now);
  if (days < 0) return 'text-destructive';
  if (days === 0) return 'text-warning';
  return 'text-muted-foreground';
}

/** 마감 짧게 — 오늘/내일/어제, 그 외는 목록 공용 표기(올해 "M월 D일", 다른 해 "YYYY. M. D", WP-919). */
export function formatDueShort(due: string, now: Date = new Date()): string {
  const diff = daysUntilLocalDate(due, now);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === -1) return '어제';
  return formatListDueDate(due, now);
}
