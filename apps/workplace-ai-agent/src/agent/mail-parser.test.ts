import { describe, it, expect } from 'vitest';
import {
  extractJsonObject,
  parseContentAnalysisJson,
  parseDraftCoachingJson,
  parseIssueDraftJson,
  parsePersonalAnalysisJson,
} from './mail-parser.js';

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

describe('extractJsonObject', () => {
  it('코드펜스·앞뒤 잡설을 걷어내고 객체를 읽는다', () => {
    expect(extractJsonObject('결과:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('문자열 안의 날 줄바꿈을 허용한다', () => {
    expect(extractJsonObject('{"summary":"• 첫째\n• 둘째"}')).toEqual({ summary: '• 첫째\n• 둘째' });
  });
  it('JSON 이 없으면 throw', () => {
    expect(() => extractJsonObject('분석 불가')).toThrow();
  });
  it('배열이면 throw', () => {
    expect(() => extractJsonObject('[1,2]')).toThrow();
  });
});

describe('parseContentAnalysisJson', () => {
  const both = { includeCategory: true, includeSummary: true };
  it('category·summary 파싱(요약 안 중괄호도 허용)', () => {
    expect(parseContentAnalysisJson('{"category":"업무","summary":"• 일정 {초안} 확인"}', both)).toEqual({
      category: '업무',
      summary: '• 일정 {초안} 확인',
    });
  });
  it('미지 category 는 null(업무 폴백 없음)', () => {
    expect(parseContentAnalysisJson('{"category":"기타","summary":null}', both).category).toBeNull();
  });
  it('필드 누락은 null', () => {
    expect(parseContentAnalysisJson('{"category":"알림"}', both)).toEqual({ category: '알림', summary: null });
  });
  it('공백 요약은 null', () => {
    expect(parseContentAnalysisJson('{"category":"업무","summary":"  "}', both).summary).toBeNull();
  });
  it('요청하지 않은 항목은 응답에 있어도 null', () => {
    expect(
      parseContentAnalysisJson('{"category":"업무","summary":"• x"}', { includeCategory: true, includeSummary: false }),
    ).toEqual({ category: '업무', summary: null });
  });
});

describe('parsePersonalAnalysisJson', () => {
  const all = { includeNeedsReply: true, includePersonalSummary: true, includeCategory: true };
  it('세 필드 파싱', () => {
    expect(parsePersonalAnalysisJson('{"needsReply":true,"personalSummary":"• 나에게: 확인","category":"업무"}', all)).toEqual({
      needsReply: true,
      personalSummary: '• 나에게: 확인',
      personalSummaryValid: true,
      category: '업무',
    });
  });
  it('needsReply 누락이면 throw', () => {
    expect(() => parsePersonalAnalysisJson('{"personalSummary":null}', all)).toThrow();
  });
  it('needsReply 가 문자열이면 throw', () => {
    expect(() => parsePersonalAnalysisJson('{"needsReply":"true"}', all)).toThrow();
  });
  it('personalSummary 형식 오류면 needsReply 는 유지하고 valid=false', () => {
    expect(parsePersonalAnalysisJson('{"needsReply":false,"personalSummary":3}', all)).toMatchObject({
      needsReply: false,
      personalSummary: null,
      personalSummaryValid: false,
    });
  });
  it('personalSummary 누락도 valid=false', () => {
    expect(parsePersonalAnalysisJson('{"needsReply":false}', all).personalSummaryValid).toBe(false);
  });
  it('personalSummary null 은 유효한 "요약 필요 없음"', () => {
    expect(parsePersonalAnalysisJson('{"needsReply":false,"personalSummary":null}', all)).toMatchObject({
      personalSummary: null,
      personalSummaryValid: true,
    });
  });
  it('요약만 모드 — needsReply 없이도 파싱', () => {
    expect(
      parsePersonalAnalysisJson('{"personalSummary":"• 핵심"}', {
        includeNeedsReply: false,
        includePersonalSummary: true,
        includeCategory: false,
      }),
    ).toEqual({ needsReply: null, personalSummary: '• 핵심', personalSummaryValid: true, category: null });
  });
});
