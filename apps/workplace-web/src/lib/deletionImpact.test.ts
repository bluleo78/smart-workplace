import { describe, expect, it } from 'vitest';

import { deletionImpactNote } from './deletionImpact';

describe('deletionImpactNote (WP-488)', () => {
  it('영향받는 이슈 수를 종류별 문구로 알린다', () => {
    expect(deletionImpactNote('member', 2)).toBe('담당 중인 이슈 2개에서 담당자가 해제됩니다.');
    expect(deletionImpactNote('label', 3)).toBe('이 라벨이 붙은 이슈 3개에서 라벨이 빠집니다.');
    expect(deletionImpactNote('cycle', 1)).toBe('이 사이클의 이슈 1개가 사이클에서 빠집니다(이슈는 지워지지 않습니다).');
    expect(deletionImpactNote('component', 4)).toBe('이 구성요소가 붙은 이슈 4개에서 구성요소가 빠집니다(이슈는 지워지지 않습니다).');
  });

  it('0건이거나 아직 모르면 안내하지 않는다', () => {
    expect(deletionImpactNote('label', 0)).toBeNull();
    expect(deletionImpactNote('member', undefined)).toBeNull();
  });
});
