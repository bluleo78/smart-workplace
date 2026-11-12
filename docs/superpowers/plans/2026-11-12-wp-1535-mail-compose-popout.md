# WP-1535 메일 작성 창 「새 창으로 열기」 계획

## 목표
데스크톱 작성창 머리줄의 「새 창으로 열기」(↗)로 지금 작성을 독립 브라우저 창(900×760)에서 이어 쓴다. 보내거나 닫거나 버리면 그 창은 스스로 닫히고, 메인 창의 보낸편지함·임시보관함이 바로 갱신된다.

## 설계
- **경로** `/mail/compose?draftId=N` — `ProtectedRoute` 아래, `AppLayout` 밖(앱 셸 없음). 페이지는 lazy.
  공급자는 `MailComposeProvider` + `AIAssistantProvider(hotkeysEnabled=false)` + `HelpPanelProvider`(testkit-b4 와 같은 조합).
  처음 한 번 `useOpenMailDraft()(id)` 로 작성을 연다(StrictMode 두 번 실행 가드). 못 받으면 창 안에 오류 + 닫기.
- **작성창 popout 모드**(`MailComposeDock popout`): 데스크톱 배치 고정(900px 창은 lg 미만이라 모바일로 그려지므로 isMobile=false),
  창 전체 패널, 배경·inert·Esc·최소화·크게 보기·새 창 단추 없음. 탭 제목 = 제목 또는 「새 메일」.
  닫기·버리기·보내기는 서버 작업(저장·삭제·발송)이 끝난 뒤 `onPopoutDone(kind, accountId)` → 페이지가 알리고 `window.close()`.
  닫기 저장이 실패하면 창을 닫지 않고 오류 토스트를 띄운다(쓴 것을 잃지 않게).
- **새 창 단추**(메인 창, 데스크톱 전용): 클릭에서 동기로 `window.open('', 고유이름, 'popup,width=900,height=760')`.
  null(차단)이면 토스트, 작성창 그대로. 열리면 작성창을 잠그고(inert) 강제 저장(`flush({ force: true })` — 손대지 않은 새 메일·답장도 id 를 받게).
  성공 → `autosave.end()` + 저장 알림 없이 닫기 + `win.location.href = /mail/compose?draftId=N`. 실패 → 빈 창 닫고 토스트.
  첨부 업로드 중·실패, 붙여 넣은 그림 업로드 중, AI 초안 생성 중, 보내는 중엔 단추를 끈다(기다리지 않고 막는다).
- **창 사이 알림** `lib/mailComposeChannel.ts`: `BroadcastChannel('mail-compose')`, 없으면 `window.opener.postMessage`(같은 출처 확인).
  메시지 `{ type: 'sent' | 'saved' | 'discarded' | 'closed', accountId }`. 메인 창(AppLayout 아래 `MailComposePopoutSync`)은
  보낸편지함(`['mail-messages', id, 'SENT']`)·임시보관함(`mailDraftKeys.account(id)`)을 무효화하고 sent/saved/discarded 를 토스트로 알린다.
  창을 OS 닫기로 닫으면 pagehide 에 `closed` 를 보내 임시보관함만 갱신한다.

## 내가 정한 것
- 경로 `/mail/compose?draftId=N`.
- 업로드 중엔 기다리지 않고 단추를 끈다(툴팁에 이유).
- 버린 뒤 「되돌리기」는 팝업이 닫혀 누를 수 없으므로 메인 창 토스트는 「임시저장을 버렸어요」만(되돌리기 없음).
- 서명 설정 링크(데스크톱)는 팝업 안에서 이동하지 않고 새 탭으로 연다.
- refresh 회전: 서버에 5초 grace + family 생존 확인이 있어(`AuthService.refresh`, `RefreshTokenReuseRevocationTest`) 두 창이 동시에 refresh 해도
  재사용 탐지로 끊기지 않는다 — 서버 변경 없음.

## 테스트
- vitest: 단추(데스크톱 보임·모바일 없음), 클릭 → 강제 POST·window.open 주소, 차단 → 도크 유지·토스트, 업로드 중 꺼짐,
  팝업 경로(셸 없음·작성 렌더), 보내기 뒤 알림·window.close, 메인 창 무효화.
- E2E `@platform` 1건: 실제 팝업(`context.waitForEvent('page')`), context.route 로 API 모킹.
- 매뉴얼 06-mail 에 「새 창으로 열기」, `pnpm manual:check`·`pnpm manual:prose`.

## 리뷰 반영(b1fe8f6b0 뒤)
- 새 창 버리기가 실패하면 자동 저장 세션을 다시 살린다(dirty) — 이어 쓴 내용이 ✕ 로 저장된다.
- 저장하는 동안 빈 창이 닫히면(win.closed) 앱 안 작성창을 그대로 둔다.
- 손대지 않은 작성을 옮기려 강제로 만든 임시저장은 주소에 `fresh=1` — 새 창에서도 손대지 않고 닫으면 지우고 결과 알림 없이(closed) 닫는다.
- ↗ 는 gone 이면 꺼지고 이유를 툴팁으로, invalid(400) 저장 실패는 서버 사유를 토스트로 보인다(flush 결과에 reason).
- 알림에 `opener`(연 창의 id, 주소로 전달)·`draftId` — 결과 토스트는 연 창만, 다른 탭은 목록만 갱신.
- 연 창은 새 창으로 옮긴 임시저장과 Window 를 기억한다. 임시보관함에서 다시 열면 그 창을 focus 하고 「이 메일은 새 창에서 쓰는 중이에요」 토스트(창 전환 성공 여부를 알 수 없어 늘 띄운다). 알림이 오거나 창이 닫히면 잊는다.
- 새 창 오류 화면은 렌더 중 setState 없이 상태에서 판정한다.
