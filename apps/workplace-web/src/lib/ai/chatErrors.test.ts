import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';

import { chatStartRejection } from './chatErrors';

const httpError = (status: number) =>
  new AxiosError('rejected', String(status), undefined, undefined, { status } as AxiosResponse);

describe('chatStartRejection', () => {
  it('409 는 같은 대화 생성 중(busy)', () => {
    expect(chatStartRejection(httpError(409))).toBe('busy');
  });
  it('429 는 동시 생성 상한(limit)', () => {
    expect(chatStartRejection(httpError(429))).toBe('limit');
  });
  it('그 외 HTTP 오류·비 axios 오류는 null(일반 오류)', () => {
    expect(chatStartRejection(httpError(500))).toBeNull();
    expect(chatStartRejection(new Error('network'))).toBeNull();
  });
});
