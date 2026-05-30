# AI Native 메인 홈 — 설계 (Design Spec)

> 상태: 확정 (2026-05-30 브레인스토밍) · 다음 단계: 구현 플랜(writing-plans)
> 시각 자료: `.superpowers/brainstorm/5661-1780128575/content/*.html` (셸·캔버스·세션 목업)

## 1. 목적 & 원칙

Smart Workplace 의 메인 진입점("/")을 **AI Native 홈**으로 만든다. 현재 "/"는 스켈레톤(HomePage). 이를 확정한다.

핵심 원칙 3가지:

- **홈 = 모든 업무의 시작점**
- **AI = 정보를 제공하는 주체** — "무엇을 보여줄지" 결정
- **프론트엔드 = 그것을 효율적으로 표현하는 구조화 레이어** — 위젯 레지스트리

목표 우선순위(사용자 확정): **C(확장 가능한 셸) > B(매일 쓰는 도구) > A(비전 데모)**. 셸이 척추, 위에 레이어를 얹어 셋을 동시 충족한다.

### 1.1 sibling 프로젝트(smart-fire-hub) 참고 & 차이

`smart-fire-hub` 의 AI 통합을 **계약(contract) 수준에서 미러**한다: 3-tier 토폴로지(web → Spring → Node agent → Claude), `tool_use` → WidgetRegistry 렌더, 캔버스+떠있는 챗 2-레이어, `--ai-accent` 토큰, ⌘K, 세션 스위처.

단, 두 가지를 **의도적으로 다르게** 한다:

1. **fire-hub 의 제너레이티브 캔버스(AI 가 즉석 차트/위젯 생성)는 채택하지 않는다.** fire-hub 에서 이 모드는 "유용성 부족"으로 비활성화됐다. fire-hub AI = 데이터 분석가(위젯 출력). 우리 AI = **동료(assignee)** — 공유 객체(이슈) 안에서 실제 작업물을 만든다. 그래서 우리 위젯은 **고정 라이브러리**(이슈 도메인 컴포넌트)이고 AI 는 그것을 **의도로 조립**할 뿐, 즉석 생성하지 않는다.
2. **스트리밍 전송은 v1 에서 제외.** fire-hub 는 토큰 단위 산문을 내보내 SSE 스트리밍한다. 우리 홈 컴포저는 1~3개 위젯 + 짧은 문장 한 줄을 반환하는 "스마트 필터 액션"이다. **단일 응답**으로 충분하다. 스트리밍은 나중에 위젯 레이어를 건드리지 않고 전송만 교체할 수 있다(seam 분리됨).
3. **Claude Agent SDK 를 도입하지 않는다.** fire-hub 는 `@anthropic-ai/claude-agent-sdk query()` 를 쓰지만, 우리는 6c 에서 만든 **CLI-runner + MCP 프로필**을 재사용한다. CLI 가 이미 `--output-format stream-json` 으로 `tool_use` 이벤트를 방출하므로, 그 출력을 파싱해 `show_*` 호출을 레이아웃 스펙으로 수집한다.

## 2. 아키텍처

```
workplace-web
  └─(POST /api/v1/home/compose)→ workplace-api  (Spring, 프록시 + 세션 영속)
        └─(Internal 호출)→ workplace-ai-agent  (Node, CLI-runner + 'home' MCP 프로필)
              └─(claude CLI, --output-format stream-json)→ Claude
```

- **workplace-api**: `/home/compose` 요청을 받아 ai-agent 로 프록시. user/assistant 메시지를 DB 에 영속. 위젯이 호출하는 기존 이슈 API 들은 그대로.
- **workplace-ai-agent**: 새 `home` MCP 프로필 + 새 라우트. CLI stream-json 출력에서 `show_*` tool_use 를 수집해 레이아웃 스펙 `{message, widgets:[]}` 로 반환(단일 응답).
- **workplace-web**: 셸(사이드바+팀) + 캔버스(위젯 레지스트리) + 떠있는 챗 + 세션 스위처.

데이터 흐름: **AI 는 "무엇을"(위젯 type+params+layout) 결정, 프론트는 "어떻게"(레지스트리에서 컴포넌트 렌더, params 로 기존 이슈 API fetch) 담당.** 분리.

## 3. 컴포즈 계약 (Compose Contract)

```jsonc
// 요청
POST /api/v1/home/compose
{ "sessionId": "uuid|null", "query": "이번 주 마감인 내 높은 우선순위" }

// 응답 (단일)
{ "sessionId": "uuid",
  "message": "이번 주 마감 + 회원님 담당 + HIGH 이슈예요",
  "widgets": [
    { "type": "issue_list",
      "params": { "assignee": "me", "priority": ["HIGH"], "dueTo": "2026-06-05" },
      "layout": { "page": "current" } }
  ] }
```

- `widgets[].type` → WidgetRegistry 키
- `widgets[].params` → 위젯이 기존 API 호출에 사용
- `widgets[].layout` → 캔버스 배치 규칙: `{ page: "new"|"current", replace?: widgetId, pageLabel?: string }` (fire-hub `canvas` 스키마 미러)

## 4. 위젯 레지스트리 (v1: 이슈 도메인 4종)

`type` → React lazy 컴포넌트 매핑. 각 위젯은 `WidgetProps<T> = { input, params, displayMode }` 계약.

| type | 역할 | 데이터 출처 | 백엔드 |
|---|---|---|---|
| `my_tasks` | 요약 카운트(나를 멘션·내 담당·워치) | assignee=me 리스트 size + watched | ✅ 기존 |
| `issue_list` | params 로 이슈 목록 | `GET /projects/{key}/issues?…` | ✅ 기존(+`assignee=me`) |
| `issue_detail` | 단일 이슈 상세(댓글·첨부·이력) | `GET /projects/{key}/issues/{number}` | ✅ 기존 |
| `activity` | 최근 활동(AI 포함, actorKind 필터) | **신규** `/me/activity` | ⚠️ 신규 |

확장축(목표 C): chat/wiki/drive 위젯은 **레지스트리 빈 자리**. 새 위젯 추가 = 컴포넌트 파일 + 레지스트리 한 줄 + MCP 도구 한 개.

### 4.1 `issue_list` 가 v1 에서 지원하는 params (검증 완료)

바로 가능(기존 `IssueSearchService`): `status`, `priority`, `label`, `type`, `dueFrom`/`dueTo`, `q`(텍스트), `blocked`, `topLevel`, `parent`, `customField(fieldId/fieldValue)`, `assignee=<id>`, `cursor`/`size`.

**제외(스키마/쿼리 미지원)**: `reviewer=me`(reviewer 개념 자체 없음), `aiTouched`(이슈 리스트 필터로는 새 union 쿼리 필요 → v1 제외, "AI 가 한 일"은 `activity{actorKind=AGENT}` 로 해결).

## 5. MCP `home` 프로필 (6c chat 프로필과 동일 패턴)

ai-agent 에 `WORKPLACE_MCP_PROFILE=home` 추가. 도구는 **표시 지시만** 반환(데이터 X):

- `show_my_tasks()`
- `show_issue_list(params, layout?)`
- `show_issue_detail(number, layout?)`
- `show_activity(actorKind?, layout?)`

각 도구는 `{ displayed: true }` 류만 반환. ai-agent 가 CLI stream-json 출력에서 이 tool_use 들을 순서대로 수집 → `widgets[]` 구성. CLI 의 마지막 assistant 텍스트 → `message`.

시스템 프롬프트: "너는 홈 컴포저다. 사용자 의도를 해석해 적절한 `show_*` 도구로 화면을 구성하라. 데이터를 직접 조회하지 말고 표시 지시만 하라. 한국어로 짧게 한 줄 설명하라." (한국어 주석/응답 규칙 준수)

## 6. 캔버스 ↔ 챗 UX (2-레이어, fire-hub 미러)

- **레이어 1 — 캔버스**: 결과(영속·공간적), 항상 보임. 위젯들이 페이지로 배치됨.
- **레이어 2 — 떠있는 챗**: 명령(일시적), 하단. 평소 입력창만. ⌘K/포커스 → 메시지 패널 슬라이드 업(≤50vh) + 뒤 dim. **응답 완료 시 자동 접힘** → 결과 전면.
- **멀티페이지(프론트 전용, 백엔드 0)**: `layout.page='new'` → 새 페이지+이동, `layout.replace=id` → 위젯 교체, 기본 → 현재 페이지 추가. 하단 PageIndicator 로 전환. `useCanvasState` 훅(fire-hub 패턴) 미러.
- **기본 구성(빈 캔버스 없음)**: 홈 로드 시 **AI 호출 없이** 클라이언트가 기본 스펙 렌더: `[my_tasks(full)] + [issue_list{assignee=me,status=IN_PROGRESS}] + [activity]`.

## 7. 세션 (확인/복원 + 새 세션) — v1 포함

세션을 **workplace-api DB 에 영속**한다(CLI 로컬 세션스토어 의존 X — 안정적).

### 7.1 데이터 모델 (Flyway 신규 마이그레이션)

```
home_session
  id            uuid PK
  user_id       FK → user
  title         text          -- 첫 사용자 메시지로 자동 생성(짧게 트림)
  created_at, updated_at, last_message_at

home_message
  id            bigserial PK
  session_id    FK → home_session
  role          text          -- 'USER' | 'ASSISTANT'
  content       text          -- 말풍선 텍스트
  widgets       jsonb null    -- ASSISTANT: [{type,params,layout}] = 캔버스 복원 원천
  created_at
```

### 7.2 엔드포인트

- `POST /api/v1/home/sessions` — 새 세션
- `GET /api/v1/home/sessions?cursor=&size=` — 목록(스위처용; title, last_message_at, 위젯 수)
- `GET /api/v1/home/sessions/{id}/messages` — 복원용 전체 메시지
- `POST /api/v1/home/compose {sessionId, query}` — AI 실행 + user/assistant 메시지 저장 + `{sessionId, message, widgets}` 반환. sessionId null 이면 새 세션 생성.
- `DELETE /api/v1/home/sessions/{id}` — 삭제
- 권한: 본인 세션만(소유권 검증). 모든 라우트 인증 필요.

### 7.3 복원 동작

`GET /sessions/{id}/messages` → 프론트가 `role` 로 **대화 transcript 재현** + ASSISTANT 의 `widgets` 로 **캔버스 페이지 재구성**(fire-hub `restoreFromMessages` 패턴). **AI 재호출 없음.**

### 7.4 follow-up 연속성

`compose` 시 그 세션의 최근 메시지 N개(예: 6)를 컨텍스트로 CLI 에 전달 → "그 중 HIGH 만" 같은 후속 명령 이해. 토큰 폭주 방지 위해 N 제한 + assistant 메시지는 `message`(텍스트)만 전달(위젯 jsonb 제외).

## 8. 프론트엔드 구성 (UI/UX, fire-hub 미러)

- **셸**: 좌측 모듈 사이드바(홈 active · 이슈 · Chat/Wiki/Drive "예정") + **팀 섹션**(사람+AI 동료, online/작업중 상태 점). 상단바: 로고 + 테마 + 유저.
- **캔버스 헤더**: ✨ "홈 — AI 어시스턴트" + 세션 스위처(▾) + (선택)토큰 칩.
- **위젯 레지스트리**: `getWidget(type)` → lazy 컴포넌트. 번들 분리.
- **떠있는 챗**: ChatInput(항상) + MessageList(접힘/펼침). ⌘K 토글. (기존 `ChatRichInput` TipTap 재사용 검토.)
- **디자인 토큰**: `--ai-accent`(보라, oklch) 라이트/다크. 기존 Tailwind4 + shadcn/ui. AGENT 시각 구분(기존 `AgentBadge` 보라) 일관.

## 9. 백엔드 추가 요약

1. `assignee=me` 리터럴 — `IssueSearchService.parse()` (~10 LOC, 필수)
2. 활동 피드 `GET /api/v1/me/activity?actorKind=&type=&cursor=&size=` — 내 담당/워치 이슈의 `issue_history` 교차 조회 + actorKind(HUMAN/AGENT) 필터, updated 순. (신규 repo 메서드 + 컨트롤러)
3. 세션: Flyway 마이그레이션(2 테이블) + `HomeSession`/`HomeMessage` repo·service·controller + `/home/compose` 프록시.
4. ai-agent: `home` MCP 프로필 + compose 라우트 + stream-json 수집 로직.

## 10. v1 범위 (포함/제외)

**포함**: 셸(사이드바+팀+⌘K) · 캔버스 2-레이어 · 멀티페이지(프론트) · 위젯 4종 · 컴포즈(단일 응답) · `home` MCP 프로필 · 기본 구성 자동 로드 · **세션(목록/복원/새 세션/삭제)** · follow-up 연속성 · `--ai-accent` 토큰.

**제외(나중 phase)**: 토큰 스트리밍 전송 · 위젯 핀고정/드래그 · `aiTouched` 리스트 필터 · `reviewer` 개념 · AI 제안 승인/무시(proposal 개념 신설 필요) · 컨텍스트 compaction/토큰 정교화 · chat/wiki/drive 위젯(레지스트리 자리만) · **제너레이티브 즉석 차트(영구 제외)**.

## 11. 테스트 (프로젝트 규칙)

- **backend(JUnit 통합)**: `IssueSearchService` `assignee=me` · `/me/activity`(actorKind 필터, 소유 이슈 한정) · 세션 CRUD + 소유권 · `/home/compose` 영속.
- **ai-agent(vitest)**: `home` 프로필 도구 빌드 · stream-json → 위젯 수집 파서 · compose 라우트.
- **frontend(Playwright E2E)**: 홈 기본 구성 로드 · ⌘K 챗 펼침/명령 → 캔버스 재구성 · 멀티페이지 전환 · 세션 새로 만들기/복원.

## 12. 리스크 / 워치 아이템

- **CLI cold-start 지연**: compose 가 CLI 를 스폰 → 첫 응답 지연. 기본 구성은 AI 호출 없으니 랜딩은 즉시. 명령만 지연 비용. 스피너 처리. (스트리밍은 나중에.)
- **follow-up 컨텍스트 비용**: 최근 N개 제한으로 관리.
- **"버튼을 이기는" 가치**: 플래그십 인텐트를 교차 필터(assignee=me+priority+due / blocked / activity actorKind=AGENT)로 설계 — 단순 탭 별칭이 되지 않게.
