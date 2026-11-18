// 설정 › API 토큰 「연결된 앱」 절의 앵커·이동 주소(WP-1687) — 한곳에 둔다.
// 절(ConnectedAppsSection)의 id·해시 비교와 알림 이동 주소(notifTarget)가 같은 글자를 써야 알림을 눌렀을 때 절로 스크롤된다.
// 설정 화면 컴포넌트가 home 컴포넌트(notifTarget)를 불러오지 않도록 둘 다 이 작은 모듈을 불러온다.
// 서버 푸시 이동 주소(PushContentService 의 OAUTH_APP_CONNECTED)는 자바라 이 상수를 쓸 수 없어 같은 글자를 따로 적는다.

/** 「연결된 앱」 절의 id 이자 이동 주소의 앵커(# 뒤 글자). */
export const CONNECTED_APPS_ANCHOR = 'connected-apps'

/** 새 앱 연결 알림·푸시가 여는 주소 — 긴 토큰 목록을 지나지 않고 곧장 끊는 곳에 닿도록 앵커를 붙인다. */
export const CONNECTED_APPS_PATH = `/settings/tokens#${CONNECTED_APPS_ANCHOR}`
