import { describe, it, expect } from 'vitest';
import { extractResultText, parseClassifyJson } from './mail-parser.js';

describe('extractResultText', () => {
  it('result 이벤트의 최종 텍스트를 반환', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '중간' }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', result: '• 요약1\n• 요약2' }),
    ];
    expect(extractResultText(lines)).toBe('• 요약1\n• 요약2');
  });
  it('result 없으면 assistant text 합침', () => {
    const lines = [JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '본문' }] } })];
    expect(extractResultText(lines)).toBe('본문');
  });
});

describe('parseClassifyJson', () => {
  it('코드펜스 섞여도 첫 JSON 객체 파싱 + 카테고리 검증', () => {
    const r = parseClassifyJson('```json\n{"category":"업무","needsReply":true}\n```');
    expect(r).toEqual({ category: '업무', needsReply: true });
  });
  it('알 수 없는 카테고리는 업무로 폴백', () => {
    expect(parseClassifyJson('{"category":"기타","needsReply":false}').category).toBe('업무');
  });
  it('JSON 없으면 throw', () => {
    expect(() => parseClassifyJson('분류 불가')).toThrow();
  });
});
