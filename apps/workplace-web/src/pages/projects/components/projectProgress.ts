// 프로젝트 목록 행의 진행률 규칙(WP-412) — ProjectListRow 에서 뺀 순수 함수(화면 없이 단위 테스트로 고정).
import type { ProjectResponse } from '@/types/project';

/**
 * 완료율 라벨 — 정직 신호: 이슈 0=이슈 없음, 100%=축하, 그 외 N개 중 X% 완료.
 * pct 는 호출부에서 completionPct(lib/progress)로 계산해 전달(바 너비와 라벨이 동일 값을 쓰도록 단일화).
 */
export function progressLabel(p: Pick<ProjectResponse, 'issueTotal'>, pct: number): string {
  if (p.issueTotal === 0) return '이슈 없음';
  if (pct >= 100) return `${p.issueTotal}개 모두 완료 🎉`;
  return `${p.issueTotal}개 중 ${pct}% 완료`;
}
