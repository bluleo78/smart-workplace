// 상위 에픽 연결 후보 거르기(WP-1018) — 번호를 몰라도 제목 일부로 에픽을 찾게 한다.
// 입력이 번호(앞의 # 허용)면 그 번호로 시작하는 에픽을, 아니면 제목에 입력이 들어간 에픽을 고른다(대소문자 무시).
// 순서: 번호가 꼭 같은 것 → 제목이 입력으로 시작하는 것 → 제목에 든 것 → 번호가 입력으로 시작하는 것(같은 등급은 원래 순서).
// 번호 접두를 맨 뒤에 두어 「1」 같은 짧은 입력에서 #10~#19 가 제목 일치를 상한 밖으로 밀어내지 않게 한다. 후보가 길어지지 않게 상한을 둔다.

/** 후보 판정에 쓰는 에픽 최소 모양 — 번호·제목만 본다. */
export interface EpicCandidateSource {
  number: number
  title: string
}

/** 후보 목록 상한 — 레일 폭에서 스크롤 없이 훑어볼 만큼. */
export const EPIC_CANDIDATE_LIMIT = 20

/** 입력이 이슈 번호(양의 정수, 앞의 # 허용)면 그 수, 아니면 null — 부모 번호 저장 검사(Number·정수·양수)와 같은 해석. */
export function parseIssueNumberQuery(text: string): number | null {
  const body = text.trim().replace(/^#/, '')
  if (body === '') return null
  const n = Number(body)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function matchEpicCandidates<T extends EpicCandidateSource>(
  epics: readonly T[],
  query: string,
  limit = EPIC_CANDIDATE_LIMIT,
): T[] {
  const q = query.trim().toLowerCase()
  if (q === '') return epics.slice(0, limit)
  const parsed = parseIssueNumberQuery(q)
  const numberQuery = parsed == null ? null : String(parsed)
  // 0: 번호 일치, 1: 제목 접두, 2: 제목 포함, 3: 번호 접두 — 같은 등급은 원래 순서(안정 정렬).
  const rank = (e: T): number | null => {
    const title = e.title.toLowerCase()
    const num = String(e.number)
    if (num === numberQuery) return 0
    if (title.startsWith(q)) return 1
    if (title.includes(q)) return 2
    if (numberQuery != null && num.startsWith(numberQuery)) return 3
    return null
  }
  return epics
    .flatMap((e, i) => {
      const r = rank(e)
      return r == null ? [] : [{ e, i, r }]
    })
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e)
}
