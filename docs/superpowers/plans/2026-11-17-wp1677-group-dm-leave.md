# WP-1677 끝난 그룹 DM 에서 나가기 — 구현 계획

## 목표

그룹 DM(본인 포함 3명 이상)에서 「대화 나가기」로 빠질 수 있게 한다. 1:1·나 혼자 DM 은 나갈 수 없다(서버가 400 으로 막는다).

## 범위

1. **API** — `ChannelMemberService.leave()`
   - 채널이 DM 이고 현재 구성원(`channel_member` 행) 2명 이하면 `InvalidDmRequestException("1:1 대화는 나갈 수 없습니다")` → 400.
     웹이 그룹 DM 을 가르는 기준(`dm.participants.length > 2`, 참여자 = 현재 구성원)과 같은 수를 쓴다.
   - 판정은 존재 은닉(비멤버 404)·잠금 뒤, 실제 삭제 전. 사전검증(`validateLeavable`, AI 확인 카드 dry-run)도 같은 술어(`checkLeave`)를 지나므로 함께 막힌다.
   - 그룹 DM 나가기·`DmService.createOrGet`/`rejoinIfLeft`(WP-507) 동작은 그대로.
2. **웹** — `DmHeader` 「⋯」 메뉴
   - 그룹 DM 에만 구분선 + 「대화 나가기」(`variant="destructive"`).
   - 확인 창(AlertDialog): 「대화 나가기」/「나가면 새 메시지·알림을 받지 않고 참여자 목록에서 빠집니다」/「취소」·「나가기」(destructive).
   - `useLeaveChannel` 호출 → 성공 시 `/chat`(숨기기와 같은 곳). `useLeaveChannel` 성공 시 DM 목록·안 읽음 요약도 무효화.
3. **MCP** — `leave_channel` 설명에 「그룹 DM 은 되고 1:1 DM 은 안 된다」를 짧게(토큰 상한 그대로), 스냅샷 갱신.
4. **매뉴얼** — `docs/manual/user/05-chat.md` DM 숨기기 옆에 나가기 절차.

## 테스트(TDD)

- JUnit(`ChannelMemberServiceTest` 또는 DM 서비스 테스트): 1:1 400 · 나 혼자 400 · 그룹 나가기 성공 · 남은 사람이 같은 구성으로 열어도 나간 사람 미복귀 · 나간 사람이 열면 재참여.
- vitest(`dmPage.test.tsx`·`dmPageMobile.test.tsx`): 그룹 DM 메뉴에 항목이 보이고 1:1·셀프엔 없다, 확인 → leave 호출 → `/chat`, 취소 → 호출 없음.
- MCP vitest: 도구 설명 스냅샷·토큰 상한.
- E2E: 휴대폰 390px 메뉴 항목이 화면 안에 보이는지 `@layout` 1건(실행은 생략 가능).
