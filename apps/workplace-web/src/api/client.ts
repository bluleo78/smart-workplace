import axios from 'axios';

import { markTenantChanged, readActiveTenant, tenantChangedSince } from '@/lib/activeTenant';
import { isPermanentClientStatus } from '@/lib/api-error';

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * 테넌트 변경을 감지해 전체 리로드를 시작했는가. 한 번 서면 언로드까지 내려가지 않는다.
 * 리로드 전에 나가는 요청은 메모리 토큰이 비어 401 을 받는데, 그때 다시 refresh 하면 직전 토큰이 없어 판정 기준이 공유
 * localStorage 로 떨어진다 — 다른 탭이 이미 새 테넌트를 기록해 뒀다면 "변화 없음" 으로 판정돼 새 테넌트 토큰을 설치하고 이전
 * 화면의 요청을 새 테넌트로 재시도하게 된다. 그래서 이 플래그가 서 있으면 요청·401·refresh 경로 모두 refresh 없이 멈춘다.
 */
let tenantReloadPending = false;

/**
 * 리로드 대기 중 요청에 돌려주는 "끝나지 않는" 약속. reject 하면 리로드 직전 뮤테이션·쿼리 onError 가 에러 토스트를 띄우므로
 * (곧 사라질 화면에 잘못된 실패 안내), 대신 결과를 영원히 미뤄 아무 UI 도 반응하지 않게 한다 — 언로드가 정리한다.
 */
function pendingForever<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/**
 * WP-341 후속: refresh 결과 토큰의 테넌트가 이 탭이 쓰던 테넌트(직전 메모리 토큰 기준, 없으면 보관된 활성 테넌트)와 다르면
 * (쓰던 테넌트가 정지·삭제돼 서버가 다른 테넌트 또는 tenant-less 로 다시 골랐을 때) 새 토큰을 설치하지 않고 메모리 토큰을 비운 뒤
 * 1회성 안내를 남기고 루트로 전체 리로드하고 true 를 돌려준다. 새 토큰을 설치하지 않는 이유: location.assign 은 즉시 실행을 멈추지
 * 않으므로, 언로드 전 동시 요청·재시도·뮤테이션이 이전 테넌트 화면에서 새 테넌트로 나가는 창을 없앤다. 전체 리로드는 select-tenant 와
 * 같은 정리 방식 — 이전 테넌트의 React Query 캐시·SSE·화면 상태를 남기지 않고, 리로드 후 AuthProvider 초기화가 refresh 쿠키로 새
 * 토큰을 다시 받아 활성 테넌트를 맞추거나(대체 테넌트) 선택 화면을 띄운다(tenant-less).
 */
function reloadIfTenantChanged(newAccessToken: string, previousToken: string | null): boolean {
  if (!tenantChangedSince(newAccessToken, previousToken, readActiveTenant())) return false;
  tenantReloadPending = true;
  setAccessToken(null);
  markTenantChanged();
  window.location.assign('/');
  return true;
}

// access token 만료 시 cookie 기반 refresh 로 새 토큰을 받아 메모리에 저장한다.
// axios 인터셉터(아래)와 동일한 단일 경로(refreshOnce)를 쓰고, raw fetch SSE 처럼 인터셉터를 안 타는
// 호출부에서도 재사용할 수 있도록 노출한다. 성공 여부만 boolean 으로 반환 — 리다이렉트는 호출부(또는 다음 axios 401)가 처리.
export async function refreshAccessToken(): Promise<boolean> {
  return (await refreshAccessTokenOutcome()) === 'ok';
}

/**
 * 갱신 결과를 세 갈래로 — 'ok' 성공, 'rejected' 서버가 갱신을 거절(4xx: 로그아웃으로 쿠키 없음·만료·정지 등 — 다시 시도해도
 * 같다. 요청 시간 초과 408·요청 과다 429 는 제외), 'error' 네트워크·5xx·408·429 같은 일시 실패. 일시 실패와 로그인 상실을 갈라야 하는 호출부(노트 동시 편집 재접속)가 쓴다.
 * 실패면 어느 쪽이든 메모리 토큰을 비운다. 테넌트 변경(리로드 시작)·리로드 대기 중이면 토큰 설치 없이 'error'.
 */
export async function refreshAccessTokenOutcome(): Promise<'ok' | 'rejected' | 'error'> {
  return (await refreshOnce()).outcome;
}

/** refreshOnce 결과 — 성공이면 설치한 새 토큰을 함께 돌려준다(인터셉터가 모듈 상태를 다시 읽지 않도록). */
type RefreshResult = { outcome: 'ok'; token: string } | { outcome: 'rejected' | 'error' };

/**
 * refresh 의 유일한 구현: 직전 토큰 포착·리로드 대기 검사·테넌트 변경 판정·토큰 설치가 여기 한곳에 있다.
 * 인터셉터와 refreshAccessTokenOutcome(SSE·동시 편집) 둘 다 이 함수를 쓴다. 리로드 대기 여부는 호출부가 tenantReloadPending 으로 구분한다.
 */
async function refreshOnce(): Promise<RefreshResult> {
  // 테넌트 변경으로 리로드가 이미 시작됐으면 refresh·토큰 설치 없이 끝낸다.
  if (tenantReloadPending) return { outcome: 'error' };
  // 이 탭이 쓰던 테넌트 판정 기준 — refresh 가 메모리 토큰을 바꾸기 전에 잡아 둔다.
  const previousToken = accessToken;
  try {
    // client 인스턴스가 아니라 bare axios — 응답 인터셉터 재진입을 피한다.
    const { data } = await axios.post('/api/v1/auth/refresh', null, {
      withCredentials: true,
    });
    // 테넌트가 바뀌었으면(쓰던 테넌트 정지·삭제) 새 토큰을 설치하지 않고 전체 리로드한다. refresh 를 기다리는 사이 다른 경로가
    // 리로드를 시작했어도 토큰을 설치하지 않는다.
    if (tenantReloadPending || reloadIfTenantChanged(data.accessToken, previousToken)) return { outcome: 'error' };
    setAccessToken(data.accessToken);
    return { outcome: 'ok', token: data.accessToken };
  } catch (e) {
    setAccessToken(null);
    return {
      outcome: isPermanentClientStatus(axios.isAxiosError(e) ? e.response?.status : undefined) ? 'rejected' : 'error',
    };
  }
}

export const client = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

client.interceptors.request.use((config) => {
  // 테넌트 변경 리로드 대기 중 — 이전 화면의 요청을 내보내지 않고 결과도 미룬다(에러 UI 없음, 무토큰 401 → refresh 연쇄도 막힘).
  if (tenantReloadPending) return pendingForever<typeof config>();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const MAX_QUEUE_SIZE = 100;

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      // 테넌트 변경 리로드 대기 중이면 refresh 를 다시 하지 않고 결과를 미룬다(새 토큰 설치·재시도·에러 UI 없음).
      if (tenantReloadPending) return pendingForever();
      // /auth/login 또는 /auth/refresh 요청의 401은 토큰 갱신 시도 없이 그대로 reject
      // — 로그인 시도 실패 시 무한 refresh 루프와 강제 리다이렉트를 방지하기 위함
      const url = originalRequest.url ?? '';
      if (url.includes('/auth/login') || url.includes('/auth/refresh')) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        if (failedQueue.length >= MAX_QUEUE_SIZE) {
          return Promise.reject(new Error('Too many queued requests'));
        }
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          // 대기 중 다른 경로가 테넌트 변경 리로드를 시작했으면 재시도하지 않는다.
          if (tenantReloadPending) return pendingForever();
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return client(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;
      try {
        const result = await refreshOnce();
        if (tenantReloadPending) {
          // 테넌트가 바뀌어 리로드 중 — 원래 요청·대기 요청을 새 테넌트로 재시도하지 않는다(이전 화면에서 시작한 쓰기가 다른
          // 워크스페이스에 반영되거나 다른 테넌트 데이터가 이전 화면 캐시에 섞이지 않게). 대기 요청도 settle 하지 않고 버린다.
          failedQueue = [];
          return pendingForever();
        }
        if (result.outcome === 'ok') {
          originalRequest.headers.Authorization = `Bearer ${result.token}`;
          processQueue(null, result.token);
          return client(originalRequest);
        }
        // 갱신 실패(거절·일시 실패 모두) — 기존처럼 세션을 정리하고 로그인으로.
        processQueue(error, null);
        localStorage.removeItem('hasSession');
        window.location.href = '/login';
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
