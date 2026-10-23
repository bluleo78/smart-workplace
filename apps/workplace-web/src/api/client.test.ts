// @vitest-environment jsdom
// api/client 의 테넌트 변경 리로드 대기(tenantReloadPending) 단위 테스트 — WP-341 후속 리뷰 R1.
// 테넌트 변경을 감지해 리로드를 시작한 뒤에는, 무토큰 401·refresh 경로가 다시 /auth/refresh 를 부르거나 토큰을 설치하면 안 된다
// (다른 탭이 공유 localStorage 를 이미 새 테넌트로 바꿔 두면 "변화 없음" 으로 오판해 새 테넌트 토큰으로 이전 화면 요청을 재시도한다).
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 서명 없는 테스트용 JWT — 웹은 tenant 클레임만 판독한다. */
function jwt(payload: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`;
}

const ACME = { tenantId: 10, tenantName: 'Acme', tenantSlug: 'acme' };
const GLOBEX = { tenantId: 20, tenantName: 'Globex', tenantSlug: 'globex' };

/** 약속이 짧은 시간 안에 끝나는지 — 리로드 대기 중 요청은 resolve 도 reject 도 하지 않아야 한다(에러 UI 방지). */
async function settleState(p: Promise<unknown>): Promise<'resolved' | 'rejected' | 'pending'> {
  return Promise.race([
    p.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    ),
    new Promise<'pending'>((r) => setTimeout(() => r('pending'), 30)),
  ]);
}

/** Map 기반 Storage 대역 — 이 Node 런타임에선 jsdom Web Storage 가 노출되지 않는다(Node 내장 localStorage 실험 기능과 충돌). */
function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

/** 모든 요청에 401 을 돌려주는 어댑터 — 인터셉터의 refresh 경로를 태운다. */
function unauthorizedAdapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const response = { status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config } as AxiosResponse;
  return Promise.reject(new AxiosError('401', 'ERR_BAD_REQUEST', config, null, response));
}

describe('api/client — 테넌트 변경 리로드 대기', () => {
  const assign = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    // 모듈 수준 플래그를 테스트마다 새로 — 모듈을 다시 읽는다.
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    assign.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, value: { assign, href: '/' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('refreshAccessTokenOutcome: 변경 감지 후엔 다른 탭이 보관값을 새 테넌트로 바꿔도 refresh·토큰 설치 없이 끝난다', async () => {
    const { refreshAccessTokenOutcome, setAccessToken, getAccessToken } = await import('./client');
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: jwt({ tenant: 20 }) } });
    localStorage.setItem('activeTenant', JSON.stringify(ACME));
    setAccessToken(jwt({ tenant: 10 }));

    expect(await refreshAccessTokenOutcome()).toBe('error');
    expect(assign).toHaveBeenCalledWith('/');
    expect(getAccessToken()).toBeNull();
    // 리로드 후 한 번 보여 줄 안내 표시.
    expect(sessionStorage.getItem('tenantChanged')).not.toBeNull();

    // 다른 탭이 공유 보관값을 Globex 로 기록 — 플래그가 없으면 직전 토큰 null → 보관값 기준 "변화 없음" 으로 설치됐을 상황.
    localStorage.setItem('activeTenant', JSON.stringify(GLOBEX));
    expect(await refreshAccessTokenOutcome()).toBe('error');
    expect(post).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it('tenant-less 로 바뀌어도 리로드 안내 표시를 남긴다', async () => {
    const { refreshAccessTokenOutcome, setAccessToken } = await import('./client');
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: jwt({}) } });
    setAccessToken(jwt({ tenant: 10 }));

    expect(await refreshAccessTokenOutcome()).toBe('error');
    expect(sessionStorage.getItem('tenantChanged')).not.toBeNull();
  });

  it('인터셉터: 변경 감지 시 원래 요청은 끝나지 않고(에러 UI 없음), 이후 요청은 나가지도 refresh 하지도 않는다', async () => {
    const { client, setAccessToken, getAccessToken } = await import('./client');
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: jwt({ tenant: 20 }) } });
    const adapter = vi.fn(unauthorizedAdapter);
    client.defaults.adapter = adapter;
    localStorage.setItem('activeTenant', JSON.stringify(ACME));
    setAccessToken(jwt({ tenant: 10 }));

    // 첫 401 → refresh 가 다른 테넌트 토큰 → 재시도 없이 리로드 시작, 원래 요청은 settle 하지 않는다.
    expect(await settleState(client.get('/me/issues'))).toBe('pending');
    expect(post).toHaveBeenCalledTimes(1);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/');
    expect(getAccessToken()).toBeNull();

    // 다른 탭이 보관값을 Globex 로 바꾼 뒤의 요청 — 보내지도, refresh 하지도, 토큰을 설치하지도, settle 하지도 않는다.
    localStorage.setItem('activeTenant', JSON.stringify(GLOBEX));
    expect(await settleState(client.get('/me/issues'))).toBe('pending');
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
  });

  it('리로드 대기 중 이미 진행 중이던 요청이 401 을 받아도 refresh 하지 않고 끝나지 않는다', async () => {
    const { client, refreshAccessTokenOutcome, setAccessToken } = await import('./client');
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: jwt({ tenant: 20 }) } });
    // 요청이 어댑터에 들어간 뒤(요청 인터셉터 통과 후) 리로드가 시작되는 경합을 흉내 낸다.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    client.defaults.adapter = async (config) => {
      await gate;
      return unauthorizedAdapter(config);
    };
    localStorage.setItem('activeTenant', JSON.stringify(ACME));
    setAccessToken(jwt({ tenant: 10 }));

    const inFlight = client.get('/me/issues');
    // 다른 경로(SSE)가 먼저 테넌트 변경을 감지해 리로드 시작.
    expect(await refreshAccessTokenOutcome()).toBe('error');
    expect(post).toHaveBeenCalledTimes(1);
    release();

    expect(await settleState(inFlight)).toBe('pending');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('인터셉터: 같은 테넌트로 갱신되면 새 토큰으로 원래 요청을 재시도한다(단일 refresh 경로)', async () => {
    const { client, setAccessToken, getAccessToken } = await import('./client');
    const fresh = jwt({ tenant: 10, n: 2 });
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: fresh } });
    const seen: Array<string | undefined> = [];
    client.defaults.adapter = async (config) => {
      const auth = config.headers.Authorization as string | undefined;
      seen.push(auth);
      if (auth === `Bearer ${fresh}`) {
        return { status: 200, statusText: 'OK', data: { ok: true }, headers: {}, config } as AxiosResponse;
      }
      return unauthorizedAdapter(config);
    };
    setAccessToken(jwt({ tenant: 10 }));

    const res = await client.get('/me/issues');
    expect(res.data).toEqual({ ok: true });
    expect(seen).toHaveLength(2);
    expect(getAccessToken()).toBe(fresh);
    expect(assign).not.toHaveBeenCalled();
  });

  it('인터셉터: refresh 가 거절(401)되면 세션 플래그를 지우고 로그인으로 보낸다', async () => {
    const { client, setAccessToken } = await import('./client');
    vi.spyOn(axios, 'post').mockRejectedValue(
      new AxiosError('401', 'ERR_BAD_REQUEST', undefined, null, { status: 401 } as AxiosResponse),
    );
    client.defaults.adapter = unauthorizedAdapter;
    localStorage.setItem('hasSession', 'true');
    setAccessToken(jwt({ tenant: 10 }));

    expect(await settleState(client.get('/me/issues'))).toBe('rejected');
    expect(localStorage.getItem('hasSession')).toBeNull();
    expect(window.location.href).toBe('/login');
  });

  // WP-859: 배포 중 502·서버 500·네트워크 끊김은 refresh 쿠키가 살아 있을 수 있다 — 세션을 지우거나 로그인으로 보내지 않고 이 요청만 실패한다.
  it.each([
    ['502 응답', new AxiosError('502', 'ERR_BAD_RESPONSE', undefined, null, { status: 502 } as AxiosResponse)],
    ['네트워크 오류(응답 없음)', new AxiosError('Network Error', 'ERR_NETWORK')],
  ])('인터셉터: refresh 가 일시 실패(%s)면 세션을 남기고 요청만 실패한다', async (_label, refreshError) => {
    const { client, setAccessToken } = await import('./client');
    vi.spyOn(axios, 'post').mockRejectedValue(refreshError);
    client.defaults.adapter = unauthorizedAdapter;
    localStorage.setItem('hasSession', 'true');
    setAccessToken(jwt({ tenant: 10 }));

    // 원래 401 이 아니라 refresh 의 오류로 실패한다 — 호출부가 만료(401)로 오판하지 않게.
    const err = await client.get('/me/issues').catch((e: unknown) => e);
    expect(err).toBe(refreshError);
    expect(localStorage.getItem('hasSession')).toBe('true');
    expect(window.location.href).toBe('/');
  });
});
