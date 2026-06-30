// 가상 첨부를 출처 위치(이슈·채널)별로 묶는 순수 함수.
import type { VirtualAttachment } from '@/types/drive'

/** 출처 위치별 첨부 그룹. key = `${sourceType}|${deepLink}`. */
export interface AttachmentGroup {
  key: string
  sourceType: 'ISSUE' | 'MESSAGE'
  sourceLabel: string
  deepLink: string
  items: VirtualAttachment[]
}

/**
 * 첨부 배열을 출처 위치별 그룹으로 묶는다.
 * - 입력은 attachedAt DESC 정렬(백엔드)이라고 가정.
 * - 그룹 순서 = 각 그룹의 첫 등장 순서(= 가장 최근 항목) → 페이지를 더 로드해도 헤더 순서 안정.
 * - 그룹 내 항목 순서 = 입력 순서 보존(attachedAt DESC).
 * Map 의 삽입 순서 보존 특성을 이용한다.
 */
export function groupAttachments(items: VirtualAttachment[]): AttachmentGroup[] {
  const map = new Map<string, AttachmentGroup>()
  for (const a of items) {
    const key = `${a.sourceType}|${a.deepLink}`
    let g = map.get(key)
    if (!g) {
      g = { key, sourceType: a.sourceType, sourceLabel: a.sourceLabel, deepLink: a.deepLink, items: [] }
      map.set(key, g)
    }
    g.items.push(a)
  }
  return [...map.values()]
}
