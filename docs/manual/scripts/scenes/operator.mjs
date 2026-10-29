// operator 매뉴얼 촬영 장면 목록. 실제 장면은 WP-1195 에서 채운다(사용자 매뉴얼 장면은 WP-1196).
//
// 장면 형식:
//   { id: '샷-id', account: '계정 아이디', async run({ page, rec, api }) { ... } }
//   - page: 로그인된 Playwright 페이지(뷰포트 1440x810, 배율 2, 라이트 테마)
//   - rec:  createShotRecorder — rec.mark(id, key, ...locators) 로 좌표를 쌓고 rec.shoot(page, id) 로 저장
//   - api:  (method, path, body?) → JSON. MANUAL_API 에 이 계정의 bearer 토큰으로 요청하는 시드용 헬퍼
//
// 페이지는 계정별로 공유된다: 장면은 먼저 자기 시작 URL 로 goto 한다(앞 장면의 화면이 남아 있을 수 있다).
// mark 와 shoot 는 같은 스크롤 위치에서 한다: 스크린샷은 뷰포트 기준이라 스크롤하면 좌표가 어긋난다.
// 결정적으로 찍는다: 촬영 중 스스로 바뀌는 UI(유휴 자동 복귀, 회전하는 캐러셀, 상대 시간 표기,
// 토스트)는 장면이 먼저 끄거나 고정한 뒤 찍는다. 안 그러면 재촬영마다 그림이 달라진다(smart-dcim 교훈).
export const scenes = [];
