// 릴리스 노트(「새 소식」) 순수 로직 — 파싱·버전 비교·현재/이전 노트 선택·안 읽음 판정.
// 노트 파일(releases/<semver>.md)을 번들에서 읽어 오는 부분은 releaseNotesBundle.ts 에 분리했다.
// 여기서는 import.meta.glob·별칭을 쓰지 않아 vitest 단위 테스트가 번들 없이 돌아간다(WP-439).

import { safeLocalStorage } from '@/lib/safeLocalStorage'

/** 파싱한 릴리스 노트 한 건. */
export type ReleaseNote = {
  /** semver 버전 (파일명 기준 — CI 가 검사하는 값이라 frontmatter version 으로 덮지 않는다) */
  version: string
  /** 배포일 YYYY-MM-DD (frontmatter 에 없으면 빈 문자열) */
  date: string
  /** frontmatter 뒤의 마크다운 본문 */
  body: string
  /** 숨김 노트 — 사용자에게 보이지 않는다(frontmatter hidden: true 일 때만) */
  hidden: boolean
}

/** 마지막으로 확인한 노트 버전을 담는 localStorage 키 — 안 읽음 점 판정에 쓴다. */
export const WHATS_NEW_STORAGE_KEY = 'genia.whatsNew.lastSeenVersion'

/** semver(x.y.z 와 선택적 -프리릴리스). 빌드 메타(+) 는 쓰지 않는다. */
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/** 파일명에서 .md 확장자를 떼어 낸다. */
function stripMd(fileName: string): string {
  return fileName.replace(/\.md$/i, '')
}

/** frontmatter 값 양끝의 같은 따옴표 한 쌍('…' 또는 "…")을 벗긴다 — `hidden: "true"`·`date: "2026-10-20"` 처럼 감싼 값도 통하게. */
function unquote(value: string): string {
  const m = /^(['"])(.*)\1$/.exec(value)
  return m ? m[2] : value
}

/**
 * 노트 파일 한 건을 파싱한다. 파일명(확장자 제외)이 semver 가 아니면(README 등) null.
 * frontmatter 는 맨 앞 `---` 줄 사이의 `key: value` 줄만 읽는 단순 형식이다(중첩·배열 미지원).
 */
export function parseReleaseNote(fileName: string, raw: string): ReleaseNote | null {
  const nameVersion = stripMd(fileName)
  if (!SEMVER_RE.test(nameVersion)) return null

  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const meta: Record<string, string> = {}
  let body = text
  // 구분선 뒤 공백(`--- `)은 허용하고, 빈 frontmatter(`---\n---`)도 한 덩어리로 읽는다 — 안 그러면 빈 블록·공백 구분선의
  // 노트가 본문에 `---` 줄과 hidden: true 가 그대로 노출된다.
  const fm = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(text)
  if (fm) {
    for (const line of (fm[1] ?? '').split('\n')) {
      const idx = line.indexOf(':')
      if (idx > 0) meta[line.slice(0, idx).trim()] = unquote(line.slice(idx + 1).trim())
    }
    body = text.slice(fm[0].length)
  }

  return {
    // 버전은 항상 파일명 기준 — frontmatter version 이 달라도(오타·복사 실수) 파일명을 검사하는 CI 와 같은 값을 쓴다.
    version: nameVersion,
    date: meta.date ?? '',
    // 안전 쪽(공개 안 함)으로 기울지 않고 문서화된 규칙대로 문자열 'true' 만 숨김으로 본다.
    hidden: meta.hidden === 'true',
    body: body.trim(),
  }
}

/** 프리릴리스 식별자 목록 비교 — 숫자는 숫자끼리 수치로, 숫자 < 문자, 짧은 쪽이 앞선다(semver 규칙). */
function comparePrerelease(a: string, b: string): number {
  const as = a.split('.')
  const bs = b.split('.')
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const x = as[i]
    const y = bs[i]
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y)
    } else if (xn !== yn) {
      return xn ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return as.length - bs.length
}

/**
 * semver 비교 — a 가 크면 양수, 작으면 음수, 같으면 0.
 * 숫자 부분은 수치로 비교(0.10.0 > 0.9.0)하고, 프리릴리스(-rc.1)는 같은 숫자 버전보다 낮다.
 * semver 형식이 아닌 입력(예: 'dev')은 가장 낮은 것으로 취급한다.
 */
export function compareSemver(a: string, b: string): number {
  const ma = SEMVER_RE.exec(a)
  const mb = SEMVER_RE.exec(b)
  if (!ma || !mb) return ma ? 1 : mb ? -1 : 0
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i])
    if (d !== 0) return d
  }
  const pa = ma[4]
  const pb = mb[4]
  if (pa === undefined && pb === undefined) return 0
  if (pa === undefined) return 1
  if (pb === undefined) return -1
  return comparePrerelease(pa, pb)
}

/**
 * 「새 소식」에 보일 노트를 고른다. 숨김 노트는 제외한다.
 * - appVersion === 'dev'(로컬 빌드): 가장 높은 노트를 current 로 본다(개발 중 최신 노트 확인용).
 * - 그 밖: 버전이 정확히 같은 노트가 current, 그보다 낮은 노트가 previous(내림차순).
 *   앱보다 높은 노트는 아직 배포 전이므로 어디에도 넣지 않는다.
 */
export function selectWhatsNew(
  notes: ReleaseNote[],
  appVersion: string,
): { current: ReleaseNote | null; previous: ReleaseNote[] } {
  const visible = notes.filter((x) => !x.hidden).sort((x, y) => compareSemver(y.version, x.version))
  if (appVersion === 'dev') {
    const [current = null, ...previous] = visible
    return { current, previous }
  }
  const current = visible.find((x) => compareSemver(x.version, appVersion) === 0) ?? null
  const previous = visible.filter((x) => compareSemver(x.version, appVersion) < 0)
  return { current, previous }
}

/** 저장소에 기록된 마지막 확인 버전 — 없거나 semver 형식이 아니면(깨진 값) null. getItem 오류는 호출자가 처리한다. */
function readLastSeen(storage: Pick<Storage, 'getItem'>): string | null {
  const stored = storage.getItem(WHATS_NEW_STORAGE_KEY)
  return stored !== null && SEMVER_RE.test(stored) ? stored : null
}

/**
 * 현재 노트가 아직 안 읽힌 상태인지 — 노트가 없으면 false, 저장소 접근 실패 시 true(점을 보여 준다).
 * 같은 버전인지가 아니라 순서로 비교한다: 기록이 현재보다 새것이면(롤링 업데이트·롤백) 이미 더 새 소식을 본 것이다.
 */
export function isUnread(
  current: ReleaseNote | null,
  storage?: Pick<Storage, 'getItem'>,
): boolean {
  if (!current) return false
  const s = storage ?? safeLocalStorage()
  if (!s) return true
  try {
    const lastSeen = readLastSeen(s)
    return lastSeen === null || compareSemver(lastSeen, current.version) < 0
  } catch {
    return true
  }
}

/** 노트를 확인했다고 기록한다. 기록이 더 새것이면 덮어쓰지 않고(마지막 확인 지점이 뒤로 가지 않게), 저장소 오류는 삼킨다. */
export function markSeen(version: string, storage?: Pick<Storage, 'getItem' | 'setItem'>): void {
  const s = storage ?? safeLocalStorage()
  if (!s) return
  try {
    const lastSeen = readLastSeen(s)
    if (lastSeen === null || compareSemver(version, lastSeen) > 0) s.setItem(WHATS_NEW_STORAGE_KEY, version)
  } catch {
    // 저장 실패는 무시 — 다음 방문에 점이 다시 보일 뿐이다.
  }
}
