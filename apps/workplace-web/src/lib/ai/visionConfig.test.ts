import { describe, expect, it } from 'vitest';

import { NO_VISION_PICK, visionChoiceFor, visionChoiceOf, visionConfigFor, visionSettingOf } from './visionConfig';

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

// WP-250 코드 리뷰: 등록 후 모델 변경 화면 — 서버 지정값 ↔ 선택 상자 값.
describe('visionChoiceOf · visionSettingOf', () => {
  it('서버 값 true/false/없음 → 볼 수 있음/볼 수 없음/자동 감지', () => {
    expect(visionChoiceOf(true)).toBe('yes');
    expect(visionChoiceOf(false)).toBe('no');
    expect(visionChoiceOf(null)).toBe('auto');
    expect(visionChoiceOf(undefined)).toBe('auto');
  });

  it('선택 → 설정 변경 값(자동은 null 로 지정을 지운다)', () => {
    expect(visionSettingOf('yes')).toBe(true);
    expect(visionSettingOf('no')).toBe(false);
    expect(visionSettingOf('auto')).toBeNull();
  });
});
