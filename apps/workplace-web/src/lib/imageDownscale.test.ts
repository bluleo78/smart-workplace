import { describe, expect, it } from 'vitest';

import { DOWNSCALE_TRIGGER_BYTES, downscaleTarget, isDownscalableType, toJpegName } from './imageDownscale';

const MB = 1024 * 1024;

describe('isDownscalableType', () => {
  it('jpeg·png·webp 만 축소 대상', () => {
    expect(isDownscalableType('image/jpeg')).toBe(true);
    expect(isDownscalableType('image/png')).toBe(true);
    expect(isDownscalableType('image/webp')).toBe(true);
  });
  it('GIF 는 애니메이션 보존을 위해, HEIC·문서는 디코딩 대상이 아니라 제외', () => {
    expect(isDownscalableType('image/gif')).toBe(false);
    expect(isDownscalableType('image/heic')).toBe(false);
    expect(isDownscalableType('application/pdf')).toBe(false);
  });
});

describe('downscaleTarget — 긴 변 2048 · 4MB', () => {
  it('긴 변 2048 이하이고 4MB 이하면 그대로(null)', () => {
    expect(downscaleTarget(2048, 1000, 1 * MB)).toBeNull();
    expect(downscaleTarget(800, 600, DOWNSCALE_TRIGGER_BYTES)).toBeNull();
  });
  it('가로가 길면 가로를 2048 로 맞추고 비율 유지', () => {
    expect(downscaleTarget(4000, 3000, 1 * MB)).toEqual({ width: 2048, height: 1536 });
  });
  it('세로가 길면 세로를 2048 로 맞춘다(반올림)', () => {
    expect(downscaleTarget(1000, 3000, 1 * MB)).toEqual({ width: 683, height: 2048 });
  });
  it('크기는 작아도 4MB 를 넘으면 같은 크기로 JPEG 재인코딩', () => {
    expect(downscaleTarget(1500, 1000, DOWNSCALE_TRIGGER_BYTES + 1)).toEqual({ width: 1500, height: 1000 });
  });
  it('아주 가는 이미지도 0px 이 되지 않는다', () => {
    expect(downscaleTarget(10000, 1, 1)).toEqual({ width: 2048, height: 1 });
  });
});

describe('toJpegName', () => {
  it('확장자를 .jpg 로 바꾼다', () => {
    expect(toJpegName('photo.png')).toBe('photo.jpg');
    expect(toJpegName('a.b.webp')).toBe('a.b.jpg');
  });
  it('확장자가 없으면 붙인다', () => {
    expect(toJpegName('스크린샷')).toBe('스크린샷.jpg');
  });
});
