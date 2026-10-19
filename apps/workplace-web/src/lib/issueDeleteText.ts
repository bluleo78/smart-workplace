// 단건 이슈 삭제 확인창 문구(WP-469) — 에픽은 「에픽 삭제」·「하위 이슈 N개(태스크·버그 등)도 함께 삭제」로 알린다.
// 예전엔 유형과 무관하게 「태스크 삭제 / 하위 태스크 N개」여서, 에픽을 지우면 일반 태스크·버그까지 통째로 지워진다는 점이 드러나지 않았다
// (에픽 화면은 하위 목록을 「하위 이슈」라 부른다).

/** 확인창 제목에 쓸 대상 이름 — 에픽만 「에픽」, 그 밖은 「태스크」. */
export function issueDeleteEntityName(typeName: string | null | undefined): string {
  return typeName === 'EPIC' ? '에픽' : '태스크';
}

/**
 * 하위가 함께 지워진다는 경고 문구. 하위가 없으면 null(호출측 기본 문구를 쓴다). titleText 가 있으면 「"제목"에는」, 없으면 「이 에픽에는」처럼 쓴다.
 */
export function issueDeleteChildrenWarning(
  typeName: string | null | undefined,
  childCount: number,
  titleText?: string,
): string | null {
  if (childCount <= 0) return null;
  const epic = typeName === 'EPIC';
  const subject = titleText ? `「${titleText}」에는` : epic ? '이 에픽에는' : '이 태스크에는';
  return epic
    ? `${subject} 하위 이슈가 ${childCount}개 있습니다. 하위 이슈(태스크·버그 등)도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`
    : `${subject} 하위 태스크가 ${childCount}개 있습니다. 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`;
}
