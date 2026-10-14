import { describe, expect, it } from 'vitest';

import { visionConfigFor } from './visionConfig';

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
