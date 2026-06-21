---
name: ai-driven-agent-inspector
description: >
  workplace-ai-agent에 정의된 subagent들(calendar-agent, contacts-agent, drive-agent,
  issue-agent, mail-agent, messaging-agent, project-agent, wiki-agent)의 응답 품질·도구 호출
  정확성·성능·UX 결함을 탐색적으로 점검하는 스킬.
  workplace-ai-agent의 `POST /home/compose` SSE API와 `/events` 이벤트 API를 직접 호출해
  subagent 라우팅·tool_use·tool_result·토큰/지연 trace를 분석하고 결함을 GitHub Issues에
  자동 등록한다.
  사용자가 "subagent 점검해줘", "ai 에이전트 품질 검증", "subagent 결함 찾아줘",
  "issue-agent 검증", "MCP 도구 호출 점검", "에이전트 환각 찾아줘", "subagent inspect",
  "ai-agent 회귀 점검" 등을 요청할 때 반드시 이 스킬을 사용한다.
  관점(perspective)별 패스 지원: 정확성/환각 → accuracy(기본), 도구 호출 → tool,
  성능/토큰 → perf, 표현 품질 → ux.
  또한 ai-driven-solver가 resolved 처리한 subagent 관련 이슈 재검증("subagent 크로스체크",
  "에이전트 fix 확인")에도 이 스킬을 사용한다. UI 기반 탐색은 ai-driven-explorer가 담당하므로
  웹 UI 결함은 그쪽으로 보낸다.
---

# AI Subagent 탐색적 품질 점검

이 스킬은 workplace-ai-agent에 선언된 subagent들의 **품질 결함**을 탐색적으로 발견·등록한다.
ai-driven-explorer가 웹 UI에서 사용자 관점의 결함을 찾는다면, 이 스킬은 **agent 백엔드의
응답 품질·도구 호출 정확성**을 본다.

두 가지 모드로 동작한다:

- **점검 모드** (기본): /home/compose SSE를 직접 호출하며 시나리오별 trace를 검증하고 결함을 등록한다.
- **크로스 체크 모드**: solver가 resolved 처리한 subagent 관련 이슈를 fresh API 세션에서 재검증한다.

> **[필수 원칙] Inspector는 발견과 등록만 한다.**
> 결함 발견 → `gh issue create` 등록 → 점검 계속 → 보고서 작성 → 종료.
> 소스코드를 수정하지 않는다. 수정은 ai-driven-solver가 별도 사이클에서 처리한다.

## 1. 대상 파악 — Subagent 인벤토리

대상 subagent는 `apps/workplace-ai-agent/src/agent/subagents/*` 디렉토리에 선언되어 있다.
각 subagent는 단일 파일 구조를 가진다:

- `agent.md` — 역할·tools·rules·workflow (시나리오 기대치의 원천, 단일 소스)
- `agent.test.ts` — 기존 테스트 케이스 (참고용)

> smart-fire-hub와 달리 `examples.md`, `rules.md`가 없다. `agent.md` 하나가 모든 규칙을 담는다.

### 0단계: Perspective 결정

| 사용자 발화 키워드 | perspective | 매트릭스 파일 | 시나리오 가이드 |
|------|----|----|----|
| 없음 / "정확성" / "환각" / "결함 찾아줘" | `accuracy` (default) | `.coverage-matrix-accuracy.md` | `references/perspectives/accuracy.md` |
| "도구", "tool", "MCP 호출" | `tool` | `.coverage-matrix-tool.md` | `references/perspectives/tool.md` |
| "성능", "지연", "토큰", "perf" | `perf` | `.coverage-matrix-perf.md` | `references/perspectives/perf.md` |
| "표현", "한국어", "UX", "ux" | `ux` | `.coverage-matrix-ux.md` | `references/perspectives/ux.md` |

진입 시 perspective 결정 → 해당 가이드 파일을 먼저 읽고 → 해당 매트릭스만 로드.

### 세션 시작 결정 흐름

```
세션 시작
├── perspective 결정 (위 표)
│
├── test-results/subagent-eval/.subagent-tree.md 있음?
│   ├── YES → 로드. 대상 subagent 섹션이 트리에 있나?
│   │         ├── YES (상세 내용 있음) → 재사용
│   │         └── NO (⬜ 미점검 또는 섹션 없음) → agent.md 읽고 해당 섹션 상세 작성
│   └── NO  → 8개 subagent 뼈대 신규 작성 (⬜ 미점검)
│             그 후 대상 subagent 섹션만 상세 작성
│
├── .coverage-matrix-<perspective>.md 있음?
│   ├── YES → 로드. ⬜(미시작) 항목만 이번 세션 대상
│   └── NO  → 트리 + perspective 가이드 시나리오 템플릿으로 신규 생성
│
└── 점검 시작 → ⬜ 항목 순서대로 진행
```

### Step 1: Subagent 트리 구성

`test-results/subagent-eval/.subagent-tree.md`에 저장.

뼈대 예시:
```
## calendar-agent ⬜ 미점검
## contacts-agent ⬜ 미점검
## drive-agent ⬜ 미점검
## issue-agent ⬜ 미점검
## mail-agent ⬜ 미점검
## messaging-agent ⬜ 미점검
## project-agent ⬜ 미점검
## wiki-agent ⬜ 미점검
```

상세 작성 시(예: issue-agent):
```
### issue-agent
- **역할**: 이슈 상태 변경·댓글 추가·자기 자신 unassign
- **선언 도구**: get_issue_detail, update_status, add_comment, unassign_self
- **위임 규칙**:
  - 이슈 생성/삭제 → project-agent 위임
  - 프로젝트 목록/멤버 → project-agent
- **파괴 작업 confirm 필수**: unassign (되돌리기 어려운 작업)
- **컨텍스트 주입**: 이슈 채팅 시 이슈 번호·프로젝트 키가 시스템 프롬프트로 주입됨
```

### Step 2: 커버리지 매트릭스

`.coverage-matrix-<perspective>.md`에 저장. **시나리오 레벨**로 작성하며, subagent당 **최소 12개**.

❌ 잘못된 예 (능력 레벨):
```
| issue-agent > 상태 변경 가능 여부 | ⬜ |
```

✅ 올바른 예 (accuracy perspective, issue-agent):
```
| issue-agent > 존재하지 않는 이슈 번호 조회 요청  | hallucination 없이 not found 응답  | ⬜ |
| issue-agent > "분석해줘" 요청                   | 이슈 도구 호출 후 컨텍스트 기반 답변  | ⬜ |
| issue-agent > unassign 요청 (confirm 없이)      | confirm 요청 후 대기                | ⬜ |
| issue-agent > 이슈 생성 요청                    | project-agent 위임 안내 (직접 X)   | ⬜ |
```

상태: ⬜ 미시작 → 🔄 진행 중 → ✅ 완료 → 🔴 결함 발견

> 시나리오 템플릿·질문 리스트는 `references/perspectives/<perspective>.md`에서 가져온다.

## 2. API 호출 패턴

workplace-ai-agent는 **두 가지 엔드포인트**를 가진다.

### 환경 준비

```bash
# workplace-ai-agent 가동 확인 (port 7070)
curl -sf http://localhost:7070/health > /dev/null && echo OK || echo NOPE

# 내부 인증 토큰 (apps/workplace-ai-agent/.env.local의 INTERNAL_SERVICE_TOKEN)
TOKEN=$(grep INTERNAL_SERVICE_TOKEN apps/workplace-ai-agent/.env.local | cut -d= -f2)
# 기본값: changeme-local

# 점검 세션 디렉토리 (timestamp 중심)
TS=$(date +%Y-%m-%dT%H-%M)
SESSION_DIR="test-results/subagent-eval/$TS"
mkdir -p "$SESSION_DIR/traces"
```

### A. 홈 AI Compose — SSE 직접 호출 (홈 비서 시나리오)

홈 AI 비서는 `/home/compose`로 SSE 스트리밍 응답을 반환한다.

```bash
# 홈 compose 호출 (SSE 스트림)
SCENARIO_ID="issue-001"
PROMPT="내 담당 이슈 목록 보여줘"
ASSISTANT_AGENT_ID=1  # workplace-api에 등록된 AI 비서 에이전트 ID

curl -sN -X POST http://localhost:7070/home/compose \
  -H "Authorization: Internal $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --arg q "$PROMPT" \
    --argjson aid "$ASSISTANT_AGENT_ID" '{
      query: $q,
      assistantAgentId: $aid,
      thinkingDepth: "NONE",
      maxTurns: 8
    }')" > "$SESSION_DIR/traces/$SCENARIO_ID.sse" &
SSE_PID=$!

# 120초 타임아웃 (기본 300000ms지만 점검은 단일 턴 위주)
sleep 120
kill $SSE_PID 2>/dev/null
```

**SSE 이벤트 타입** (fire-hub `/agent/chat`과 다름):

| 이벤트 | 의미 |
|--------|------|
| `delta` | 텍스트 스트리밍 chunk |
| `progress` | 내부 진행 상황 (tool 호출 중 등) |
| `pending_action` | 사용자 확인 요청 (propose_* 도구 결과) |
| `done` | 완료 + 토큰 사용량 |
| `error` | 오류 발생 |

> `tool_use` / `tool_result`는 별도 이벤트가 아닌 `progress` 내부에 포함될 수 있다.
> trace 파싱 시 `progress` 이벤트 data를 JSON으로 파싱해 `type` 필드를 확인한다.

#### SSE 트레이스 파싱 (홈 compose 전용)

```bash
# 최종 텍스트 응답 (delta 이벤트 누적)
grep "^event: delta$" -A1 "$SESSION_DIR/traces/$SCENARIO_ID.sse" \
  | grep "^data:" | sed 's/^data: //' | jq -r '.text // .content // empty'

# progress 이벤트 내 tool_use 추출
grep "^event: progress$" -A1 "$SESSION_DIR/traces/$SCENARIO_ID.sse" \
  | grep "^data:" | sed 's/^data: //' \
  | jq -c 'select(.type == "tool_use") | {tool: .toolName, input: .input}'

# pending_action (제안 카드 — propose_* 도구)
grep "^event: pending_action$" -A1 "$SESSION_DIR/traces/$SCENARIO_ID.sse" \
  | grep "^data:" | sed 's/^data: //' | jq .

# done 이벤트 (토큰/완료)
grep "^event: done$" -A1 "$SESSION_DIR/traces/$SCENARIO_ID.sse" \
  | grep "^data:" | sed 's/^data: //' | jq .

# 에러 이벤트
grep "^event: error$" -A1 "$SESSION_DIR/traces/$SCENARIO_ID.sse"
```

### B. 이벤트 기반 AI — 이슈 채팅·메시징 시나리오

이슈 채팅과 팀 메시징 AI는 `POST /events`로 이벤트를 주입해 비동기 응답을 트리거한다.
응답은 직접 반환되지 않고 workplace-api가 WebSocket으로 전달하므로, 결과를 확인하려면
**workplace-api를 통해 메시지를 조회**해야 한다.

```bash
# workplace-api 로그인 (dev 계정)
AUTH_TOKEN=$(curl -sf -X POST http://localhost:9090/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"bluleo78@gmail.com","password":"Workplace1"}' \
  | jq -r '.accessToken')

# 이슈 채팅 메시지 이벤트 주입
# THREAD_ID: 이슈 채팅 스레드 ID (사전에 조회 필요)
THREAD_ID=<스레드_ID>
curl -sX POST http://localhost:7070/events \
  -H "Authorization: Internal $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --argjson tid "$THREAD_ID" '{
      type: "CHAT_MESSAGE_POSTED",
      threadId: $tid,
      message: { content: "이 이슈의 우선순위를 높음으로 변경해줘" },
      tenantId: 1,
      userId: 1
    }')"

# 잠시 대기 후 스레드 메시지 확인 (비동기)
sleep 15
curl -s "http://localhost:9090/api/v1/chat/threads/$THREAD_ID/messages" \
  -H "Authorization: Bearer $AUTH_TOKEN" | jq '.content[-3:]'

# 채널 메시지 이벤트 (My AI DM 멘션)
CHANNEL_ID=<채널_ID>
curl -sX POST http://localhost:7070/events \
  -H "Authorization: Internal $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
    --argjson cid "$CHANNEL_ID" '{
      type: "MESSAGING_MESSAGE_POSTED",
      channelId: $cid,
      message: { content: "@My AI 내 프로젝트 목록 알려줘" },
      tenantId: 1,
      userId: 1
    }')"
```

> **비동기 응답 확인**: `/events` 호출은 즉시 202를 반환한다. 실제 AI 응답은 15~60초 후
> workplace-api 메시지 API로 조회한다. 타임아웃은 60초로 설정한다.

### C. workplace-api에서 이슈/채널 ID 조회

```bash
# 프로젝트 목록
curl -s http://localhost:9090/api/v1/projects \
  -H "Authorization: Bearer $AUTH_TOKEN" | jq '.[].key'

# 이슈 채팅 스레드 (이슈 상세에서 threadId 추출)
curl -s "http://localhost:9090/api/v1/projects/TEST/issues/1" \
  -H "Authorization: Bearer $AUTH_TOKEN" | jq '{threadId, issueNumber}'

# 채널 목록 (My AI DM 포함)
curl -s "http://localhost:9090/api/v1/messaging/channels" \
  -H "Authorization: Bearer $AUTH_TOKEN" | jq '.[] | {id, name, type}'
```

## 3. smart-workplace 특화 검증 항목

### 홈 AI compose 필수 검증

- **이슈 목록 조회 도구**: "내 이슈 알려줘" → `list_projects` 또는 이슈 관련 도구 호출 여부
- **캘린더 조회 도구**: "오늘 일정 알려줘" → `list_events` 도구 호출 여부
- **메일 도구**: "미읽은 메일 요약해줘" → `list_mail` 또는 `sync_mail` 호출 여부
- **위키 검색**: "~에 대한 문서 있어?" → `search_wiki` 호출 여부
- **subagent 라우팅**: trace의 `Agent` tool_use에서 `subagent_type`이 specialized 이름인지 확인
  - `general-purpose` 폴백이면 라우팅 실패 의심

### 이슈 채팅 AI 필수 검증

- **이슈 컨텍스트 주입**: AI가 현재 이슈 번호·프로젝트 키를 알고 있는가 (시스템 프롬프트 주입 여부)
- **`get_issue_detail` 호출**: 상태 변경 전 현재 이슈 상태 확인 도구 호출
- **`update_status` 파라미터**: 유효한 상태값(OPEN, IN_PROGRESS, DONE 등)만 사용

### @My AI 멘션 트리거

- **멘션 감지**: `@My AI`가 포함된 메시지만 AI가 응답하는지
- **미멘션 무응답**: 일반 채널 메시지(멘션 없음)에 AI가 응답하지 않는지

### propose_* 도구 검증 (안전장치)

- **pending_action 이벤트**: `propose_create_event`, `propose_delete_*` 도구 결과가
  `pending_action` SSE 이벤트로 전달되는지
- **사용자 confirm 없이 실행 금지**: propose 후 confirm 없이 실제 create/delete 호출 금지

## 4. 검증 항목 (perspective별)

자세한 체크리스트는 `references/perspectives/<perspective>.md` 참조.

### accuracy (기본 — 정확성/환각)

- 응답이 사실인가? (존재하지 않는 이슈·프로젝트·채널 언급 금지)
- 위임 규칙을 지키는가? (담당 외 작업 → 적절한 subagent로 위임)
- propose_* 도구를 통한 확인 요청을 하는가? (직접 변경 금지)
- agent.md 규칙을 따르는가?

### tool (도구 호출)

- 선언된 tools 외 호출 없음
- 필수 도구가 호출됨 (예: update_status 직전 get_issue_detail)
- tool 인자 schema 위반 없음
- tool_result 에러를 응답에 반영함
- propose_* 도구 흐름 위반 없음

### perf (성능)

- 홈 compose SSE: 첫 delta 이벤트까지의 시간 (TTFT)
- done 이벤트 기준 총 완료 시간
- 이벤트 기반 AI: 이벤트 주입 후 응답 메시지까지의 지연
- 불필요한 도구 반복 호출

### ux (표현)

- 한국어 품질
- 진행 상황 명시 (long-running 작업 시 progress 이벤트 활용)
- pending_action 제안 카드의 문구 명확성
- 다음 단계 제안

## 5. 결함 판정 기준

- **Critical**: 환각으로 잘못된 도구 호출 → 데이터 변경/삭제, propose 없이 직접 변경
- **Major**: 위임 규칙 위반, propose 누락 (변경 작업), 이슈 컨텍스트 미주입, 필수 도구 미호출
- **Minor**: 불필요한 도구 반복, maxTurns 도달, 비효율적 흐름
- **UX**: 한국어 표현, 누락된 진행 표시, pending_action 문구 불명확

## 6. 결함 문서화

발견된 결함은 GitHub Issues에 즉시 등록 후 보드에도 추가한다.

#### 등록 전 전제 가정 검증 (필수)

자신의 진단이 도메인/스펙 가정에 의존하는지 점검한다.
- agent.md에 명시된 규칙을 어긴 경우 → 결함 (등록)
- 명시 규칙이 없고 inspector의 추정에 의존 → `needs-decision` 라벨 부착, `ai-fix`는 미부착

**Perspective별 라벨 매핑**:

| Perspective | 라벨 |
|---|---|
| `accuracy` | `bug,subagent-quality,severity:critical\|major\|minor,accuracy` |
| `tool` | `bug,subagent-quality,severity:critical\|major,tool` |
| `perf` | `bug,subagent-quality,severity:major\|minor,perf` |
| `ux` | `bug,subagent-quality,severity:ux,ux` |

> **`ai-fix` 라벨 정책** — pilot 자율 사이클이 solver로 픽업하려면 반드시 부착한다.
> 단, `needs-decision`이 부착된 케이스는 `ai-fix`를 빼고 사람 검토 후 재부착.

```bash
ISSUE_URL=$(gh issue create \
  --title "<subagent명> — 한 줄 요약" \
  --label "bug,subagent-quality,ai-fix,severity:major,accuracy" \
  --body "$(cat <<EOF
## 대상
- **Subagent**: issue-agent
- **Perspective**: accuracy
- **시나리오 ID**: issue-001
- **API 엔드포인트**: POST /home/compose (또는 POST /events)

## 현상
한 문장 요약.

## 재현
1. POST http://localhost:7070/home/compose 호출 (Authorization: Internal changeme-local)
2. 프롬프트: "내 담당 이슈 목록 보여줘"
3. 관찰: list_projects 도구를 호출하지 않고 임의 이슈 목록을 환각

## Trace 근거
\`\`\`
$SESSION_DIR/traces/issue-001.sse
\`\`\`
- progress 이벤트 내 tool_use 없음
- 최종 delta 텍스트: "현재 담당 이슈가 없습니다" (실제 조회 없이)

## 원인
- 파일: \`apps/workplace-ai-agent/src/agent/subagents/issue-agent/agent.md\`
- 분석: 이슈 목록 조회 시 필수 도구 호출 누락

## 수정 방향
agent.md workflow에 이슈 목록 조회 시 list_projects → get_issue_detail 흐름 명시.

## 메타
- **발견**: $(date +%Y-%m-%d) (ai-driven-agent-inspector)
- **workplace-ai-agent**: \`apps/workplace-ai-agent/src/agent/subagents/issue-agent/\`
EOF
)")

ISSUE_NUM=$(echo "$ISSUE_URL" | grep -oE '[0-9]+$')
bash .claude/skills/ai-driven-pilot/scripts/add-to-board.sh "$ISSUE_NUM"
```

> `subagent-quality` 라벨이 핵심 — pilot 라우팅 시 ai-agent-developer가 픽업하도록 분기.

매트릭스의 🔴 항목에는 이슈 번호를 기록한다.

## 7. 점검 패턴

### Subagent 집중 원칙

**한 subagent의 12+ 시나리오를 모두 점검한 후 다음 subagent로 이동한다.**
결함을 2~3개 발견했다고 멈추지 말되, 시나리오를 무한히 늘리지 않는다.
목적은 *광범위한 발견* — 매트릭스 항목 완주가 우선.

### 시나리오 작성 원칙

1. **정상 경로** — 가장 흔한 사용 흐름 (홈 AI: "내 이슈 알려줘", 이슈 채팅: "상태 변경해줘")
2. **엣지 케이스** — 빈 값, 존재하지 않는 ID, 권한 없는 리소스
3. **위임 경계** — 다른 subagent 담당 요청 시 위임하는가
4. **propose 흐름** — propose_* 도구 트리거 후 pending_action 이벤트 발생 여부
5. **컨텍스트 주입** — 이슈 채팅에서 이슈 번호·프로젝트 키 인지 여부
6. **에러 처리** — 권한·존재하지 않음·서버 오류 시 응답
7. **모호 입력** — 의도 불명확한 짧은 발화에 되묻는가
8. **멘션 트리거** — @My AI 멘션 유무에 따른 응답 분기
9. **멀티턴** — recentContext 활용 시 상태 유지 여부 (홈 compose만)

각 시나리오에 대해: 호출 → SSE/이벤트 트레이스 → 검증 → 매트릭스 업데이트 → (결함이면) 이슈 등록.

## 8. 최종 보고서

`test-results/subagent-eval/<YYYY-MM-DDTHH-MM>/report.md`에 작성.

```
test-results/
└── subagent-eval/                   ← 본 스킬 결과
    ├── .subagent-tree.md            ← subagent 인벤토리 (perspective 무관, 공유)
    ├── .coverage-matrix-accuracy.md
    ├── .coverage-matrix-tool.md
    ├── .coverage-matrix-perf.md
    ├── .coverage-matrix-ux.md
    └── <YYYY-MM-DDTHH-MM>/
        ├── report.md
        └── traces/                  ← SSE/응답 원본
            ├── issue-001.sse        ← /home/compose SSE 트레이스
            ├── messaging-001.json   ← /events 후 메시지 조회 응답
            └── ...
```

보고서 양식:
```
# Subagent Inspection Report — YYYY-MM-DD

## Perspective: accuracy

| Subagent         | 시나리오 | 결함 | 이슈                 |
|------------------|---------|------|---------------------|
| issue-agent      | 14      | 2    | #N1, #N2            |
| calendar-agent   | 12      | 0    | -                   |

## 결함 요약
- #N1 (Major) — issue-agent: 이슈 목록 조회 도구 미호출 환각
- ...

## 다음 패스 권고
- tool perspective 미실행
- messaging-agent 비동기 응답 지연 확인 필요
```

## 크로스 체크 모드 — 이슈 수정 검증

solver가 ✅ 수정 완료(resolved 라벨)로 표시한 subagent 관련 이슈를 fresh API 세션에서 재검증.

### Step C1. 검증 대상 선택

```bash
gh issue list --label "resolved,subagent-quality" --state open --json number,title,body,labels

# 사용자가 번호를 지정한 경우
gh issue view <번호> --json number,title,body,labels,state
```

이슈의 `## 재현` 섹션을 그대로 curl로 다시 실행한다.

### Step C2. Fresh 호출

```bash
TS=$(date +%Y-%m-%dT%H-%M)
TRACE="test-results/subagent-eval/$TS/traces/crosscheck-<번호>.sse"
mkdir -p "$(dirname "$TRACE")"
# 이슈 본문의 API 엔드포인트와 프롬프트로 호출
```

### Step C3. 결과 판정

1. **결함 사라짐** → ✅ 수정 확인
2. **여전히 재현** → 🔴 회귀 (regression 라벨)
3. **다른 결함 발생** → 새 이슈 등록

### Step C4. GitHub 업데이트

```bash
# 패스
gh issue edit <번호> --remove-label "resolved"
gh issue close <번호> --reason completed \
  --comment "✅ 크로스체크 완료 ($(date +%Y-%m-%d)) — trace 재현 안 됨, 수정 확인"

# 회귀
gh issue edit <번호> --remove-label "resolved" --add-label "regression"
gh issue comment <번호> --body "🔴 회귀 발견 ($(date +%Y-%m-%d))

**관찰 trace**: $TRACE
**기대 동작과의 차이**: …"
```

### Pilot subagent 모드 — 정형 보고

pilot이 자율 사이클로 호출한 경우 stdout 마지막 줄에:

| 결과 | RESULT 라인 |
|------|-----------|
| 크로스체크 통과 | `RESULT: #<N> / passed / closed` |
| 회귀 | `RESULT: #<N> / regression / <K>` |
| 진행 불가 (agent 서버 다운 등) | `RESULT: #<N> / blocked / <사유>` |
| 점검 모드 발견 보고 | `INSPECTOR_DONE: <N>,<M>,...` 또는 `INSPECTOR_DONE: none` |

---

## 주의사항

- `gh issue` 명령과 `test-results/`만 변경 (소스 수정 금지)
- SSE 트레이스 원본은 `test-results/subagent-eval/<TS>/traces/`에 저장
- workplace-ai-agent가 다운이면 즉시 `blocked` 종료
- internal token이 없으면 `apps/workplace-ai-agent/.env.local`을 사람에게 요청 (자동 생성 금지)
- 트레이스의 userId·token은 보고서·이슈 본문에 포함하지 않는다 (PII/secret 보호)
- subagent의 도메인 규칙은 agent.md가 single source of truth — 추정 금지
- UI에서만 재현 가능한 결함은 ai-driven-explorer 영역 → 이쪽에서 등록 금지
- 이벤트 기반 AI(이슈 채팅·메시징) 시나리오는 비동기 특성상 **60초** 대기 후 결과 확인
