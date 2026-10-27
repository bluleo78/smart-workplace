// 단건 이슈 삭제 확인창 문구(WP-469) — 에픽은 「에픽 삭제」로 알린다(에픽 화면은 하위 목록을 「하위 이슈」라 부른다).
// WP-1038 부터 에픽을 지워도 하위 이슈는 지우지 않고 에픽 연결만 푼다(하위가 다른 프로젝트에 있을 수 있다). 일반 이슈의 하위 태스크는 예전처럼
// 함께 지워진다.

/** 확인창 제목에 쓸 대상 이름 — 에픽만 「에픽」, 그 밖은 「태스크」. */
export function issueDeleteEntityName(typeName: string | null | undefined): string {
  return typeName === 'EPIC' ? '에픽' : '태스크';
}

/**
 * 하위에 대한 경고 문구 — 에픽은 「하위는 남고 에픽 연결만 풀린다」, 일반 이슈는 「하위 태스크도 함께 지워진다」. 하위가 없으면 null(호출측 기본 문구를
 * 쓴다). titleText 가 있으면 「"제목"에는」, 없으면 「이 에픽에는」처럼 쓴다.
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
    ? `${subject} 하위 이슈가 ${childCount}개 있습니다. 하위 이슈는 지워지지 않고 에픽 연결만 풀립니다. 이 작업은 되돌릴 수 없습니다.`
    : `${subject} 하위 태스크가 ${childCount}개 있습니다. 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`;
}
