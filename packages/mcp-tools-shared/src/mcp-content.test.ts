import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { replaceImagesWithNotice, resultText, summarizeToolResult, toMcpContent, type McpContent } from './mcp-content.js';
import type { SharedTool } from './mcp-tool.js';

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

describe('resultText (WP-345)', () => {
  it('문자열은 그대로', () => {
    expect(resultText('{"ok":true}')).toBe('{"ok":true}');
  });
  it('text 블록만 있는 배열은 줄바꿈으로 이어 붙인다', () => {
    expect(resultText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
  });
  it('이미지 블록이 섞이면 던진다(텍스트를 기대하는 자리에서 조용히 넘기지 않는다)', () => {
    expect(() => resultText([{ type: 'text', text: '첨부:' }, image6kb])).toThrow('이미지 블록');
  });
});

// WP-345: 공유 도구도 content 블록 배열을 돌려줄 수 있다 — 아래가 컴파일되면(typecheck) 타입이 넓어진 것이다.
describe('SharedTool 반환 타입 (WP-345)', () => {
  const imageTool: SharedTool = {
    name: 'read_attachment_fake',
    description: 'd',
    inputSchema: z.object({}),
    kind: 'read',
    handler: async () => [{ type: 'text', text: '첨부:' }, image6kb],
  };
  const stringTool: SharedTool = { name: 's', description: 'd', inputSchema: z.object({}), kind: 'read', handler: async () => '{}' };

  it('블록 배열을 돌려주는 공유 도구도 toMcpContent·summarizeToolResult 를 그대로 통과한다', async () => {
    const out = await imageTool.handler({});
    expect(toMcpContent(out)).toEqual([{ type: 'text', text: '첨부:' }, image6kb]);
    expect(summarizeToolResult(out)).toBe('첨부:\n[image/png 6KB]');
  });
  it('기존 문자열 도구는 그대로 동작한다', async () => {
    expect(toMcpContent(await stringTool.handler({}))).toEqual([{ type: 'text', text: '{}' }]);
  });
});
