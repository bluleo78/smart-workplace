import { describe, expect, it } from 'vitest';

import type { VersionResponse } from '@/types/version';

import { buildVersionDetailContext } from './version';

const version: VersionResponse = {
  id: 7, name: 'v1.5.3', description: null, startDate: '2026-10-01', releaseDate: '2026-10-29', status: 'UNRELEASED',
  releasedAt: null, progress: { done: 3, inProgress: 1, todo: 2 }, affectsCount: 0,
};

describe('buildVersionDetailContext', () => {
  it('이름·상태·기간·진행을 담고 refs 에 이슈 조회용 fixVersion 을 둔다', () => {
    const ctx = buildVersionDetailContext({ projectKey: 'WP', version, today: '2026-10-26' });
    expect(ctx.view).toBe('버전 상세');
    expect(ctx.focus?.label).toBe('v1.5.3');
    expect(ctx.focus?.refs).toEqual({ projectKey: 'WP', fixVersion: 'v1.5.3' });
    expect(ctx.focus?.facts).toEqual([
      { label: '상태', value: '미출시' },
      { label: '시작일', value: '2026-10-01' },
      { label: '출시일', value: '2026-10-29' },
      { label: '기간', value: '3일 남음' },
      { label: '진행', value: '3/6 완료' },
    ]);
  });
});
