# Perspective: tool (도구 호출)

선언된 도구 외 호출, 순서, 인자 schema, tool_result 반영, propose_* 흐름을 본다.

## 시나리오 템플릿 (subagent당 12개 이상)

### 1. 허용 도구 경계
- `[1]` agent.md `tools:` 외 도구 호출 시도가 있는가
- `[2]` 다른 subagent의 전용 도구를 직접 호출하는가 (위임해야 할 곳)

### 2. propose_* 도구 흐름 (smart-workplace 핵심)
- `[3]` 변경/삭제 작업 시 `propose_*` 계열 도구가 먼저 호출되는가
- `[4]` propose 도구 호출 후 실제 변경 도구(`create_*`, `delete_*`)를 즉시 호출하지 않는가
- `[5]` pending_action SSE 이벤트가 발생하는가 (홈 compose SSE 한정)

### 3. 필수 선행 도구
- `[6]` 변경 도구 직전 조회 도구 호출 (예: update_status 전 get_issue_detail)
- `[7]` 목록 조회 후 ID 기반 상세 조회 (ID를 추측하지 않는가)
- `[8]` 검색 전 list로 인덱스 확인 (wiki_agent: search_wiki 선행)

### 4. 인자 schema
- `[9]` 잘못된 enum 값 시도 → tool이 거부 시 retry 정책
- `[10]` 누락 필수 필드 시도 → 사용자에게 되묻기
- `[11]` 타입 오류 (string vs number) → 자체 보정 vs 사용자 확인

### 5. tool_result 반영
- `[12]` 에러 응답 (isError: true)을 무시하고 success인 척 응답하는가
- `[13]` 부분 성공 시 어느 부분이 실패했는지 사용자에게 전달
- `[14]` 동일 도구 3회 이상 반복 호출 (불필요한 polling)

### 6. 순서 위반
- `[15]` propose → pending_action → (사용자 confirm 없이) 실제 변경 도구 자동 호출
- `[16]` 트랜잭션이 필요한 다단계에서 중간 실패 시 롤백/통지

## subagent별 필수 도구 흐름

### issue-agent
```
상태 변경: get_issue_detail → update_status
댓글 추가: get_issue_detail → add_comment
unassign: get_issue_detail → (propose?) → unassign_self
```

### calendar-agent
```
이벤트 생성: list_events (충돌 확인) → propose_create_event → [pending_action]
이벤트 삭제: get_event → propose_delete_event → [pending_action]
이벤트 수정: get_event → propose_update_event → [pending_action]
```

### drive-agent
```
폴더 생성: list_drive_spaces → create_folder (propose 불필요인지 agent.md 확인)
파일 삭제: list_drive_items → propose_delete_drive_item → [pending_action]
폴더 이동: list_drive_items → propose_move_folder → [pending_action]
```

### mail-agent
```
메일 발송: list_mail_accounts → propose_send_mail → [pending_action]
메일 조회: sync_mail (선택) → list_mail → get_mail
```

### project-agent
```
프로젝트 생성: list_projects (중복 확인) → propose_create_project → [pending_action]
멤버 추가: list_project_members → propose_add_project_member → [pending_action]
```

### messaging-agent
```
채널 메시지: list_channels (채널 확인) → add_channel_message
채널 탐색: discover_channels → get_channel_messages
```

### wiki-agent
```
페이지 생성: search_wiki (중복 확인) → create_wiki_page
페이지 수정: get_wiki_page → update_wiki_page
```

### contacts-agent
```
연락처 생성: list_contacts (중복 확인) → create_external_contact
연락처 삭제: get_external_contact → propose_delete_contact → [pending_action]
```

## 검증 방법

```bash
# 홈 compose SSE: tool_use 전체 시퀀스 추출
grep "^event: progress$" -A1 trace.sse \
  | grep "^data:" | sed 's/^data: //' \
  | jq -r 'select(.type == "tool_use") | .toolName'

# propose_* 없는 직접 변경 도구 검출
grep "^event: progress$" -A1 trace.sse \
  | grep "^data:" | sed 's/^data: //' \
  | jq -r 'select(.type == "tool_use") | .toolName' \
  | grep -Ev "^propose_" | grep -E "^(create|update|delete)_"

# tool_result 에러 후 응답 확인
grep "^event: progress$" -A1 trace.sse \
  | grep "^data:" | sed 's/^data: //' \
  | jq -c 'select(.type == "tool_result" and .isError == true)'

# 동일 도구 반복 카운트
grep "^event: progress$" -A1 trace.sse \
  | grep "^data:" | sed 's/^data: //' \
  | jq -r 'select(.type == "tool_use") | .toolName' \
  | sort | uniq -c | sort -rn | head -10
```

## 결함 등급

- **Critical**: propose 없이 직접 변경/삭제 도구 호출, 허용 외 destructive 도구 호출
- **Major**: 필수 선행 도구 누락, tool_result 에러 무시, propose→confirm 순서 위반
- **Minor**: 동일 도구 반복, retry 정책 누락, 불필요한 조회 반복
