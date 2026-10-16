/**
 * 순서를 유지한 채 연달아 같은 이름을 받는 항목끼리 묶는다 — 최신순 기록을 날짜 묶음으로 나눌 때 쓴다(메모리 「AI가 정리한 기록」·노트 버전 기록).
 * 이름은 label 이 정한다(KST 오늘·어제·날짜, 로컬 날짜 등 — 부르는 쪽 기준).
 */
export function groupConsecutive<T>(entries: readonly T[], label: (e: T) => string): { label: string; entries: T[] }[] {
  const groups: { label: string; entries: T[] }[] = []
  for (const e of entries) {
    const name = label(e)
    const last = groups.at(-1)
    if (last?.label === name) last.entries.push(e)
    else groups.push({ label: name, entries: [e] })
  }
  return groups
}
