import { describe, it, expect } from 'vitest';
import {
  extractJsonObject,
  parseClassifyBatchJson,
  parseComposeDraft,
  parseContentAnalysisJson,
  parseDraftCoachingJson,
  parseIssueDraftJson,
  parseLearnCategoryJson,
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
      personalCategory: null,
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
    ).toEqual({ needsReply: null, personalSummary: '• 핵심', personalSummaryValid: true, category: null, personalCategory: null });
  });
  // WP-1341: 개인 분류 — 요청했을 때만 읽고, 근접어도 분류로 맞춘다.
  it('personalCategory 를 요청하면 근접어를 분류로 맞춰 돌려준다', () => {
    const flags = { includeNeedsReply: true, includePersonalSummary: false, includeCategory: false, includePersonalCategory: true };
    expect(parsePersonalAnalysisJson('{"needsReply":false,"personalCategory":"광고"}', flags).personalCategory).toBe('프로모션');
    expect(parsePersonalAnalysisJson('{"needsReply":false,"personalCategory":"기타"}', flags).personalCategory).toBeNull();
  });
  it('personalCategory 를 요청하지 않으면 응답에 있어도 null', () => {
    expect(parsePersonalAnalysisJson('{"needsReply":false,"personalCategory":"업무"}', all).personalCategory).toBeNull();
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

// WP-1340: 모델이 5종 밖 이름(근접어)을 내도 버리지 않고 가까운 분류로 맞춘다 — 소문자·trim 후 정확히 일치할 때만.
describe('분류 근접어 (WP-1340)', () => {
  it.each([
    ['광고', '프로모션'],
    [' 홍보 ', '프로모션'],
    ['마케팅', '프로모션'],
    ['할인', '프로모션'],
    ['이벤트', '프로모션'],
    ['구독', '뉴스레터'],
    ['소식지', '뉴스레터'],
    ['뉴스', '뉴스레터'],
    ['Newsletter', '뉴스레터'],
    ['시스템', '알림'],
    ['거래', '알림'],
    ['영수증', '알림'],
    ['일', '업무'],
    ['협업', '업무'],
    ['지인', '개인'],
    ['업무', '업무'],
  ])('%s → %s (classify-batch·③ 공통)', (raw, expected) => {
    expect(parseClassifyBatchJson(`{"results":[{"id":1,"category":${JSON.stringify(raw)}}]}`, [1])).toEqual([
      { id: 1, category: expected },
    ]);
    expect(
      parseContentAnalysisJson(`{"category":${JSON.stringify(raw)}}`, { includeCategory: true, includeSummary: false }).category,
    ).toBe(expected);
  });

  it.each(['기타', '광고 메일', '업무용'])('맞출 수 없는 값(%s)은 null — 부분 일치는 하지 않는다', (raw) => {
    expect(parseClassifyBatchJson(`{"results":[{"id":1,"category":${JSON.stringify(raw)}}]}`, [1])).toEqual([
      { id: 1, category: null },
    ]);
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

// WP-1341: 분류 교정 학습 응답 — 화이트리스트·id·길이를 어기면 throw(→ 502, API 는 NONE 으로 응답).
describe('parseLearnCategoryJson', () => {
  it('CREATE — memoryId 는 null', () => {
    expect(
      parseLearnCategoryJson('{"action":"CREATE","content":"원티드(wantedlab.com) 채용 소식 메일은 업무가 아니라 프로모션으로 분류"}', []),
    ).toEqual({ action: 'CREATE', memoryId: null, content: '원티드(wantedlab.com) 채용 소식 메일은 업무가 아니라 프로모션으로 분류' });
  });
  it('UPDATE — 요청한 기억 id 면 그 id', () => {
    expect(parseLearnCategoryJson('{"action":"UPDATE","memoryId":7,"content":"원티드 메일은 프로모션으로 분류"}', [7])).toEqual({
      action: 'UPDATE',
      memoryId: 7,
      content: '원티드 메일은 프로모션으로 분류',
    });
  });
  it('UPDATE — 숫자 문자열 id 도 받는다', () => {
    expect(parseLearnCategoryJson('{"action":"UPDATE","memoryId":"7","content":"x 는 업무로 분류"}', [7]).memoryId).toBe(7);
  });
  it('UPDATE 의 id 가 요청 목록에 없으면 throw', () => {
    expect(() => parseLearnCategoryJson('{"action":"UPDATE","memoryId":7,"content":"x 는 업무로 분류"}', [3])).toThrow();
  });
  it('NONE — content 는 null', () => {
    expect(parseLearnCategoryJson('{"action":"NONE"}', [7])).toEqual({ action: 'NONE', memoryId: null, content: null });
  });
  it('content 가 120자를 넘으면 throw, 120자는 통과', () => {
    expect(() => parseLearnCategoryJson(JSON.stringify({ action: 'CREATE', content: '가'.repeat(121) }), [])).toThrow();
    expect(parseLearnCategoryJson(JSON.stringify({ action: 'CREATE', content: '가'.repeat(120) }), []).content).toHaveLength(120);
  });
  it('content 가 비었거나 공백이면 throw', () => {
    expect(() => parseLearnCategoryJson('{"action":"CREATE","content":"  "}', [])).toThrow();
    expect(() => parseLearnCategoryJson('{"action":"CREATE"}', [])).toThrow();
  });
  it('action 이 화이트리스트 밖이면 throw', () => {
    expect(() => parseLearnCategoryJson('{"action":"DELETE","memoryId":7}', [7])).toThrow();
  });
});
