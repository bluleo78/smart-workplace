import { AxiosError, type AxiosResponse } from 'axios';

/** 서버 오류(5xx) — 일시 오류라 안내·재시도 대상. 상태 코드만 바꿔 영구 4xx 도 만든다. */
export function httpError(status: number) {
  return new AxiosError('x', status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST', undefined, null, { status } as AxiosResponse);
}
