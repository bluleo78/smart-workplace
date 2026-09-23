import { describe, expect, it } from 'vitest';
import { parseIssueKey, errText, describeApiError } from './parse.js';

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
  it('응답 본문(객체)은 ErrorResponse 요약(#840)', () => {
    expect(errText({ response: { status: 409, data: { message: 'x' } } })).toBe('API 오류 409: x');
  });
  it('응답 없으면 message', () => {
    expect(errText({ message: 'boom' })).toBe('boom');
  });
});

// #840: 서버 ErrorResponse 를 LLM 이 읽을 한 줄로 요약.
describe('describeApiError', () => {
  it('message 와 필드 오류(errors 맵)를 함께 붙인다', () => {
    expect(describeApiError(400, { message: '위임 후보가 아닙니다', errors: { projectKey: '후보 밖' } })).toBe(
      'API 오류 400: 위임 후보가 아닙니다 — projectKey: 후보 밖',
    );
  });
  it('HTML 등 문자열 본문은 300자로 자른다', () => {
    expect(describeApiError(502, '<html>' + 'x'.repeat(400))).toHaveLength('API 오류 502: '.length + 300);
  });
  it('본문이 없거나 해석 불가하면 상태코드만', () => {
    expect(describeApiError(404, undefined)).toBe('API 오류 404');
    expect(describeApiError(500, Buffer.from(''))).toBe('API 오류 500');
  });
});
