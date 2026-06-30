import type { IncomingMessage } from 'node:http'
import net from 'node:net'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

// 개발 프록시 대상(workplace-api).
const API_HOST = 'localhost'
const API_PORT = 9090
const API_TARGET = `http://${API_HOST}:${API_PORT}`

// 콜드스타트 재시도 설정.
// web(vite)은 즉시 뜨지만 API(Spring Boot)는 기동에 ~10초 걸려, 그 사이 브라우저가 쏘는
// /api 요청이 ECONNREFUSED 로 스택과 함께 콘솔을 도배한다. 연결 거부 시 포트가 열릴 때까지
// 조용히 기다렸다가 한 번만 재프록시하고, 타임아웃이면 한 줄 경고 + 503 으로 마무리한다.
const RETRY_PROBE_INTERVAL_MS = 500
// E2E(Playwright)·CI 에서는 백엔드를 띄우지 않고 page.route() 로 /api 를 모킹한다.
// 모킹 누락 요청이 콜드스타트 대기(20초)에 걸리면 테스트가 느려지므로, 이때는 즉시 503 으로 빠르게 실패시킨다.
const IS_E2E = process.env.E2E === '1' || !!process.env.CI
const RETRY_TIMEOUT_MS = IS_E2E ? 0 : 20000 // API 콜드스타트 구간(~10초)을 여유 있게 덮는다(E2E 제외)

// 요청별 재시도 1회만 수행하기 위한 플래그 확장 타입.
type RetryReq = IncomingMessage & { __proxyRetried?: boolean }

// API 포트가 연결 가능해질 때까지 polling. 타임아웃이면 false.
// proxy.web 재호출을 1회로 제한해 req/res 리스너 누적을 막는다.
function waitForApi(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const probe = () => {
      const socket = net.connect(API_PORT, API_HOST)
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() >= deadline) resolve(false)
        else setTimeout(probe, RETRY_PROBE_INTERVAL_MS)
      })
    }
    probe()
  })
}

// Vite 설정.
// - tailwindcss 플러그인으로 CSS 변환
// - "@/..." → "src/..." 별칭
// - 개발 서버 /api → workplace-api(9090) 프록시
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 6173,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        configure: (proxy) => {
          // SSE 스트리밍 응답 버퍼링 방지
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              res.setHeader('Cache-Control', 'no-cache')
              res.setHeader('Connection', 'keep-alive')
              res.setHeader('X-Accel-Buffering', 'no')
            }
          })

          // Vite 는 configure 직후 자체 error 핸들러(요청마다 전체 스택을 찍는다)를 등록한다.
          // 다음 틱에 그 핸들러를 조용한 재시도 핸들러로 교체한다.
          setTimeout(() => {
            proxy.removeAllListeners('error')
            proxy.on('error', async (err, req, res) => {
              const code = (err as NodeJS.ErrnoException).code
              const isConnError = code === 'ECONNREFUSED' || code === 'ECONNRESET'

              // 웹소켓 업그레이드 등 res 가 Socket 이면 조용히 종료
              if (!('writeHead' in res)) {
                res.destroy()
                return
              }

              // API 기동 전 연결 거부 → 포트가 열릴 때까지 기다렸다가 1회만 재프록시 (응답/로그 없음)
              if (isConnError && !res.headersSent && !(req as RetryReq).__proxyRetried) {
                ;(req as RetryReq).__proxyRetried = true
                const ready = await waitForApi(RETRY_TIMEOUT_MS)
                if (ready && !res.writableEnded) {
                  proxy.web(req, res, { target: API_TARGET })
                  return
                }
                if (!res.headersSent && !res.writableEnded) {
                  // 타임아웃 — 스택 없이 한 줄만 남기고 503 (E2E 는 백엔드 부재가 정상이므로 조용히 처리)
                  if (!IS_E2E) console.warn(`[proxy] API 미응답(재시도 초과): ${req.url}`)
                  res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '1' }).end('API not ready')
                }
                return
              }

              if (res.headersSent || res.writableEnded) return

              if (isConnError) {
                if (!IS_E2E) console.warn(`[proxy] API 미응답: ${req.url}`)
                res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '1' }).end('API not ready')
              } else {
                console.error(`[proxy] ${req.url} ${err.message}`)
                res.writeHead(500, { 'Content-Type': 'text/plain' }).end()
              }
            })
          }, 0)
        },
      },
    },
  },
})
