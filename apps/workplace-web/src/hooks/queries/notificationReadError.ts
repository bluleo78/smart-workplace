import { toast } from 'sonner'

/**
 * 알림 읽음 처리 실패 토스트(WP-1842) — 「모두 읽음」·개별 읽음 훅이 함께 쓴다.
 * 문구와 id 를 한곳에 두어 둘이 어긋나지 않게 한다. 같은 id 라 한 화면(홈 위젯)에서 둘 다 실패하거나
 * 묶음의 id 마다 실패해도 토스트는 한 장만 보인다.
 */
export function toastNotificationReadError() {
  toast.error('읽음 처리하지 못했습니다', { id: 'notification-read-error' })
}
