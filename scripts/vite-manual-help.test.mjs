// scripts/vite-manual-help.mjs 테스트 (WP-1504) — `node --test scripts/vite-manual-help.test.mjs`
// 웹 빌드가 매뉴얼 원본으로 /help/ 도움말 묶음을 싣는지(빌드 generateBundle·dev 미들웨어·preview 404), 매뉴얼 글이 깨져도 빌드를
// 멈추지 않는지(경고만), 웹 이미지 빌드(Dockerfile)가 플러그인이 읽는 파일을 COPY 하는지, 무거운 의존성(marked·Playwright)을
// 끌어오지 않는지를 본다.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { validateBundle } from '../docs/manual/scripts/lib/help-bundle.mjs'
import { MANUAL_HELP_BASE, MANUAL_HELP_INPUTS, manualHelpPlugin } from './vite-manual-help.mjs'

// 저장소 루트 — 실행 위치(cwd)와 상관없이 파일을 찾는다(다른 scripts/*.test.mjs 와 같은 방식).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** generateBundle 을 가짜 플러그인 컨텍스트로 부른다 → { files: fileName → source, warnings }. */
async function runGenerate(plugin) {
  const files = new Map()
  const warnings = []
  const ctx = {
    emitFile(asset) {
      assert.equal(asset.type, 'asset')
      files.set(asset.fileName, asset.source)
      return asset.fileName
    },
    warn(message) {
      warnings.push(String(message))
    },
  }
  await plugin.generateBundle.call(ctx, {}, {})
  return { files, warnings }
}

/** configureServer 가 등록한 미들웨어 하나를 꺼낸다. */
function devMiddleware(plugin) {
  const used = []
  plugin.configureServer({ middlewares: { use: (fn) => used.push(fn) } })
  assert.equal(used.length, 1, '미들웨어 하나를 등록한다')
  return used[0]
}

/** 미들웨어에 요청 하나를 흘려 응답(상태·헤더·본문)이나 next() 호출을 돌려준다. */
function request(mw, url) {
  return new Promise((resolve, reject) => {
    const headers = {}
    const res = {
      statusCode: 200,
      setHeader: (k, v) => {
        headers[k.toLowerCase()] = v
      },
      end: (body) => resolve({ status: res.statusCode, headers, body: body === undefined ? '' : body }),
    }
    Promise.resolve(mw({ url, method: 'GET', headers: {} }, res, (err) => (err ? reject(err) : resolve({ next: true })))).catch(reject)
  })
}

test('MANUAL_HELP_BASE 는 help — 웹 /help/ 아래에 싣는다', () => {
  assert.equal(MANUAL_HELP_BASE, 'help')
})

test('generateBundle: 목차·장·자리표시 목록·그림을 help/ 아래에 내고 목차는 형식 검증을 통과한다', async () => {
  const { files, warnings } = await runGenerate(manualHelpPlugin())
  assert.ok(files.has('help/manual-index.json'))
  assert.ok(files.has('help/manual/agents.json'))
  assert.ok(files.has('help/manual-vars.json'))
  const pngs = [...files.keys()].filter((f) => /^help\/figures\/[^/]+\.png$/.test(f))
  assert.ok(pngs.length > 0, '그림 PNG 가 하나 이상 실린다')
  // PNG 는 커밋된 도움말 그림 바이트 그대로다(PNG 서명).
  const png = files.get(pngs[0])
  assert.ok(Buffer.isBuffer(png) || png instanceof Uint8Array)
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])

  const index = JSON.parse(files.get('help/manual-index.json'))
  const chapters = index.map((h) => ({ chapter: h.chapter, json: JSON.parse(files.get(`help/manual/${h.chapter}.json`)) }))
  assert.deepEqual(validateBundle({ index, chapters }), [])
  // 장 파일이 가리키는 그림은 모두 함께 실린다(패널이 깨진 그림을 보지 않게).
  for (const c of chapters) for (const s of c.json.sections) for (const f of s.figures) assert.ok(files.has(`help/${f.src}`), f.src)
  // 실제 매뉴얼은 문제가 없어야 한다(경고 0) — 생기면 manual:check 가 먼저 잡는다.
  assert.deepEqual(warnings, [])
})

// 장 둘이 같은 도움말 id 를 쓰는 깨진 책(임시 저장소 루트).
async function brokenRoot() {
  const dir = await mkdtemp(path.join(tmpdir(), 'vite-manual-help-'))
  await mkdir(path.join(dir, 'docs/manual/user'), { recursive: true })
  const chapter = (slug, title) => `---\ntitle: ${title}\nslug: ${slug}\nroutes: []\naudience: [member]\n---\n\n# ${title}\n\n## 같은 절 {help=dup.id label=같은}\n\n본문\n`
  await writeFile(path.join(dir, 'docs/manual/user/01-a.md'), chapter('a', '가'))
  await writeFile(path.join(dir, 'docs/manual/user/02-b.md'), chapter('b', '나'))
  return dir
}

test('generateBundle: 매뉴얼이 깨져도(중복 id) 던지지 않고 warn 만 부르며 산출물은 낸다', async () => {
  const dir = await brokenRoot()
  const { files, warnings } = await runGenerate(manualHelpPlugin({ root: dir }))
  assert.ok(files.has('help/manual-index.json'))
  assert.ok(files.has('help/manual/a.json'))
  assert.ok(files.has('help/manual/b.json'))
  assert.ok(warnings.some((w) => /duplicate-id/.test(w) && /02-b\.md/.test(w)), warnings.join('\n'))
})

test('dev 미들웨어: /help/ 파일은 요청마다 만든 묶음으로, 없으면 404, 다른 주소는 next()', async () => {
  const mw = devMiddleware(manualHelpPlugin())
  const index = await request(mw, '/help/manual-index.json')
  assert.equal(index.status, 200)
  assert.match(index.headers['content-type'], /^application\/json/)
  assert.ok(Array.isArray(JSON.parse(index.body)))

  const chapter = await request(mw, '/help/manual/agents.json?t=1')
  assert.equal(chapter.status, 200)
  assert.equal(JSON.parse(chapter.body).chapter, 'agents')

  // 그림 하나 — 그림이 있는 장(ai-collaboration)이 가리키는 src 로 받으면 PNG 다.
  const withFigures = await request(mw, '/help/manual/ai-collaboration.json')
  const src = JSON.parse(withFigures.body).sections.flatMap((x) => x.figures).at(0)?.src
  assert.ok(src, 'ai-collaboration 장에 그림이 있다')
  const png = await request(mw, `/help/${src}`)
  assert.equal(png.status, 200)
  assert.equal(png.headers['content-type'], 'image/png')
  assert.deepEqual([...png.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])

  const missing = await request(mw, '/help/manual/nope.json')
  assert.equal(missing.status, 404)
  assert.deepEqual(await request(mw, '/other'), { next: true })
  assert.deepEqual(await request(mw, '/helpers.js'), { next: true })
})

test('preview 미들웨어: dist 에 없는 /help/ 파일은 SPA index.html 대신 404(nginx 와 같게), 있는 파일·다른 주소는 next()', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vite-manual-help-dist-'))
  await mkdir(path.join(dir, 'help/manual'), { recursive: true })
  await writeFile(path.join(dir, 'help/manual-index.json'), '[]')
  const plugin = manualHelpPlugin()
  plugin.configResolved({ root: dir, build: { outDir: dir } })
  const used = []
  plugin.configurePreviewServer({ middlewares: { use: (fn) => used.push(fn) } })
  assert.equal(used.length, 1)
  assert.deepEqual(await request(used[0], '/help/manual-index.json'), { next: true })
  assert.equal((await request(used[0], '/help/manual/nope.json')).status, 404)
  // 묶음 밖으로 나가는 주소(../)는 dist 밖 파일을 보지 않고 404.
  assert.equal((await request(used[0], '/help/../package.json')).status, 404)
  // 폴더 주소는 파일이 아니라 404 — next() 로 넘기면 Vite 정적 서빙이 SPA index.html 로 떨어질 수 있다.
  assert.equal((await request(used[0], '/help/manual')).status, 404)
  assert.equal((await request(used[0], '/help/')).status, 404)
  assert.deepEqual(await request(used[0], '/'), { next: true })
})

test('dev 미들웨어: PNG 는 묶음을 만들지 않고 그림 폴더에서 바로 낸다(이름 검사·폴더 밖·없는 파일은 404)', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vite-manual-help-png-'))
  // 장 폴더 자리에 일반 파일을 두어 묶음 생성(loadChapters)이 실패하게 한다 — PNG 가 묶음을 만들지 않는다는 증거.
  await mkdir(path.join(dir, 'docs/manual'), { recursive: true })
  await writeFile(path.join(dir, 'docs/manual/user'), '')
  await mkdir(path.join(dir, 'docs/manual/help-figures/user/sub.png'), { recursive: true })
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await writeFile(path.join(dir, 'docs/manual/help-figures/user/s1~2.png'), png)
  await writeFile(path.join(dir, 'docs/manual/help-figures/secret.png'), png)
  const mw = devMiddleware(manualHelpPlugin({ root: dir }))

  const ok = await request(mw, '/help/figures/s1~2.png')
  assert.equal(ok.status, 200)
  assert.equal(ok.headers['content-type'], 'image/png')
  assert.equal(ok.headers['cache-control'], 'no-cache')
  assert.deepEqual([...ok.body], [...png])
  assert.equal((await request(mw, '/help/figures/nope.png')).status, 404)
  assert.equal((await request(mw, '/help/figures/sub.png')).status, 404) // 폴더
  assert.equal((await request(mw, '/help/figures/..%2Fsecret.png')).status, 404) // 그림 폴더 밖
  // JSON 은 여전히 요청마다 묶음을 만든다 — 장 폴더가 깨졌으니 오류가 next(err) 로 간다.
  await assert.rejects(request(mw, '/help/manual-index.json'))
})

test('MANUAL_HELP_INPUTS 마다 웹 Dockerfile 빌드 단계에 COPY 가 있고, 플러그인 파일도 복사한다', () => {
  const dockerfile = readFileSync(path.join(root, 'apps/workplace-web/Dockerfile'), 'utf8')
  const build = dockerfile.split(/^FROM /m)[1] // 첫 FROM 단계(빌드)
  for (const input of MANUAL_HELP_INPUTS) {
    assert.ok(existsSync(path.join(root, input)), `${input} 가 저장소에 있다`)
    assert.ok(build.split(/\r?\n/).includes(`COPY ${input} ./${input}`), `COPY ${input} ./${input}`)
  }
  // vite.config 가 import 하므로 플러그인과 tsc 용 선언 파일도 빌드 단계에 있어야 한다.
  assert.match(build, /^COPY [^\n]*scripts\/vite-manual-help\.mjs[^\n]*scripts\/vite-manual-help\.d\.mts[^\n]* \.\/scripts\/$/m)
})

/**
 * 플러그인에서 상대 import 를 따라가며 모듈 그래프를 모은다 → { seen: 모듈 절대 경로들, bare: 패키지 import 이름들 }.
 * 소스 글자 검사 — 동적 import 도 문자열로 잡힌다.
 */
function pluginModuleGraph() {
  const seen = new Set()
  const bare = new Set()
  const walk = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)) {
      const spec = m[1]
      if (spec.startsWith('.')) walk(path.resolve(path.dirname(file), spec))
      else bare.add(spec)
    }
  }
  walk(path.join(root, 'scripts/vite-manual-help.mjs'))
  return { seen, bare }
}

test('플러그인 모듈 그래프가 marked·Playwright 를 import 하지 않는다(웹 이미지는 workplace-web 의존성만 설치)', () => {
  const { seen, bare } = pluginModuleGraph()
  assert.ok(seen.size > 3, '매뉴얼 lib 모듈까지 따라갔다')
  for (const spec of bare) assert.match(spec, /^node:/, `Node 내장만 쓴다: ${spec}`)
})

test('게이트의 웹 입력 lib 목록(noncode.sh MANUAL_WEB_LIB_RE)이 플러그인이 실제 불러오는 매뉴얼 lib 와 같다', () => {
  // 셸 파일의 ERE 를 그대로 읽어 JS 정규식으로 쓴다(이 꼴의 ERE — 묶음·`|`·`\.` — 는 JS 와 뜻이 같다).
  const sh = readFileSync(path.join(root, 'scripts/husky/noncode.sh'), 'utf8')
  const m = /^MANUAL_WEB_LIB_RE='([^']+)'$/m.exec(sh)
  assert.ok(m, 'noncode.sh 에 MANUAL_WEB_LIB_RE 가 있다')
  const re = new RegExp(`^${m[1]}$`)
  const libDir = 'docs/manual/scripts/lib'
  const { seen } = pluginModuleGraph()
  const used = [...seen]
    .map((f) => path.relative(root, f).split(path.sep).join('/'))
    .filter((f) => f.startsWith(`${libDir}/`))
    .sort()
  const listed = readdirSync(path.join(root, libDir))
    .map((f) => `${libDir}/${f}`)
    .filter((f) => re.test(f))
    .sort()
  // 다르면: 플러그인이 새 lib 를 불러오면 목록에 더하고(빠지면 그 lib 변경이 비코드로 회귀를 건너뛴다), 안 쓰게 되면 뺀다.
  assert.deepEqual(listed, used)
})
