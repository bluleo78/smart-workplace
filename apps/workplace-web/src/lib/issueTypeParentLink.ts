// 왜: 서버 IssueService.setType 의 releasesParent 와 식을 같이 유지해야 한다(WP-2097)

/**
 * 유형 변경이 기존 상위를 풀어 주는지(WP-2097) — 서버 IssueService.setType 의 releasesParent 와
 * 식을 같이 둔 유일한 판정 원본. 다른 함수는 이 함수를 부른다.
 *
 * 서버 규칙(issue.parentIssueId != null 조건은 shouldShowParentLinkChange 가 맡는다):
 * (SUBTASK → 비SUBTASK) 또는 (무관 → EPIC)
 */
export function releasesParentType(oldTypeName: string, newTypeName: string): boolean {
  return (oldTypeName === 'SUBTASK' && newTypeName !== 'SUBTASK') || newTypeName === 'EPIC'
}

/**
 * 상위 변경 확인 대화상자를 열지 — 서버의 `issue.parentIssueId() != null` 에 해당하는
 * 상위가 있어야(hasParent) releases 여부를 묻는다(Review Focus 4).
 * (WP-2131) 읽을 수 없는 상위는 키가 없어도 상위가 있으므로 parentKey 대신 hasParent 로 판정한다.
 */
export function shouldShowParentLinkChange(input: {
  oldTypeName: string
  newTypeName: string
  hasParent: boolean
}): boolean {
  return input.hasParent && releasesParentType(input.oldTypeName, input.newTypeName)
}

/**
 * 대화상자 선택지 — 지금 상위가 에픽 아래면(할아버지가 에픽) 「에픽 아래로 유지」 선택지에 그 에픽을
 * 싣고, 아니면 상위 없이 떼어내기(detach) 만 돌려준다.
 *
 * 신규 유형이 EPIC 이면(완료 기준 7) 에픽은 상위를 둘 수 없어 어디 있든 이동할 곳이 없다 —
 * 할아버지 에픽이 실려 있어도 무조건 detach 만 낸다(그래야 parentKey 없는 payload 가 나간다).
 */
export function parentLinkChangeChoices(input: {
  newTypeName: string
  grandparentTypeName: string | null
  grandparentKey: string | null
  grandparentTitle: string | null
}): { choice: 'move-under-epic' | 'detach'; epic?: { key: string; title: string } } {
  const { newTypeName, grandparentTypeName, grandparentKey, grandparentTitle } = input
  if (
    newTypeName !== 'EPIC' &&
    grandparentTypeName === 'EPIC' &&
    grandparentKey != null &&
    grandparentTitle != null
  ) {
    return { choice: 'move-under-epic', epic: { key: grandparentKey, title: grandparentTitle } }
  }
  return { choice: 'detach' }
}
