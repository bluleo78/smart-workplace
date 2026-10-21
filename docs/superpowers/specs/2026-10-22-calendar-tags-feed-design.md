# 캘린더 회의 참가·태그·태그 구독 주소 설계 (WP-709·710·714·715·716)

에픽 WP-707 「캘린더 앱 사용성 개선」의 두 번째·세 번째 웨이브. 화면 시안은 2026-10-22 사용자 승인
(① 참가 버튼 = 제목 아래 넓은 버튼, ② 태그 = 제목 아래 칩 줄, ③ 태그 붙이기 팝오버·사이드바 「태그」 묶음, ④ 구독 주소 창).

## 왜

- 회의 일정을 여는 이유는 대부분 「들어가기」다. 참가 링크가 설명 속에 묻혀 있고, 그나마 255자 미리보기라 잘린다.
- Teams 초대 일정 일부를 사내 시스템과 공유해야 한다. 읽기 전용이라 캘린더를 옮길 수 없으니 개인 표시(태그)로 고르고,
  사내 시스템은 태그별 비밀 iCal 주소로 주 단위로 가져간다.

## 웨이브와 브랜치

| 웨이브 | 브랜치 | 이슈 | 비고 |
|---|---|---|---|
| 1 | feat/wp-709 | 709 → 710 | 동기화 본문 전체 + 참가 버튼·안내문 접기 (마이그레이션 V193) |
| 1 | feat/wp-714 | 714 → 715 | 태그 모델·Outlook 범주 동기화·화면 → 태그별 iCal 피드·구독 주소 창·연동 문서 (V196 — main 에 V194·V195 가 먼저 들어와 바꿈) |
| 2 | feat/wp-716 | 716 | 앱 → Outlook 범주 써 넣기 |

구독 주소 창 시제품이 이미 태그 화면과 함께 만들어져 715 는 714 브랜치에 이어 커밋한다(이슈마다 커밋 하나).
웨이브 1 의 두 브랜치는 `GraphCalendarClient.$select`·`GraphCalendarFetcher.mapEvent`·`EventDetailView` 머리 부분을 함께 고친다.
**709 브랜치를 먼저 머지**하고 714 브랜치를 그 위로 rebase 한다(마이그레이션 번호도 그때 다시 맞춘다).

## 709 — 설명 전문 저장

- `listCalendarView` 의 `$select` 에 `body` 를 더하고 `Prefer: outlook.body-content-type="text"` 헤더로 Graph 가 텍스트로 바꿔 주게 한다
  (HTML→텍스트 변환기를 직접 만들지 않는다). `bodyPreview` 는 본문이 비었을 때만 폴백.
- 텍스트 본문의 링크는 `글자<https://…>` 꼴로 오므로 `splitTextLinks`(꺾쇠 제외)가 그대로 링크로 만든다.
- 10,000자(`CalendarEventRequest` 제한)를 넘으면 앞 9,999자 + 「…」.
- upsert 의 갱신 경로가 description 을 덮어쓰므로 이미 동기화된 일정은 다음 동기화에 전문으로 바뀐다.

## 710 — 회의 참가

- **M365**: `$select` 에 `isOnlineMeeting,onlineMeetingProvider,onlineMeeting` 추가 → `calendar_event.online_meeting_url`(VARCHAR 2000, null 허용) 저장.
- **응답 DTO**: `onlineMeeting: { provider: 'TEAMS' | 'MEET' | 'ZOOM' | 'OTHER', joinUrl } | null`.
  서버가 저장된 URL 이 있으면 그것을, 없으면 설명·장소에서 찾은 첫 회의 링크를 넣는다(판정 함수는 서버 한 곳 — 목록·상세·MCP 가 같은 답).
  - Teams: `teams.microsoft.com/l/meetup-join/…`, `teams.microsoft.com/meet/…`, `teams.live.com/meet/…`
  - Meet: `meet.google.com/xxx-xxxx-xxx`
  - Zoom: `*.zoom.us/j/…`, `*.zoom.us/my/…`
- **화면**: 칩 줄 아래 넓은 버튼 「Teams 회의 참가」 / 「Google Meet 참가」 / 「Zoom 회의 참가」. `target=_blank rel=noopener noreferrer`.
- **안내문 접기**: 설명에서 밑줄 20자 이상 줄로 감싼 덩어리 중 `Microsoft Teams` 를 담은 것(실제 초대 본문 형식 — 80자 밑줄 두 줄 사이에
  「Microsoft Teams 모임 / 참가 / 모임 ID / 암호 / 도움말 링크」)을 「Teams 회의 안내」 접힌 줄로 바꾼다. 펼치면 원문 그대로. 순수 함수(프론트).

## 714 — 태그

### 데이터

```sql
-- 사용자별 태그. 이름은 사용자 안에서 대소문자 무시 유일(Outlook 범주 이름 = 태그 이름).
calendar_tag(
  id BIGSERIAL PK, tenant_id BIGINT NOT NULL, user_id BIGINT NOT NULL → users,
  name VARCHAR(255) NOT NULL, color VARCHAR(20) NOT NULL,          -- 팔레트 키(blue … gray)
  feed_token VARCHAR(64) NULL UNIQUE, feed_created_at TIMESTAMPTZ NULL,  -- 715 에서 사용(컬럼은 714 마이그레이션에 함께)
  created_at, updated_at,
  UNIQUE (user_id, lower(name)))

-- 일정-태그 연결. 태그가 사용자 것이라 연결도 그 사용자 것.
calendar_event_tag(
  tag_id BIGINT → calendar_tag ON DELETE CASCADE,
  event_id BIGINT → calendar_event ON DELETE CASCADE,
  source VARCHAR(10) NOT NULL,   -- 'APP' | 'OUTLOOK'
  PRIMARY KEY (tag_id, event_id))
```

- **우리 앱 일정**: 반복이면 마스터 일정 id 에 붙인다. 가상 회차·예외 회차는 마스터의 태그를 따른다.
  초대받은 사람도 자기 태그를 붙일 수 있다(일정은 하나, 태그는 사람마다).
- **M365 일정**: 동기화 `$select` 에 `categories` 추가. 일정마다 범주 이름으로 그 캘린더 주인의 태그를 찾고(없으면 만들고)
  그 일정의 `source='OUTLOOK'` 연결을 범주 목록과 같게 바꾼다. M365 일정은 회차마다 행이 따로라 회차별로 따른다.
- **색**: Outlook 범주 색을 읽으려면 `MailboxSettings.Read` 권한이 더 필요하다(지금 `Calendars.ReadWrite` 뿐 — 추가하면 모든 사용자가 M365 를 다시 연결해야 함).
  그래서 Outlook 에서 온 새 태그는 이름 해시로 팔레트 색을 정하고, 앱에서 바꾼다. (설계 단계 결정 — 사용자에게 보고)
- **지우기**: 앱 태그를 지우면 연결도 사라진다. Outlook 범주에서 온 태그를 지워도 다음 동기화에 범주가 남아 있으면 다시 생긴다(안내 문구).

### API (인증 사용자 기준)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/calendar/tags` | `[{ id, name, color, eventCount, hasFeed }]` 이름순 |
| POST | `/api/calendar/tags` | `{ name, color? }` → 태그(같은 이름 있으면 409) |
| PATCH | `/api/calendar/tags/{id}` | `{ name?, color? }` |
| DELETE | `/api/calendar/tags/{id}` | |
| PUT | `/api/calendar/events/{id}/tags` | `{ tagIds }` 앱 일정만(M365 는 716 전까지 409). 반복 회차 id 면 마스터에 |

일정 응답 DTO 에 `tags: [{ id, name, color }]`(현재 사용자 것만), `tagsEditable: boolean`(M365 일정은 716 전까지 false).

### 화면

- 상세 보기 머리: 캘린더 칩 · 읽기 전용 칩 뒤에 태그 칩(둥근 색 테두리) → 앱 일정은 끝에 「＋ 태그」. 넘치면 다음 줄.
  M365 일정은 칩 아래 「Outlook 범주에서 가져온 태그예요 · Outlook에서 바꿀 수 있어요」.
- 「＋ 태그」 팝오버: 검색 입력 + 체크 목록(여러 개) + 「「이름」 태그 만들기」. 바꾸면 바로 저장.
- 편집 폼(주최자)에도 같은 태그 줄을 둔다(저장 버튼과 무관하게 바로 저장).
- 사이드바 「태그」 묶음: 색 점 · 이름 · 일정 수 · ⋮(이름·색 바꾸기 / 구독 주소… / 태그 지우기). 「＋」로 새 태그.
  태그로 걸러 보기는 이번 범위 밖.

## 715 — 태그 구독 주소

- `POST /api/calendar/tags/{id}/feed` 발급·재발급(새 토큰, 이전 주소 즉시 무효), `DELETE` 폐기, `GET` → `{ url, createdAt, eventCount }`.
- 공개 엔드포인트 `GET /api/calendar/feeds/{token}.ics?week=2026-W43` — 인증 없음, 토큰만. 형식 오류 400, 없는 토큰 404.
  주 = ISO 주, KST 월 00:00 ~ 다음 월 00:00, 없으면 이번 주. 그 주와 겹치는 일정, 반복은 회차로 펼침.
- 토큰은 32바이트 난수 base64url. Google 의 「비공개 주소」처럼 언제든 다시 보여 줘야 해서 원문 저장(해시 아님) — 재발급으로 막는다.
- 항목: `UID`(M365 = iCalUId, 앱 = `wp-event-{id}[-{occurrence}]@genia-works`), `SUMMARY`, `DTSTART/DTEND`(종일은 DATE),
  `LOCATION`, `ORGANIZER`·`ATTENDEE` mailto. **설명은 넣지 않는다.**
- 창: 태그 이름 · 설명 · 주소 + 복사 · `?week=` 안내 · 나가는 항목 · 일정 수 · 「새 주소로 바꾸기」·「주소 없애기」·만든 날.
- 연동 문서: `docs/integrations/calendar-tag-feed.md`(사람은 이메일, 같은 UID = 같은 일정, 빠진 UID 처리는 받는 쪽).

## 716 — Outlook 범주 써 넣기

- M365 일정의 `tagsEditable=true`. 붙이기·떼기 → Graph `PATCH /me/events/{id}` `{ categories }` → 성공하면 `source='OUTLOOK'` 연결 갱신.
- 반복 회의는 시리즈 마스터에 PATCH(동기화에 `seriesMasterId` 저장 필요).
- Outlook 범주 목록(masterCategories)에 새로 만들지 않는다 — `MailboxSettings.ReadWrite` 권한이 필요해 재연결을 부르기 때문.
  목록에 없는 범주도 Outlook 일정에는 붙고 색 없이 보인다. (10-21 「없으면 만든다」에서 바꿈 — 사용자에게 보고)

## 구현 중 정한 것

### 714

- **마이그레이션 V196**(V193 은 709 브랜치, V194·V195 는 다른 작업이 먼저 씀). 715 의 `feed_token`·`feed_created_at` 컬럼과 공개 resolve 함수(`calendar_tag_feed_resolve`, SECURITY DEFINER)도
  V196 에 함께 넣었다 — rebase 때 맞출 번호가 하나뿐이게.
- **이름 유일 키에 tenant_id 를 넣었다**: `(tenant_id, user_id, lower(name))`. user 는 전역 표라 한 사람이 여러 워크스페이스에 있으면 워크스페이스마다
  태그가 따로여야 한다(V58 과 같은 이유). 두 표 모두 RLS(FORCE)·`app_tenant` 권한, 테넌트 영구 삭제 목록(`TenantPurgePlan`)에도 더했다.
- **태그 목록·칩 순서**는 `lower(name)` 을 C 콜레이션으로 정렬한다(영문·숫자 먼저, 한글 가나다순) — DB 기본 콜레이션이 환경마다 달라 순서가 흔들렸다.
- **남의 태그는 404**(존재 은닉, 일정 404 와 같은 규칙). 같은 이름 409 문구 「같은 이름의 태그가 이미 있습니다」, M365 일정 PUT 409 문구
  「Outlook 일정의 태그는 Outlook 범주에서 바꿀 수 있습니다」.
- **이름 1~50자**(앞뒤 공백 제외)는 API 에만 건다. Outlook 범주는 이 제한 없이 동기화한다(컬럼 255자).
- **색을 안 주면 이름 해시 색** — 서버 `CalendarPalette.forName` 이 프론트 `pickTagColor` 와 같은 답을 낸다(같은 이름을 JUnit·vitest 양쪽에 고정).
- **태그 API 권한**: 조회 `calendar:read`, 만들기·바꾸기·지우기·일정에 붙이기 `calendar:write`. 일정에 붙이기는 그 일정을 볼 수 있으면(주인·참석자) 된다.
- **M365 일정 판정 = `external_id` 있음**(`tagsEditable = external_id IS NULL`). 동기화 일정과 앱에서 Outlook 캘린더로 써 넣은 일정이 모두 해당한다.
- **고친 회차(오버라이드)**는 예외 표로 마스터를 찾아 마스터의 태그를 보인다. 고친 회차 id 로 PUT 하면 마스터에 붙는다.
- **「이후 모든 일정」으로 나누면** 새 마스터에 옛 마스터의 태그 연결(모든 사람 것)을 복사한다 — 참석자 복사와 같은 자리.
- **Outlook 범주 동기화**: 응답에 `categories` 가 없으면(null) 그 일정의 연결을 건드리지 않고, 빈 목록이면 OUTLOOK 연결을 모두 뗀다. 달력 하나씩 배치로
  (이름 → 태그 한 번, 기존 연결 한 번) 처리하고 바뀐 연결만 지우고 넣는다. 범주를 동기화 레코드(`ExternalEventRow`)가 아니라 `GraphEvent` 에서 바로 읽는다 —
  `calendar_event` 컬럼이 아니라서.
- **편집 폼 태그 줄**은 제목 아래, 이미 있는 일정에서만(새 일정은 숨김). M365 일정이면 칩과 Outlook 안내만, 태그도 없으면 줄째 숨긴다.

### 715

- **공개 경로는 `/api/v1/public/calendar/feeds/{토큰}.ics`** — 설계의 `/api/calendar/feeds/…` 대신 기존 공개 링크(드라이브 공유·전송, 스테이징 업로드)와 같은
  `/api/v1/public/**` 아래에 두고 SecurityConfig 에 GET·HEAD 만 열었다(HEAD 는 리뷰 반영 — 아래). `/api/v1/**` 는 인증 필수라 그 아래에 예외를 끼우는 것보다 안전하다.
  전체 주소는 다른 공개 링크와 같은 `workplace.public-base-url`(운영 `WEB_BASE_URL`)로 만든다.
- **토큰 resolve 는 SECURITY DEFINER 함수**(V196) — 공개 요청엔 테넌트 컨텍스트가 없어 FORCE RLS 를 우회해야 한다. 찾은 뒤 테넌트 활성·주인 멤버십을
  확인하고(아니면 404) 그 테넌트 컨텍스트에서 **주인 기준 보통 일정 목록과 같은 규칙**을 쓴다(반복 전개·취소/고친 회차·중복 제거가 화면과 같다).
  다만 그 태그가 붙은 일정만 읽는다(리뷰 반영 — 아래).
- **오류는 짧은 평문**(400·404) — 캘린더 클라이언트가 `Accept: text/calendar` 로 불러도 JSON 협상에 걸려 상태 코드가 바뀌지 않게.
- **형식이 틀린 토큰(43자 base64url 아님)은 DB 를 보지 않고 404.** 속도 제한은 재사용할 기존 장치가 없어 두지 않았다(토큰 256비트라 추측 불가).
- **종일 날짜**는 저장 시각 +12시간의 UTC 날짜 — 앱 종일(한국 자정 저장)·M365 종일(UTC 자정 저장) 모두 맞는다. 주 겹침도 종일은 날짜로 본다.
- **고친 회차의 UID 는 원래 회차 시작 시각** 기준(`wp-event-{마스터}-{원래 회차}`) — 시간을 옮겨도 받는 쪽이 같은 회차로 알아본다.
- **DTSTAMP = 일정의 updated_at**(없으면 지금). 참석자에 `CN`(이름)·`PARTSTAT` 을 함께 싣는다. **AI 에이전트 참석자는 뺀다**(바깥 시스템의 사람이 아님).
- **METHOD 는 넣지 않았다** — 설계에 적힌 머리 항목(PRODID·VERSION·CALSCALE·X-WR-CALNAME)만.
- 화면: 구독 주소 창의 발급·재발급·폐기 뒤 태그 목록(hasFeed)을 다시 받으므로 E2E 는 서버처럼 상태를 바꾸는 모킹을 쓴다.

### 리뷰 반영(714·715)

- **태그 피커 저장은 한 번에 하나씩** — PUT 이 집합 전체 교체라, 체크마다 동시에 보내면 늦게 끝난 옛 요청이 서버를 낡은 집합으로 덮을 수 있었다. 보내는 동안
  바뀐 선택은 마지막 것만 기억했다가 끝나면 이어서 보내고, 서버가 마지막으로 받아들인 집합과 같으면 보내지 않는다. 호출별 `mutate` 콜백 대신
  `mutateAsync` 를 기다리는 루프로 했다 — 호출별 콜백은 팝오버·상세 창이 닫혀 컴포넌트가 내려가면 불리지 않아 기다리던 마지막 선택이 사라진다.
  실패하면 남은 저장을 버리고 화면을 **서버가 마지막으로 받아들인 집합**(열 때 값이 아니라)으로 되돌린다. 저장이 줄에 남은 채 다시 열면 낡은 `current`
  로 덮지 않는다. 상세 보기·편집 폼 태그 줄이 같은 피커라 함께 고쳐진다.
- **Outlook 범주에서 온 태그는 앱에서 이름을 못 바꾼다(409 「Outlook 범주에서 온 태그라 이름은 Outlook에서 바꿔 주세요」)** — 동기화가 범주 이름으로
  태그를 찾아, 「Work」를 「Job」으로 바꾸면 다음 동기화가 「Work」를 새로 만들고 「Job」의 Outlook 연결을 모두 떼어 태그가 갈라진다. 판정은 OUTLOOK 출처
  연결이 하나라도 있는지(`fromOutlook`, 태그 목록 응답에 싣는다). 이름이 그대로면(색만 바꾸기) 통과 — 화면은 이름 칸을 잠그고 안내를 단 채 원래 이름을 그대로
  보낸다. 대소문자만 바꾸는 것도 막는다(규칙을 하나로).
- **범주 이름 대소문자 접기는 DB `lower()` 한 곳에서만** — Java `toLowerCase` 로 키를 만들면 PG `lower()` 와 어긋나는 이름(그리스어 끝 시그마 「ΟΔΟΣ」,
  터키어 「İ」)이 연결되지 못하고 동기화마다 다시 넣으려 했다. `findOrCreateByNames` 는 이제 **넘겨받은 이름 그대로 → 태그 id** 를 돌려주고, 이름 목록을
  `unnest(?::text[])` 로 넘겨 SQL 안에서 `lower(t.name) = lower(input)` 으로 맞춘다. 테스트 DB 에서 두 이름이 실제로 어긋나는지도 테스트가 먼저 확인한다.
- **읽기 전용 달력(canEdit=false — 동료가 공유한 달력·공휴일·생일)의 범주는 태그로 만들지 않는다** — 남의 사서함 범주라 지울 수 없는 태그가 쌓였다. 참석자
  동기화와 같은 기준. 아직 배포 전이라 이미 생긴 태그를 치우는 정리는 두지 않았다.
- **구독 주소는 HEAD 도 로그인 없이 연다** — Spring 이 HEAD 를 GET 핸들러로 보낸다. 본문을 버리는 것은 서블릿 컨테이너라 MockMvc 테스트는 상태·
  Content-Type 만 본다.
- **피드는 태그가 붙은 일정만 읽는다** — 전에는 주인의 9일치 전체 목록(모든 반복 마스터 전개 + 참석자·태그·오버라이드 채우기)을 만든 뒤 태그로 걸렀다. 이제
  보통 목록과 같은 수집 본체(`CalendarEventService.listTagged` — 접근·끊긴 계정 숨김·전개·예외·중복 제거)가 날짜 범위와 함께 **태그 조건을 SQL 에 건다**
  (`CalendarEventRepository.taggedWith` — 단일 일정·M365 회차 행·반복 마스터는 자기 연결, 고친 회차는 마스터의 연결을 본다). 일정 id 를 미리 읽어
  `IN (...)` 으로 넘기지 않으므로 M365 회차 행이 수천 개여도 그 주 범위만 읽는다. 참석자는 남은 일정만 한 번 읽는다. 중복 제거(내 사본이 있으면 초대 사본을 뺀다)를 부분 집합에 하면 원래와 달라질 수 있는 경우는, 주인 태그가 비소유 초대 사본에만
  붙은 경우인데 — iCalUId 가 있는 일정은 M365 동기화 일정뿐이고 그 Outlook 연결은 그 달력 주인의 태그라 생기지 않는다.
- **태그 주인 확인은 `CalendarTagService.requireOwned` 하나** — 구독 주소 서비스도 그것을 쓴다(404 은닉 규칙이 갈라지지 않게).
- `IcsWriter.fold` 는 글자마다 String·byte[] 를 만들지 않고 코드 포인트 범위로 UTF-8 바이트 수를 센다(짝 없는 서로게이트는 3으로 세어 조금 일찍 접힐 뿐).
