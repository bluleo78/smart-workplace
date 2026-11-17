# 이슈 생성 창 본문 칸 안 이미지 — 설계 (WP-1657)

기획: WP-361(C안 — 원문 칸 + 칸 안 이미지). 선행 WP-1656(본문 모드 `RichInput`, `InlineEditableBody`) 머지됨(dcd829dba). 무인 work-loop 세션 — 설계 승인은 스스로 함.

## 의도
이슈를 **만들 때도** 본문에 붙여넣은 이미지를 칸 안에서 그림으로 본다(고칠 때와 같은 경험). 보내는 본문 원문(마크다운)은 지금 Textarea 와 같은 글자여야 한다 — `![이름](url)` 그대로.

## 목표 / 하지 않음 / 실패로 보는 것
- 목표: 데스크톱 `IssueCreateDialog`·모바일 `MobileIssueCreateSheet` 의 본문 칸을 본문 모드 `RichInput` 으로. 이미지는 보기 화면 크기, Enter 줄바꿈, 붙여넣기 원문 그대로·한 줄 복사·trim 없음(WP-1656 과 같음). 폼 상태·이탈 경고·버림 확인·업로드 중 생성 막기 유지. 모바일 390px 에서 가로 넘침 없음.
- 하지 않음: `IssueDraftFields`(다른 화면), API·MCP·저장 형식, 코멘트·채팅 입력창, 본문 편집(WP-1656 범위).
- 실패로 보는 것: 업로드 중에 만들어져 자리표시가 본문에 들어감, 이미지만 넣었는데 버림 확인 없이 닫힘, Esc 한 번에 멘션 팝업과 창이 함께 닫힘, 모바일 제목 Enter 가 본문으로 가지 않음.

## 방식 비교
- A. 두 생성 화면에서 본문 모드 `RichInput` 을 바로 씀(`InlineEditableBody` 의 쓰는 법 그대로). **고름** — 공유할 몫이 얇고(props 몇 개), 편집 쪽 초안·배너·저장 실패 로직은 생성에 없다.
- B. `InlineEditableBody` 에서 공용 「본문 편집칸」 컴포넌트를 뽑아 셋이 씀 — 감싸개만 하나 늘고 편집 전용 로직이 섞임. 버림.
- C. `RichInput` 을 제어 컴포넌트(value 주입)로 바꿈 — 본문 모드는 비제어(마운트 시 원문)라 큰 변경. 버림.

## 설계 (내가 정한 것)
### 폼 훅 `useIssueCreateForm`
- `useIssueImageUpload`·`bodyRef`(textarea)·`bodyField` 를 걷고, 본문 값은 `onBodyChange → setValue('body', v, { shouldDirty: true })` 로 받는다(`register('body')` 는 검사용으로 남김 — 5만 자 상한 오류).
- `uploading` 상태(`onUploadingChange`). `isSubmitting = uploading || submitting`. `hasContent = hasIssueDraftContent(title, body) || uploading`(이미지만 올리는 중이어도 버림 확인·이탈 경고).
- 제출 막기: `uploading` 이면 토스트 「이미지 업로드가 끝난 뒤 등록해 주세요」(지금 문구) — 자리표시는 원문에 없으므로 토큰 검사 대신 상태로. 열 때마다 `uploading=false`.
- 훅이 `richRef`(RichInputHandle), `bodyMode`(useMemo), `imageUpload`(useCallback `uploadIssueImage`), `mentionMembers` 를 돌려줘 두 화면이 같이 쓴다.
- 열 때마다 편집기를 새로 만든다: 데스크톱은 Dialog 내용이 닫히면 내려가 다시 마운트되므로 그대로, 모바일도 Portal 내용이 닫히면 내려간다 — `initialBody=''` 로 충분(확인 테스트로 고정).

### 데스크톱 다이얼로그
- `<RichInput ref={richRef} bodyMode imageUpload members initialBody="" editorAria={{ invalid, describedBy:'issue-body-error' }} inputTestId="issue-body" ariaLabel="본문" editorMaxHeightClass="max-h-[40vh]" onBodyChange onUploadingChange onSubmit={() => formRef.current?.requestSubmit()} onCancel={requestClose} />`.
- 라벨 줄의 `IssueBodyImageButton onFiles={(files) => richRef.current?.insertImages(files)}`. `<label htmlFor>` 는 contenteditable 과 이어지지 않으므로 라벨은 `<span id>` 로 두고 편집칸은 `ariaLabel="본문"` 으로 이름을 받는다(라벨 클릭 포커스는 하지 않음 — 칸이 바로 아래라 누를 일이 적다).
- Esc: `DialogContent onEscapeKeyDown` 에서 대상이 본문 편집칸 안이면 `preventDefault` 만 한다 → `RichInput` 의 막힌-Esc 처리(멘션 팝업 먼저, 아니면 `onCancel=requestClose`). 편집칸 밖은 지금처럼.
- Cmd/Ctrl+Enter = 폼 제출(제목 검사 포함, 업로드 중이면 RichInput 이 부르지 않음).

### 모바일 시트
- 테두리 없는 칸: `bodyMode` 에 `frame?: 'boxed' | 'bare'`(기본 boxed)를 더함 — bare 는 테두리·안쪽 여백·포커스 링 없이 `min-h-[4.5rem] text-base leading-6`(지금 rows=3 과 같은 높이), 최대 높이 없음. 안내 「설명 (선택)」, `ariaLabel="설명"`, `inputTestId="issue-create-body"`.
- 제목 Enter → 본문: 이미 있는 `focusRequest`/`onFocusRequestDone`(WP-1372, 본문 끝으로 포커스)을 쓴다 — 핸들 API 는 늘리지 않는다.- Esc: `onEscapeKeyDown` 에서 대상이 편집칸 안이면 `preventDefault` 만(RichInput 이 `onCancel=requestClose`), 밖이면 지금처럼 `preventDefault + requestClose`.
- 업로드 버튼은 지금처럼 없음(붙여넣기만) — 모바일에 버튼을 더하는 것은 이번 범위 밖.
- `useAutoGrowTextarea(bodyRef…)` 제거(편집칸이 내용 높이로 자람).

### 정리
- `useIssueImageUpload` 와 그 테스트는 쓰는 곳이 없어지면 지운다. `lib/imageUpload`·`lib/markdownImageInsert` 는 다른 곳이 쓰므로 남긴다.

## 테스트
- vitest(화면): 생성 payload 에 `![이름](url)` 원문 그대로·앞뒤 공백 그대로, 업로드 중 생성 버튼 잠김·토스트, 업로드 중 `hasContent`(닫기 → 버림 확인), Cmd+Enter 제출, Esc 멘션 팝업 우선, 모바일 제목 Enter → 본문 포커스, 다시 열면 빈 본문.
- 기존 테스트 고침: `issueCreate.test.tsx`·`openIssuePermissions.test.tsx`·`issueTypes.test.tsx`(본문 textarea 를 채우던 것), e2e `issue-body-images.spec.ts`·`mobile/issue-create.spec.ts`.
- E2E: `@input` 붙여넣기 여러 줄·이미지 붙여넣기 → 칸 안 그림 → 생성된 이슈 본문 원문 확인, `@layout` 390px 시트 가로 넘침 없음.
- 매뉴얼 `docs/manual/user/08-work.md` 이슈 만들기 절에 칸 안 이미지 한 줄(`pnpm manual:prose` 통과).

## 빌더에게 남김
- 편집칸 안 여부 판정 함수의 위치·이름, 테스트 파일 나눔.
