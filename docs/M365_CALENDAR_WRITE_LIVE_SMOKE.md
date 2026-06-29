# M365 캘린더 쓰기 라이브 스모크 체크리스트

> 이슈: #502 — M365 Graph API 캘린더 쓰기

## 사전 준비

### 1. ⚠️ Azure 앱 등록 — `Calendars.ReadWrite` 권한 확인 + 관리자 동의

1. [Azure 포털](https://portal.azure.com) → 앱 등록 → `aa9c80a9-...` 앱 선택.
2. **API 사용 권한** → `Calendars.ReadWrite` 추가 완료 확인 (✅ 녹색).
   - ⚠️ #501 라이브 스모크에서 이미 추가된 경우 생략.
   - 없으면 **권한 추가** → Microsoft Graph → **위임된 권한** → `Calendars.ReadWrite` 추가.
3. **"iacloud.kr에 대한 관리자 동의 허용"** 버튼 클릭 → 상태가 ✅ 녹색으로 바뀌는지 확인.
   - ⚠️ 테넌트 사용자 동의 차단 정책으로 인해 사용자가 직접 동의할 수 없음(버튼 회색).
   - 관리자 동의 없이 쓰기 시도 시 `AADSTS65001` 오류 발생.

### 2. 기존 M365 계정 재연결 (새 스코프 동의)

1. 앱 **설정 → 계정 연결** 에서 기존 M365 계정 연결 해제.
2. **M365 Graph 계정 재연결** — OAuth 팝업 흐름으로 새 `Calendars.ReadWrite` 스코프 동의.
3. 재연결 후 `refresh_token` 갱신 완료 확인 (`email_account.oauth_refresh_token` 업데이트).

### 3. API 재시작 + 스케줄러 대기

```bash
# :9090 API 재시작 (스케줄러 로드)
./gradlew :apps:workplace-api:bootRun

# 재시작 후 스케줄러 1사이클(최대 10분) 대기
```

### 4. JWT 토큰 준비

```bash
# 로그인 후 개발자 도구에서 localStorage 의 `auth_token` 복사
# 또는 로그인 응답 Authorization 헤더에서 토큰 추출
export JWT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...."
```

---

## 검증 항목

### 5. 캘린더 페이지 — 쓰기 가능 캘린더 확인

- [ ] `/calendar` 페이지에 M365 계정의 모든 캘린더가 표시된다.
- [ ] **쓰기 가능 캘린더**(일반 일정, `is_read_only = false`)는 편집 가능 상태다.
- [ ] **공휴일**, **생일** 등 읽기 전용 캘린더는 편집 불가 배지가 표시된다.
- [ ] 새 일정 다이얼로그의 **캘린더 선택** 드롭다운에 쓰기 가능 캘린더만 나타난다 (공휴일/생일 제외).

### 6. 단일 시각 일정 생성 → 즉시 목록 표시 + Outlook 동기화 확인

**UI 경로:**
1. `/calendar` → **새 일정** 버튼.
2. 제목: "테스트 회의", 시작: 2026-07-01 14:00, 종료: 2026-07-01 15:00, 캘린더: M365 기본 캘린더.
3. **저장** → 목록에 즉시 표시 확인.

**REST 경로 (curl):**

```bash
# 1. POST로 일정 생성
curl -X POST http://localhost:9090/api/v1/calendar/events \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "테스트 회의",
    "startsAt": "2026-07-01T14:00:00+09:00",
    "endsAt": "2026-07-01T15:00:00+09:00",
    "calendarId": "<쓰기가능 M365 캘린더 ID>",
    "isAllDay": false
  }' \
  -i

# 예상 응답:
# HTTP/1.1 201 Created
# {"id": "123", "title": "테스트 회의", "startsAt": "...", "externalId": "<Graph API 이벤트 ID>", ...}
```

**Outlook 확인:**
- Outlook 웹/앱 → 해당 M365 계정 → 캘린더 확인 → "테스트 회의" 2026-07-01 14:00~15:00 표시.

- [ ] 일정이 앱 목록에 나타난다.
- [ ] Outlook에서 동일 일정이 표시된다 (문제적 타임존 시프트 없음).
- [ ] 응답 `externalId` 필드에 Graph API 이벤트 ID가 저장된다.

### 7. 일정 수정 (제목·시간) → Outlook 반영 확인

**UI 경로:**
1. 생성된 일정 클릭 → **편집** 버튼.
2. 제목을 "테스트 회의 → 수정됨"로 변경, 시간을 15:00~16:00으로 변경.
3. **저장** → 목록 즉시 업데이트 확인.

**REST 경로 (curl):**

```bash
# 2. PATCH로 일정 수정
curl -X PATCH http://localhost:9090/api/v1/calendar/events/123 \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "테스트 회의 → 수정됨",
    "startsAt": "2026-07-01T15:00:00+09:00",
    "endsAt": "2026-07-01T16:00:00+09:00"
  }' \
  -i

# 예상 응답:
# HTTP/1.1 200 OK
# {"id": "123", "title": "테스트 회의 → 수정됨", "startsAt": "...", ...}
```

**Outlook 확인:**
- Outlook 새로고침 → 제목·시간 변경 즉시 반영.

- [ ] 앱과 Outlook 양쪽에서 수정 내용이 일치한다.

### 8. 일정 삭제 → 목록·Outlook 양쪽 제거 확인

**UI 경로:**
1. 수정된 일정 클릭 → **삭제** 버튼 → 확인.
2. 목록에서 사라짐 확인.

**REST 경로 (curl):**

```bash
# 3. DELETE로 일정 삭제
curl -X DELETE http://localhost:9090/api/v1/calendar/events/123 \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -i

# 예상 응답:
# HTTP/1.1 204 No Content
```

**Outlook 확인:**
- Outlook 새로고침 → 일정 사라짐 확인.

- [ ] 앱 목록에서 일정이 제거된다.
- [ ] Outlook에서도 일정이 삭제된다.

### 9. 이미 삭제된 일정 재삭제 → 404 성공 처리 확인

**REST 경로:**

```bash
# 4. 이미 삭제된 일정을 다시 삭제 시도
curl -X DELETE http://localhost:9090/api/v1/calendar/events/999 \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -i

# 예상 응답:
# HTTP/1.1 204 No Content (또는 404 로그 내부 처리)
# 사용자 UI에서는 토스트 오류 없음 (idempotent 처리)
```

- [ ] 404가 내부 처리되어 사용자가 오류를 보지 않는다.

### 10. 종일 일정 생성 → 올바른 날짜 표시 (half-open, 타임존 무시)

**UI 경로:**
1. `/calendar` → **새 일정**.
2. 제목: "종일 테스트", 날짜: 2026-07-10, **종일** 체크.
3. **저장** → 목록에 "종일 테스트" 2026-07-10 종일 표시.

**REST 경로 (curl):**

```bash
# 5. 종일 일정 생성
curl -X POST http://localhost:9090/api/v1/calendar/events \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "종일 테스트",
    "startsAt": "2026-07-10T00:00:00+09:00",
    "endsAt": "2026-07-11T00:00:00+09:00",
    "calendarId": "<쓰기가능 M365 캘린더 ID>",
    "isAllDay": true
  }' \
  -i

# 예상 응답:
# HTTP/1.1 201 Created
# {"id": "124", "title": "종일 테스트", "startsAt": "2026-07-10T00:00:00", "endsAt": "2026-07-11T00:00:00", "isAllDay": true, ...}
```

**Outlook 확인:**
- Outlook 캘린더 → 2026-07-10 종일로 표시 **(7월 11일이 아님 — 타임존 시프트 검증)**.

- [ ] 앱에서 종일로 표시된다.
- [ ] Outlook에서 정확한 날짜(2026-07-10)에 종일 일정으로 표시된다 (하루 밀림 없음).
- [ ] 데이터베이스에 `starts_at = 2026-07-10 00:00`, `ends_at = 2026-07-11 00:00` 저장됨.

### 11. 동기화 윈도우 밖 일정 생성 → prune 생존 확인

**기본 동기화 윈도우:** 과거 1개월 ~ 미래 3개월 (변경 불가능에 가까움).

**REST 경로:**

```bash
# 6. 4개월 뒤(윈도우 밖) 일정 생성
curl -X POST http://localhost:9090/api/v1/calendar/events \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "윈도우 밖 일정",
    "startsAt": "2026-10-15T10:00:00+09:00",
    "endsAt": "2026-10-15T11:00:00+09:00",
    "calendarId": "<쓰기가능 M365 캘린더 ID>",
    "isAllDay": false
  }' \
  -i

# 예상 응답:
# HTTP/1.1 201 Created
# {"id": "125", "title": "윈도우 밖 일정", ...}
```

**스케줄러 대기:**
- API 로그에서 다음 주기적 동기화 (대략 10분 후 또는 수동 트리거 시)를 확인.
- `/calendar` → 목록을 새로고침.

- [ ] 일정이 앱에서 여전히 표시된다 (prune 제거되지 않음).
- [ ] 스케줄러가 동기화 윈도우 밖 일정을 구분하고 삭제하지 않는다.

### 12. 반복 일정 생성 시도 → 422 차단 확인

**REST 경로:**

```bash
# 7. 외부 M365 캘린더에 반복 일정 생성 시도
curl -X POST http://localhost:9090/api/v1/calendar/events \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "반복 회의",
    "startsAt": "2026-07-01T14:00:00+09:00",
    "endsAt": "2026-07-01T15:00:00+09:00",
    "calendarId": "<M365 캘린더 ID>",
    "recurrence": {
      "pattern": "weekly",
      "interval": 1,
      "daysOfWeek": ["monday", "wednesday", "friday"]
    }
  }' \
  -i

# 예상 응답:
# HTTP/1.1 422 Unprocessable Entity
# {"error": "반복 일정은 M365 연동 캘린더에서 지원되지 않습니다"}
```

**UI 토스트 확인:**
- 사용자가 M365 캘린더에서 반복 일정 생성 시도 → "반복 일정은 지원되지 않습니다" 토스트.

- [ ] 422 오류가 반환된다.
- [ ] 사용자 UI에 명확한 오류 메시지가 표시된다.

### 13. 다른 캘린더로 이동 시도 → 422 차단 확인

**사전 조건:** 동기화된 M365 일정 1개(예: id=126)가 있어야 함.

**REST 경로:**

```bash
# 8. 동기화 M365 일정을 다른 캘린더로 이동 시도
curl -X PATCH http://localhost:9090/api/v1/calendar/events/126 \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "calendarId": "<다른 쓰기가능 캘린더 ID 또는 로컬 캘린더>"
  }' \
  -i

# 예상 응답:
# HTTP/1.1 422 Unprocessable Entity
# {"error": "동기화 캘린더의 일정은 이동할 수 없습니다"}
```

- [ ] 422 오류가 반환되어 동기화 일정의 이동이 차단된다.

### 14. 네트워크 장애 → 502 에러 처리 확인 (선택)

**준비:** 로컬 호스트에서 `:9090` 를 일시 중단하거나 네트워크 차단.

**REST 경로:**

```bash
# 9. 네트워크 장애 중 일정 생성 시도
curl -X POST http://localhost:9090/api/v1/calendar/events \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "실패 테스트",
    "startsAt": "2026-07-01T10:00:00+09:00",
    "endsAt": "2026-07-01T11:00:00+09:00",
    "calendarId": "<M365 캘린더 ID>"
  }' \
  -i

# 예상 응답:
# HTTP/1.1 502 Bad Gateway
```

**UI 확인:**
- "네트워크 오류" 또는 "요청 실패" 토스트 표시.
- 로컬 캘린더에 일정이 생성되지 않음 (낙관적 UI 미적용).

- [ ] 사용자가 오류 메시지를 본다.
- [ ] 로컬 데이터 무결성이 유지된다.

---

## 알려진 한계

- **반복 일정 미지원** (#546): 외부 M365 캘린더에서 반복 인스턴스 편집 시 Graph API 예외 또는 새 ID churn 가능.
- **참석자 미지원** (#547): 일정 생성 시 참석자 필드가 전송되지 않음.
- **동시편집 충돌**: 마지막 쓴 자가 우선 (Graph API 및 로컬 우선권 미정의).

---

## 참고

- 동기화 주기: `@Scheduled` (기본 10분 간격 또는 설정 참조).
- 동기화 창: 현재 기준 **과거 1개월 ~ 미래 3개월**.
- 외부 일정 식별: `calendar_event.external_id` 에 Graph API 이벤트 ID 저장, 소속 컨테이너 `calendar.is_read_only = false` + `calendar.external_account_id` 로 확인.
- 다중 캘린더: M365 계정의 모든 캘린더를 순회하여 각각 컨테이너 생성 + 이벤트 쓰기 가능.
- API 엔드포인트: `/api/v1/calendar/events` (GET/POST/PATCH/DELETE).
