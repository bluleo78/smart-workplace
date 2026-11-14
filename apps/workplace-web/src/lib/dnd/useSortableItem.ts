// eslint-disable-next-line no-restricted-imports -- 공용 래퍼 자신(WP-1549)
import { useSortable, type UseSortableArguments } from '@dnd-kit/sortable'

/**
 * 드래그로 순서를 바꾸는 항목의 스크린리더 설명(aria-roledescription) — WP-1549.
 * dnd-kit 기본값은 영어 「sortable」이라 한국어 화면에서 스크린리더가 영어로 읽는다(WCAG 3.1.2·4.1.2).
 */
export const SORTABLE_ROLE_DESCRIPTION = '순서를 바꿀 수 있는 항목'

/**
 * 보드 카드 설명(WP-1549) — 보드에서 끌기는 순서보다 열(상태)·에픽 이동이라 이슈 목록 행(IssueListRow)과 같은 문구를 쓴다.
 */
export const DRAGGABLE_ISSUE_ROLE_DESCRIPTION = '드래그 가능한 이슈'

/**
 * 노트 트리 행 설명(WP-1549) — 순서뿐 아니라 다른 페이지 아래로 넣기(중첩)·옮기기가 되므로 「순서」 대신 이 문구를 쓴다.
 */
export const DRAGGABLE_PAGE_ROLE_DESCRIPTION = '드래그 가능한 페이지'

/**
 * useSortable 에 한국어 roleDescription 을 넣어 주는 공용 훅(WP-1549).
 * DndContext 의 accessibility 옵션에는 roleDescription 이 없어 항목마다 넘겨야 하므로, 정렬 목록은 모두 이 훅을 쓴다
 * (eslint no-restricted-imports 로 useSortable 직접 사용을 막는다). 호출자가 attributes 를 따로 주면 그 값이 이긴다 —
 * role·tabIndex 는 그대로 넘기고, roleDescription 만 비어 있을 때 한국어 기본값을 채운다.
 * 반환값은 useSortable 그대로라 기존 구조 분해(attributes·setActivatorNodeRef 등)가 바뀌지 않는다.
 */
export function useSortableItem(args: UseSortableArguments) {
  return useSortable({
    ...args,
    attributes: {
      ...args.attributes,
      roleDescription: args.attributes?.roleDescription ?? SORTABLE_ROLE_DESCRIPTION,
    },
  })
}
