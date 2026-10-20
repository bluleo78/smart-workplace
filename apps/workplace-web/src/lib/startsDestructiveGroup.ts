// 작업 메뉴 구분선 규칙 — 휴대폰 시트(MobileActionSheet)·드롭다운(ActionMenuItems)가 함께 쓴다(WP-363).

/**
 * 일반 항목 다음에 처음 나오는 파괴적 항목인지 — 그 앞에 구분선을 둬 삭제를 자주 쓰는 작업과 떼어 놓는다.
 * 데스크톱·태블릿·휴대폰 메뉴가 같은 모양이 되게 한 규칙이다.
 */
export function startsDestructiveGroup(items: ReadonlyArray<{ destructive?: boolean }>, i: number): boolean {
  return !!items[i].destructive && i > 0 && !items[i - 1].destructive
}
