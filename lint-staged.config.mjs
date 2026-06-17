import path from 'node:path'

// lint-staged 설정 — JS/TS pre-commit 게이트.
//
// 왜 함수형 config 인가:
//   eslint flat config(eslint.config.js)는 각 앱 디렉토리에 있다. lint-staged 는 repo 루트에서
//   실행되는데, 루트에는 eslint config 가 없어 절대경로로 넘기면 "config 못 찾음" 에러가 난다.
//   따라서 스테이징된 파일을 앱별로 묶어, 각 앱 디렉토리(cwd)에서 앱 기준 상대경로로 eslint 를
//   실행한다. eslint 는 error 가 있으면 비0 종료 → 커밋 차단, import 정렬 등은 --fix 로 자동수정.
//   (Java 포맷은 별도로 gradle test 내 Spotless 가 검증.)
const APPS = ['workplace-web', 'workplace-admin']

export default {
  'apps/{workplace-web,workplace-admin}/{src,e2e}/**/*.{ts,tsx}': (files) => {
    // 절대경로로 들어온 스테이징 파일을 소속 앱별로 그룹핑.
    const byApp = new Map()
    for (const f of files) {
      const app = APPS.find((a) => f.includes(`/apps/${a}/`))
      if (!app) continue
      const rel = path.relative(path.resolve('apps', app), f)
      if (!byApp.has(app)) byApp.set(app, [])
      byApp.get(app).push(rel)
    }
    // 앱마다 해당 디렉토리에서 eslint --fix 실행(에러 시 커밋 차단).
    return [...byApp.entries()].map(
      ([app, rels]) => `bash -c "cd apps/${app} && npx eslint --fix ${rels.join(' ')}"`,
    )
  },
}
