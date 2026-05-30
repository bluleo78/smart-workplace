import axios from 'axios';

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

// access token 만료 시 cookie 기반 refresh 로 새 토큰을 받아 메모리에 저장한다.
// axios 인터셉터(아래)와 동일한 endpoint/응답 필드를 쓰되, raw fetch SSE 처럼 인터셉터를 안 타는
// 호출부에서 재사용할 수 있도록 별도 함수로 노출한다. 성공 여부만 boolean 으로 반환 — 리다이렉트는
// 호출부(또는 다음 axios 401)가 처리.
export async function refreshAccessToken(): Promise<boolean> {
  try {
    // client 인스턴스가 아니라 bare axios — 응답 인터셉터 재진입을 피한다.
    const { data } = await axios.post('/api/v1/auth/refresh', null, {
      withCredentials: true,
    });
    setAccessToken(data.accessToken);
    return true;
  } catch {
    setAccessToken(null);
    return false;
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
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return client(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post('/api/v1/auth/refresh', null, {
          withCredentials: true,
        });
        const newAccessToken = data.accessToken;

        setAccessToken(newAccessToken);

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        processQueue(null, newAccessToken);

        return client(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        setAccessToken(null);
        localStorage.removeItem('hasSession');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
