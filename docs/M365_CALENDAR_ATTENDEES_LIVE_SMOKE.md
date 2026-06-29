# M365 Calendar Attendees Live Smoke (#547)

모킹 테스트가 검증하지 못하는 Graph API 실제 계약을 확인하는 라이브 절차.
선행: [M365_CALENDAR_LIVE_SMOKE.md](M365_CALENDAR_LIVE_SMOKE.md) 기본 연결 확인 완료.

---

## 사전조건

1. `dh.yang@iacloud.kr` M365 계정이 앱에 연결되어 있어야 함
   - **필수 scope**: `Calendars.ReadWrite` (읽기만으로는 patchAttendees 불가)
   - scope 누락 시 → 설정 > M365 연결 해제 → 재연결(관리자 동의 포함)
2. API `:9090` 재시작 (머지 후 V111 마이그레이션 자동 적용)
3. `dh.yang@iacloud.kr` Outlook에 writable 캘린더 1개 이상 존재

---

## 1. 읽기 — 외부 참석자 표시

**시나리오**: Outlook에서 외부 이메일(예: gmail 계정)을 포함한 회의 생성 → 앱 동기화 → 외부 참석자 이메일 표시 확인.

1. Outlook에서 새 회의 생성, 외부 이메일(예: `test@gmail.com`) + 내부 멤버 초대
2. 앱에서 캘린더 → "지금 동기화" 버튼 클릭(또는 10분 대기)
3. 해당 일정 클릭 → 참석자 목록 확인:
   - **외부 참석자**: 아이콘 없이 이메일(`test@gmail.com`)이 텍스트로 표시
   - **내부 멤버**: 이름 + RSVP 아이콘 표시
   - **주최자(본인)**: `ORGANIZER` 배지

**합격 기준**: `EXTERNAL` kind 참석자가 `externalEmail` 값으로 렌더됨. 제거 버튼 없음.

---

## 2. 읽기 — RSVP 갱신

**시나리오**: 참석자가 Outlook에서 초대 수락 → 다음 sync 후 앱 반영.

1. 위 1번 회의의 참석자(외부 또는 내부)가 Outlook에서 수락
2. 앱 동기화(최대 10분)
3. 해당 일정 참석자 목록 확인

**합격 기준**: 수락한 참석자의 RSVP 아이콘이 초록(ACCEPTED)으로 변경됨.

---

## 3. 읽기 — 내가 초대받은 일정(읽기 전용)

**시나리오**: 타인(예: 동료)이 주최한 회의에 `dh.yang@iacloud.kr` 초대 → 동기화 후 읽기 전용 확인.

1. 동료 Outlook에서 `dh.yang@iacloud.kr` 초대 회의 생성
2. 앱 동기화 후 해당 일정 클릭
3. UI 확인:
   - **invite 버튼 없음** (`myRole !== 'ORGANIZER'`)
   - **참석자 제거 버튼 없음**
   - **RSVP 컨트롤 없음** (`external=true` 가드)
   - 참석자 목록은 읽기 전용으로 표시

**합격 기준**: 비주최자 일정에서 참석자 편집 UI가 완전히 숨겨짐.

---

## 4. 쓰기 — 일정 생성 시 참석자 전송

**시나리오**: 앱에서 외부 캘린더에 내부 멤버를 포함해 일정 생성 → Outlook에 참석자로 반영.

1. 앱 캘린더 → 외부(M365) 캘린더에 새 일정 생성
2. 참석자 섹션에서 내부 멤버(예: `sg.lee@iacloud.kr`) 추가
3. 일정 저장
4. `dh.yang@iacloud.kr` Outlook에서 해당 일정 확인

**합격 기준**:
- Outlook 일정에 내부 멤버가 참석자로 표시됨
- 해당 멤버에게 초대 이메일 수신 (Exchange 라우팅 의존)

---

## 5. 쓰기 — 참석자 추가(invite)

**시나리오**: 내가 주최한 외부 일정에서 앱으로 참석자 추가 → Graph 반영.

1. 앱에서 내가 만든 외부 일정 클릭(주최자)
2. 참석자 섹션 "+" 버튼으로 내부 멤버 초대
3. `dh.yang@iacloud.kr` Outlook에서 해당 일정 확인

**합격 기준**:
- Outlook 일정 참석자 목록에 새 멤버 추가됨
- 기존 참석자가 **그대로 유지됨** (PATCH = 전체 목록 교체이므로 기존 참석자 유지 필수)

---

## 6. 쓰기 — 참석자 제거(remove)

**시나리오**: 내가 주최한 외부 일정에서 참석자 제거 → Graph 반영.

1. 위 5번 일정에서 방금 추가한 멤버의 X 버튼 클릭
2. Outlook에서 해당 일정 확인

**합격 기준**: 제거된 멤버가 Outlook 일정 참석자 목록에서 사라짐.

---

## 7. ⭐ 라운드트립 보존 — 내부 참석자가 외부로 뒤집히지 않는지

**시나리오**: 앱에서 생성한 일정의 내부 참석자가 다음 read-sync 후에도 `EXTERNAL`이 아닌 내부 참석자로 유지되는지 확인.

1. 4번 절차로 내부 멤버(`sg.lee@iacloud.kr`)를 포함해 일정 생성
2. 앱 재동기화(10분 또는 버튼) 후 해당 일정 참석자 목록 확인

**합격 기준**: `sg.lee@iacloud.kr` 참석자가 `kind: 'HUMAN'`(내부)으로 유지됨. `EXTERNAL` kind로 변경되면 **매칭 로직 버그** — `user.email`과 Graph 반환 주소가 다를 수 있음(별칭/프록시). 발견 시: `GraphCalendarFetcher.resolveSpec` 의 계정 이메일 매칭 로직 보강 필요.

---

## 8. ⭐ 비주최자 차단 API 확인

**시나리오**: 내가 초대받은 일정(비주최자)에서 API로 직접 invite 호출 → 409 응답.

```bash
# 비주최자 외부 일정 ID 조회
curl -s -H "Authorization: Bearer <jwt>" http://localhost:9090/api/v1/calendar/events?calendarId=<cal_id>

# 해당 이벤트에 직접 invite 시도
curl -X POST http://localhost:9090/api/v1/calendar/events/<event_id>/attendees \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"userIds": [<some_user_id>]}'
```

**합격 기준**: `409 Conflict` + `"동기화로 받은 일정의 참석자는 변경할 수 없습니다(주최자가 아님)."` 메시지.

---

## 9. 진단법 — 토큰 없이 Graph 직접 호출

Graph 응답과 앱 로컬 상태를 비교하는 절차 (#502 절차 재사용).

```bash
# dev DB에서 암호화된 액세스 토큰 조회
docker exec smart-workplace-db-1 psql -U app -d workplace -c \
  "SELECT access_token FROM oauth_access_token WHERE user_id = <user_id> LIMIT 1;"

# AES-GCM 복호화 (dev master key: testtest...)
# EncryptionService.decrypt(accessToken) 로직 참고

# Graph 직접 호출 — 일정 참석자 확인
curl -s -H "Authorization: Bearer <decrypted_token>" \
  "https://graph.microsoft.com/v1.0/me/events/<external_id>?$select=attendees,organizer" \
  | jq '.attendees[] | {email: .emailAddress.address, response: .status.response}'
```

---

## 체크리스트

| # | 항목 | 결과 |
|---|------|------|
| 1 | 외부 참석자 이메일 렌더 | ☐ |
| 2 | RSVP 갱신 반영 | ☐ |
| 3 | 비주최자 일정 읽기 전용 UI | ☐ |
| 4 | create 시 Graph 참석자 전송 | ☐ |
| 5 | invite 후 기존 참석자 유지 | ☐ |
| 6 | remove 후 Graph 반영 | ☐ |
| 7 | ⭐ 라운드트립 보존(내부→HUMAN 유지) | ☐ |
| 8 | ⭐ 비주최자 API 409 차단 | ☐ |
