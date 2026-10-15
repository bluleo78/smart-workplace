// filterLabelsByName·labelNameToCreate(WP-412) — 라벨 피커 검색·인라인 만들기 판정 단위 테스트(label-inline-create E2E 에서 이관).
import { describe, expect, it } from 'vitest';

import { filterLabelsByName, labelNameToCreate } from './labelSearch';

const labels = [{ name: 'bug' }, { name: 'severity:major' }];

describe('labelNameToCreate', () => {
  it('정확히 같은 이름이 있으면 만들 수 없다', () => {
    expect(labelNameToCreate('bug', labels)).toBeNull();
    expect(labelNameToCreate('  bug  ', labels)).toBeNull();
  });

  it('대소문자가 다르거나 일부만 겹치면 만들 수 있다(서버 유일 제약이 대소문자 구분)', () => {
    expect(labelNameToCreate('Bug', labels)).toBe('Bug');
    expect(labelNameToCreate('severity', labels)).toBe('severity');
  });

  it('공백뿐이면 만들 수 없고, 앞뒤 공백은 잘라 만든다', () => {
    expect(labelNameToCreate('   ', labels)).toBeNull();
    expect(labelNameToCreate(' 긴급 ', labels)).toBe('긴급');
  });
});

describe('filterLabelsByName', () => {
  it('부분 일치·대소문자 무시로 거른다', () => {
    expect(filterLabelsByName(labels, 'BU').map((l) => l.name)).toEqual(['bug']);
    expect(filterLabelsByName(labels, 'sever').map((l) => l.name)).toEqual(['severity:major']);
    expect(filterLabelsByName(labels, '')).toHaveLength(2);
  });
});
