// 측정(WP-1512)으로 보내는 화면 주소를 다듬는 순수 함수 — 식별자·토큰이 서버 통계에 남지 않게 하고,
// 같은 화면(라우트 패턴)이 프로젝트 키·식별자에 따라 여러 줄로 쪼개지지 않게 한다.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISSUE_KEY = /^[A-Z][A-Z0-9]*-\d+$/
/** 서버가 받는 주소 최대 길이. */
const MAX_LENGTH = 200

/**
 * 숫자 id 가 아닌 라우트 파라미터 자리 — App.tsx 의 `<Route path>` 에서 뽑았다.
 * 앞 고정 조각(prefix) 바로 다음 조각을 `:param` 이름으로 바꾼다. 라우트를 추가하면 여기에도 더한다.
 * (`me/tasks/:tab` 은 정해진 탭 값이라 그대로 둔다 — 탭별로 다른 화면이기 때문.)
 */
export const PARAM_PREFIXES: { prefix: string[]; param: string }[] = [
  { prefix: ['projects'], param: ':key' }, // projects/:key/...
  { prefix: ['s'], param: ':token' }, // /s/:token 공유 링크 — 짧아도 비밀이다
  { prefix: ['wiki', 'share'], param: ':token' }, // /wiki/share/:token
]

/** 이 조각이 식별자(숫자·UUID·이슈 키)이거나 토큰처럼 긴 글자+숫자 섞임이면 true. */
function isIdLike(segment: string): boolean {
  if (/^\d+$/.test(segment) || UUID.test(segment) || ISSUE_KEY.test(segment)) return true
  // 공유 링크 토큰 같은 긴 무작위 글자 — 20자 이상이고 글자와 숫자가 모두 있을 때
  return segment.length >= 20 && /[A-Za-z]/.test(segment) && /\d/.test(segment)
}

/** 경로의 파라미터 조각을 `:key`·`:token`·`:id` 로 바꾸고 200자로 자른다. 쿼리·해시는 받지 않는다(pathname 만). */
export function helpMetricRoute(pathname: string): string {
  const segs = pathname.split('/')
  // 절대 경로라 segs[0] 은 '' — 고정 조각은 segs[1] 부터 비교한다.
  const rule = PARAM_PREFIXES.find(({ prefix }) => prefix.every((p, i) => segs[i + 1] === p))
  // 규칙이 맞고 접두 뒤에 조각이 더 있을 때만 그 자리가 파라미터다 — 한 번만 계산한다.
  const paramAt = rule && segs.length > rule.prefix.length + 1 ? rule.prefix.length + 1 : -1
  const normalized = segs
    .map((seg, i) => (i === paramAt && seg !== '' ? (rule?.param ?? seg) : isIdLike(seg) ? ':id' : seg))
    .join('/')
  return normalized.slice(0, MAX_LENGTH)
}
