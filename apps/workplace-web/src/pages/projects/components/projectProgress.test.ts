// progressLabel(WP-412) — 프로젝트 목록 진행률 라벨 단위 테스트(project-list E2E 에서 이관).
import { describe, expect, it } from 'vitest';

import { completionPct } from '@/lib/progress';

import { progressLabel } from './projectProgress';

const label = (issueTotal: number, issueDone: number) =>
  progressLabel({ issueTotal }, completionPct(issueDone, issueTotal));

describe('progressLabel', () => {
  it('일부 완료는 "N개 중 X% 완료"(반올림)', () => {
    expect(label(18, 11)).toBe('18개 중 61% 완료');
    expect(label(3, 1)).toBe('3개 중 33% 완료');
  });

  it('이슈가 없으면 "이슈 없음", 전부 완료면 축하 문구', () => {
    expect(label(0, 0)).toBe('이슈 없음');
    expect(label(12, 12)).toBe('12개 모두 완료 🎉');
  });
});
