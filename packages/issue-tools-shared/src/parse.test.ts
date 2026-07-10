import { describe, expect, it } from 'vitest';
import { parseIssueKey, errText } from './parse.js';

describe('parseIssueKey', () => {
  it('WP-12 → {projectKey:"WP", number:12}', () => {
    expect(parseIssueKey('WP-12')).toEqual({ projectKey: 'WP', number: 12 });
  });
  it('프로젝트 키에 하이픈이 있어도 마지막 -숫자 로 분리', () => {
    expect(parseIssueKey('MY-PROJ-7')).toEqual({ projectKey: 'MY-PROJ', number: 7 });
  });
  it('형식이 틀리면 throw (하이픈 없음)', () => {
    expect(() => parseIssueKey('WP12')).toThrow('issueKey 형식이 올바르지 않습니다: WP12');
  });
  it('형식이 틀리면 throw (숫자 아님)', () => {
    expect(() => parseIssueKey('WP-x')).toThrow('issueKey 형식이 올바르지 않습니다: WP-x');
  });
});

describe('errText', () => {
  it('axios 응답 본문(문자열) 우선', () => {
    expect(errText({ response: { data: '이슈를 찾을 수 없습니다' } })).toBe('이슈를 찾을 수 없습니다');
  });
  it('응답 본문(객체)은 JSON 화', () => {
    expect(errText({ response: { data: { message: 'x' } } })).toBe('{"message":"x"}');
  });
  it('응답 없으면 message', () => {
    expect(errText({ message: 'boom' })).toBe('boom');
  });
});
