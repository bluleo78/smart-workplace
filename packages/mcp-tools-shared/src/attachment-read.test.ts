import { describe, expect, it } from 'vitest';

import { effectiveMimeType } from './attachment-read.js';

// WP-250 코드 리뷰: 확장자 매핑 전에 올라온 사진(octet-stream)을 파일명으로 이미지로 본다 — 서버 MimeNormalizer 의 이미지 항목과 같은 표.
describe('effectiveMimeType', () => {
  it('octet-stream·빈 값이면 이미지 확장자(대소문자 무관)로 이미지 mime', () => {
    expect(effectiveMimeType('application/octet-stream', 'IMG_0001.HEIC')).toBe('image/heic');
    expect(effectiveMimeType('', 'a.heif')).toBe('image/heif');
    expect(effectiveMimeType('application/octet-stream', 'scan.tif')).toBe('image/tiff');
    expect(effectiveMimeType('application/octet-stream', 'scan.tiff')).toBe('image/tiff');
    expect(effectiveMimeType('application/octet-stream; charset=binary', 'pic.bmp')).toBe('image/bmp');
  });

  it('구체적인 mime 은 그대로(파라미터만 뗀다), 모르는 확장자·이름 없음은 저장 mime', () => {
    expect(effectiveMimeType('image/png', 'a.heic')).toBe('image/png');
    expect(effectiveMimeType('application/pdf; charset=binary', 'a.pdf')).toBe('application/pdf');
    expect(effectiveMimeType('application/octet-stream', 'bundle.zip')).toBe('application/octet-stream');
    expect(effectiveMimeType('application/octet-stream', 'noext')).toBe('application/octet-stream');
    expect(effectiveMimeType('application/octet-stream')).toBe('application/octet-stream');
  });
});
