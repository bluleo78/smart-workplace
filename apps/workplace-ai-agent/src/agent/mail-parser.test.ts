import { describe, it, expect } from 'vitest';
import {
  extractJsonObject,
  parseClassifyBatchJson,
  parseComposeDraft,
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
  // 정규화 규칙 자체는 issue-priority.test 가 지킨다 — 여기선 mail-parser 가 normalizePriority 를 거치는지만 본다.
  it('5단계 우선순위는 normalizePriority 를 거쳐 살린다(WP-886)', () => {
    expect(parseIssueDraftJson('{"title":"t","body":"b","priority":" highest "}').priority).toBe('HIGHEST');
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

describe('parseClassifyBatchJson', () => {
  it('요청한 id 가 하나도 없는 응답은 형식 오류로 던진다(전부 미분류 기록 방지)', () => {
    const text = '{"results":[{"id":1,"category":"업무"}]}';
    expect(() => parseClassifyBatchJson(text, [101, 102])).toThrow();
  });

  it('요청한 id 순서대로 결과를 돌려주고, 누락·허용 밖 값은 null', () => {
    const text = '{"results":[{"id":2,"category":"알림"},{"id":1,"category":"업무"},{"id":3,"category":"스팸"}]}';
    expect(parseClassifyBatchJson(text, [1, 2, 3, 4])).toEqual([
      { id: 1, category: '업무' },
      { id: 2, category: '알림' },
      { id: 3, category: null },
      { id: 4, category: null },
    ]);
  });
  it('요청하지 않은 id 는 버린다', () => {
    const text = '{"results":[{"id":1,"category":"업무"},{"id":99,"category":"개인"}]}';
    expect(parseClassifyBatchJson(text, [1])).toEqual([{ id: 1, category: '업무' }]);
  });
  it('코드펜스·앞뒤 설명이 있어도 파싱', () => {
    const text = '결과입니다\n```json\n{"results":[{"id":5,"category":" 뉴스레터 "}]}\n```';
    expect(parseClassifyBatchJson(text, [5])).toEqual([{ id: 5, category: '뉴스레터' }]);
  });
  it('숫자 문자열 id("7")도 숫자 id 로 받아들인다', () => {
    const text = '{"results":[{"id":"7","category":"업무"}]}';
    expect(parseClassifyBatchJson(text, [7])).toEqual([{ id: 7, category: '업무' }]);
  });
  it('results 배열이 없으면 예외', () => {
    expect(() => parseClassifyBatchJson('{"foo":1}', [1])).toThrow();
  });
});

describe('parseComposeDraft', () => {
  it('정상 JSON 의 subject/body', () => {
    expect(parseComposeDraft('{"subject":"제목","body":"안녕하세요,\\n\\n본문"}', true)).toEqual({
      subject: '제목',
      body: '안녕하세요,\n\n본문',
    });
  });
  it('wantSubject=false 면 subject 는 null', () => {
    expect(parseComposeDraft('{"subject":"제목","body":"본문"}', false)).toEqual({ subject: null, body: '본문' });
  });
  it('코드펜스로 감싼 JSON', () => {
    expect(parseComposeDraft('```json\n{"subject":"s","body":"b"}\n```', true)).toEqual({ subject: 's', body: 'b' });
  });
  it('본문 안 이스케이프 안 된 큰따옴표(subject 앞)', () => {
    expect(parseComposeDraft('{"subject":"제목","body":"그가 "안녕" 했다"}', true)).toEqual({
      subject: '제목',
      body: '그가 "안녕" 했다',
    });
  });
  it('본문 안 큰따옴표 + body 가 subject 앞이고 이스케이프(\\n) 포함', () => {
    expect(parseComposeDraft('{"body":"가 "나"\\n다","subject":"s"}', true)).toEqual({ subject: 's', body: '가 "나"\n다' });
  });
  it('JSON 뒤 군더더기 텍스트', () => {
    expect(parseComposeDraft('{"subject":"s","body":"b"}\n\n위 초안입니다.', true)).toEqual({ subject: 's', body: 'b' });
  });
  it('본문이 비면 던진다', () => {
    expect(() => parseComposeDraft('{"subject":"s","body":"  "}', true)).toThrow();
    expect(() => parseComposeDraft('{"foo":"bar"}', true)).toThrow();
    expect(() => parseComposeDraft('   ', true)).toThrow();
  });
  it('평문이면 코드펜스를 걷은 전체가 본문', () => {
    expect(parseComposeDraft('```\n안녕하세요.\n감사합니다.\n```', true)).toEqual({
      subject: null,
      body: '안녕하세요.\n감사합니다.',
    });
  });
  it('잘려서 본문을 못 꺼내면 던진다', () => {
    expect(() => parseComposeDraft('{"subject":"제목","body":"끝이 잘린', true)).toThrow();
  });
});
