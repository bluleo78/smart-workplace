# M365 캘린더 동기화 라이브 스모크 체크리스트

> 이슈: #501 — M365 Graph API 캘린더 읽기 동기화

## 사전 준비

### 1. ⚠️ Azure 앱 등록 — `Calendars.Read` 권한 추가 + 관리자 동의

1. [Azure 포털](https://portal.azure.com) → 앱 등록 → `aa9c80a9-...` 앱 선택.
2. **API 사용 권한** → **권한 추가** → Microsoft Graph → **위임된 권한** → `Calendars.Read` 추가.
3. **"iacloud.kr에 대한 관리자 동의 허용"** 버튼 클릭 → 상태가 ✅ 녹색으로 바뀌는지 확인.
   - ⚠️ 테넌트 사용자 동의 차단 정책으로 인해 사용자가 직접 동의할 수 없음(버튼 회색).
   - 관리자 동의 없이 OAuth 흐름 진행 시 `AADSTS65001` 오류 발생.

### 2. 기존 M365 계정 재연결 (새 스코프 동의)

1. 앱 **설정 → 계정 연결** 에서 기존 M365 계정 연결 해제.
2. **M365 Graph 계정 재연결** — OAuth 팝업 흐름으로 새 `Calendars.Read` 스코프 동의.
3. 재연결 후 `refresh_token` 갱신 완료 확인 (`email_account.oauth_refresh_token` 업데이트).

### 3. API 재시작 + 스케줄러 대기

```bash
# :9090 API 재시작 (스케줄러 로드)
./gradlew :apps:workplace-api:bootRun

# 재시작 후 스케줄러 1사이클(최대 10분) 대기 — 수동 트리거 엔드포인트 없음
```

---

## 검증 항목

### 4. 캘린더 페이지 — 실제 M365 일정 노출 확인

- [ ] `/calendar` 페이지에 M365 계정의 실제 일정이 표시된다.
- [ ] **오늘 위젯** (홈 화면)에 M365 일정이 포함되어 표시된다.
- [ ] 사이드바에 외부 캘린더 컨테이너가 표시되고 **읽기 전용 배지**가 보인다.
- [ ] 외부 캘린더 컨테이너의 일정을 클릭하면 **편집 버튼이 비활성화** 또는 편집 시도 시 차단된다.
- [ ] 종일 일정이 날짜 단위(half-open, end = 다음 날 00:00)로 올바르게 표시된다.

### 5. 외부 이벤트 PATCH 시도 → 409 확인

```bash
# 외부 이벤트 ID 확인 (예: 27)
# 외부 이벤트 식별: calendar_event.external_id 에 Graph API 이벤트 ID, 해당 calendar.is_read_only = true

curl -X PATCH http://localhost:9090/api/v1/calendar/events/27 \
  -H "Authorization: Bearer <JWT토큰>" \
  -H "Content-Type: application/json" \
  -d '{"title": "수정 시도"}' \
  -i

# 예상 응답:
# HTTP/1.1 409 Conflict
# {"error": "읽기전용 캘린더는 수정할 수 없습니다: 27"}
```

### 6. 종일 일정 half-open 검증

- [ ] M365 종일 일정 (예: 2026-07-01 하루 종일)이 `start = 2026-07-01`, `end = 2026-07-02` 로 저장된다.
- [ ] 캘린더 UI에서 해당 날짜에 하루 단위로 표시된다 (날짜 넘침 없음).

---

## 참고

- 동기화 주기: `@Scheduled` (기본 10분 간격 또는 설정 참조).
- 동기화 창: 현재 기준 **과거 1개월 ~ 미래 3개월**.
- 외부 이벤트 식별: `calendar_event.external_id` 에 Graph API 이벤트 ID 저장, 소속 컨테이너 `calendar.is_read_only = true` + `calendar.external_account_id` 로 확인.
- 다중 캘린더: M365 계정의 모든 캘린더를 순회하여 각각 컨테이너 생성 + 이벤트 동기화.
- 스코프 추가 확인: 메일 스코프(`Mail.Read`, `Mail.Send`)와 함께 `Calendars.Read` 포함 여부.
