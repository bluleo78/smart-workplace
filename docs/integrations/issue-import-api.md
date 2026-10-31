# 이슈 가져오기 API 사용법 (이관 스크립트 작성자용)

다른 트래커(예: Jira CLIM)의 이슈를 **원래 보고자·작성자·시각 그대로**, **알림·푸시·AI 작업 시작 없이** Works 로 옮기는 REST API 다. 이슈 한 건(댓글·첨부·워처·변경 이력 포함)을 한 요청·한 트랜잭션으로 넣는다. 어느 검증이든 실패하면 아무것도 남지 않는다.

## 호출

- `POST /api/v1/projects/{projectKey}/import/issues` — 성공 시 `201` + 만든 이슈(일반 이슈 응답의 요약과 같은 모양).
- 인증: 개인 API 토큰(`swp_`) 또는 JWT. **워크스페이스 관리자(ADMIN 역할)인 사람**과 **그 프로젝트의 소유자(OWNER)인 사람**만 쓸 수 있다(WP-1239 — 소유자는 자기 팀 프로젝트에만, 개인 프로젝트는 안 된다). 소유자 아닌 구성원과 AI 키(`ak_`)·AI 구성원은 403. 관리자가 아니면 없는 프로젝트도 404 가 아니라 403 이다.
- 개인 프로젝트로는 가져올 수 없다(400).
- 이슈를 모두 가져온 뒤 이슈 사이 관계를 한 번에 넣는 `POST /api/v1/projects/{projectKey}/import/relations` 도 같은 권한이다(아래 「관계·외부 링크」).

## 준비 순서

1. **구성원**: 요청에 나오는 모든 사람(보고자·담당자·워처·댓글 작성자·첨부자·이력 행위자·담당자 이력의 added/removed)을 먼저 **그 프로젝트의 활성 구성원**으로 추가한다. 사람은 모두 username 으로 적는다. 하나라도 아니면 400 이고 맞지 않은 username 을 전부 알려 준다. 다른 사람으로 대신 넣지 않는다.
2. **프로젝트 설정**: 상태·유형·사이클·마일스톤·커스텀 필드 정의를 미리 만들고 id 를 모아 둔다. 라벨은 `labelNames` 로 주면 없을 때 만들어지지만, 변경 이력의 라벨 이름은 이미 있어야 한다(아래).
   **구성요소는 라벨과 달리 가져오기가 만들어 주지 않는다.** 이관 스크립트가 먼저 일반 API(`POST /api/v1/projects/{projectKey}/components`, 프로젝트 소유자 또는 관리자)로 필요한 구성요소를 담당자와 함께 만들어 두고, 이슈에서는 `componentNames` 로 이름만 적는다. 이미 보관한 구성요소도 이름으로 연결할 수 있다.
   **버전도 가져오기가 만들어 주지 않는다.** 이슈를 가져오기 전에 이관 스크립트가 버전 API 로 먼저 만든다(개인 토큰, 프로젝트 소유자 또는 관리자): `POST /api/v1/projects/{projectKey}/versions`(이름·설명·시작일·출시 예정일). 이미 출시된 것은 이어서 `POST .../versions/{id}/release` 로 출시하고(출시 날짜는 본문 `releaseDate` 로 줄 수 있고, 없으면 만들 때의 출시 예정일, 그것도 없으면 오늘이 된다), Jira 에서 지금은 지워져 **이력에만 이름이 남은 버전**은 `PATCH .../versions/{id}` 에 `{"archived": true}` 로 **보관된 버전**으로 만들어 둔다. 보관·출시된 버전도 가져오기는 이름으로 연결할 수 있다.
3. **이슈마다** 「그 이슈의 첨부·이미지 업로드 → 가져오기」를 번갈아 한다(아래 「업로드」).
4. **에픽(부모) 먼저**, 하위 이슈는 나중에. 하위에서 같은 프로젝트 부모는 `parentNumber` 로 번호를, **다른 프로젝트의 에픽**은 `parentKey` 로 키(예: `PLAN-12`)를 건다. 다른 프로젝트 에픽이면 그 프로젝트 이슈를 먼저 가져와 둔다.
5. **이슈를 전부 가져온 뒤** 관계를 한 번에 넣는다(아래 「관계·외부 링크」). 관계는 양쪽 이슈가 이미 있어야 걸 수 있다.

## 업로드

업로드는 **가져오는 사람(관리자·소유자) 본인 토큰**으로 한다.

- **첨부 파일**: 스테이징 업로드로 먼저 올리고 `fileId` 를 얻어 요청의 `attachments[].fileId` 에 넣는다.
  - `POST /api/v1/staged-files/upload-link` (`{"name":"파일명"}`) → 10분짜리 일회용 PUT URL. `curl -T 파일 URL` 로 올리면 `{fileId, ...}` 가 온다(최대 25MB). 텍스트는 `POST /api/v1/staged-files/text` (`{name, content}`) 로도 만들 수 있고, 이때 내용은 10MB(텍스트 상한 `TEXT_MAX_BYTES`) 까지다.
  - 스테이징 파일은 **24시간 안에** 쓰지 않으면 지워진다.
- **본문·댓글 이미지**: `POST /api/v1/projects/{projectKey}/issue-images` (multipart, 필드 `file`) → `201` + `{fileId, url, ...}`. 응답의 `url`(`/api/v1/projects/{projectKey}/issue-images/{fileId}`)을 본문·댓글 마크다운에 그대로 넣는다. 예: `![스크린샷](/api/v1/projects/CLIM/issue-images/123)`.
  - 이미지는 파일당 10MB 까지이고(PNG·JPEG·GIF·WebP), 연결되지 않은 이미지는 업로드 24시간 뒤 수거되며, 한 사람이 한 프로젝트에 **연결 전 50개까지**만 둘 수 있다. 그래서 이슈 한 건씩 「그 이슈의 파일 업로드 → 가져오기」로 돌린다(이슈 한 건의 본문·댓글 이미지는 합쳐 50개까지).
  - 가져오기가 이미지를 연결하면서 올린 사람을 그 글의 작성자(본문=보고자, 댓글=댓글 작성자)로, 올린 시각을 그 글의 작성 시각으로 바꾼다.
- **주의(조용히 건너뜀)**: 본문·댓글의 이미지 참조 중 **연결할 수 없는 것**(다른 사람이 올림, 만료됨, 잘못된 id)은 오류 없이 건너뛰고 **그래도 201** 이다. 이미지는 깨진 채로 보인다. 응답으로는 알 수 없으니 올린 사람·만료 시간을 지켜야 한다.

## 요청 필드

필수는 `title`, `reporter`, `createdAt` 뿐이다. 나머지는 선택.

| 필드 | 설명 |
|---|---|
| `number` | 이슈 번호(1 ~ 1,000,000,000). 주면 그 번호로 만들고 이미 쓰였으면(삭제된 이슈 포함) 409. 없으면 다음 번호. 이후 일반 생성은 겹치지 않게 이어진다. |
| `sourceKey` | 원본 키(100자, 예 `CLIM-17`). 프로젝트 안에서 고유 — 재시도 판별용. 가져온 이슈의 상세·목록 응답에 `sourceKey` 로 보이고, 목록 `GET /api/v1/projects/{projectKey}/issues?sourceKey=CLIM-17` 로 정확히 일치하는 이슈를 찾는다(WP-1239). 원본 키 없이 만든 이슈는 `null`. |
| `title` / `body` | 제목 200자, 본문 50,000자(마크다운). |
| `typeId`, `statusId` 또는 `status`(상태 분류), `priority`, `startDate`, `dueDate`(`YYYY-MM-DD`), `parentNumber`, `milestoneId`, `labelIds`, `labelNames`, `cycleIds` | 일반 이슈 생성과 같은 뜻·검증. |
| `parentKey` | 부모 이슈 **키**(64자, 예 `PLAN-12`). **다른 프로젝트의 에픽**을 부모로 둘 때 쓴다. 같은 프로젝트 키면 `parentNumber` 와 같고, 둘 다 주면 같은 이슈를 가리켜야 한다(아니면 400). 규칙은 일반 생성과 같다 — 부모는 **에픽**이어야 하고, 하위 태스크·에픽은 다른 프로젝트 부모를 둘 수 없으며, 어느 한쪽이라도 개인 프로젝트면 안 된다. 없는 키·키 꼴이 아닌 값은 400(「부모로 지정한 이슈를 찾을 수 없습니다」 등, 아래 「오류 응답」의 검증 메시지). 완료 에픽 아래 미완료 하위 규칙은 `parentNumber` 처럼 가져오기에서 풀어 준다. 에픽 쪽 프로젝트 화면에도 갱신 신호가 한 번 간다. |
| `componentNames` | 연결할 구성요소 **이름** 100개까지. 이 프로젝트에 이미 있는 구성요소여야 하고(**대소문자 무시**, 앞뒤 공백은 지운다) **보관된 구성요소도 허용**한다(지난 기록). 없는 이름이 하나라도 있으면 400 `IMPORT_UNKNOWN_COMPONENTS` 이고 이슈를 만들기 전에 거절한다. 같은 구성요소를 대소문자만 다르게 여러 번 적어도 한 번만 붙는다. 가져오기는 **구성요소 담당자 자동 지정을 하지 않는다** — 담당자는 `assignees` 로 준 사람뿐이고 비워 두면 담당자 없이 들어간다. |
| `fixVersionNames` | 이 이슈의 **수정 버전** 이름 100개까지. 이 프로젝트에 이미 있는 버전이어야 하고(**대소문자 무시**, 앞뒤 공백은 지운다) **보관·출시된 버전도 허용**한다(지난 기록). 없는 이름이 하나라도 있으면 400 `IMPORT_UNKNOWN_VERSIONS` 이고 이슈를 만들기 전에 거절한다(`affectsVersionNames` 의 없는 이름과 합쳐 알린다). 같은 버전을 대소문자만 다르게 여러 번 적어도 한 번만 붙는다. 가져오기는 버전 변경 알림을 내지 않는다. |
| `affectsVersionNames` | 이 이슈의 **영향 버전** 이름 100개까지. 규칙은 `fixVersionNames` 와 같다. |
| `fields` | 커스텀 필드 값 `[{defId, value}]` — 일반 필드 값 API 와 같은 형식. 이력은 남기지 않는다. |
| `reporter` | 보고자 username. |
| `assignees` | 담당자 username(50명까지). 지정자는 호출자로 남고 원래 지정자는 `history` 로 옮긴다. |
| `watchers` | 워처 username. **넘긴 목록 그대로**만 워처가 된다. 보고자·담당자를 자동으로 넣지 않는다. |
| `createdAt` | 원래 생성 시각(오프셋 포함 ISO-8601). |
| `updatedAt` | 원래 수정 시각. 없으면 `createdAt`. `createdAt` 보다 이르면 400. 종료 시각보다 이르면(아래) 400. |
| `closedAt` | 종료 시각. **종료 범주(완료·취소) 상태일 때만** 줄 수 있고(아니면 400), 없으면 `updatedAt`. `createdAt` 보다 이르거나 `updatedAt` 보다 늦으면 400(종료도 변경이라 수정 시각이 종료 이후여야 한다). |
| 딸린 것들의 시각 | 댓글 `createdAt`·첨부 `attachedAt`·이력 `at` 은 이슈 `createdAt` 보다 이르면 400. 미래 시각 검사는 하지 않는다. |
| `attachments` | `[{fileId, attachedBy, attachedAt}]` 50개까지. |
| `comments` | `[{author, createdAt, updatedAt?, body}]` 500개까지, 입력 순서대로. 본문 50,000자. 댓글 `updatedAt` 이 `createdAt` 보다 이르면 400. |
| `history` | 변경 이력 1,000개까지(아래). |
| `externalLinks` | 다른 시스템에 남는 이슈로 가는 외부 링크 50개까지(아래 「관계·외부 링크」). |

### 변경 이력 `history[]`

항목은 `{type, actor, at, from?, to?, fromStatusId?, toStatusId?, fromTypeId?, toTypeId?, added?, removed?}`. `actor` 는 username, `at` 은 원래 시각. 받은 순서대로 넣고 정렬은 활동 목록이 시각으로 한다.

| type | 쓰는 값 / 규칙 |
|---|---|
| `STATUS_CHANGED` | **Works 프로젝트 상태 id** `toStatusId` 필수, `fromStatusId` 는 null 가능(첫 전이). 이 프로젝트 상태가 아니면 400. 이름이 아니라 id 로 받는다. `fromStatusId` 와 `toStatusId` 가 같으면 400. |
| `PRIORITY_CHANGED` | `to` 필수, `from` 선택. 우선순위 코드 5개 중 하나: `HIGHEST`·`HIGH`·`MID`·`LOW`·`LOWEST`(그 밖은 400). `from` 과 `to` 가 같으면 400. |
| `TITLE_CHANGED` | `to` 필수(200자), `from` 선택. `from` 과 `to` 가 같으면 400. |
| `DUE_DATE_CHANGED`, `START_DATE_CHANGED` | `from`/`to` 는 `YYYY-MM-DD` 또는 null. `from` 과 `to` 가 같으면(둘 다 null 포함) 400. |
| `ASSIGNEES_CHANGED` | `added`/`removed` username 목록 — **둘 중 하나는 비어 있지 않아야** 한다. |
| `LABELS_CHANGED` | `added`/`removed` 라벨 이름 — 둘 중 하나는 비어 있지 않아야 하고, **이 프로젝트에 있는 라벨이어야** 한다(대소문자 구분). 이름은 `labelNames` 와 같게 앞뒤 공백을 지우고 한 줄로 다듬어 찾으므로 같은 요청의 `labelNames` 로 만든 라벨도 쓸 수 있다. 없으면 400. |
| `COMPONENTS_CHANGED` | `added`/`removed` 구성요소 이름 — 둘 중 하나는 비어 있지 않아야 하고, **이 프로젝트에 있는 구성요소여야** 한다(대소문자 무시, 보관된 것도 허용). 없는 이름은 400 `IMPORT_UNKNOWN_COMPONENTS`. 이력에는 구성요소의 저장된 이름이 그 시점 이름으로 남는다. 이력은 기록일 뿐 이슈의 현재 구성요소는 `componentNames` 가 정한다. |
| `FIX_VERSIONS_CHANGED`, `AFFECTS_VERSIONS_CHANGED` | `added`/`removed` 버전 이름 — 수정 버전·영향 버전 각각. 둘 중 하나는 비어 있지 않아야 하고, **이 프로젝트에 있는 버전이어야** 한다(대소문자 무시, 보관·출시된 것도 허용). 없는 이름은 400 `IMPORT_UNKNOWN_VERSIONS`. 이력에는 버전의 저장된 이름이 그 시점 이름으로 남는다. 이력은 기록일 뿐 이슈의 현재 버전은 `fixVersionNames`·`affectsVersionNames` 가 정한다. |
| `TYPE_CHANGED` | `fromTypeId`·`toTypeId` **둘 다** 필수, 이 프로젝트의 유형 id. 둘이 같으면 400. |
| 그 밖 | 400(`지원하지 않는 이력 유형`). |

## 요청 예시

```json
{
  "number": 17,
  "sourceKey": "CLIM-17",
  "title": "로그인 후 빈 화면이 나온다",
  "body": "재현 절차는 아래와 같다.\n\n![화면](/api/v1/projects/CLIM/issue-images/901)",
  "typeId": 3,
  "statusId": 12,
  "priority": "HIGH",
  "startDate": "2025-03-03",
  "dueDate": "2025-03-14",
  "parentNumber": 5,
  "milestoneId": 2,
  "labelIds": [4],
  "labelNames": ["compute"],
  "componentNames": ["Compute", "Network"],
  "fixVersionNames": ["v1.5.3"],
  "affectsVersionNames": ["v1.5.2", "v1.5.3"],
  "cycleIds": [7],
  "fields": [{ "defId": 31, "value": "RND-2025-03" }],
  "reporter": "kim.reporter",
  "assignees": ["lee.dev"],
  "watchers": ["lee.dev", "park.qa"],
  "createdAt": "2025-03-03T09:12:00+09:00",
  "updatedAt": "2025-03-20T17:40:00+09:00",
  "closedAt": "2025-03-20T17:40:00+09:00",
  "attachments": [
    { "fileId": 5521, "attachedBy": "kim.reporter", "attachedAt": "2025-03-03T09:15:00+09:00" }
  ],
  "comments": [
    {
      "author": "lee.dev",
      "createdAt": "2025-03-04T10:00:00+09:00",
      "updatedAt": "2025-03-04T10:05:00+09:00",
      "body": "원인을 찾았다. 수정 중."
    }
  ],
  "history": [
    {
      "type": "STATUS_CHANGED",
      "actor": "lee.dev",
      "at": "2025-03-04T09:30:00+09:00",
      "fromStatusId": 10,
      "toStatusId": 11
    },
    {
      "type": "ASSIGNEES_CHANGED",
      "actor": "kim.reporter",
      "at": "2025-03-03T09:20:00+09:00",
      "added": ["lee.dev"],
      "removed": []
    },
    {
      "type": "LABELS_CHANGED",
      "actor": "kim.reporter",
      "at": "2025-03-03T09:21:00+09:00",
      "added": ["compute"]
    },
    {
      "type": "COMPONENTS_CHANGED",
      "actor": "kim.reporter",
      "at": "2025-03-03T09:21:30+09:00",
      "added": ["Compute", "Network"]
    },
    {
      "type": "FIX_VERSIONS_CHANGED",
      "actor": "kim.reporter",
      "at": "2025-03-03T09:21:45+09:00",
      "added": ["v1.5.3"]
    },
    {
      "type": "PRIORITY_CHANGED",
      "actor": "kim.reporter",
      "at": "2025-03-03T09:22:00+09:00",
      "from": "MID",
      "to": "HIGH"
    }
  ]
}
```

## 관계·외부 링크

이슈를 한 건씩 가져오므로 아직 없는 이슈와는 이을 수 없다. 그래서 두 단계다 — 이슈마다 **외부 링크**(이슈 요청에 실어서), 모두 가져온 뒤 **관계 일괄**(한 번의 호출). 둘 다 이력·알림을 남기지 않고, 관계의 작성자는 가져온 사람·시각은 가져온 시각이다(Jira 링크에는 만든 사람·시각이 없다). 숨긴 관계 유형도 쓸 수 있다.

### 외부 링크 `externalLinks[]`

Works 에 없는 이슈(다른 프로젝트 에픽, 다른 Jira 프로젝트의 이슈)는 외부 링크로 넣는다. 항목은 `{type, side?, url, key?, title}` 이고 이슈와 같은 트랜잭션에 들어간다(하나라도 틀리면 이슈도 만들어지지 않는다).

| 필드 | 설명 |
|---|---|
| `type` | 관계 유형 **코드**(`RELATES`·`PARENT_EPIC`·`BLOCKS`·`DUPLICATES`·`CLONES`·`CAUSES`) 또는 사용자 정의 유형 **이름**. 코드를 먼저 보고 없으면 이름(대소문자 무시)으로 찾는다. 모르는 유형은 400 `IMPORT_UNKNOWN_RELATION_TYPE`. 외부 전용 `PARENT_EPIC` 도 여기서는 쓴다. |
| `side` | 방향 있는 유형에서 **이 이슈의 쪽** — `source`(기본, 이 이슈가 A) 또는 `target`. 그 밖의 값은 400(오타가 반대 방향으로 저장되지 않게). 방향 없는 유형은 무시. |
| `url` | `http`/`https` 주소, 2000자까지. 그 밖의 스킴(`javascript:` 등)·공백 섞임은 400. |
| `key` | 상대 시스템의 키(50자, 예 `CL-3`). 선택. |
| `title` | 제목(300자). |

같은 이슈에 같은 주소를 같은 유형·방향으로 다시 보내면 건너뛰고(재시도 멱등), 다른 유형·방향으로 보내면 409 `EXTERNAL_LINK_CONFLICT` 다. 이슈당 50개까지.

### 관계 일괄 `POST /api/v1/projects/{projectKey}/import/relations`

요청 `{"relations":[{type, from, toNumber | toKey}, ...]}` — 최대 1,000건. 성공 `200` + `{"created": n, "skipped": m}`.

| 필드 | 설명 |
|---|---|
| `type` | 관계 유형 코드 또는 사용자 정의 유형 이름. **외부 전용 유형(`PARENT_EPIC`)은 오류**(외부 링크로). |
| `from` | 이 프로젝트의 **A 쪽** 이슈 번호. 방향 있는 유형(`DUPLICATES`·`CLONES`·`CAUSES`·`BLOCKS`)은 「from 이 …임/…함」 방향이다. 방향 없는 유형(`RELATES`)은 어느 쪽을 `from` 으로 보내도 같다. |
| `toNumber` | 같은 프로젝트의 상대 이슈 번호. |
| `toKey` | 상대 이슈 키(예 `WPV-28`) — 다른 프로젝트 이슈를 이을 때. 이 프로젝트 키로 써도 된다. |

`toNumber` 와 `toKey` 는 **정확히 하나**만 준다.

- **전부 검증한 뒤 쓴다.** 틀린 줄이 하나라도 있으면 아무것도 쓰지 않고 `400` 으로 **틀린 줄을 모두** 알려 준다. 줄 번호는 요청의 `relations` 배열 위치(0부터).
- **멱등.** 이미 있는 관계, 같은 요청 안의 중복 줄(방향 없는 유형의 뒤집힌 쌍 `(1,2)`·`(2,1)` 포함)은 오류 없이 `skipped` 로 센다. 같은 요청을 다시 보내도 안전하다.
- **차단(`BLOCKS`)** 은 같은 프로젝트끼리만 걸 수 있고(다른 프로젝트 `toKey` 는 그 줄 오류), 일반 의존성으로 저장된다(블로커 표시·필터가 그대로 동작). 순환이 되는 줄은 오류이고, 순환 검사는 이미 저장된 차단 + 이 요청에서 앞선 줄까지 본다.
- 개인 프로젝트 이슈는 다른 프로젝트와 관계를 맺을 수 없다. 없는 프로젝트·읽을 수 없는 프로젝트·없는(삭제된) 이슈는 그 줄 오류다.
- 끝나면 관계가 생긴 프로젝트마다 화면 갱신 신호가 한 번 간다(알림·푸시·AI 작업은 없다).

### Jira 이관 대응

Jira 는 같은 링크를 **양쪽 이슈에서 모두 보여 준다**(CLIM 360건 → 고유 250건). 링크 **id 로 중복을 없애** 한 번만 보내고, 방향은 아래 표의 A→B 에 맞춰 `from`(A) 과 상대(B) 를 정한다. 중복을 못 없애도 일괄이 멱등이라 오류는 나지 않지만, 방향이 어긋나면 반대로 저장된다.

| Jira 링크 유형 | Works `type` | `from`(A) |
|---|---|---|
| Relates | `RELATES` | 아무쪽 |
| Duplicate — A duplicates B | `DUPLICATES` | A(중복인 쪽) |
| Cloners — A clones B | `CLONES` | A(복제본) |
| Problem/Incident — A causes B | `CAUSES` | A(원인) |
| Blocks — A blocks B | `BLOCKS` | A(차단하는 쪽) |

- **다른 프로젝트 에픽이 부모**이고 그 에픽이 **이미 Works 에 있으면**(먼저 가져온 이관 프로젝트 등) `parentKey` 로 바로 건다.
- 그 에픽이 **아직 Works 에 없으면**(CL 등 옮기지 않았거나 나중에 옮길 프로젝트) 그 이슈의 `externalLinks` 에 `{"type":"PARENT_EPIC","url":"https://<사이트>/browse/<키>","key":"<키>","title":"…"}` 로 넣어 두고, 에픽을 옮긴 뒤 아래 「부모 에픽 링크 변환」으로 실제 부모로 바꾼다.
- **Works 로 옮기지 않는 프로젝트(CL·TECH·INFRA 등)로 가는 링크**는 관계가 아니라 외부 링크다 — 유형은 위 표대로 정하고 `url` 은 `https://<사이트>/browse/<키>`.
- Works 로 옮기는 프로젝트끼리(예: CLIM ↔ 다른 이관 프로젝트)는 두 프로젝트의 이슈를 모두 가져온 뒤 `toKey` 로 관계 일괄을 부른다.

### 부모 에픽 링크 변환 `POST /api/v1/admin/issues/parent-epic-links/convert`

예전 이관에서 다른 프로젝트 에픽 부모를 `PARENT_EPIC` 외부 링크로 남긴 것을 **실제 부모 관계로 한 번에 바꾼다.** 워크스페이스 전체를 훑으므로 가져오기와 달리 **워크스페이스 관리자(사람)만** 쓸 수 있다 — 프로젝트 소유자도 403 `IMPORT_ADMIN_ONLY`.

본문:

```json
{ "projectKey": "CLIM", "dryRun": true, "limit": 500, "afterLinkId": null }
```

- `projectKey`(선택): 이 프로젝트 이슈(자식)에 달린 링크만 본다. 없으면 워크스페이스 전체. 없는 키는 404, 개인 프로젝트는 400 `IMPORT_PERSONAL_PROJECT`.
- `dryRun`(**필수**): `true` 면 판정만 돌려주고 아무것도 쓰지 않는다. 먼저 `true` 로 결과를 확인한 뒤 `false` 로 바꾼다. 빠지면 400.
- `limit`(1~500, 기본 500): 링크 id 순으로 이만큼 본다.
- `afterLinkId`(선택, 0 이상): 이 링크 id 보다 **큰** 링크부터 본다. 없으면 처음부터. 앞 응답의 `nextAfterLinkId` 를 그대로 넘긴다.

지운 프로젝트의 이슈에 달린 링크는 보지 않는다. 에픽 찾기 — 링크의 `key`(없으면 `url` 의 `/browse/` 뒤)를 ① 그 값을 `sourceKey` 로 가져온 활성 이슈가 워크스페이스에 **하나뿐이면** 그 이슈로 ② 없으면 Works 이슈 키(예 `PLAN-12`)로 읽어 찾는다. 규칙은 일반 부모 지정과 같고, 링크마다 판정이 하나 붙는다.

| 판정 | 뜻 | 바꾸면 |
|---|---|---|
| `CONVERT` | 부모로 붙일 수 있다 | 부모 지정 + 링크 삭제 |
| `SKIP_HAS_PARENT` | 자식에 이미 부모가 있다 | 그대로 |
| `NOT_FOUND` | 원본 키·Works 키 어느 쪽으로도 에픽이 없다(아직 안 옮김·삭제·지운 프로젝트), 또는 관리자도 읽을 수 없는 프로젝트(남의 개인 프로젝트)의 에픽이다 — 키는 싣지 않는다 | 그대로 |
| `AMBIGUOUS` | 같은 원본 키로 가져온 이슈가 여럿이다 | 그대로 |
| `NOT_EPIC` | 찾은 이슈가 에픽이 아니다 | 그대로 |
| `PERSONAL` | 자식(또는 관리자 본인의 개인 프로젝트 에픽)이 개인 프로젝트에 있고 둘이 다른 프로젝트다 | 그대로 |
| `SUBTASK` | 자식이 하위 태스크다 | 그대로 |
| `EPIC_CHILD` | 자식이 에픽이다(에픽은 부모를 가질 수 없다) | 그대로 |
| `DONE_EPIC_OPEN_CHILD` | 완료 에픽 아래에 미완료 자식을 넣게 된다 — 에픽을 다시 열거나 자식을 끝낸 뒤 다시 돌린다 | 그대로 |
| `CHANGED` | (`dryRun: false` 에서만) 판정 뒤 쓰기 전에 바뀌었다 — 자식이 지워졌거나, 에픽이 완료·삭제됐거나, 에픽 프로젝트가 지워짐 등. 다시 돌리면 바뀐 상태로 다시 판정한다 | 그대로 |

응답(200):

```json
{
  "dryRun": true,
  "scanned": 3,
  "counts": { "CONVERT": 1, "SKIP_HAS_PARENT": 0, "NOT_FOUND": 1, "AMBIGUOUS": 0, "NOT_EPIC": 1, "PERSONAL": 0, "SUBTASK": 0, "EPIC_CHILD": 0, "DONE_EPIC_OPEN_CHILD": 0, "CHANGED": 0 },
  "rows": [
    { "linkId": 41, "childKey": "CLIM-17", "extKey": "CL-12", "outcome": "CONVERT", "parentKey": "CL-12" },
    { "linkId": 42, "childKey": "CLIM-18", "extKey": "CL-99", "outcome": "NOT_FOUND", "parentKey": null },
    { "linkId": 43, "childKey": "CLIM-19", "extKey": "CL-20", "outcome": "NOT_EPIC", "parentKey": "CL-20" }
  ],
  "nextAfterLinkId": null
}
```

- `dryRun: false` 면 `CONVERT` 줄마다 부모를 붙이고 부모 변경 이력(행위자 = 호출한 관리자)을 남긴 뒤 링크를 지운다. 자식·에픽 양쪽 프로젝트에 화면 갱신 신호가 가고, **워처 알림·AI 작업은 만들지 않는다.** 실행마다 감사 로그(`ISSUE_PARENT_EPIC_LINKS_CONVERTED`, 판정별 건수) 한 건.
- `nextAfterLinkId`: 뒤에 볼 링크가 더 있으면 이번에 본 마지막 링크 id, 더 없으면 `null`. 바꾸지 못한 링크는 지워지지 않아 다음 호출에도 같은 자리에 남으므로, **커서 없이 되풀이하면 앞쪽의 바꿀 수 없는 링크만 계속 본다.** 끝까지 돌리려면 `nextAfterLinkId` 를 다음 요청의 `afterLinkId` 로 넘기며 `null` 이 될 때까지 부른다(`dryRun` 도 같은 방식으로 훑는다).
- 요청 하나가 한 트랜잭션이다. 바꾼 링크는 지워지므로 같은 요청을 되풀이해도 안전하다 — 남는 것은 바꾸지 못한 줄뿐이다. 판정과 쓰기 사이에 한 줄이 바뀌면(동시 수정) 그 줄만 `CHANGED`(그사이 부모가 생겼으면 `SKIP_HAS_PARENT`)로 남고 나머지 줄은 그대로 바뀐다 — 배치 전체가 되돌려지지 않는다.

## 오류 응답

응답 `errors.reason` 으로 원인을 구분한다.

| 상태 | `errors.reason` | 뜻 / 할 일 |
|---|---|---|
| 403 | `IMPORT_ADMIN_ONLY` | 관리자(사람)도 그 프로젝트의 소유자(사람)도 아니다(이름은 예전 그대로). 관리자나 소유자 토큰으로 호출. |
| 400 | `IMPORT_PERSONAL_PROJECT` | 개인 프로젝트. 팀 프로젝트로 가져온다. |
| 400 | `IMPORT_UNKNOWN_USERS` | `errors.usernames` 에 프로젝트 활성 구성원이 아닌 username 이 쉼표로 나열된다. 구성원 추가 후 재시도. |
| 400 | `IMPORT_INVALID_TIMES` | 수정·종료 시각이 생성보다 이르거나, 종료가 수정보다 늦거나, 댓글·첨부·이력 시각이 이슈 생성보다 이르거나, 종료 상태가 아닌데 `closedAt` 을 줬다. |
| 400 | `IMPORT_INVALID_HISTORY` | `errors.index`(0부터)번째 이력이 규칙에 어긋난다. `errors.detail` 참고. |
| 400 | `IMPORT_UNKNOWN_LABELS` | 이력의 라벨 이름이 프로젝트에 없다. `errors.labels` 참고. |
| 400 | `IMPORT_UNKNOWN_COMPONENTS` | `componentNames` 나 이력의 구성요소 이름이 프로젝트에 없다. `errors.components` 에 없는 이름이 쉼표로 나열된다. 구성요소를 먼저 만들고(가져오기는 만들지 않는다) 재시도. |
| 400 | `IMPORT_UNKNOWN_VERSIONS` | `fixVersionNames`·`affectsVersionNames` 나 이력의 버전 이름이 프로젝트에 없다. `errors.versions` 에 없는 이름이 쉼표로 나열된다. 버전을 먼저 만들고(가져오기는 만들지 않는다) 재시도. |
| 400 | `IMPORT_UNKNOWN_RELATION_TYPE` | 외부 링크의 `type` 을 코드·이름으로 찾을 수 없다. `errors.type` 참고. |
| 400 | `IMPORT_RELATION_SIDE_NOT_ALLOWED` | 상대 쪽 말이 없는 방향 있는 유형(`PARENT_EPIC` 등)에 `side: "target"` 을 줬다. 이런 유형은 `source` 로만 건다. `errors.type` 참고. |
| 400 | `IMPORT_DUPLICATE_EXTERNAL_LINK` | 같은 요청의 `externalLinks` 에 같은 주소가 서로 다른 유형·방향으로 두 번 나왔다. 이슈를 만들기 전에 거절한다(유형·방향까지 같은 줄은 건너뛴다). `errors.url` 참고. |
| 400 | `EXTERNAL_LINK_URL_INVALID` · `RELATION_SIDE_INVALID` | 외부 링크 주소가 http/https 가 아니거나 `side` 가 `source`·`target` 이 아니다(`errors.code`). |
| 409 | `EXTERNAL_LINK_CONFLICT` | 같은 이슈에 같은 주소가 다른 유형·방향으로 이미 있다(`errors.code`). |
| 400 | `IMPORT_INVALID_RELATIONS` | 관계 일괄에 틀린 줄이 있다 — **아무것도 쓰지 않았다.** `errors.rows` 는 `[{"index":4,"reason":"…"}]` 모양의 JSON 문자열이고 틀린 줄이 전부 들어 있다(없는 유형·외부 전용 유형·없는 이슈·없는 프로젝트·자기 자신·차단 순환·차단의 다른 프로젝트·개인 프로젝트·`toNumber`/`toKey` 형식). |
| 400 | (검증 메시지) | 필수 값 누락·길이 초과·잘못된 상태/유형/부모 등 일반 생성과 같은 검증. |
| 409 | `IMPORT_NUMBER_TAKEN` | 지정한 `number` 가 이미 쓰였다. |
| 409 | `IMPORT_SOURCE_KEY_TAKEN` | 같은 `sourceKey` 로 이미 가져왔다. |

## 재시도

시간 초과 등으로 결과를 모르면 **같은 `sourceKey` 로 다시 보낸다.** `409 IMPORT_SOURCE_KEY_TAKEN` 이면 이미 들어간 것이니 건너뛴다(이슈가 두 번 만들어지지 않는다). 첫 요청이 아직 처리 중일 때 재시도가 와도, 번호·첨부가 같아 생기는 다른 오류보다 원본 키 409 가 먼저 온다. 요청 하나는 한 트랜잭션이라 실패하면 아무것도 남지 않는다. 단, 업로드한 첨부(24시간)·이미지(24시간)는 그 사이 만료될 수 있으니 오래 지났다면 다시 올린다.

## CLIM 이관 때 주의

- Jira 우선순위 이름은 Works 코드로 바꿔 넣는다(`priority` 와 이력의 `from`/`to` 모두): Highest→`HIGHEST`, High→`HIGH`, Medium→`MID`, Low→`LOW`, Lowest→`LOWEST`.
- 상태 이력은 Jira 상태 id → Works 상태 id 로 맞춘다(이름 금지). 종료 시각(`closedAt`)은 Works 에서 완료 범주로 매핑한 상태로 들어간 마지막 전이 시각을 넘긴다(Jira `resolutiondate` 는 4건에만 있어 쓰지 않는다).
- Jira 인라인 이미지는 이슈 첨부이기도 하다(약 345개) — 둘 다 올리면 이중으로 들어간다. 본문 이미지로 쓴 파일은 첨부로 다시 올리지 않는 식으로 한 번만 넣는다. 인라인 파일 카드(로그 등, 이미지 아님)는 첨부로 넣고 본문엔 링크 문구로.
- 대소문자만 다른 라벨(Compute/compute 등 6쌍)은 Works 에서 다른 라벨이 된다 — 미리 합친다.
- Jira 구성요소 12개는 이슈를 가져오기 **전에** 일반 API 로 Works 구성요소(이름·담당자)로 만든다. 이름은 Works 에서 대소문자를 무시하고 유일해야 한다. 이슈에서는 Jira 구성요소 이름을 `componentNames` 에, 변경 이력은 `COMPONENTS_CHANGED` 로 옮긴다. 가져오기는 구성요소 담당자를 이슈 담당자로 붙이지 않으므로 담당자는 Jira 담당자를 `assignees` 로 보낸다.
- Jira 버전(Fix Version/s·Affects Version/s)은 이슈를 가져오기 **전에** 버전 API 로 Works 버전으로 만든다. 이름은 Works 에서 대소문자를 무시하고 유일해야 한다. Jira 에서 출시된 버전은 만든 뒤 출시하고, **이력에만 이름이 남은(지금은 지워진) 버전**은 보관된 버전으로 만들어 둔다. 이슈에서는 Fix Version/s 를 `fixVersionNames` 에, Affects Version/s 를 `affectsVersionNames` 에 이름으로 적고, 변경 이력은 `FIX_VERSIONS_CHANGED`·`AFFECTS_VERSIONS_CHANGED` 로 옮긴다.
- 다른 프로젝트(CL) 에픽이 부모인 62건은 `parentNumber` 로 걸 수 없다 — CL 에픽이 이미 Works 에 있으면 `parentKey` 로, 아니면 `PARENT_EPIC` 외부 링크로 넣고 나중에 「부모 에픽 링크 변환」으로 바꾼다(위 「관계·외부 링크」).
- 본문의 `CLIM-n` 링크(773개)는 Works 프로젝트 키를 `CLIM` 으로 두면 번호 보존으로 그대로 맞는다.
- 커넥터가 주는 주석 HTML 을 그대로 보내면 5만 자를 넘는 댓글이 있다(CLIM-16·14) — 마크다운으로 바꿔 보낸다.
- 멘션은 Jira 계정 id → Works username 으로 바꾼다. 가져오기는 멘션 알림을 내지 않는다.
- 비밀값처럼 보이는 문자열(약 57곳)은 그대로 옮기면 Works 검색·첨부 텍스트 추출에도 들어간다 — 이관 전 검토.
- CLIM 일부 댓글(25개)은 이미 한 번 옮겨 온 것이라 본문 첫 줄에 「원작성자: …」가 있다 — 원래 사람으로 바꿀지는 스크립트가 정한다.

## 동작상 참고

- 가져오는 동안 그 프로젝트의 일반 이슈 생성은 이 가져오기의 트랜잭션이 커밋될 때까지 기다린다(번호 시퀀스 잠금) — 아직 아무도 쓰지 않는 프로젝트로 옮기는 용도다. 가져온 이슈에는 AI 요약이 자동으로 만들어지지 않고, 다음 댓글·상태 변경 때 생긴다.

## 지원하지 않는 것

- 관계·외부 링크의 **이력**(원래 시각·행위자로 옮기기) — 관계 일괄은 이력을 남기지 않는다. 이슈의 `history` 에도 관계 이력 유형은 없다.
- 수정·영향 버전 — WP-888.
- 사이클·스프린트 이동 이력, 본문 변경 이력, 작업 기록·투표·반응.
- 이미 있는 이슈에 댓글만 덧붙이는 추가 가져오기(이슈 한 건을 한 번에 넣는다).
