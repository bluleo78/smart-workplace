# 작업 관리 네비게이션 — 경쟁 솔루션 메뉴 구조 조사

> 작성일: 2026-06-01
> 목적: Smart Workplace "작업 관리"(이슈 트래커) 좌측 사이드바 개선을 위해, 주요 이슈/작업 관리 솔루션 10종의 네비게이션 구조를 조사하고 공통 패턴·적용안을 정리한다.
> 배경 피드백: ① "작업 관리 메뉴가 휑하다" ② "아이콘 있는 메뉴/없는 메뉴가 섞여 어색하다" ③ "기능은 충분한 것 같다" → 구조·일관성 문제.

---

## 1. 조사 대상

- **개발자 중심 트래커**: Linear, GitHub(Issues/Projects), GitLab, Height, Shortcut
- **범용 PM 도구**: Jira(team-managed), Asana, ClickUp, Monday.com, Notion

근거는 각 제품 **공식 도움말 문서** 우선. 문서 미기재 항목은 트리에서 제외했다(섹션 8 신뢰도 노트 참고).

---

## 2. 제품별 메뉴 트리

### Linear
```
├─ 개인 영역 (상단, 워크스페이스 공통)
│  ├─ 📥 Inbox
│  ├─ 📋 My Issues   (Assigned / Created / Subscribed / Activity 4탭)
│  └─ ⭐ Favorites   (★ 핀한 View·Project)
├─ 워크스페이스: Initiatives · Projects · Views(Workspace views)
└─ 팀(Team) 내부  ← 팀 아이콘=섹션헤더, 하위 들여쓰기
   └─ Issues · Triage · Cycles · Projects · Views(Team views)
```
- 개인 뷰: `My Issues` 최상단 고정, 4탭 분할. 단축키 `G M`.
- 저장된 뷰: `Views`(Team/Workspace). ★ Favorite로 사이드바 핀 + 기본 진입 페이지 지정 가능. **가장 성숙.**
- Cycles(=Sprint)는 **팀 내부**에 위치.

### GitHub (Issues + 새 Projects)
```
[Issues] 좌측 사이드바 없음 — (a)전역 대시보드 (b)리포 필터바 (c)Projects 상단 탭
├─ 전역 대시보드(github.com/issues): Assigned to me / Created by me / Mentioned / Recent
├─ 리포 Issues 탭: 상단 필터바(Author/Label/Milestone/Assignee/Sort), 저장 뷰 없음(URL 공유)
└─ Projects: 상단 가로 탭 = View(Table / Board / Roadmap), + New view
```
- **유일하게 좌측 수직 사이드바 미채택** → 우리 모델엔 부적합한 레퍼런스.
- 저장된 뷰는 Projects의 **상단 탭** 형태로만 존재.

### GitLab (프로젝트 좌측 메뉴)
```
├─ 상단/개인: 🔍 Search · Your work(전 프로젝트 집계) · 📌 Pinned
├─ 프로젝트 상단: Overview · Manage
└─ ▾ Plan (펼침 섹션, 아이콘 헤더)
   └─ Work items(구 Issues+Epics) · Issue boards · Milestones · Iterations · Wiki
   (형제 섹션: Code / Build / Deploy / Monitor …)
```
- 개인 뷰: `Your work`(상단 전역). 저장 뷰는 약함 → Pinned·Issue boards가 대체.
- Milestones·Iterations 모두 **Plan 섹션 내부**.

### Height
```
├─ 개인: 📥 Inbox · Assigned(본인 할당 열린 태스크)
├─ 워크스페이스(Lists): #general · #커스텀List(계층 없는 평면) · ★별표 List · 📌 Smart lists(저장 검색)
└─ 하단: 개별 태스크 핀 · + New List
```
- Smart lists = 저장 검색, **공유형**(다른 멤버도 자기 사이드바에 추가). 저장 뷰 성숙도 Linear급.
- List는 계층 없이 평면 나열(`#` 접두 + ★).

### Shortcut (구 Clubhouse)
```
├─ Work: 🏠 Home · Stories · Epics · Milestones
├─ Planning: Iterations(=Sprints) · Timelines(Beta)
├─ More: Projects · Labels · Reports · Status · Search
└─ Team 영역: 선택 팀 단위로 Stories/Epics/Iterations/Backlog 노출
```
- 10+ 평면 항목 → **카테고리 그룹핑(Work/Planning/More)** 으로 재편한 게 핵심 변경.
- 알림은 우상단 shelf로 분리.

### Jira (team-managed)
```
├─ 상단 글로벌 바: Search · Create(+) · Notifications · Settings
├─ 글로벌 사이드바: For you(개인 허브) · Projects · Filters(저장 필터) · Dashboards · Teams · Plans
└─ 프로젝트 내부 탭: Summary · Board · Backlog · Timeline · Calendar · List(제거불가) · Reports · + (탭 추가) · Settings
```
- 개인 뷰: `For you`(할당/최근/별표 집계). 저장 뷰: `Filters` **독립 섹션**.
- 커스터마이즈 강력: `Customize sidebar` 체크박스 표시/숨김·드래그(**스페이스 전원 공유**).

### Asana
```
├─ My Views(상단): Home · My Tasks · My Inbox · My Dashboards · See More(저장 Search Views)
├─ Favorites: 별표 프로젝트가 Projects 목록 상단 고정
├─ Projects(방문빈도+최근 자동 정렬)
└─ Teams → 팀 페이지
```
- 개인 뷰: `My Views` 묶음 최상단. 저장 뷰: Search Views(See More).
- 아이콘 규칙 명확: **항목=아이콘+색(33종 프로젝트 아이콘) / 섹션=텍스트 헤더**.

### ClickUp
```
├─ Global Navigation(아이콘 전용 세로 레일): Home · Inbox · Dashboards · Docs · Whiteboards · (핀: Chat/AI/Planner)
└─ Sidebar(2모드)
   ├─ Home Sidebar: Inbox · My Tasks · Favorites
   └─ Spaces Sidebar: Favorites · Everything · Spaces > Folders > Lists(>Views: Board/Calendar/Gantt)
```
- **아이콘 레일 분리** 2-tier 구조(유일). 저장 뷰는 List/Folder/Space 하위 종속.
- Favorites 명시적 핀(상단/하단). 사용자별 개인화.

### Monday.com
```
├─ 상단 개인/글로벌: Home · My Work · Notifications(단일 활동 피드)
├─ Favorites(Workspaces 바로 위)
├─ Workspaces: Pinned(최대 50) + Recent → Boards/Folders/Dashboards/Docs
└─ More: Marketplace · Automation · AI · Personalize menu
```
- 개인 뷰: `My Work`. 저장 뷰는 보드 레벨 종속(사이드바 전용 없음).
- 커스터마이즈: `Personalize menu`로 핀/정렬.

### Notion (프로젝트/태스크 DB 기준)
```
├─ 고정 상단: Search · Home · Notion AI · Inbox
├─ 동적 섹션: Favorites · Teamspaces · Shared · Private(개인)
└─ 고정 하단: Templates · Trash · Settings
```
- 고정 `My Tasks` 없음 → 태스크 DB에 "Assigned to me" 뷰를 직접 생성해 사용. `Home`이 본인 관련 집계.
- 아이콘 규칙 가장 명확: **모든 페이지=이모지/이미지 아이콘 / 섹션=텍스트 헤더(접기 가능)**.

---

## 3. 공통 구조 패턴 비교표

| 패턴 | Linear | Jira | Asana | GitHub | GitLab | Height | Shortcut | ClickUp | Monday | Notion |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Inbox/알림 상단 | ✅ | 상단바 | ✅ | 우상단 | 우상단 | ✅ | shelf | ✅ | ✅ | ✅ |
| 개인 뷰 최상단 | My Issues | For you | My Views | (전역) | Your work | Assigned | Home | My Tasks | My Work | (DB뷰) |
| 개인 뷰 하위탭 | A/C/S | — | — | A/C/M | — | — | — | — | — | — |
| 저장된 뷰 사이드바 | ✅★ | ✅ | ✅ | 탭 | 약함 | ✅★ | Spaces | List종속 | 보드종속 | DB종속 |
| Favorites/Pinned | ✅ | Starred | ✅ | — | 📌 | ✅★ | — | ✅ | ✅ | ✅ |
| Sprint류 1급 항목 | Cycles | Sprint | — | Iteration | Iterations | sprint | Iterations | — | — | — |
| 커스터마이즈(숨김/핀) | ✅ | ✅강력 | 핀 | — | 📌 | ✅ | — | ✅ | ✅ | ✅ |

---

## 4. 도출된 핵심 규칙 (10종 거의 전부)

1. **3구획 구조로 수렴**: ① 개인 영역(상단) → ② 워크스페이스/뷰 영역 → ③ 프로젝트·팀 내부. (Notion만 단일 사이드바에 상/중/하로 압축.)
2. **개인 작업 뷰를 사이드바 최상단에 고정**: Inbox → My Issues/My Tasks 순서.
3. **항목 = 아이콘+라벨 / 섹션 헤더 = 텍스트**: Notion·Asana·ClickUp이 가장 엄격. 아이콘 일관성의 표준 규칙.
4. **저장된 뷰(Views)를 ★/핀으로 사이드바 고정**: 성숙한 트래커의 핵심(Linear·Height·Jira·Asana).
5. **Sprint류(Cycles/Iterations)는 거의 항상 별도 1급 항목** — 위치만 "팀 내부" vs "전역 Planning"으로 갈림.
6. **사이드바 커스터마이즈**(항목 숨김/핀)로 "기본 최소, 확장 옵트인" 철학.

### 차별화 관찰
- **Linear의 My Issues 하위탭(Assigned/Created/Subscribed)** 이 개인 영역을 가장 깔끔하게 풍부화 → 우리 `내 태스크`에 바로 이식 가능.
- **GitHub만 좌측 사이드바 미채택** → 우리 모델엔 부적합.
- 저장 뷰 일급화는 Linear·Height·Jira·Asana, 나머지는 컨테이너 종속.

---

## 5. 우리 현재 상태 (IssueSidebar)

`apps/workplace-web/src/components/issue/IssueSidebar.tsx`
```
작업 관리 [LayoutList]
├─ 내 태스크 [ListChecks]            → /me/watched
└─ 프로젝트 (섹션 라벨)
   └─ {프로젝트명}  (아이콘 없음 ← :46 <span>{p.name}</span>)   → /projects/:key
   └─ + (전체 보기)
```

진단:
- **개인 영역이 `내 태스크` 1줄** → 공통 패턴 대비 상단이 휑함. ("아무것도 없다"의 정체)
- **프로젝트 항목만 아이콘 부재**(`IssueSidebar.tsx:46`) → 규칙 3 위반. AdminSidebar는 전 항목 아이콘이라 대조. ("어색하다"의 정체)
- **저장된 뷰(Views) 부재** → 사이드바를 채울 가장 큰 레버 미사용.

---

## 6. 목표 구조 제안 (공통 패턴 적용)

```
작업 관리
├─ ① 개인 영역
│   📥 Inbox                       (AI 담당자 멘션·상태변경 피드 — AI Native 차별점)
│   📋 내 작업                      (할당 / 내가 만든 / 구독 — Linear식 하위탭)
│   ⭐ AI 위임 작업                  (AI에게 맡긴 작업 전용 뷰 — 경쟁사에 없는 신규)
├─ ② 저장된 뷰
│   🔖 Views                       (필터+그룹핑 저장, ★ 핀)
└─ ③ 프로젝트
    # {프로젝트}  (아이콘/컬러 점 부여 — 규칙 3 준수)   + 전체 보기
```

우선순위(노력 대비 효과):
| # | 아이템 | 근거(조사) | 노력 |
|---|--------|-----------|------|
| P1 | 프로젝트 항목 아이콘/컬러 점 | 규칙 3, 즉시 "어색함" 해소 | 낮음 |
| P2 | 개인 영역 그룹화(Inbox + 내 작업 하위탭) | 규칙 1·2, "휑함" 해소 | 중 |
| P3 | ⭐ AI 위임 작업 뷰 | AI Native 차별점 | 중 |
| P4 | 저장된 뷰(Views) | 규칙 4, 트래커 성숙도 | 높음 |
| P5 | 즐겨찾기/커스터마이즈 | 규칙 6 | 중 |

---

## 7. 출처 URL

**Linear**: conceptual-model · my-issues · custom-views · changelog 2024-12-18(personalized-sidebar)
**GitHub**: projects/quickstart · customizing-views/changing-the-layout · using-issues/viewing-all · blog 2022-02-23
**GitLab**: tutorials/left_sidebar · issue_board · milestones · group/iterations · work_items
**Height**: articles/3606831(overview) · 3847167(lists) · blog/whats-new-add-tasks-to-sidebar
**Shortcut**: blog/new-layout-and-navigation · blog/team-navigation · help 360058438212 · clubhouse 360028953452(iterations)
**Jira**: jira-software-cloud/manage-and-customize-the-project-navigation · get-started-team-managed · new-jira-cloud-navigation · jira-work-management/navigate-to-your-work
**Asana**: navigating-asana · inside-asana/more-navigation-improvements · my-tasks · project-customization-and-views
**ClickUp**: What-is-Global-Navigation · Intro-to-the-Sidebar · What-is-the-Spaces-Sidebar · Default-Home-Sidebar-sections
**Monday**: Navigating-monday-AI-work-platform · Notifications-explained · favorites-section · keep-account-organized
**Notion**: navigate-with-the-sidebar · structure-sidebar-focused-work-teamspaces · manage-your-library · intro-to-workspaces

---

## 8. 신뢰도 노트

- Jira·Notion·ClickUp·GitLab: 공식 문서에서 사이드바 항목·커스터마이즈·아이콘 규칙까지 직접 확인(신뢰도 높음).
- Asana: My Views/Projects/Teams·저장 검색은 공식 확인. **개별 항목 토글/숨김은 공식 문서 미확정 → 단정 보류.**
- Monday: Personalize·핀·정렬·Favorites 공식 확인. 포럼의 "잠금/숨김"은 기능 요청이라 채택 안 함.
- GitHub Issues 탭: 본래 좌측 사이드바가 없는 구조(필터바+상단 탭)라 1:1 대응 불가 — 그대로 명시.
- GitLab Plan 하위: 18.10 Work items 통합 기준(구버전은 Issues/Epics 분리).
- ClickUp·Height 헬프센터 일부는 직접 fetch 403 차단 → 공식 문서 발췌(검색 스니펫) 교차 확인.
- 각 제품 UI는 수시 개편되므로 픽셀 단위 배치는 실제 화면 캡처로 최종 검증 권장(특히 Linear·Shortcut nav 재편 잦음).
