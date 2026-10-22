// 노트 사이드바 페이지 트리 끌어 놓기의 스크린리더 안내(WP-838) — 지정하지 않으면 dnd-kit 영어 기본 문구
// (「Draggable item 1 was dropped over droppable area 2」·「To pick up a draggable item, press the space bar.」)가 원시 id 로 읽혔다.
// 이슈 보드(epicDnd)·홈 위젯과 같이 제목과 놓을 자리를 한국어로 읽고, 트리라 놓으면 들어갈 부모(없으면 최상위)도 알린다.
import type { Announcements, UniqueIdentifier } from '@dnd-kit/core'

// 드래그 가능 행의 사용법(aria-describedby). 들여쓰기(하위로 넣기)는 마우스 가로 끌기라 방향키는 위·아래만 안내한다.
export const WIKI_DND_SCREEN_READER_INSTRUCTIONS = {
  draggable: 'Space 키로 페이지를 집고, 위·아래 방향키로 옮길 자리를 고른 뒤 Space 키로 놓으세요. Esc 키를 누르면 취소됩니다.',
}

/** 놓을 자리 — 그 자리에 있던 행의 제목과, 놓으면 들어갈 부모 제목(null 이면 최상위). */
export interface WikiDropSpot {
  overTitle: string
  parentTitle: string | null
}

const where = (spot: WikiDropSpot) => (spot.parentTitle != null ? `「${spot.parentTitle}」 하위` : '최상위')

/**
 * titleOf: 행 id → 제목(빈 제목은 호출처가 「제목 없음」으로). spotOf: 지금 끌고 있는 페이지를 over 행 자리에 놓았을 때의 자리 —
 * 투영이 불가능(트리 갱신으로 행이 사라짐 등)하면 null.
 */
export function wikiDndAnnouncements(
  titleOf: (id: UniqueIdentifier) => string,
  spotOf: (activeId: UniqueIdentifier, overId: UniqueIdentifier) => WikiDropSpot | null,
): Announcements {
  const page = (id: UniqueIdentifier) => `「${titleOf(id)}」 페이지`
  return {
    onDragStart: ({ active }) => `${page(active.id)}를 집었습니다.`,
    onDragOver: ({ active, over }) => {
      // 집은 직후 over 가 자기 자신으로 잡혀 바로 불린다 — 「집었습니다」를 덮지 않게 읽지 않는다.
      if (over?.id === active.id) return undefined
      const spot = over ? spotOf(active.id, over.id) : null
      return spot
        ? `${page(active.id)}가 「${spot.overTitle}」 자리 위에 있습니다. 놓으면 ${where(spot)}에 들어갑니다.`
        : `${page(active.id)}가 놓을 자리 밖에 있습니다.`
    },
    onDragEnd: ({ active, over }) => {
      const spot = over && over.id !== active.id ? spotOf(active.id, over.id) : null
      return spot
        ? `${page(active.id)}를 「${spot.overTitle}」 자리에 놓았습니다(${where(spot)}).`
        : `${page(active.id)}를 놓았습니다. 위치는 그대로입니다.`
    },
    onDragCancel: ({ active }) => `${page(active.id)} 이동을 취소했습니다.`,
  }
}
