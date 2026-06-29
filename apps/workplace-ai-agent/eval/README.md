# #519 Text-to-Filter 라이브 Eval

NL→이슈 필터 매핑 정확도는 **라이브 LLM 속성**이라 CI 유닛/E2E 테스트가 잡지 못한다.
- CI vitest: 필터의 *유효성·렌더*만 검증(쿼리→필터 구조 변환 미포함)
- **라이브 eval**: 실제 LLM 출력으로 질의→필터 매핑 정확도 검증

이 폴더의 eval은 **머지 게이트 수동 라이브 eval**로, PR 전에 `pnpm dev` 후 실행한다.

## 목표

held-out 질의 6개를 실행해 LLM 이 올바른 필터 파라미터(`assignee` / `priority` / `status` / `blocked` / `dueFrom`/`dueTo`)를 매핑하는지 검증한다.
few-shot 예시와 문장이 겹치지 않아 순환 평가를 방지한다.

## 테스트 케이스

| # | 질의 | 검증 포인트 | 기대 필터 |
|---|---|---|---|
| 1 | 내가 맡은 급한 거 | assignee:me + 우선순위 높음 | `assignee:me`, `priority:["HIGH"]` |
| 2 | 담당자 없는 가장 급한 이슈 | 담당 없음 + 우선순위 높음 | `assignee:"null"`, `priority:["HIGH"]` |
| 3 | 이번 주에 마감인 내 이슈 | 담당자 + 날짜 범위 | `assignee:me`, `dueFrom/dueTo` (이번 주 범위) |
| 4 | 내가 만든 막힌 이슈 | 작성자 + 블로커 | `reporter:me`, `blocked:true` |
| 5 | 아직 안 끝난 내 작업 | 담당자 + 미완료 상태 | `assignee:me`, `status:["TODO","IN_PROGRESS"]` |
| 6 | 지난주에 등록한 이슈 | **degradation** — 생성일 미지원 | 필터 0~1개 + "지원하지 않" 안내 prose |

## 실행 방법

### 1. 서버 기동 (별도 터미널)

```bash
cd /path/to/smart-workplace

# ai-agent 서버 (포트 7070)
cd apps/workplace-ai-agent
pnpm dev

# 또는 api 서버(포트 9090) 거쳐 호출 시
cd apps/workplace-api
pnpm dev
```

### 2. Eval 실행

```bash
cd apps/workplace-ai-agent

# 기본값 사용 (ai-agent:7070 로컬, 테스트 토큰)
EVAL_TOKEN=test node eval/run-text-to-filter-eval.mjs

# 또는 명시적 URL/토큰
EVAL_BASE_URL=http://localhost:7070/ai/chat EVAL_TOKEN=<bearer-token> \
  node eval/run-text-to-filter-eval.mjs

# API 거쳐 호출
EVAL_BASE_URL=http://localhost:9090/api/v1/ai/chat EVAL_TOKEN=<user-jwt> \
  node eval/run-text-to-filter-eval.mjs
```

### 3. 선택 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `EVAL_BASE_URL` | `http://localhost:7070/ai/chat` | ai-agent chat 엔드포인트 |
| `EVAL_TOKEN` | _(필수)_ | Bearer 토큰 |
| `EVAL_AGENT_ID` | `1` | 대행 에이전트 ID |
| `EVAL_USER_ID` | `1` | 요청 사용자 ID |
| `EVAL_MODEL` | `claude-3-5-sonnet-20241022` | LLM 모델 |

## 판정 기준

**통과:** 전 6개 케이스 PASS

### 케이스별 판정

- **Case 1,2,4,5**: 기대 필드 전부 일치
- **Case 3**: `assignee:me` + `dueFrom/dueTo` 필드 존재 + 범위가 이번 주
- **Case 6 (degradation)**: 
  - `dueFrom`/`dueTo` 필드 비움
  - 응답 prose 에 "지원하지 않" 류 문구 포함

## 실패 디버깅

eval 실행 중 FAIL 이 나면:

1. **prose 확인** — 안내 문구가 올바른지 보기
   ```bash
   # 특정 케이스만 디버그 (아래 runner 수정)
   ```

2. **파라미터 검사** — 실제 LLM 출력의 params 비교
   ```
   실제 params: {"assignee":"me","priority":["HIGH","MEDIUM"]}
   ```

3. **프롬프트 재검토** — assistant-system-prompt.ts 의 필터 지시 확인
   - `priority` 는 `LOW`/`MID`/`HIGH` 만 (CRITICAL·MEDIUM 없음)
   - 날짜 필터는 `dueFrom`/`dueTo`(마감일)만 지원
   - 생성일(`createdFrom`/`createdTo`) 요청 시 안내 필수

4. **CI 테스트** — 필터 유효성·렌더 테스트는 분리
   - 이 eval 은 LLM 정확도만 — 필터 구조·렌더는 E2E/unit 에서

## 커밋 & PR

```bash
git add apps/workplace-ai-agent/eval/
git commit -m "test(issue): #519 held-out 라이브 eval 하니스(NL→이슈 필터 정확도 머지 게이트)"
```

PR 작성 시:
- eval 실행 결과 스크린샷 또는 터미널 로그 첨부
- 6/6 통과 여부 명시
