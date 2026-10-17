// web·admin 빌드가 앱 버전·커밋을 알도록 하는 vite 공용 헬퍼 (WP-439).
// 값은 Docker 빌드 인자(APP_VERSION·GIT_SHA)에서 오며, 없거나 비면 'dev' 다(로컬 개발·E2E).
// VITE_* 환경변수로 두지 않는다: VITE_* 는 import.meta.env 로 클라이언트에 그대로 노출돼 의도치 않게 새기 때문에
// vite `define` 상수(노트 선택용 __APP_VERSION__ 과 화면 표기용 __APP_VERSION_LABEL__·__GIT_SHA_SHORT__)로만 주입한다.

/** 환경변수 값을 읽되 없거나 공백뿐이면 'dev' 로 대체한다. */
function readOrDev(value) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : 'dev'
}

/**
 * 앱 버전 — 맨 앞 `v`/`V` 한 개를 떼어 낸다(`v0.9.0` → `0.9.0`).
 * 릴리스 태그를 그대로 빌드 인자로 넘겨도 노트 파일명(0.9.0.md)과 화면 표기(`v` + 버전)가 어긋나지 않게 한다.
 */
function normalizeVersion(value) {
  const version = readOrDev(value)
  return version === 'dev' ? version : version.replace(/^[vV]/, '')
}

/**
 * vite `define` 에 병합할 빌드 상수.
 * define 값은 코드 조각으로 치환되므로 JSON.stringify 한 문자열 리터럴이어야 한다.
 * 화면 표기용 라벨(`v0.9.0`/`dev`)·짧은 커밋(앞 7자, dev 면 빈 문자열)도 여기서 한 번만 계산해 web·admin 이 같은 규칙을 쓴다.
 */
export function appVersionDefine(env = process.env) {
  const version = normalizeVersion(env.APP_VERSION)
  const sha = readOrDev(env.GIT_SHA)
  return {
    __APP_VERSION__: JSON.stringify(version),
    __APP_VERSION_LABEL__: JSON.stringify(version === 'dev' ? 'dev' : `v${version}`),
    __GIT_SHA_SHORT__: JSON.stringify(sha === 'dev' ? '' : sha.slice(0, 7)),
  }
}

/**
 * 빌드 산출물 루트에 version.json({version, commit})을 내보내는 vite 플러그인.
 * 배포된 번들의 버전을 SPA 밖에서도(헬스체크·새 버전 감지 등) 정적 파일로 확인할 수 있게 한다.
 */
export function versionJsonPlugin(env = process.env) {
  return {
    name: 'app-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: normalizeVersion(env.APP_VERSION), commit: readOrDev(env.GIT_SHA) }),
      })
    },
  }
}
