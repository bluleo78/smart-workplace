# WP-1522 인용문(원본 메일) 이미지를 초안 인라인 첨부로 보내기

## 문제
M365 답장·전달에서 원본 메일 cid 이미지 합계가 2MB 를 넘으면 「인용문 이미지 용량이 너무 큽니다(최대 2MB)」로 거절된다.
2MB 는 Graph sendMail(raw MIME) 4MB 요청 한도 때문. 같은 첨부를 가리키는 cid 가 여럿이면 중복으로 세고 받는다.

## 결정(옵션 D)
- Graph: 인라인 이미지도 큰 첨부처럼 초안 경로로 보낸다. 초안 MIME 에서는 일반 첨부·인라인 이미지를 모두 빼고(HTML 의 cid: 참조는 유지),
  초안에 인라인 fileAttachment(isInline=true, contentId) 로 붙인다 — 3MB 미만 attachments API, 이상 업로드 세션(AttachmentItem.isInline/contentId).
- 초안 경로 진입: 일반 첨부 **또는** 인라인 이미지가 있고 추정 base64 길이가 sendMail 상한을 넘을 때.
- Graph 의 인라인 전용 합계 상한(2MB) 제거 — 인용문·붙여 넣은 본문 이미지 모두. 남는 것은 전체 25MB, 개수 20.
- SMTP 10MB 인라인 상한은 그대로.
- 중복 제거: 서버는 완전히 같은 (id,cid) 참조를 하나로 모으고, 용량은 실제로 나가는 파트(cid)마다 세며, 바이트는 첨부마다 한 번만 받는다.
  같은 cid 가 서로 다른 첨부를 가리키면 거절한다.
  웹은 collectQuoteInlineImages 에서 첨부 id 기준으로 모으고, 같은 첨부를 가리키는 다른 cid 의 <img> 는 첫 cid 로 바꾼다.
- 문구: 「원본 메일의 이미지…」로 바꾼다(개수·SMTP 용량·가져오기 실패·25MB 초과 시 원본 이미지 포함 안내).

## 작업 순서(TDD)
1. 실패하는 테스트: GraphApiClientWriteTest(인라인 JSON), GraphMailTransportTest(인라인 초안 경로·업로드 세션), GraphDraftPathDecisionTest,
   MailComposeServiceTest(Graph 3MB 인용문 통과·중복 1회·SMTP 문구), web mailInlineImages.test.ts(첨부 id 중복 제거).
2. 구현: GraphApiClient → OutgoingMail.withoutBinaryParts → GraphMailTransport → MailComposeService → web.
3. spotlessApply, 대상 테스트·typecheck·lint, 커밋 1개.
