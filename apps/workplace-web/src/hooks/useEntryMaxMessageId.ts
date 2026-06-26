import { useRef } from 'react'

// 진입 시점(첫 로드)의 최대 메시지 id 를 채널/DM 별로 고정한다.
// 미읽음 구분선·캐치업은 "진입 전부터 있던, 안 읽은" 메시지만 대상으로 해야 한다(#491).
// 진입 후 도착한 라이브 메시지(내 전송·AI 답글·남의 신규)는 이 값을 넘으므로 경계에서 제외된다 —
// 진입-고정 watermark 가 내 활동으로 갱신되지 않아, 이 상한이 없으면 진입 후 모든 메시지가
// 미읽음으로 잡혀 유령 구분선/캐치업이 부활한다.
//
// useChannelMessages 는 channelId 별 쿼리 키라 채널 전환 시 messages 가 빈 배열로 시작한다(stale 없음).
// 따라서 채널이 바뀌면 새 채널 데이터가 로드되는 순간 자동으로 재스냅샷된다.
export function useEntryMaxMessageId(
  channelId: number | undefined,
  messages: { id: number }[],
): number | null {
  const ref = useRef<{ channelId: number; maxId: number } | null>(null)
  // 의도적 렌더타임 ref 스냅샷(#491): 진입 시점의 maxId 를 채널별로 1회 고정한다.
  // effect 로 옮기면 스냅샷이 렌더 이후로 밀려 진입 직후 메시지들이 미읽음으로 잡히고
  // 유령 구분선/캐치업이 부활한다 → react-hooks/refs 룰을 이 블록에 한해 비활성.
  /* eslint-disable react-hooks/refs */
  if (channelId != null && messages.length > 0) {
    if (ref.current === null || ref.current.channelId !== channelId) {
      ref.current = {
        channelId,
        maxId: messages.reduce((mx, m) => (m.id > mx ? m.id : mx), 0),
      }
    }
  }
  return ref.current && ref.current.channelId === channelId ? ref.current.maxId : null
  /* eslint-enable react-hooks/refs */
}
