// Anthropic 워크스페이스 ID 입력 규칙(WP-1496) — 형식 검사·요청 조각·서버 거절 문구 추출.
import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, test } from 'vitest';

import { WORKSPACE_ID_MAX, workspaceIdError, workspaceIdErrorFromApi, workspaceIdPart } from './anthropicWorkspaceId';

/** 본문이 data 인 400 Axios 오류. */
function axios400(data: unknown): AxiosError {
  const response = { status: 400, data } as AxiosResponse;
  return new AxiosError('Bad Request', 'ERR_BAD_REQUEST', undefined, undefined, response);
}

describe('workspaceIdError', () => {
  test('빈 값·정상 ID 는 오류가 아니다', () => {
    expect(workspaceIdError('')).toBeNull();
    expect(workspaceIdError('wrkspc_01AbC')).toBeNull();
    expect(workspaceIdError('a'.repeat(WORKSPACE_ID_MAX))).toBeNull();
  });

  test('공백·탭·줄바꿈·제어 문자가 섞이면 오류', () => {
    expect(workspaceIdError('wrkspc 01')).toMatch(/공백/);
    expect(workspaceIdError('wrkspc\t01')).toMatch(/공백/);
    expect(workspaceIdError('wrkspc\n01')).toMatch(/공백/);
    expect(workspaceIdError('wrkspc\u000001')).toMatch(/공백/);
  });

  test('보이는 ASCII 가 아닌 문자(전각 문자·U+200D 등)가 섞이면 오류 — 서버·ai-agent 와 같은 규칙', () => {
    expect(workspaceIdError('wrkspc_\uFF21')).toMatch(/영문·숫자·기호/);
    expect(workspaceIdError('wrkspc_a\u200Db')).toMatch(/영문·숫자·기호/);
    expect(workspaceIdError('wrkspc_한글')).toMatch(/영문·숫자·기호/);
  });

  test('128자를 넘으면 오류', () => {
    expect(workspaceIdError('a'.repeat(WORKSPACE_ID_MAX + 1))).toMatch(/128자/);
  });
});

describe('workspaceIdPart', () => {
  test('비었으면 키를 싣지 않고, 있으면 그대로 싣는다', () => {
    expect(workspaceIdPart('')).toEqual({});
    expect(workspaceIdPart('wrkspc_01')).toEqual({ workspaceId: 'wrkspc_01' });
  });
});

describe('workspaceIdErrorFromApi', () => {
  test('errors.workspaceId 가 있으면 그 문구', () => {
    const e = axios400({ status: 400, message: '잘못된 요청', errors: { workspaceId: '이 키는 Anthropic 워크스페이스 ID 가 필요합니다' } });
    expect(workspaceIdErrorFromApi(e)).toBe('이 키는 Anthropic 워크스페이스 ID 가 필요합니다');
  });

  test('다른 필드 오류·Axios 가 아닌 오류는 null', () => {
    expect(workspaceIdErrorFromApi(axios400({ status: 400, message: 'x', errors: { token: '토큰이 거절됐습니다' } }))).toBeNull();
    expect(workspaceIdErrorFromApi(axios400({ status: 400, message: 'x' }))).toBeNull();
    expect(workspaceIdErrorFromApi(new Error('boom'))).toBeNull();
  });
});
