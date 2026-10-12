import { describe, expect, it } from 'vitest';
import { TOOL_APPS } from '@smart-workplace/mcp-tools-shared';

import { InvalidScopeError, parseApps, resolveScope } from './scope.js';

describe('parseApps', () => {
  it('쉼표 목록을 앱 배열로 — 공백·대소문자 무시, 중복 제거', () => {
    expect(parseApps(' Issue, wiki ,issue', '경로')).toEqual(['issue', 'wiki']);
  });

  it('모르는 앱이 하나라도 있으면 전부 거절하고 사용 가능한 목록을 알린다', () => {
    try {
      parseApps('issue,foo', '경로');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidScopeError);
      expect((e as InvalidScopeError).message).toContain("'foo'");
      expect((e as InvalidScopeError).message).toContain(TOOL_APPS.join(', '));
      expect((e as InvalidScopeError).available).toEqual(TOOL_APPS);
    }
  });

  it('빈 목록은 거절', () => {
    expect(() => parseApps(' , ', '경로')).toThrow(InvalidScopeError);
  });
});

describe('resolveScope — 우선순위: 경로 > 헤더 > 전체', () => {
  it('경로·헤더가 모두 없으면 전체', () => {
    expect(resolveScope({ readOnly: false }, undefined)).toEqual({ apps: null, readOnly: false });
  });

  it('헤더만 있으면 헤더가 앱 선택(경로 /readonly 와 함께 쓰면 읽기 전용도 적용)', () => {
    expect(resolveScope({ readOnly: false }, 'issue,wiki')).toEqual({ apps: ['issue', 'wiki'], readOnly: false });
    expect(resolveScope({ readOnly: true }, 'mail')).toEqual({ apps: ['mail'], readOnly: true });
  });

  it('경로에 앱 선택이 있으면 헤더는 무시한다(합치지 않는다)', () => {
    expect(resolveScope({ pathApps: 'drive', readOnly: false }, 'issue')).toEqual({ apps: ['drive'], readOnly: false });
  });

  it('빈 헤더는 없는 것으로 본다', () => {
    expect(resolveScope({ readOnly: false }, '  ')).toEqual({ apps: null, readOnly: false });
  });

  it('헤더의 앱 이름도 검증한다', () => {
    expect(() => resolveScope({ readOnly: false }, 'nope')).toThrow(InvalidScopeError);
  });
});
