# Perspective: perf (성능 — 지연/토큰)

응답 지연, 토큰 사용량, maxTurns 도달, 도구 반복 호출을 본다.
smart-workplace는 두 가지 API 패턴이 있으므로 각각 별도 임계치를 적용한다.

## 측정 지표

### A. 홈 compose SSE (`POST /home/compose`)

- **TTFT (첫 delta 이벤트까지)**: SSE 연결 시작 ~ 첫 `delta` 이벤트 수신
- **총 완료 시간**: 첫 이벤트 ~ `done` 이벤트 (curl wall-clock으로 측정)
- **토큰**: `done` 이벤트의 usage 필드 (있으면)
- **도구 호출 수**: `progress` 이벤트 중 `type == "tool_use"` 카운트
- **동일 도구 반복**: 같은 toolName 연속 호출

### B. 이벤트 기반 AI (`POST /events`)

- **응답 지연**: 이벤트 주입 시각 ~ workplace-api 메시지 조회 시 AI 응답 메시지 등장
- **비동기 완료 시간**: 60초 poll 기준

## 임계치 (초안 — 실측 후 조정)

### 홈 compose SSE

| 지표 | 정상 | Warn | Critical |
|------|------|------|----------|
| TTFT | < 5s | 5~15s | > 15s |
| 단순 조회 총 완료 | < 15s | 15~30s | > 30s |
| 복합 작업 총 완료 | < 60s | 60~120s | > 120s |
| 도구 호출 수 (단순) | < 3 | 3~6 | 7+ |
| 동일 도구 반복 | 0~1 | 2 | 3+ |

### 이벤트 기반 AI

| 지표 | 정상 | Warn | Critical |
|------|------|------|----------|
| 이슈 채팅 응답 도착 | < 30s | 30~60s | > 60s |
| 채널 AI 응답 도착 | < 45s | 45~90s | > 90s |

## 시나리오 템플릿 (subagent당 12개)

### 홈 compose 시나리오
- 단순 조회 (list만): "내 일정 목록 보여줘" × 2
- 단순 조회 (get): "특정 이슈 상세 보여줘" × 2
- 복합 작업 (propose 포함): "내일 오후 3시에 회의 잡아줘" × 2
- 멀티턴 (recentContext 활용): 2~3턴 대화 × 2
- 큰 결과셋: "메일 30개 목록 보여줘" × 1
- 동시 다중 subagent 라우팅: "이슈 목록이랑 오늘 일정 같이 알려줘" × 1
- 에러 후 재시도: 존재하지 않는 리소스 → 에러 처리 × 2

### 이벤트 기반 시나리오
- 이슈 채팅 단순: "이 이슈 설명해줘" × 2
- 이슈 채팅 변경: "상태 변경해줘" × 2
- 채널 AI 멘션: "@My AI 내 이슈 목록 알려줘" × 2

## 검증 방법

```bash
# 홈 compose: curl 전체 시간 측정
TIME_START=$(date +%s%N)
curl -sN -X POST http://localhost:7070/home/compose \
  -H "Authorization: Internal $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" > trace.sse
TIME_END=$(date +%s%N)
TOTAL_MS=$(( ($TIME_END - $TIME_START) / 1000000 ))
echo "총 소요: ${TOTAL_MS}ms"

# 도구 호출 수
grep "^event: progress$" -A1 trace.sse \
  | grep "^data:" | sed 's/^data: //' \
  | jq -r 'select(.type == "tool_use") | .toolName' | wc -l

# 동일 도구 반복
grep "^event: progress$" -A1 trace.sse \
  | grep "^data:" | sed 's/^data: //' \
  | jq -r 'select(.type == "tool_use") | .toolName' \
  | sort | uniq -c | sort -rn | head -5

# done 이벤트 토큰 (있는 경우)
grep "^event: done$" -A1 trace.sse \
  | grep "^data:" | sed 's/^data: //' | jq '.usage // "N/A"'

# 이벤트 기반: 응답 도착 시간 측정
EVENT_SENT=$(date +%s)
curl -sX POST http://localhost:7070/events ... -w "\n"
# ... poll loop
POLL_INTERVAL=5
for i in $(seq 1 12); do
  sleep $POLL_INTERVAL
  RESULT=$(curl -s "http://localhost:9090/api/v1/..." \
    -H "Authorization: Bearer $AUTH_TOKEN" | jq -r '.content[-1].author.type')
  if [ "$RESULT" = "AGENT" ]; then
    echo "응답 도착: $(($(date +%s) - $EVENT_SENT))초"
    break
  fi
done
```

## 결함 등급

- **Critical**: maxTurns 도달로 작업 미완료, 동일 도구 5+ 반복 (루프 의심)
- **Major**: Critical 임계치 초과 (30s TTFT, 복합 120s+)
- **Minor**: Warn 구간 지속, 명백한 redundant call
