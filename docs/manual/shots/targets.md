# 촬영 대상 표

매뉴얼 그림 한 장이 한 행이다. 촬영 스크립트(`scripts/scenes/<book>.mjs`)는 이 표를 구현만 한다 — 집필 중 그림이 필요해지면 **이 표에 행을 먼저 추가**하고 장면을 쓴다.

- 그림 id 는 `<장 slug>-<n>` 이고 `shots/<book>/<id>.png` 와 `boxes.json` 의 키가 된다.
- 자르기·표식 키는 `boxes.json` 의 상자 이름이다. 장 본문 그림 지시문의 `crop=`·`marks=` 와 같아야 한다.
- 로그인 계정·시드는 가상 회사(누리커머스 등) 데이터만 쓴다. 실명·실계정·운영 데이터를 찍지 않는다.

## 사용자 매뉴얼

### 04 AI 와 함께 일하기

현재 출처: **소개서 촬영본**(`docs/intro/deck/shots`, 가상 회사 누리커머스·격리 스택). `scripts/import-intro-shots.mjs` 가 복사·좌표 변환한 샘플이며, 매뉴얼 테넌트(WP-1194)가 생기면 WP-1196 에서 `capture.mjs` 장면으로 다시 찍는다.

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| ai-collaboration-1 | `/me/ai-tasks` | 김서연(PM, 관리자) | AI 에게 맡긴 이슈가 진행 중일 때 연다 | `nav+rows` | `nav,rows` | MOB 프로젝트, 에이전트 지니에게 맡긴 미완료 이슈 2건 이상 |
| ai-collaboration-2 | `/projects/MOB/issues/8` | 김서연 | 담당자 칸을 눌러 선택창을 연다 | `picker` | `picker,agent` (`suggest` 도 기록) | 구성원 5명 + 에이전트 지니가 MOB 멤버 |
| ai-collaboration-3 | `/projects/MOB/issues/<회귀 체크리스트 이슈>` | 김서연 | 코멘트 탭, 마지막 AI 코멘트 머리가 화면 위쪽에 오게 스크롤 | `start+result` | `start,result` | 지니에게 맡겨 끝난 이슈(실제 AI 호출로 만든 착수·결과 코멘트) |
| ai-collaboration-4 | 위와 같은 이슈 | 김서연 | **이력** 탭을 누른다 | `changes` | `changes` | 위와 같음(AI 의 상태 변경 이력) |
| ai-collaboration-5 | `/projects/MOB` | 김서연 | **AI 어시스턴트** 를 열어 진행 상황·일정 정리를 요청하고 답이 끝날 때까지 기다린다 | `launcher+answer+context` | `launcher,answer,context` | MOB 이슈·사이클, 김서연의 이번 주 일정 |

다시 찍을 때 고칠 것(WP-1196) — 샘플 그림은 자르기 폭 기준(원본 1400px 이하, 집필 스킬 「자르기 가독성 기준」)을 넘는다. 표식 상자가 컨테이너 전체를 감싸 자르기를 더 좁힐 수 없기 때문이다.

| 그림 id | 지금 자른 폭(원본 px) | 고칠 것 |
| --- | --- | --- |
| ai-collaboration-1 | 2824 | 높이 약 330px 의 띠이기도 하다. `rows` 가 표 전체 폭이다. ID·제목 열만 감싸는 키를 따로 기록하고, 지금 화면에 생긴 범위·상태 칩 줄도 키로 기록한다 |
| ai-collaboration-2 | 640 | 같은 배율로 단 폭의 약 46% 로 인쇄된다(문제 없음). 담당자 칸까지 감싸는 키를 기록하면 어디서 연 목록인지 보인다 |
| ai-collaboration-3 | 1680 | `result` 가 화면 아래로 넘어가 이미지 경계에서 잘렸다(가져올 때 잘라 넣음). 결과 코멘트의 머리 부분만 감싸는 키를 기록한다 |
| ai-collaboration-4 | 1604 | 높이 약 200px 의 얇은 띠라 어느 화면인지 보이지 않는다. 이 샷에는 `changes` 키 하나뿐이라 맥락을 넓힐 수 없었다. **활동** 의 탭 줄(코멘트·이력)과 이력 목록 전체를 감싸는 키를 함께 기록하고, `changes` 는 글자가 있는 폭만 감싼다 |
| ai-collaboration-5 | 1556 | 패널과 AI 어시스턴트 단추를 함께 담느라 넓다. 단추 위치는 전체 그림으로 따로 보여 주고, 패널만 자르는 것을 검토한다 |

## 운영자 매뉴얼

촬영 환경: **격리 로컬 스택**(매번 깨끗한 DB) + `scripts/seed-operator.mjs` 시드. 로그인 계정은 첫 가입으로 만든 슈퍼어드민 **플랫폼 운영자**(`ops@example.com`)다. 뷰포트는 **900x810**(배율 2 → 원본 1800x1620)이다 — 1440 폭에서는 제목과 오른쪽 단추가 원본 2400px 가까이 벌어져 자르기 폭 기준을 지킬 수 없다(`lib/books.mjs` 의 `capture.viewport`).

시드 테넌트: 누리커머스(활성, 구성원 4) · 한빛물류(활성, 2) · 새솔디자인(정지됨, 2) · 다온헬스케어(활성, 2) · 푸른교육(삭제됨, 1). 앱이 처음부터 두는 기본 테넌트 **Default Workspace**(운영자 1명)도 목록에 보인다. 영구 삭제 장면은 돌 때마다 장면이 새로 만드는 별빛스튜디오(slug 는 비어 있는 첫 값 `byeolbit-studio`, `-2`, …)에서만 한다.

장면은 표 순서대로 돈다. tenant-lifecycle-7·8·6 은 **한 장면**(id `tenant-lifecycle-7`, `shots` 로 세 그림을 밝힘)이다 — 영구 삭제를 실제로 시작해야 진행 배너(8)와 삭제됨 목록의 「영구 삭제 중…」 행(6)이 나온다. API 는 영구 삭제 잡의 첫 실행·주기를 모두 길게(`--workplace.tenant-purge.delay-ms=3600000 --workplace.tenant-purge.initial-delay-ms=3600000`) 띄워 영구 삭제 중 상태가 촬영 동안 남게 한다. 장면은 생성·편집·멤버 추가 창을 채우기만 하고 제출하지 않는다(다시 찍어도 같은 화면).

### 01 소개와 로그인

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| introduction-1 | `/login` | 로그아웃 상태(새 컨텍스트) | 아이디·비밀번호 칸을 채운다 | `card` | `username,password,submit` | 운영자 계정 |
| introduction-2 | `/` | 플랫폼 운영자 | 로그인 직후 화면 | (전체) | `tenants,user` | 시드 테넌트 |
| introduction-3 | `/` | 플랫폼 운영자 | 왼쪽 아래 사용자 메뉴를 연다 | `menu+trigger` | `trigger,logout` (`theme` 도 기록) | — |

### 02 테넌트 만들기와 고치기

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| tenants-1 | `/` | 플랫폼 운영자 | 운영 중 목록 | `header+table` | `toggle,row` | 시드 테넌트(정지됨 포함) |
| tenants-2 | `/` | 플랫폼 운영자 | **테넌트 생성** 창에 이름·소유자 이메일을 넣고 **확인** 으로 찾는다(제출하지 않음) | `dialog` | `name,slug,owner,check,submit` | 오민재(소유자 후보) |
| tenants-3 | `/tenants/<누리커머스>` | 플랫폼 운영자 | 상세 화면 위쪽 | `card+quota` | `edit,quota` | 누리커머스 |
| tenants-4 | 위와 같음 | 플랫폼 운영자 | **편집** 을 눌러 창을 연다(제출하지 않음) | `dialog` | `name,slug,save` | 누리커머스 |

### 03 테넌트 구성원

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| tenant-members-1 | `/tenants/<누리커머스>` | 플랫폼 운영자 | 멤버 표가 보이게 내린다 | `members` | `add,table` | 누리커머스 구성원 4명 |
| tenant-members-2 | `/tenants/<다온헬스케어>` | 플랫폼 운영자 | **멤버 추가** 창에 다른 테넌트 구성원 이메일을 넣고 **확인**(제출하지 않음) | `dialog` | `email,check,found,role,submit` | 최유나(누리커머스 소속) |
| tenant-members-3 | 위와 같음 | 플랫폼 운영자 | 없는 이메일을 넣고 **확인**, 이름·초기 비밀번호를 채운다(제출하지 않음) | `dialog` | `name,password,role,submit` (`notice` 도 기록) | — |

### 04 테넌트 정지·활성화와 삭제

| 그림 id | 경로 | 로그인 계정 | 준비 조작 | 자르기 | 표식 키 | 필요한 시드 |
| --- | --- | --- | --- | --- | --- | --- |
| tenant-lifecycle-1 | `/tenants/<한빛물류>` | 플랫폼 운영자 | 상세 화면 위쪽 | `card` | `suspend` | 한빛물류(활성) |
| tenant-lifecycle-2 | `/tenants/<새솔디자인>` | 플랫폼 운영자 | 상세 화면 위쪽 | `card` | `status,activate` | 새솔디자인(정지됨) |
| tenant-lifecycle-3 | `/tenants/<다온헬스케어>` | 플랫폼 운영자 | 위험 구역이 보이게 내린다 | `danger` | `delete` | 다온헬스케어(활성) |
| tenant-lifecycle-4 | 위와 같음 | 플랫폼 운영자 | **삭제** 를 눌러 확인 창을 연다(확정하지 않음) | `dialog` | `confirm` | 다온헬스케어 |
| tenant-lifecycle-5 | `/tenants/<푸른교육>` | 플랫폼 운영자 | 상세 화면 위쪽 | `banner+card` | `restore` | 푸른교육(삭제됨) |
| tenant-lifecycle-7 | `/tenants/<별빛스튜디오>` | 플랫폼 운영자 | 장면이 돌 때마다 API 로 새로 만들고 삭제한 테넌트에서 **영구 삭제** 창을 열어 이름을 넣는다 | `dialog` | `input,confirm` | 장면이 만든다 |
| tenant-lifecycle-8 | 위와 같음 | 플랫폼 운영자 | 창의 **영구 삭제** 를 눌러 진행 배너가 뜨면 찍는다 | `banner+card` | `banner,status` | 위와 같음 |
| tenant-lifecycle-6 | `/?view=deleted` | 플랫폼 운영자 | 위 장면에 이어 삭제됨 보기 | `header+table` | `toggle,rows` | 푸른교육(삭제됨) + 별빛스튜디오(영구 삭제 중) |
