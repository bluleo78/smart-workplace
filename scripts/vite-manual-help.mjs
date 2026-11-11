// 매뉴얼 도움말 묶음을 웹 정적 파일 /help/ 로 싣는 vite 플러그인 (WP-1504).
// 사용자 매뉴얼(docs/manual/user)을 설계 14절 형식의 절 단위 묶음(manual-index.json·manual/<장>.json·manual-vars.json)으로 만들고
// 미리 만들어 커밋한 도움말 그림 PNG(docs/manual/help-figures/user)를 figures/ 로 함께 싣는다. 빌드 때 원본에서 만들므로
// 배포된 앱과 매뉴얼 버전이 늘 같다(설계 9절). 묶음 생성은 매뉴얼 lib(buildHelpBundle·bundleFiles)를 그대로 부른다 — 따로 구현하지 않는다.
// 매뉴얼 글의 문제(중복 id·깨진 링크 등)는 빌드를 멈추지 않고 경고만 낸다(장 원고 변경은 웹 빌드·회귀가 아니라 커밋 때
// pre-commit 의 manual:check 가 막는다 — 판정은 manual:check·manual:help 가 맡는다). 웹 이미지(node:22-alpine, workplace-web 의존성만 설치)에서 돌므로 Node 내장과 매뉴얼 lib 의
// 순수 모듈만 import 한다(marked·Playwright 금지 — 테스트가 모듈 그래프를 검사한다).
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { BOOKS, ROOT } from '../docs/manual/scripts/lib/books.mjs'
import { buildBookHelpBundle, bundleFiles, HELP_BUNDLE_FILES } from '../docs/manual/scripts/lib/help-bundle.mjs'

/** 웹 산출물 안 묶음 루트 폴더 — `/help/manual-index.json` 처럼 앱 라우트와 겹치지 않는 자리(App.tsx 에 /help 없음). */
export const MANUAL_HELP_BASE = 'help'

/** 웹 이미지 빌드가 COPY 해야 하는 저장소 경로(플러그인이 읽는 것) — 테스트가 apps/workplace-web/Dockerfile 과 대조한다. */
export const MANUAL_HELP_INPUTS = ['docs/manual/scripts/lib', 'docs/manual/user', 'docs/manual/help-figures/user']

// 응답 형식 — 묶음에는 JSON 과 PNG 만 있다.
const CONTENT_TYPES = { '.json': 'application/json; charset=utf-8', '.png': 'image/png' }

/**
 * 묶음 파일 표를 만든다 → { files: Map<묶음 루트 기준 경로, () => 내용>, problems: 경고 줄 목록 }.
 * root 는 저장소 루트(테스트가 깨진 책을 임시 폴더에 두려고 바꾼다). 묶음 준비(그림 폴더·그림 있음·문제 줄 서식)는 CLI 와 같은
 * buildBookHelpBundle 이 한다. JSON 은 bundleFiles 의 직렬화 그대로(manual:help 와 바이트 단위로 같다),
 * 그림은 묶음이 가리키는 PNG 만 — 실제 바이트는 필요할 때 읽는다(dev 는 요청한 파일 하나만).
 */
async function createHelpFiles({ book, root }) {
  const { bundle, figuresDir, problemLines } = await buildBookHelpBundle(BOOKS[book], root)
  const files = new Map()
  for (const f of bundleFiles(bundle)) files.set(f.path, () => f.content)
  for (const fig of bundle.figures) files.set(fig.src, () => readFileSync(path.join(figuresDir, `${fig.id}.png`)))
  return { files, problems: problemLines }
}

/** 요청 주소에서 `/help/` 뒤 묶음 경로를 꺼낸다(쿼리 제거·퍼센트 디코딩). /help/ 밖이면 null. */
function helpPath(url) {
  const pathname = (url ?? '').split('?')[0]
  const prefix = `/${MANUAL_HELP_BASE}/`
  if (!pathname.startsWith(prefix)) return null
  try {
    return decodeURIComponent(pathname.slice(prefix.length))
  } catch {
    return '' // 잘못된 % 표기 — 어떤 파일과도 맞지 않아 404 가 된다
  }
}

// 묶음 안 그림 폴더 접두(`figures/`) — 묶음이 그림 src 를 만드는 것과 같은 이름을 쓴다.
const FIGURE_PREFIX = `${HELP_BUNDLE_FILES.figureDir}/`

/** 그 경로가 일반 파일인가(폴더·없는 경로는 false) — 폴더 요청이 정적 서빙·SPA 대체로 넘어가지 않게 한다. */
function isFile(file) {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** 200 응답 — dev 는 매뉴얼을 고치면 새로고침만으로 보이도록 늘 재검증(no-cache)하게 한다. */
function sendFile(res, type, body) {
  res.statusCode = 200
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'no-cache')
  res.end(body)
}

/** 404 응답(본문 없음) — SPA index.html 로 떨어지지 않게 nginx 의 `try_files $uri =404` 와 같은 결과를 낸다. */
function notFound(res) {
  res.statusCode = 404
  res.end()
}

/**
 * 매뉴얼 도움말 묶음 플러그인.
 * - 빌드(generateBundle): help/manual-index.json·help/manual/<장>.json·help/manual-vars.json·help/figures/<id>.png 를 emitFile.
 * - dev(configureServer): GET /help/*.json 을 요청마다 새로 만든 묶음으로 응답한다(장 19개라 수십 ms — 매뉴얼을 고치면 새로고침만으로 보인다).
 *   그림 PNG 는 묶음을 만들지 않고 그림 폴더에서 이름 검사 뒤 바로 낸다(한 장에 그림이 여럿이라 그림마다 묶음을 다시 만들면 느리다).
 * - preview(configurePreviewServer): dist 에 없는(또는 폴더인) /help/* 는 404(운영 nginx 와 같게 — 기본 preview 는 index.html 로 떨어질 수 있다).
 * 문제는 this.warn(빌드)·console.warn(dev)만 하고 빌드를 멈추지 않는다.
 */
export function manualHelpPlugin(options = {}) {
  const book = options.book ?? 'user'
  const root = options.root ?? ROOT
  let outDir = null // preview 가 보는 빌드 산출물 폴더(configResolved 에서 정함)
  let lastDevProblems = '' // dev 경고는 내용이 바뀔 때만 찍는다(요청마다 같은 경고가 쌓이지 않게)

  return {
    name: 'manual-help-bundle',

    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },

    async generateBundle() {
      const { files, problems } = await createHelpFiles({ book, root })
      for (const p of problems) this.warn(`매뉴얼 도움말 묶음: ${p}`)
      for (const [rel, read] of files) {
        this.emitFile({ type: 'asset', fileName: `${MANUAL_HELP_BASE}/${rel}`, source: read() })
      }
    },

    configureServer(server) {
      // 플러그인 미들웨어를 바로 등록해 Vite 내부(SPA 대체 포함)보다 먼저 받는다.
      server.middlewares.use(async (req, res, next) => {
        const rel = helpPath(req.url)
        if (rel === null) return next()
        try {
          if (rel.startsWith(FIGURE_PREFIX)) {
            // 그림: 묶음 없이 그림 폴더의 파일을 바로 낸다. 이름은 `<그림 id>.png` 한 마디만 — `/`·`\` 가 있으면(../ 포함)
            // 그림 폴더 밖이나 하위 폴더를 가리키므로 404. 폴더·없는 파일도 404(isFile).
            const name = rel.slice(FIGURE_PREFIX.length)
            if (!name.endsWith('.png') || /[/\\]/.test(name)) return notFound(res)
            const file = path.join(root, BOOKS[book].help.figuresDir, name)
            if (!isFile(file)) return notFound(res)
            return sendFile(res, CONTENT_TYPES['.png'], readFileSync(file))
          }
          const { files, problems } = await createHelpFiles({ book, root })
          const text = problems.join('\n')
          if (text && text !== lastDevProblems) console.warn(`[manual-help] 매뉴얼 도움말 묶음 문제:\n${text}`)
          lastDevProblems = text
          const read = files.get(rel)
          if (!read) return notFound(res)
          sendFile(res, CONTENT_TYPES[path.extname(rel)] ?? 'application/octet-stream', read())
        } catch (err) {
          next(err)
        }
      })
    },

    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const rel = helpPath(req.url)
        if (rel === null || !outDir) return next()
        const base = path.join(outDir, MANUAL_HELP_BASE)
        const file = path.resolve(base, rel)
        // 묶음 폴더 밖(../)을 가리키거나 일반 파일이 아니면(없음·폴더) 404 — 있는 파일만 Vite 정적 서빙에 넘긴다.
        if (!file.startsWith(base + path.sep) || !isFile(file)) return notFound(res)
        next()
      })
    },
  }
}
