import { describe, expect, it } from 'vitest';

import { NO_VISION_PICK, visionChoiceFor, visionConfigFor } from './visionConfig';

describe('visionConfigFor', () => {
  it('자동 감지면 undefined — providerConfig 에 vision 키를 싣지 않는다', () => {
    expect(visionConfigFor('auto', 'm')).toBeUndefined();
  });

  it('볼 수 있음이면 해당 모델 id 를 키로 true', () => {
    expect(visionConfigFor('yes', 'custom/q')).toEqual({ 'custom/q': true });
  });

  it('볼 수 없음이면 해당 모델 id 를 키로 false', () => {
    expect(visionConfigFor('no', 'x')).toEqual({ x: false });
  });

  it('모델이 아직 정해지지 않았으면(빈 값) 수동 지정이어도 undefined', () => {
    expect(visionConfigFor('yes', '')).toBeUndefined();
  });
});

// WP-250 최종 리뷰: 선택은 선택할 때의 모델 id 에만 적용된다 — 직접 입력 중 다른 id 가 되면 자동 감지로 보인다.
describe('visionChoiceFor', () => {
  it('선택할 때의 모델과 지금 모델이 같으면 그 선택', () => {
    expect(visionChoiceFor({ model: 'p/gpt-4o', choice: 'yes' }, 'p/gpt-4o')).toBe('yes');
    expect(visionChoiceFor({ model: 'p/gpt-4o', choice: 'no' }, 'p/gpt-4o')).toBe('no');
  });

  it('지금 모델이 다르면(입력이 바뀌어 다른 id) 자동 감지', () => {
    expect(visionChoiceFor({ model: 'p/gpt-4o', choice: 'yes' }, 'p/gpt-4o-mini')).toBe('auto');
    expect(visionChoiceFor({ model: 'p/gpt-4o', choice: 'yes' }, '')).toBe('auto');
  });

  it('아무것도 지정하지 않은 상태는 자동 감지', () => {
    expect(visionChoiceFor(NO_VISION_PICK, '')).toBe('auto');
    expect(visionChoiceFor(NO_VISION_PICK, 'p/m')).toBe('auto');
  });
});
