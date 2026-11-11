# WP-1494 MCP 이슈 조회 크기 옵션

VOC WPV-78: `list_issues`(size=100)·`get_issue_detail` 응답이 AI 도구 한 결과 한도(약 5만 자)를 넘는다.

## 결정

- 손질은 공유 도구 층(`packages/mcp-tools-shared`)에서만 한다. 백엔드 API 는 그대로다.
- 옵션은 모두 선택이다. 주지 않으면 응답이 예전과 글자 하나까지 같다(변경 전 코드로 만든 스냅숏으로 고정).
- `list_issues.fields`: CSV 문자열. 다른 list_issues 목록 인자(cycle·milestone·sort)가 CSV 라서 같은 꼴로 받는다. 항목을 고른 키로 줄이고 `issueKey` 는 늘 남긴다. 모르는 이름은 조회 전에 거절하고, 쓸 수 있는 이름(`ISSUE_LIST_FIELDS`)을 알린다. `hasMore`·`nextCursor` 는 그대로 둔다.
- `get_issue_detail.comments`: 0 이상 정수, 최근 N건. 200(하드 상한)을 넘으면 거절하지 않고 200 으로 자른다. 같이 주면 `allComments` 보다 우선한다. 빠진 수는 기존처럼 `commentsOmitted` 로 알린다.
- `get_issue_detail.history`: false 면 `history` 키를 빼고 `historyTotal` 에 전체 수를 싣는다. `historyOmitted` 는 「오래된 것이 잘림」만 뜻하게 둔다(리뷰 반영).
- `get_issue_detail.bodyMaxChars`: 1 이상 정수. 본문을 앞 N 코드 포인트로 자르고(서로게이트 쌍을 가르지 않는다), 잘렸을 때만 `bodyTruncated: true`·`bodyLength`(전체 코드 포인트 수)를 body 바로 뒤에 붙인다.
- 기본 연결 도구 정의가 이미 토큰 상한(17,300)에 꽉 차 있었다. 처음엔 다른 설명을 줄여 맞췄으나 리뷰에서 뜻이 빠졌다는 지적을 받아 되살렸고(부모·하위, INTERNAL AI 가 무시하는 행동, component "none" 뜻, fields 허용 키 목록), 사용자 승인으로 상한을 17,400 으로 올렸다(현재 17,362).

## 단계

1. 새 테스트를 먼저 쓴다: 기본값 스냅숏(변경 전 코드로 생성), fields·모르는 이름, comments 0/N, history false, bodyMaxChars(서로게이트). 실패를 확인한다.
2. `schemas.ts` 에 인자를 더하고, `issue-detail.ts`(정규화)·`issue-tools.ts`(핸들러·설명)·`project-tools.ts`(fields)를 고친다.
3. 도구 정의 크기를 맞추고 스키마 스냅숏을 갱신한다.
4. ai-agent issue-agent 안내(`agent.md`)·공유 패키지 README 를 고친다.
5. 격리 라이브 스택에서 실제 핸들러로 응답 글자 수를 비교한다.
