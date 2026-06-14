import axios from 'axios'

// 운영자 콘솔 API 클라이언트.
// - baseURL `/api/platform` (web 의 `/api/v1` 와 분리)
// - access token 은 메모리 보관(XSS 노출 최소화), refresh 토큰은 HttpOnly 쿠키
// - 401 응답 시 1회 refresh 후 원요청 재시도. 실패 시 세션 정리 + /login 이동

let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export const client = axios.create({
  baseURL: '/api/platform',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
})

client.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

let isRefreshing = false
let failedQueue: Array<{
  resolve: (token: string) => void
  reject: (error: unknown) => void
}> = []

const MAX_QUEUE_SIZE = 100

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error)
    } else {
      prom.resolve(token!)
    }
  })
  failedQueue = []
}

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    if (error.response?.status === 401 && !originalRequest._retry) {
      // /auth/login 또는 /auth/refresh 요청의 401은 토큰 갱신 시도 없이 그대로 reject
      // — 로그인 실패 시 무한 refresh 루프와 강제 리다이렉트를 방지.
      const url = originalRequest.url ?? ''
      if (url.includes('/auth/login') || url.includes('/auth/refresh')) {
        return Promise.reject(error)
      }

      if (isRefreshing) {
        if (failedQueue.length >= MAX_QUEUE_SIZE) {
          return Promise.reject(new Error('Too many queued requests'))
        }
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`
          return client(originalRequest)
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        // bare axios — 응답 인터셉터 재진입을 피한다.
        const { data } = await axios.post('/api/platform/auth/refresh', null, {
          withCredentials: true,
        })
        const newAccessToken = data.accessToken

        setAccessToken(newAccessToken)

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`
        processQueue(null, newAccessToken)

        return client(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        setAccessToken(null)
        localStorage.removeItem('hasSession')
        window.location.href = '/login'
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    return Promise.reject(error)
  },
)
