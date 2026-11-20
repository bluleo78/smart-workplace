import { toast } from 'sonner'

import { isTransientRequestError } from '../../lib/api-error'

/**
 * 메신저 읽음 처리 실패 토스트(WP-1855) — 채널/DM(useMarkMessageRead)·이슈 채팅(useMarkChatRead)·스레드 읽음 훅이 함께 쓴다.
 * 문구와 id 를 한곳에 두어 훅끼리 어긋나지 않게 한다. id 가 고정이라 연속 실패해도 토스트는 한 장만 보인다.
 */
export function toastMessageReadError() {
  toast.error('읽음 처리하지 못했습니다', { id: 'message-read-error' })
}

/**
 * 읽음 처리 실패 정책(WP-1855) — 읽음 훅 셋이 실패 때 이 함수 하나만 부른다.
 * 일시 오류(네트워크·5xx·408·429)는 중복 억제 기준을 되돌려(rollback) 다음 확인(탭 포커스·intersection)에서 같은 id 를 다시 보내게 하고,
 * 고정 id 토스트 한 장으로 알린다. 영구 4xx(401·403·404 등)는 다시 보내도 결과가 같으므로 되돌리지도 알리지도 않는다 —
 * 되돌리면 탭 포커스·intersection 마다 재전송·재토스트가 반복되고, 로그아웃 뒤 언마운트 flush 의 401 이 로그인 화면에 거짓 토스트를 띄운다.
 * rollback 이 없는 호출처(스레드 읽음)는 되돌림을 자체 처리하므로 알림만 이 정책에 따른다.
 */
export function reportReadFailure(error: unknown, rollback?: () => void): void {
  if (!isTransientRequestError(error)) return
  rollback?.()
  toastMessageReadError()
}
