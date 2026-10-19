// 삭제 확인창의 영향 안내(WP-488) — 멤버 제거·라벨·사이클 삭제는 이슈의 담당자·라벨·사이클 연결을 함께 지우므로, 몇 개의 이슈가
// 영향을 받는지 미리 알린다(마일스톤 삭제 확인창과 같은 취지). 0건이거나 아직 모르면 안내하지 않는다(null).

export type DeletionImpactKind = 'member' | 'label' | 'cycle';

export function deletionImpactNote(kind: DeletionImpactKind, count: number | undefined): string | null {
  if (count == null || count <= 0) return null;
  switch (kind) {
    case 'member':
      return `담당 중인 이슈 ${count}개에서 담당자가 해제됩니다.`;
    case 'label':
      return `이 라벨이 붙은 이슈 ${count}개에서 라벨이 빠집니다.`;
    case 'cycle':
      return `이 사이클의 이슈 ${count}개가 사이클에서 빠집니다(이슈는 지워지지 않습니다).`;
  }
}
