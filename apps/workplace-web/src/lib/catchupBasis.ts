// 채널 캐치업 카드의 근거 표기(WP-1183) — 카드 컴포넌트 파일은 컴포넌트만 내보내야 해(fast refresh) 따로 둔다.
import type { ChannelCatchupResponse } from '@/types/messaging'

/**
 * 카드 푸터의 근거 표기 — 미읽음이 요약 상한을 넘어 최근 것만 요약했으면 「최근 N건」으로 밝힌다(WP-1183 — 실제 210건인데 「근거 200건」으로
 * 보였다). summarizedCount 가 없으면(예전 서버) 미읽음 수 그대로.
 */
export function catchupBasisLabel(data: Pick<ChannelCatchupResponse, 'unreadCount' | 'summarizedCount'>): string {
  const summarized = data.summarizedCount ?? data.unreadCount
  return summarized < data.unreadCount ? `근거 최근 ${summarized}건 기준` : `근거 ${data.unreadCount}건 기준`
}
