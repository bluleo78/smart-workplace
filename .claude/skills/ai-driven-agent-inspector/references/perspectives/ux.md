# Perspective: ux (표현 품질)

한국어 품질, 진행 표시, pending_action 카드 문구, 결과 요약 일관성, 다음 단계 제안을 본다.

## 시나리오 템플릿 (subagent당 12개 이상)

### 1. 한국어 품질
- `[1]` 어색한 번역체 ("그것은 ~입니다", 영어식 어순)
- `[2]` 조사 누락/오류 ("이슈 이/가", "에서/에게")
- `[3]` 단위·전문용어 일관성 (이슈 상태 표현: "진행 중" vs "In Progress" 혼용)
- `[4]` 영어 단어 혼용 빈도 (필요 시 한글 병기)

### 2. 진행 표시
- `[5]` 긴 작업 시 progress 이벤트 활용 여부 (도구 호출 중 상태 안내)
- `[6]` 도구 호출 사이 침묵 구간이 5초 이상이면 progress 이벤트로 상태 표시
- `[7]` 실패 시 어느 단계에서 실패했는지 명시

### 3. pending_action 카드 (smart-workplace 특화)
- `[8]` pending_action 이벤트의 제안 문구가 명확한가 ("어떤 이벤트를 생성할까요?" vs 추상적 문구)
- `[9]` 제안 내용에 핵심 정보 포함 (날짜·시간·제목 등)
- `[10]` 사용자 confirm/거절 선택지가 명확한가

### 4. 결과 요약
- `[11]` 실행한 작업 한 줄 요약 포함 (완료 시)
- `[12]` 변경된 리소스 이름·ID 포함
- `[13]` 다음 단계 제안 ("이제 ~할까요?")

### 5. 모호 응답
- `[14]` "할 수도 있고 안 할 수도 있어요" 류 hedging
- `[15]` 사용자 질문에 답하지 않고 일반론으로 회피
- `[16]` 동일 응답이 멀티턴에 반복 (스크립트 같은 느낌)

### 6. 상태 일관성 (멀티턴 — 홈 compose recentContext)
- `[17]` 2턴 이전 사용자 결정 기억하는가
- `[18]` 이전 대화 맥락을 버리고 처음부터 다시 묻는가

## subagent별 UX 체크포인트

### 홈 AI compose
- delta 이벤트 스트리밍이 자연스럽게 흐르는가 (긴 침묵 없이)
- 복합 작업 (여러 subagent 라우팅) 시 진행 순서 안내

### issue-agent
- 상태 변경 완료 후 "✅ 이슈 #N 상태가 [상태명]으로 변경되었습니다" 류 명확한 완료 메시지

### calendar-agent
- propose_create_event: "2026-06-20 15:00~16:00 '팀 회의' 일정을 생성할까요?" 구체적 문구
- propose_delete_event: 삭제 대상 이벤트명·날짜 포함

### mail-agent
- propose_send_mail: 수신자·제목·내용 요약 포함한 확인 문구

### messaging-agent
- 채널명 안내: "채널 '[채널명]'에 메시지를 전송했습니다"

## 검증 방법

이 perspective는 정성 검증이 많다. trace의 최종 텍스트를 직접 읽거나, 명백한 패턴만 자동 검출.

```bash
# 최종 delta 텍스트 누적 추출
grep "^event: delta$" -A1 trace.sse \
  | grep "^data:" | sed 's/^data: //' \
  | jq -r '.text // .content // empty' | tr -d '\n' > /tmp/final-response.txt

cat /tmp/final-response.txt

# pending_action 카드 내용 확인
grep "^event: pending_action$" -A1 trace.sse \
  | grep "^data:" | sed 's/^data: //' | jq '.title, .description, .actions'

# 다음 단계 제안 포함 여부
grep -cE "다음 (단계|작업)|이제 .{0,20}할까요|진행하시겠습니까|추가로 필요하신" \
  /tmp/final-response.txt

# 영어 상태값 노출 검사
grep -oE "(OPEN|IN_PROGRESS|DONE|CLOSED|TODO)" /tmp/final-response.txt
# → 한국어 병기 없이 영어만 노출되면 UX 결함

# hedging 패턴
grep -cE "수도 있|것 같습니다|아마도|확실하지 않" /tmp/final-response.txt
```

## 결함 등급

- **UX (기본)**: 어색한 한국어, 요약 누락, hedging, pending_action 문구 불명확
- **Major** (드물게): 멀티턴 상태 기억 실패로 잘못된 작업 수행, pending_action 핵심 정보 누락으로 사용자 판단 불가
