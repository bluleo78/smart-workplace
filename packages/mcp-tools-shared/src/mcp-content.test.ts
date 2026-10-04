import { describe, expect, it } from 'vitest';
import { replaceImagesWithNotice, summarizeToolResult, toMcpContent, type McpContent } from './mcp-content.js';

// 6KB 분량의 base64(실제 바이트 = 길이 × 3/4).
const image6kb: McpContent = { type: 'image', data: 'A'.repeat(8192), mimeType: 'image/png' };

describe('toMcpContent', () => {
  it('문자열은 text 블록 하나로 감싼다(기존 도구 하위 호환)', () => {
    expect(toMcpContent('{"ok":true}')).toEqual([{ type: 'text', text: '{"ok":true}' }]);
  });
  it('빈 문자열도 text 블록으로 감싼다', () => {
    expect(toMcpContent('')).toEqual([{ type: 'text', text: '' }]);
  });
  it('content 블록 배열은 이미지 포함 그대로 전달한다', () => {
    const blocks: McpContent[] = [{ type: 'text', text: '첨부:' }, image6kb];
    expect(toMcpContent(blocks)).toEqual(blocks);
  });
});

describe('summarizeToolResult', () => {
  it('문자열은 그대로', () => {
    expect(summarizeToolResult('결과')).toBe('결과');
  });
  it('이미지는 base64 대신 mime·크기 요약으로 바꾼다', () => {
    expect(summarizeToolResult([{ type: 'text', text: '첨부:' }, image6kb])).toBe('첨부:\n[image/png 6KB]');
  });
  it('1KB 미만 이미지도 1KB 로 표시한다', () => {
    expect(summarizeToolResult([{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }])).toBe('[image/jpeg 1KB]');
  });
  it('여러 텍스트 블록은 줄바꿈으로 잇는다', () => {
    expect(summarizeToolResult([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
  });
});

describe('replaceImagesWithNotice', () => {
  it('image 블록만 크기 표기 + 안내 text 블록으로 바꾸고 text 블록은 그대로 둔다', () => {
    const out = replaceImagesWithNotice([{ type: 'text', text: 'a.png' }, image6kb], '볼 수 없음');
    expect(out).toEqual([
      { type: 'text', text: 'a.png' },
      { type: 'text', text: '[image/png 6KB] 볼 수 없음' },
    ]);
  });
});
