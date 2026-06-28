import { describe, it, expect } from 'vitest';
import { extractResultText, parseClassifyJson, parseDraftCoachingJson, parseIssueDraftJson } from './mail-parser.js';

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

describe('parseDraftCoachingJson', () => {
  it('notes + improvedBodyHtml 파싱', () => {
    const text = '{"notes":[{"dimension":"TONE","message":"명령조"}],"improvedBodyHtml":"<p>개선</p>"}';
    const out = parseDraftCoachingJson(text);
    expect(out.notes).toEqual([{ dimension: 'TONE', message: '명령조' }]);
    expect(out.improvedBodyHtml).toBe('<p>개선</p>');
  });
  it('알 수 없는 dimension 은 제외', () => {
    const text = '{"notes":[{"dimension":"WEIRD","message":"x"},{"dimension":"CLARITY","message":"y"}],"improvedBodyHtml":"<p>h</p>"}';
    const out = parseDraftCoachingJson(text);
    expect(out.notes).toEqual([{ dimension: 'CLARITY', message: 'y' }]);
  });
  it('JSON 없으면 throw (→ 502 → UI 에러)', () => {
    // 파싱 실패를 빈 결과로 폴백하면 "고칠 곳 없어요"라는 거짓 신호가 됨 → 반드시 throw.
    expect(() => parseDraftCoachingJson('설명만 있고 JSON 없음')).toThrow();
  });
  it('깨진 JSON 도 throw', () => {
    expect(() => parseDraftCoachingJson('{"notes": [oops')).toThrow();
  });
});

describe('parseIssueDraftJson', () => {
  it('정상 JSON 파싱', () => {
    const r = parseIssueDraftJson('{"title":"정산 검토","body":"- 5월 자료 확인","priority":"HIGH","projectKey":"FIN"}');
    expect(r).toEqual({ title: '정산 검토', body: '- 5월 자료 확인', priority: 'HIGH', projectKey: 'FIN' });
  });
  it('projectKey 생략 허용', () => {
    const r = parseIssueDraftJson('{"title":"t","body":"b","priority":"MID"}');
    expect(r.projectKey).toBeUndefined();
  });
  it('잘못된 priority 는 MID 로 보정', () => {
    const r = parseIssueDraftJson('{"title":"t","body":"b","priority":"URGENT"}');
    expect(r.priority).toBe('MID');
  });
  it('파싱 실패 시 throw(빈 폴백 금지)', () => {
    expect(() => parseIssueDraftJson('not json')).toThrow();
  });
});
