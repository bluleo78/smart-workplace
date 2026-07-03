# 멀티 프로바이더 LLM(opencode 러너) 라이브 스모크 체크리스트

> 설계: `docs/superpowers/specs/2026-07-03-multi-provider-llm-opencode-design.md`
> 계획: `docs/superpowers/plans/2026-07-03-multi-provider-llm-opencode.md`

## ⚠️ 배포 전제조건 — `opencode` CLI 바이너리

Task 9 구현 중 확인된 사실: `@opencode-ai/sdk`의 `createOpencode()`는 순수 JS 서버가 아니라
**`opencode` CLI 실행파일을 `cross-spawn`으로 자식 프로세스 spawn**하는 방식으로 동작한다
(`node_modules/@opencode-ai/sdk/dist/server.js`). npm 패키지 설치만으로는 부족하고,
**ai-agent 프로세스가 실행되는 환경의 `PATH`에 `opencode` CLI가 별도로 설치돼 있어야 한다.**

이는 기존에 Claude 경로가 `@anthropic-ai/claude-code` 실행파일을 이미지에 설치해둬야 하는 것과
정확히 같은 패턴이다(`apps/workplace-ai-agent/CLAUDE.md` 참고).

- [ ] 로컬 개발 환경: `which opencode` 로 PATH 확인 (없으면 `npm i -g opencode-ai` 또는 공식 설치 스크립트로 설치)
- [ ] **배포 이미지(Dockerfile)에 `opencode` CLI 설치 단계 추가 필요** — 이 스모크를 시작하기 전에 확인. 미설치 상태에서 opencode 자격증명으로 실행하면 ENOENT/spawn 오류로 즉시 실패한다.
- [ ] `opencode --version` 으로 정상 실행 확인

## 사전 준비

### 1. AWS Bedrock OpenAI 호환 엔드포인트 준비

1. AWS Bedrock 콘솔에서 Bedrock API 키(bearer token) 발급.
2. OpenAI 호환 엔드포인트 URL 확인 (예: `https://bedrock-mantle.{region}.api.aws/openai/v1`).
3. 사용 가능한 모델 id 확인(예: `openai.gpt-oss-120b-1:0` 등) — 등록 시 모델 프로브로 자동 조회되지만, 사전에 알고 있으면 프로브 실패 시 수동 입력 폴백 검증에 활용 가능.

### 2. API + ai-agent 재시작

```bash
pnpm db:up
cd apps/workplace-api && ./gradlew bootRun     # V119 마이그레이션 자동 적용
cd apps/workplace-ai-agent && pnpm dev         # opencode CLI PATH 확인 후 기동
cd apps/workplace-web && pnpm dev
```

---

## 검증 항목

### 3. 관리자 — 공통 에이전트에 opencode 등록

- [ ] `/admin/agents` → 임의 AGENT 선택 → "자격증명 등록" 다이얼로그 오픈
- [ ] "외부 프로바이더 (OpenAI 호환)" 모드 선택 → "AWS Bedrock" 프리셋 선택 → Base URL 템플릿 자동 채움 확인
- [ ] Base URL을 실제 리전으로 수정, API Key 입력 → **[모델 불러오기]** 클릭
- [ ] 모델 목록이 실제로 조회되어 Select에 표시됨 (프로브 성공)
- [ ] 모델 선택 → 등록 제출 → 성공 토스트 + 자격증명 카드에 "AWS Bedrock" 뱃지 + baseUrl 노출

### 4. 프로브 실패 폴백 (의도적으로 잘못된 API Key 사용)

- [ ] 잘못된 API Key로 [모델 불러오기] 클릭 → 에러 표시 + 모델 id 수동 입력란 노출
- [ ] 모델 id 수동 입력 → 등록 성공

### 5. 개인 비서로도 등록

- [ ] `/settings` 개인 비서 섹션에서 동일 플로우(외부 프로바이더 선택 → 프로브 → 등록) 반복
- [ ] 등록 후 모델 셀렉트가 서버 목록(`GET /users/me/assistant/models`) 기준으로 렌더

### 6. 홈챗 — 도구 호출 포함 대화 (opencode 러너 end-to-end)

- [ ] 홈 화면 AI 채팅에서 "내 이슈 보여줘" 같은 도구 호출 유발 질문 입력
- [ ] 응답 스트리밍 텍스트가 정상 표시됨 (opencode 이벤트 → RunnerEvent → SSE 변환 확인)
- [ ] `show_issue_list` 위젯이 정상 렌더됨 (opencode의 MCP 도구 호출이 stdio 브리지를 통해 실제 workplace-api를 호출했다는 증거)
- [ ] ai-agent 로그에서 stdio MCP 자식 프로세스 spawn/정상 종료 확인, 좀비 프로세스 없음

### 7. 이벤트 경로 — 이슈 담당 AI (모델 결정 이원화 해소 검증)

- [ ] opencode로 등록된 AGENT를 이슈 담당자로 지정
- [ ] 이슈에 코멘트 남겨 AI 응답 트리거
- [ ] AI가 opencode 러너로 정상 응답 (redeem 응답의 `model` 필드가 이벤트 경로에도 적용됨 — Task 7에서 해소한 이원화 버그의 실 검증)

### 8. pending_action — HostBridge HTTP 콜백 검증

- [ ] 채팅에서 "일정 잡아줘" 같은 확인 카드(pending_action) 유발 요청
- [ ] 카드가 정상 렌더됨 (opencode 프로세스 → stdio MCP → HTTP 콜백(`POST /internal/bridge/:runId`) → HostBridge.onProposal 경로가 실제로 동작함을 확인)
- [ ] 승인 클릭 → 정상 처리

### 9. 타임아웃 경로 (Task 9 리뷰에서 미검증으로 남은 항목)

- [ ] 의도적으로 매우 긴 응답을 유발하거나 `timeoutMs`를 낮게 설정해 타임아웃 트리거
- [ ] 타임아웃 후 opencode 프로세스가 정상 종료되고(좀비 없음) bridge가 release 되는지 확인 (`registerBridge`/`releaseBridge` 쌍이 타임아웃 경로에서도 성립하는지 — 리뷰에서 코드 경로는 kill()과 동일하다고 확인했으나 실제 SSE 스트림이 abort 후 즉시 종료되는지는 라이브 필요)

### 10. Anthropic 회귀 (기존 경로 무변화 확인)

- [ ] 기존 Claude 구독으로 등록된 AGENT/개인 비서로 홈챗 1회 실행 — 정상 동작 확인(러너 분기가 opencode 추가로 인해 anthropic 경로를 깨지 않았는지)

### 11. 웜 캐시 — 재사용 히트 시 지연 감소 (assistant/chat/issue)

- [ ] 개인 비서(assistant 프로필)로 홈챗에서 메시지 1회 전송 → ai-agent 로그에서 `pool_miss` 확인(첫 요청은 캐시 미스로 스폰)
- [ ] 같은 개인 비서로 바로 이어서 메시지 2회 전송 → 로그에서 `pool_hit` 확인 + 응답 시작까지 걸린 시간이 1회차보다 눈에 띄게(체감상) 짧은지 확인
- [ ] 5분 이상 대기 후 다시 메시지 전송 → 로그에서 `pool_idle_evict`(유휴 축출) 후 `pool_miss`(재스폰) 확인

### 12. 웜 캐시 — messaging/home 은 재사용되지 않음(회귀 확인)

- [ ] 채팅(messaging 프로필)에서 pending_action(8번 항목) 재현 → ai-agent 로그에 `pool_hit`/`pool_miss`가 전혀 찍히지 않는지 확인(이 프로필은 풀 대상이 아니므로 로그 자체가 없어야 정상)
- [ ] 같은 흐름을 2회 반복해도 매번 새 opencode 프로세스가 뜨고 정상 종료되는지 확인(좀비 프로세스 없음)

### 13. 웜 캐시 — 동시 요청(같은 키) 처리

- [ ] 같은 개인 비서(assistant, 같은 사용자)로 짧은 간격을 두고 2개의 메시지를 겹쳐 전송(예: 2개 브라우저 탭 또는 연속 클릭)
- [ ] 둘 다 정상적으로 각자의 응답을 받는지 확인 — 만약 한쪽이 실패하거나 응답이 섞이면 opencode 서버 1개가 동시 세션을 지원하지 않는다는 뜻이므로 즉시 보고(설계 문서의 "동시 요청" 절 폴백 필요)
- [ ] (알려진 위험) 동시 요청 중 한쪽이 `session.create`/`event.subscribe` 일시 실패로 evict-재시도를 타면, 그 evict 가 같은 키를 쓰는 **다른 진행 중인 요청의 서버까지 닫아버릴 수 있음**(현재 구현은 사용 중 여부와 무관하게 evict) — 만약 이 인터리빙이 재현되면(한쪽 실패가 다른 쪽 응답까지 깨짐) 설계 문서의 큐잉(직렬화) 폴백이 필요하다는 신호

---

## 알려진 제약 / 후속 과제

- opencode 프로세스는 `assistant`/`chat`/`issue` 프로필에 한해 웜 서버 풀로 재사용된다(#627,
  `agent/opencode-server-pool.ts`, 설계: `docs/superpowers/specs/2026-07-03-opencode-warm-cache-design.md`).
  `messaging`/`home`(hostBridge 사용 프로필)은 여전히 요청별 완전 스폰/종료 — 아래 11~13번 항목으로 검증.
- opencode의 tool-key 와일드카드 매칭(`'workplace*': true`)이 실제 CLI 런타임에서 문서대로 동작하는지는 SDK 타입만으로 확정 불가 — 위 6번 항목이 사실상의 검증.
- `PersonalAssistantSection.tsx`와 `ProviderCredentialDialog.tsx` 사이에 opencode 등록 폼 로직이 일부 중복(Task 13 리뷰에서 확인된 의도적 YAGNI 트레이드오프) — 3번째 소비처가 생기면 공용화 검토.
