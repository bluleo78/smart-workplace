// 드라이브 공유 링크 나누기(WP-1528) — 공유 창은 지금 쓸 수 있는 링크를 먼저 보이고, 폐기·만료된 링크는 「지난 링크」로 접는다.
// 화면과 떼어 순수 함수로 둔다.
import type { ShareLink } from '@/types/drive'

/**
 * 지금 쓸 수 있는 링크인가 — 서버가 자기 시계로 판정한 active 를 따른다(폐기되지 않았고 만료 전).
 * 브라우저 시계로 다시 판정하지 않는다: 시계가 틀린 PC 에서 살아 있는 링크가 지난 링크로 숨거나 그 반대가 되지 않게(코드 리뷰).
 * 방금 폐기한 항목은 화면이 active 도 함께 끄므로 active 하나만 보면 된다.
 */
function isShareLinkLive(link: ShareLink): boolean {
  return link.active
}

/** 살아 있는 링크(live)와 지난 링크(past)로 나눈다 — 각자 입력 순서(서버 정렬)를 그대로 지킨다. */
export function splitShareLinks(links: ShareLink[]): { live: ShareLink[]; past: ShareLink[] } {
  const live: ShareLink[] = []
  const past: ShareLink[] = []
  for (const link of links) (isShareLinkLive(link) ? live : past).push(link)
  return { live, past }
}
