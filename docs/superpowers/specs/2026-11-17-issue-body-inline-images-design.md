# 이슈 본문 편집칸 칸 안 이미지 — 설계 (WP-1656)

기획: WP-361(C안 확정 — 원문 칸 + 칸 안 이미지). 이 문서는 WP-1656 본문의 범위·완료 기준을 구현 방식으로 옮긴 것이다(무인 work-loop 세션 — 설계 승인은 스스로 함).

## 의도
이슈 본문을 고치는 사람이 붙여넣은 이미지를 저장 전에도 칸 안에서 그림으로 본다. 본문 원문(마크다운)은 한 바이트도 바뀌지 않아야 한다 — AI·MCP 가 그 원문을 그대로 다시 읽는다.

## 목표 / 하지 않음 / 실패로 보는 것
- 목표: WP-1656 「완료 기준」 전부.
- 하지 않음: WYSIWYG·미리보기 탭, 다른 프로젝트·외부 이미지 칸 안 표시, 저장 형식·API·MCP 변경, 코멘트·채팅 입력창 동작 변경, 생성 다이얼로그(WP-1657).
- 실패로 보는 것: 열고 그대로 저장했는데 PATCH 가 감, 한 글자 고쳤는데 다른 곳(공백·빈 줄·꺾쇠 글자)이 바뀜, 코멘트 입력창 썸네일·Enter 전송이 바뀜.

## 방식 비교
- A. `RichInput` 에 본문 모드(`bodyMode`)를 더함 — 이미지 노드·업로드 자리표시·IME·멘션 자동완성을 그대로 씀. **고름**(기획·팀장 검토와 같음).
- B. 본문 전용 새 TipTap 편집기 — IME·업로드·멘션을 두 벌로 유지. 버림.
- C. Textarea 위에 이미지를 겹쳐 그림 — 줄 높이·스크롤 동기화가 깨지기 쉬움. 버림.

## 설계
### `RichInput` 본문 모드 (`bodyMode?: { projectKey: string }`, 마운트 시점 고정)
- 그리는 것: 편집칸(`EditorContent`)만. 버튼 줄·전송 버튼·글자 수 카운터·서식 도구는 그리지 않는다.
- 문서 ↔ 원문: 지금의 `bodyToDoc`(줄 = 문단, `<@id>` = 멘션, 이미지 마크다운 = 이미지 노드) / `serializeToBody`(서식 없음 경로). 다만 이미지 노드로 바꾸는 것은 `bodyMode.projectKey` 의 이슈 이미지뿐 — 다른 프로젝트 경로는 글자로 둔다(`bodyToDoc` 에 `imageProjectKey` 옵션).
- 바깥 알림: `onBodyChange(body: string)` — 다듬지 않은(trim 없는) 원문을 갱신마다. `onUploadingChange(uploading: boolean)`.
- 키: Enter 는 줄바꿈(기본 문단 나누기 — 전송하지 않음, 멘션 팝업이 열려 있으면 팝업 우선). Cmd/Ctrl+Enter → `onSubmit(지금 원문)`(본문 모드에선 RichInput 의 submit 가드·trim·변경 없음 비교를 거치지 않고 바깥이 판단). Esc → `onCancel`.
- 붙여넣기(본문 모드만): 클립보드에 이미지 파일만 있으면 지금처럼 업로드. 그 밖에 `text/plain` 이 있으면 HTML 이 함께 있어도 그 글자만 쓴다 — `\r\n|\r|\n` 하나마다 문단 하나(빈 줄 = 빈 문단), 그 글자를 `bodyToDoc` 로 읽어(같은 프로젝트 이미지·멘션 토큰도 노드로) 열린 조각(`Slice(fragment, 1, 1)`)으로 선택 자리에 넣는다. 결과 원문에서 붙여넣은 부분은 클립보드 글자와 같다(`\r\n` 은 `\n` 으로 — Textarea 와 같다).
- 복사·잘라내기(본문 모드만): `clipboardTextSerializer` 가 조각을 `serializeToBody` 와 같은 규칙(문단 사이 `\n` 하나, 멘션 `<@id>`, 이미지 마크다운)으로 내보낸다.
- 이미지 크기(본문 모드만): 같은 `image` 노드 이름에 다른 노드뷰 — 보기 화면 `IssueBodyImage` 와 같은 클래스(`block h-auto max-h-[480px] max-w-full`, 본래 크기·늘리지 않음). 자리표시·실패 상자는 지금 상자 모양 그대로. 코멘트 입력창의 `THUMB` 는 그대로.
- 실행 취소(본문 모드만): `@tiptap/pm/history` 로 Mod-z / Mod-Shift-z / Mod-y — Textarea 에 있던 실행 취소를 잃지 않게. (새 의존성 없음.)
- 바깥 조작: `ref`(핸들)로 `insertImages(files)` — `InlineEditableBody` 의 「이미지」 버튼이 커서 자리에 넣는다.
- 높이·모양: `editorMaxHeightClass` 로 바깥이 넘긴다 — 데스크톱 `max-h-[70vh]`, 모바일 상한 없음, 최소 160px. 본문 모드는 `whitespace-pre-wrap` 성격의 문단(빈 문단도 한 줄 높이)이다.

### `InlineEditableBody`
- Textarea 자리에 본문 모드 `RichInput`. `draft` 는 `onBodyChange` 로 받는다. 업로드 중 여부는 `onUploadingChange`.
- 저장·취소 버튼, 초안 자동 저장·복구 배너, 이탈 경고, 5만 자 안내, 저장 실패 시 다시 열기, 모바일 하단 편집 바는 지금처럼 여기서.
- 「불러오기」(초안 복구)는 편집기를 다시 만들어(`key` 증가) 초안 원문으로 연다.
- 업로드 중 저장 막기: 자리표시 노드가 있으면 `uploading` — 저장 버튼·단축키·모바일 바 모두 막힘. 옛 Textarea 자리표시 토큰이 든 복원 초안은 지금처럼 「업로드가 끝나지 않은 이미지가 있습니다…」 안내.
- `useIssueImageUpload`·`useAutoGrowTextarea` 는 이 화면에서 더 쓰지 않는다(다른 곳이 쓰면 남긴다).
- `data-testid="issue-body-textarea"` 는 편집칸(contenteditable)에 그대로 두어 기존 테스트 선택자를 살린다.

## 테스트
- 순수(vitest node): 표본 왕복 `serializeToBody(bodyToDoc(b)) === b`(WP 실제 본문 표본 — 노트 스키마에서 깨졌던 WP-1024·1146·1461·571·594·1340·1342·1081·163 와 WP-361·WP-1656 본문, 그리고 합성 경계 사례: 끝 줄바꿈·연속 빈 줄·`\t`·앞 공백·꺾쇠·표·코드 펜스·체크리스트·다른 프로젝트 이미지·멘션). 한 글자 고친 왕복. 붙여넣기 조각·복사 직렬화 함수.
- 컴포넌트·페이지(vitest dom): 본문 모드 RichInput(Enter 가 전송 안 함, Cmd/Ctrl+Enter·Esc, 이미지 노드 크기 클래스, 다른 프로젝트 이미지는 글자, 코멘트 모드는 썸네일 그대로), InlineEditableBody(변경 없는 저장은 PATCH 없음, 업로드 중 저장 막힘, 초안 배너·불러오기, 5만 자 안내). 기존 페이지 테스트의 textarea 조작은 `setRichText` 류로 옮긴다.
- E2E(`@input`): 실제 클립보드 붙여넣기(일반 글자 / 글자+HTML)·복사 줄 간격·한글 조합 Enter·이미지 붙여넣기 자리표시. `@layout`: 390px 에서 편집칸·이미지가 화면 폭 안.
- 긴 본문 측정: 줄 1,000개·5만 자 가까운 합성 본문을 열고 타이핑하는 동안 키 입력 → 화면 반영 시간을 재서 PR 에 적는다.

## 남겨 둔 것(구현자 판단)
- 본문 모드 placeholder 문구, 내부 함수 이름·파일 나눔.
