// 위젯 본문 호스트(WP-2077) — 본문(EntryBody)을 카드 밖 한 곳에서 한 번만 그리고, 카드는 OutPortal 로 그 DOM 을 가져다 붙인다.
// 보기↔편집 전환에서 카드 요소 타입(Card/div)이 바뀌어도 본문은 다시 만들어지지 않아 fetch·상태·이펙트를 잃지 않는다. (DOM 노드를 옮기면 안쪽 스크롤·포커스·iframe 은 초기화되지만 현재 본문에는 해당 요소가 없다.)
// 한계: 본문은 React 트리에서 카드 밖이라 카드의 React 이벤트 핸들러(onClick·onKeyDown)로 본문 이벤트가 버블되지 않고, 카드 안 컨텍스트도 받지
// 못한다 — 본문이 써야 할 카드 단위 provider 는 이 호스트 안 EntryBody 를 감싸 둔다(지금은 헤딩 레벨만 그렇게 넘긴다).
import { InPortal, type PortalNode } from '@/lib/portalSlot'

import type { WidgetHeadingLevel } from '../widgets/WidgetFrame'
import { EntryBody } from './EntryBody'
import type { ResolvedEntry } from './resolvedEntry'

/**
 * entries 마다 본문을 자기 PortalNode 안에 그린다. 호스트 자체는 DOM 을 만들지 않고(portal 만 렌더),
 * 노드는 각 카드의 OutPortal 이 제자리로 옮긴다. key 는 위젯 id 라 순서가 바뀌어도 본문이 유지된다.
 */
export function WidgetBodyHost({
  entries,
  nodeFor,
  headingLevelFor,
}: {
  entries: ResolvedEntry[]
  nodeFor: (id: string) => PortalNode
  headingLevelFor: (entry: ResolvedEntry) => WidgetHeadingLevel
}) {
  return (
    <>
      {entries.map((entry) => (
        <InPortal key={entry.cfg.id} node={nodeFor(entry.cfg.id)}>
          <EntryBody entry={entry} frameHeadingLevel={headingLevelFor(entry)} />
        </InPortal>
      ))}
    </>
  )
}
