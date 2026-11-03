// WP-1322 생각의 깊이 → 추론 노력 단계 매핑.
import { describe, it, expect } from 'vitest';

import { clampEffort, effortFor, effortsList, thinkingDepthSchema } from './thinking.js';

describe('effortFor', () => {
  it('DEFAULT(설정 안 함)·미지정은 아무것도 싣지 않는다', () => {
    expect(effortFor('DEFAULT')).toBeUndefined();
    expect(effortFor(undefined)).toBeUndefined();
  });
  it('LOW~MAX 는 소문자 단계로', () => {
    expect(effortFor('LOW')).toBe('low');
    expect(effortFor('MEDIUM')).toBe('medium');
    expect(effortFor('HIGH')).toBe('high');
    expect(effortFor('XHIGH')).toBe('xhigh');
    expect(effortFor('MAX')).toBe('max');
  });
  it('모르는 값(옛 값 포함)은 싣지 않는다', () => {
    expect(effortFor('NORMAL')).toBeUndefined();
    expect(effortFor('WAT')).toBeUndefined();
  });
});

describe('thinkingDepthSchema', () => {
  it('새 값은 그대로', () => {
    expect(thinkingDepthSchema.parse('XHIGH')).toBe('XHIGH');
    expect(thinkingDepthSchema.parse('DEFAULT')).toBe('DEFAULT');
  });
  it('옛 값(NONE/NORMAL/DEEP)은 롤링 배포 호환으로 받아 DEFAULT 로', () => {
    expect(thinkingDepthSchema.parse('NONE')).toBe('DEFAULT');
    expect(thinkingDepthSchema.parse('NORMAL')).toBe('DEFAULT');
    expect(thinkingDepthSchema.parse('DEEP')).toBe('DEFAULT');
  });
  it('그 밖의 값은 거절', () => {
    expect(thinkingDepthSchema.safeParse('high').success).toBe(false);
    expect(thinkingDepthSchema.safeParse('WAT').success).toBe(false);
  });
});

describe('effortsList', () => {
  it('지원 단계만 낮은 순 소문자로, 단계가 아닌 키(minimal·none)는 버린다', () => {
    expect(effortsList(['high', 'minimal', 'low', 'none', 'max'])).toEqual(['low', 'high', 'max']);
    expect(effortsList([])).toEqual([]);
  });
});

describe('clampEffort', () => {
  it('받는 단계면 그대로, 아니면 바로 아래 받는 단계, 없으면 undefined', () => {
    expect(clampEffort('medium', ['low', 'medium', 'high'])).toBe('medium');
    expect(clampEffort('max', ['low', 'medium', 'high'])).toBe('high');
    expect(clampEffort('low', ['high'])).toBeUndefined();
    expect(clampEffort('high', [])).toBeUndefined();
  });
});
