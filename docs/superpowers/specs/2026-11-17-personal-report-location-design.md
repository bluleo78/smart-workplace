# 개인 보고 — 템플릿 분리·저장 위치 고르기 설계 (WP-1655)

부모 WP-1628. 선행 WP-1654(프로젝트 정기 리포트의 같은 규칙, ccb3392b9·417612e42) 머지됨. 무인 work-loop 세션 — 설계 승인은 스스로 함. 시제품 참고: 이슈 첨부 「시제품-참고-2.diff.txt」(구조 참고만), 시안 8707–8711.

## 의도
내 노트 「보고」 아래에 템플릿과 보고가 섞여 있어, 보고만 모아 보기 어렵고 템플릿을 옮기면 다시 복사돼 같은 템플릿이 쌓였다. WP-1654 가 프로젝트 리포트에 한 것과 같은 규칙을 개인 보고에 적용한다 — 템플릿은 「템플릿」 아래로 나누고 id 로 따라가며, 보고 저장 위치는 사용자가 고른다.

## 목표 / 하지 않음 / 실패로 보는 것
- 목표
  1. 템플릿 분리: 내 노트 최상위 「템플릿」 아래 「일일 보고」·「주간·월간 보고」. 「보고」 에는 달 폴더·보고만. 처음 켤 때/없을 때만 기본 복사. 이미 「보고」 아래에 있던 템플릿은 다음 설정 저장·보고 만들기 때 한 번 「템플릿」 으로 옮기고 이름만 바꾼다(본문 그대로). 달 폴더 위치 계산에서 `templatesUnder` 를 걷는다(가장 최근 달이 맨 위).
  2. 템플릿 위치 따라가기: 위치 검사(`ReportTemplateCopier.isUnder`)를 걷고 id 로 찾는다. 내 노트 공간 안에서 옮기면 그대로 쓰고, 다른 공간으로 옮기거나 지우면 「템플릿」 아래 다시 만들고 설정 창에 「템플릿을 다시 만들었어요」. 템플릿 링크 글자는 실제 위치 경로(기본 「템플릿 › 일일 보고」·「템플릿 › 주간·월간 보고」).
  3. 이름: 설정 행 「주간 템플릿」 → 「주간·월간 템플릿」, 설명에서 「· 월간도 이 템플릿」 뺌. 보고 제목은 그대로. 매뉴얼 개인 보고 절 갱신.
  4. 저장 위치 고르기: 「저장 위치」 행에 「바꾸기」 → WP-1654 공용 고르기 창(제목 「보고 저장 위치」, 설명 「새 보고를 고른 페이지 아래에 달별로 모아 만들어요. 이미 만든 보고는 그대로 둬요.」). 내 노트 페이지만, 「템플릿」 갈래·AI 가 쓴 보고·달 폴더(「2026년 11월」 꼴) 제외, 「새 페이지」 바로 만들기 가능. 고른 페이지 id 를 설정에 저장(새 열), 비면 「보고」. 새 보고는 고른 페이지 아래 달 폴더에. 이미 만든 보고·「보고」 는 손대지 않음. 고른 페이지가 지워지거나 공간 밖으로 옮겨지면 「보고」 로 돌아가고 설정에 바뀐 위치가 보인다.
- 하지 않음: 프로젝트 리포트 동작 변경, 보고 조회(「일일 보고 보기」 — page id 로 찾으므로 위치와 무관) 변경, 이미 만든 보고 옮기기, 사용자가 예전에 옮겨 다시 복사된 묵은 템플릿 사본 정리.
- 실패로 보는 것: 고른 위치가 있는데 「보고」 가 다시 생김, 보고 다시 시도(대기 중 페이지 재사용)가 옛 위치의 페이지를 새 위치로 끌고 감, 400 으로 거절된 요청이 부수효과(옮기기·알림 지우기)를 남김, 고르기 창과 서버의 막는 규칙이 어긋나 창에서 고른 것을 서버가 거절함.

## 방식 비교
- A. WP-1654 구조를 그대로 본떠 개인 판 `PersonalReportLocation` 을 새로 두고, 공간 무관한 `WikiSystemPageWriter` 도우미(`ensureTemplatesPage`·`findTemplatesPage`·`existsInSpace`·`pathTitles`·`isUnderOrSelf`·`renameTo`·`lockSpaceTree`)와 공용 `ReportLocationDialog`·`ReportPageWriter.writeAndMarkInPlace` 를 다시 쓴다. **고름** — 검증된 규칙·동시성 처리를 그대로 얻고, 다른 것은 공간 찾기와 설정 행뿐이다.
- B. `ProjectReportLocation` 을 일반화해 프로젝트·개인이 같이 씀 — 공간 찾기·설정 저장소·막는 규칙(달 폴더는 개인만)이 달라 추상화가 무겁고 머지된 프로젝트 쪽을 흔든다. 버림.
- C. 위치 없이 템플릿 분리만 먼저 — 이슈가 한 번에 요구. 버림.

## 설계 (내가 정한 것)
### DB (V298)
`personal_report_setting` 에 `report_location_page_id BIGINT REFERENCES wiki_page(id) ON DELETE SET NULL`(+인덱스), `template_initialized BOOLEAN NOT NULL DEFAULT false`(옛 템플릿 옮기기를 마침), `daily_template_made`·`weekly_template_made BOOLEAN NOT NULL DEFAULT false`(그 종류 템플릿을 한 번이라도 만들었음 — 기존 행은 id 가 있으면 true 로 채움), `template_recreated_at TIMESTAMPTZ`. jOOQ 다시 생성(`./gradlew generateJooq`) 해 커밋. 알림 열은 하나(두 템플릿 중 어느 것이든 다시 만들면 한 줄 알림).
- 「다시 만듦」 판정은 종류별이다: 저장된 id 가 있는데 공간 밖이거나, id 가 비었는데(지워져 FK 가 NULL) 그 종류를 전에 만든 적이 있으면(`*_template_made`). 프로젝트처럼 열 하나(initialized)로 가리면 처음 켤 때 일일을 만든 직후 주간이 「다시 만듦」으로 보이거나, 수동 주간만 만든 사람이 처음 일일을 만들 때 잘못 알린다 — 그래서 종류별 열을 둔다(내가 정한 것).

### 서버
- `PersonalReportLocation`(새): `resolveForWrite(userId)` → `(spaceId, parentPageId)`, `describe(userId)`(만들지 않음 → 위치 페이지 id·경로·템플릿 루트 id·공간 id), `validateChoice(userId, pageId)`(400: 내 노트 공간 밖 / 「템플릿」 갈래 또는 두 템플릿 자신·아래 / 페이지 자신이 AI 보고(`aiLastAction=='report'`) / 페이지 자신이나 조상이 달 폴더 제목(`^\d{4}년 \d{1,2}월$`, 월 1–12)). 쓸 때: 저장값이 공간 안·막히지 않음 → 사용, 다른 공간 → `clearLocationIf`(비교 후 비움) + 「보고」, 공간 안이지만 막힘(나중에 템플릿 갈래·달 폴더 아래로 옮겨짐) → 이번만 「보고」(저장값 유지), 없음 → 「보고」(필요할 때만 만듦). 짧은 트랜잭션.
- `WikiSystemPageWriter`: 개인 공간 찾기/보장, 「보고」 찾기/보장을 나눈다 — 고른 위치가 있으면 「보고」 를 만들지 않는다. 기존 `ensurePersonalReportsHome` 은 쓰는 곳이 없어지면 지운다.
- `PersonalReportTemplate`: 템플릿 제목 `일일 보고`·`주간·월간 보고`, 부모 「템플릿」. `ensure(userId, spaceId, kind)` 는 저장된 id 가 공간 안이면 그대로(옮겨도 됨), 아니면 「템플릿」 아래 복사(일일 0, 주간·월간 1) — 다시 만든 것(전에 id 가 있었거나 initialized)이면 `template_recreated_at`. `relocateLegacyIfNeeded(userId)`: 공간 트리 잠금 안에서 행을 다시 읽고 initialized 면 끝, 아니면 부모가 「보고」 최상위인 템플릿 둘을 「템플릿」 으로 옮기고 이름을 바꾼 뒤(본문 그대로) initialized. 사용자가 이미 다른 곳으로 옮긴 템플릿은 그 자리에 둔다. 「보고」·공간은 찾기만 한다. `reset` 도 같은 규칙.
- `ReportTemplateCopier.isUnder`·안 쓰는 `copy` 제거.
- `PersonalReportSettingsService`: `update`·`resetTemplate`·`updateLocation` 모두 요청 검사 먼저(400 은 부수효과 없음), 그다음 `beginWrite`(알림 지우기 + 옛 템플릿 옮기기), 켜져 있으면 템플릿 보장. `updateLocation(userId, pageId)` 새로.
- 응답 `PersonalReportSettingsResponse`: `spaceId` = 내 노트 공간 id(있으면 — 「보고」 유무와 무관), `reportsPageId` = 지금 쓰는 위치(고른 페이지, 아니면 「보고」 있으면 그 id), 더해 `reportLocationPath: string[]`(기본 `["보고"]`), `reportLocationPageId`(저장된 고른 페이지 — 유효할 때만), `templateRootPageId`, `dailyTemplatePath`·`weeklyTemplatePath`, `templateRecreatedAt`. 템플릿 id 는 공간 안에 있을 때만.
- `PUT /api/v1/me/report-settings/location` body `{ pageId }`(필수) → 전체 설정 응답.
- `PersonalReportGenerator`: `resolveForWrite` → 템플릿 보장(옛 템플릿 옮기기 포함) → 대상 부모 아래 달 폴더(`monthFolderPosition(siblings, title)` — 템플릿 자리 계산 제거). 재사용한 대기 페이지가 대상 달 폴더 밖이면 `writeAndMarkInPlace`(옮기지 않음).

### 웹
- `ReportLocationDialog`(공용) 일반화 두 가지: `isBlockedPage?: (page) => boolean`(맞는 페이지와 그 아래를 숨김 — 지금 위치·조상은 기존처럼 보임), `emptyText?`(기본은 지금 프로젝트 문구). 프로젝트 쪽 동작은 그대로.
- `ReportSettingsDialog`: 「일일 템플릿」 링크 글자 = `dailyTemplatePath.join(' › ')`(기본 「템플릿 › 일일 보고」), 「주간·월간 템플릿」(설명 「필요할 때 만들기」, 글자 기본 「템플릿 › 주간·월간 보고」), 「저장 위치」 = `내 노트 › {경로}` 링크 + 「바꾸기」(`spaceId != null`) → 고르기 창(`home="보고"`, `blockedRootIds=[templateRoot, daily, weekly]`, `isBlockedPage`=달 폴더 제목, `emptyText`=「고를 페이지가 없으면 다음 보고 때 「보고」를 만들어요.」, `helpId="me.reports.location"`). 저장 성공 토스트 「저장 위치를 바꿨어요」, 실패면 창을 열어 둠. `templateRecreatedAt` 이면 「템플릿을 다시 만들었어요」.
- 달 폴더 제목 판정은 순수 함수 하나(`lib`)로 두고 고르기 창이 쓴다(서버 정규식과 같은 규칙, 양쪽 테스트).
- `CreateReportDialog` 「저장 위치」 문구의 바탕 경로를 설정의 `reportLocationPath` 로.
- `useMeReport` 가 GENERATED 를 받으면 설정 쿼리도 무효화(다시 만든 템플릿·돌아간 위치가 보이게). `useUpdateMeReportLocation` 은 응답을 설정 캐시에 넣는다.
- 매뉴얼 `08-work.md` 개인 보고 절: 템플릿 위치·이름, 저장 위치 바꾸기 소절 `{help=me.reports.location}`. `pnpm manual:check`·`pnpm manual:prose` 통과.

## 테스트
- 백엔드 통합: 분리·옛 템플릿 한 번 옮기기(이름 바뀜·본문 그대로·initialized), 공간 안 이동 템플릿 재사용, 다른 공간 이동·삭제 → 「템플릿」 아래 재생성 + 알림, 위치 저장·검사(400 네 가지 + 부수효과 없음), 생성이 고른 위치 아래 달 폴더로·「보고」 안 만듦, 고른 페이지 삭제/공간 밖 → 「보고」 로 돌아감, 달 폴더 위치(최근 달 맨 위), 대기 페이지 재사용 시 옮기지 않음.
- 프론트 vitest: `ReportSettingsDialog.test.tsx`(문구·링크 경로·「바꾸기」→ 저장 요청·토스트·실패 유지·다시 만듦 알림), 고르기 창 제외 규칙(달 폴더·템플릿 갈래·AI 보고), 달 폴더 판정 순수 함수, `CreateReportDialog`·`meReportModel` 경로.

## 빌더에게 남김
- 클래스 안 메서드 나눔, 테스트 파일 나눔, 응답 경로 계산 위치.
