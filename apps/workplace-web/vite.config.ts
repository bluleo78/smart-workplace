import type { IncomingMessage } from 'node:http'
import net from 'node:net'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { appVersionDefine, versionJsonPlugin } from '../../scripts/vite-app-version.mjs'

// E2E(Playwright)·CI 에서는 백엔드를 띄우지 않고 page.route() 로 /api 를 모킹한다.
const IS_E2E = process.env.E2E === '1' || !!process.env.CI
/**
 * 서비스 이름·소개 — PWA manifest 와 index.html 링크 미리보기 메타(WP-894)가 같은 값을 쓴다.
 * index.html 의 %APP_NAME%·%APP_DESCRIPTION% 은 appMetaPlugin 이 빌드·dev 때 채운다.
 */
const APP_NAME = 'Gen:iA Works'
const APP_DESCRIPTION = '사람과 AI가 함께 일하는 워크플레이스'

/** index.html 의 서비스 이름·소개 자리(%APP_NAME%·%APP_DESCRIPTION%)를 채운다 — manifest 와 문구가 갈리지 않게 한 곳에서 정한다. */
function appMetaPlugin(): Plugin {
  return {
    name: 'app-meta',
    // pre — Vite 의 %ENV% 치환보다 먼저 채워, 환경 변수에 없는 이름이라는 경고가 나지 않게 한다.
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%APP_NAME%', APP_NAME).replaceAll('%APP_DESCRIPTION%', APP_DESCRIPTION),
    },
  }
}

// 릴리스 노트 위치 — Playwright 가 E2E_RELEASE_NOTES_DIR 로 픽스처 폴더를 명시할 때만 바꾼다. IS_E2E 로 고르면
// CI 만 켜져도 참이라 CI 릴리스 빌드가 테스트 픽스처 노트를 번들에 담아 배포한다.
const RELEASE_NOTES_DIR = process.env.E2E_RELEASE_NOTES_DIR || path.resolve(__dirname, '../../releases')

// 개발 프록시 대상(workplace-api).
// E2E 는 모킹 누락 요청이 항상 즉시 503 이 되도록 닫힌 포트(9, discard)로 보낸다 — 6060 으로 보내면
// 병렬 세션이 띄운 실제 API 가 있을 때만 401·토큰 refresh 재시도가 끼어들어 결과가 환경에 따라 달라졌다(WP-82).
const API_HOST = 'localhost'

// 개발 서버 전용 포트 환경변수 — 비었거나 숫자가 아니면 기본값을 쓴다.
// 이름을 VITE_* 로 두지 않는다: VITE_* 는 클라이언트 코드(import.meta.env)에도 노출된다(WP-376).
function devPort(name: string, fallback: number): number {
  const raw = process.env[name]?.trim() ?? ''
  return /^\d+$/.test(raw) ? Number(raw) : fallback
}

// DEV_API_PORT: 격리 라이브 스택(scripts/live-stack.sh)이 다른 포트의 API 에 붙일 때만 준다 — 없으면 기존대로 6060(WP-376).
const API_PORT = IS_E2E ? 9 : devPort('DEV_API_PORT', 6060)
const API_TARGET = `http://${API_HOST}:${API_PORT}`

// 콜드스타트 재시도 설정.
// web(vite)은 즉시 뜨지만 API(Spring Boot)는 기동에 ~10초 걸려, 그 사이 브라우저가 쏘는
// /api 요청이 ECONNREFUSED 로 스택과 함께 콘솔을 도배한다. 연결 거부 시 포트가 열릴 때까지
// 조용히 기다렸다가 한 번만 재프록시하고, 타임아웃이면 한 줄 경고 + 503 으로 마무리한다.
const RETRY_PROBE_INTERVAL_MS = 500
// E2E 에서 모킹 누락 요청이 콜드스타트 대기(20초)에 걸리면 테스트가 느려지므로, 이때는 즉시 503 으로 빠르게 실패시킨다.
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
// - 개발 서버 /api → workplace-api(6060) 프록시
// 노트 동시 편집 동기화 서버(workplace-collab). E2E 는 테스트가 띄운 서버 포트(E2E_COLLAB_PORT)를 쓰고,
// 없으면 /api 와 같은 이유로 닫힌 포트(9)로 보내 즉시 실패시킨다.
// DEV_COLLAB_PORT: 격리 라이브 스택이 9(닫힌 포트)를 줘 다른 세션의 collab(6095)에 붙지 않게 한다 — 없으면 기존대로 6095(WP-376).
const COLLAB_TARGET = `ws://localhost:${IS_E2E ? (process.env.E2E_COLLAB_PORT ?? 9) : devPort('DEV_COLLAB_PORT', 6095)}`

export default defineConfig({
  // 빌드 상수 — E2E 빌드에서만 동기화 문서 이름에 테스트 네임스페이스를 붙인다(collabSession.docNameFor).
  // appVersionDefine 은 릴리스 버전·커밋(Docker 빌드 인자 APP_VERSION·GIT_SHA, 없으면 'dev')에서 계산한 표기 상수다(WP-439).
  define: { __E2E__: JSON.stringify(IS_E2E), ...appVersionDefine() },
  plugins: [
    react(),
    tailwindcss(),
    // 산출물 루트에 version.json({version, commit}) 을 내보낸다(WP-439).
    versionJsonPlugin(),
    appMetaPlugin(),
    // PWA — injectManifest: SW 코드(src/sw.ts)는 직접 작성하고 플러그인은 precache 목록 주입·manifest 생성만 한다.
    // dev SW 는 E2E=1 일 때만 켠다(E2E 가 mock 기반 dev 서버에서 SW 등록·push 를 검증). 일반 개발에선 캐시 혼선 방지로 끈다.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false, // PwaUpdatePrompt 의 useRegisterSW 가 등록한다
      manifest: {
        name: APP_NAME,
        short_name: 'Gen:iA',
        description: APP_DESCRIPTION,
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#4338ca',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // 링크 미리보기 이미지(WP-894)는 메신저 봇만 받는다 — 앱이 쓰지 않으므로 모든 설치본이 미리 받아 두지 않게 뺀다.
        globIgnores: ['**/node_modules/**', 'og-image.png'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: process.env.E2E === '1', type: 'module' },
    }),
  ],
  // dev SW(src/sw.ts)는 index.html 에서 정적으로 닿지 않아 Vite 의존성 스캔에서 빠진다. 캐시가 빈 상태에서 SW 를 처음
  // 불러올 때 workbox 를 새로 발견해 의존성을 다시 묶고 페이지를 통째로 새로고침해, 그 순간 진행 중이던 E2E(푸시 켜기 등)의
  // 화면 상태가 날아갔다. SW 도 스캔 진입점에 넣어 처음부터 함께 묶는다(패키지 목록을 손으로 적지 않아 sw.ts 가 바뀌어도 맞음).
  // entries 를 지정하면 기본 스캔(index.html)을 대체하므로 index.html 도 함께 둔다.
  optimizeDeps: { entries: ['index.html', 'src/sw.ts'] },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // 릴리스 노트(.md) 위치 — 기본은 저장소 루트 releases/, E2E 서버는 고정 픽스처로 바꿔
      // 실제 릴리스 노트가 늘어도 E2E 기대값이 흔들리지 않게 한다(WP-439).
      '@release-notes': RELEASE_NOTES_DIR,
    },
    // 공용 스키마 패키지(@smart-workplace/wiki-editor-schema)와 웹이 tiptap·prosemirror·yjs 를
    // 반드시 같은 인스턴스로 쓰게 한다 — 둘로 갈리면 스키마 노드 타입·플러그인 키가 어긋난다(WP-284).
    dedupe: ['@tiptap/core', '@tiptap/pm', 'yjs', 'y-prosemirror', 'prosemirror-model', 'prosemirror-state', 'prosemirror-view'],
  },
  server: {
    port: 6173,
    strictPort: true,
    proxy: {
      // 노트 동시 편집 웹소켓 → workplace-collab
      '/collab': {
        target: COLLAB_TARGET,
        ws: true,
      },
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
