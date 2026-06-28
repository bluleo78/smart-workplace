# Drive AI 경쟁 분석 & 기회 매핑 (심층 조사)

작성일: 2026-06-27 · 목적: Smart Workplace **Drive 앱에 AI 기능 추가**를 위한 사전 조사/분석. 경쟁 서비스 AI 기능 심층 조사 + 우리 코드베이스 현황(기존 앱 AI·재사용 인프라·Drive 현 상태) + 앱간 연동 관점 종합.

---

## 0. 요약 (TL;DR)

- **업계 베이스라인(테이블 스테이크)**: ① 검색바의 자연어/시맨틱 검색 + 인용 달린 "AI Overview" ② 미리보기 패널의 자동 요약 + 파일 Q&A(출처 span 인용) ③ 루트의 우측 "Ask" 패널. 이 3종은 거의 모든 제품(Google Gemini, MS Copilot, Dropbox Dash, Box AI, Egnyte)이 공통 탑재. **인용(클릭→원문 위치)과 권한 스코핑(볼 수 있는 것만 답함)은 신뢰의 전제 — 안 하면 신뢰 상실.**
- **차별화 상위 티어**: ④ 업로드 시 자동 메타데이터/태그/분류 추출 → 메타데이터 컬럼 (Box Extract, SharePoint Syntex, Coda AI Column, Egnyte) ⑤ 폴더/컬렉션 단위 Knowledge Base + 다중파일 합성 (Box Hubs, Dropbox Stacks, Adobe Spaces) ⑥ 메타데이터→워크플로우 자동화 (Box Automate, Syntex→Power Automate) ⑦ 노코드 에이전트 빌더 ⑧ 거버넌스(PII/민감정보 탐지·AI 감사·프롬프트 인젝션 방어, Egnyte AI Safeguards).
- **우리의 강점/현실**: Drive는 그린필드가 **아님** — `drive-agent` 서브에이전트 + 9개 구조 조작 MCP 툴 + `drive.*` confirm 액션이 이미 출시됨(구조/탐색 조작). **진짜 공백은 "콘텐츠 레벨 AI"** — 텍스트 추출 파이프라인 없음, 전문/시맨틱 검색 없음(이름 ILIKE만), 요약·분류·메타데이터 컬럼 없음.
- **우리의 결정적 이점**: RLS/테넌트/GUC 멀티테넌시 = 업계가 가장 어려워하는 "권한 스코핑 검색"을 **공짜로 상속**. SSE `/events`·ConfirmActionDispatcher·MailSummaryScheduler 2단계 배치·classify 패턴·MCP/서브에이전트 = 새 AI 기능에 필요한 배관이 **이미 다 있음**.
- **앱간 연동이 우리만의 무기**: 경쟁사의 "cross-app connector"(Dash/Notion/Glean의 해자)를 우리는 **내부적으로** 이미 보유 — issue·chat·mail·calendar·wiki + Drive `drive_file_ref` 백링크(파일↔ISSUE/MESSAGE). "이 파일 관련 이슈/대화 찾아줘", "이 회의록에서 이슈 만들어줘"가 자연스러운 wedge.

---

## 1. 경쟁사 AI 기능 심층 조사

### 1-A. 클라우드 스토리지 (직접 경쟁)

#### Google Drive / Workspace (Gemini)
- **우측 "Ask Gemini" 패널**(Drive 루트): Drive 콘텐츠 그라운딩 대화, 다중파일 합성, 폴더로 소스 범위 지정, 큐레이션 소스셋을 공유 가능한 "projects"로 저장. 2026 Gmail/Calendar/Chat까지 확장.
- **파일 뷰어 내 Gemini**: 파일 열면 자동 요약 → 요약/질문/생성/`@`로 다른 파일 끌어오기/회의 녹화 액션아이템 추출 (PDF·비디오 지원).
- **폴더 요약**: 파일 안 열고 폴더 전체 요약/질의 (우클릭→Ask Gemini, 드래그, `@`).
- **시맨틱 검색 + AI Overviews**: 검색바 NL 질의 → 상단에 합성 답변 + 출처 인용 링크 (임베딩 기반, 2026.4 GA).
- **AI 파일 정리**: 콘텐츠/패턴 기반 폴더 이동·생성 제안, "연도별로 묶어" 같은 평문 지시로 정제.
- **자동 데이터 분류 라벨(관리자)**: 평문 규칙으로 분류 라벨 자동 적용, 편집자가 검토/수정 (human-in-loop).
- **NotebookLM**: 소스 그라운딩 노트북, 인용, Audio/Video Overview, 마인드맵·퀴즈.
- 가격: Workspace Business/Enterprise 번들(추가비 0), AI Expanded/Ultra 애드온.

#### Microsoft OneDrive / SharePoint / M365 Copilot
- **Copilot in OneDrive**: 요약/다중파일 요약(최대 5)·**파일 비교(원클릭 diff, 콘텐츠+메타데이터 차이 표)**·다중파일 질의·FAQ/아웃라인 생성·인사이트·오디오 오버뷰. UX = 우하단 버튼/행 호버/우클릭 메뉴/"Ask a question" 정제박스.
- **Copilot Search (시맨틱)**: 키워드+NL, 시맨틱 인덱스(동의어/관련개념), Copilot Search API(preview) 하이브리드 검색, Windows 시맨틱 파일 검색.
- **SharePoint Agents**: 라이브러리/폴더/선택파일 범위 그라운딩 에이전트 + 인용, 공유 링크. **Knowledge Agent**(역할 인지): 뷰어=질의/페이지요약, 편집자=**메타데이터 자동생성**.
- **Copilot Studio**: 노코드 커스텀 에이전트, 멀티에이전트 오케스트레이션.
- **SharePoint Premium(Syntex)**: 업로드 시 문서 분류·엔티티 추출(계약유형/날짜/당사자/key-value)·택소노미 자동태깅·Content Assembly(템플릿+메타데이터로 문서 생성)·Power Automate 트리거.
- 가격: Copilot $30/user/mo, Copilot Chat 무료(에이전트는 metered credits), Syntex 별도 종량제.

#### Dropbox Dash + Dropbox AI
- **Dropbox AI(미리보기 패널)**: 파일 요약(문서·계약·비디오)·파일 Q&A(RAG)·다중파일 Q&A.
- **Dash Universal Search**: 연결앱 전체 + 모든 파일타입(이미지·비디오·오디오·이메일·챗) 단일 검색, 시맨틱/NL, **권한 인지**, 크롬 확장. 커넥터: Google·M365·Slack·Notion·Salesforce·Jira·HubSpot·Zoom 등.
- **Dash AI Answers**: 자기 콘텐츠 그라운딩 답변+출처+후속질문 제안. 프리셋 액션버튼(Summarize/Next Steps/Quick Draft/Grammar) + 커스텀 프롬프트 버튼.
- **Stacks**: 관련 파일/링크/업데이트를 묶은 공유 가능 "living workspace", 개별 질의("이 프로젝트 요약해").
- **Dash MCP Server**: Claude/Cursor/Goose가 Dash 콘텐츠 검색.
- 가격: Teams $15, Business $35/user/mo (standalone 애드온).
- ⭐ **cross-app connector가 핵심 해자** — 나머지는 대부분 자기 생태계 내.

#### Box AI
- **Box AI for Documents(미리보기)**: 요약/핵심/Q&A/아웃라인, 열린 문서 한정 그라운딩, 우측 사이드바+제안칩, 인용(호버), 에이전트 피커.
- **다중문서 & Hubs**: 1~10 파일 교차질의; **Hubs**=큐레이션 허브(최대 2만 파일) 질의+인용, RAG/벡터 자동.
- **Box Extract(AI 메타데이터 추출)**: 문서 읽고 필드 추출→**구조화 Box 메타데이터로 write-back**(계약 상대방·발효/만료일·갱신조항). 커스텀 추출 에이전트를 소스 폴더에 붙여 자동 적용. Extract API(JSON schema in→filled JSON out).
- **Box Doc Gen**: 템플릿+구조화 데이터 병합 대량 문서생성 (Forms→DocGen→e-sign).
- **Box Automate / Relay**: 추출 메타데이터→라우팅/승인/e-sign 트리거. 캐논 루프: 계약 도착→Extract→워크플로우.
- **AI Studio(노코드 에이전트)**: 목적·지식소스(최대 100파일/Hub)·LLM·노출위치 정의. **BYO-model**(Anthropic/Google/OpenAI/AWS...).
- **Box Agent / Foundation Agents**: Q&A·Compose·Extract·Search·Research, Deep Research(대량 콘텐츠 합성).
- 가격: AI Units 종량(Enterprise 1k~Advanced 20k), 초과 $10/1k.

### 1-B. 지식/문서 제품 (인접/심화 패턴)

#### Notion AI (3.0 Agents, 2025.9)
- **Enterprise Search Q&A**: 워크스페이스(페이지/DB/뷰/관계/속성)+연결앱+웹, **항상 출처 인용**, `@`로 범위 지정, 모델 피커.
- **AI Connectors**: Slack·Teams·Drive·SharePoint·OneDrive·Jira·GitHub·Gmail·Outlook·캘린더 색인, 특정 메시지/파일 인용.
- **AI Autofill(자동 메타데이터)**: DB 행 속성 채우기, 프리빌트(AI Summary/Key Info/Translation), 조건부 로직.
- **AI Meeting Notes**: 실시간 전사→요약+액션아이템, **각 takeaway가 전사 정확 시점으로 클릭 인용**.
- **Notion Agents**: 자율 멀티스텝(20분+ 세션, 수백 페이지 생성), **영속 메모리를 Notion 페이지/DB로 저장**, 24/7 스케줄/트리거, 거버넌스 디렉토리.
- **Research Mode**: 워크스페이스+커넥터+웹 딥리서치→출처 표시 리포트.
- 거버넌스: 권한 인지(원천앱별)+DLP/PII(Nightfall/Polymer)+프롬프트 인젝션 방어+감사로그.

#### Atlassian Rovo / Confluence AI / Coda AI
- **Rovo Search/Chat/Agents**: Atlassian+서드파티(Drive/Slack) 통합검색, 액션 수행(Jira 티켓·Slack·캘린더 생성), 노코드 에이전트 빌더. **권한 golden rule**(못 보면 Rovo도 못 봄), 고객데이터 미학습.
- **Confluence AI**: 페이지 요약·**"마지막 방문 이후 변경 요약"**·댓글 recap·`/ai` 리라이트/번역·용어 정의·하이라이트→Jira 태스크·NL 자동화.
- **Coda**: **AI Column**(컬럼 단위 자동채움, `@`로 다른 행 참조)·AI Chat/Block/Reviewer·**Coda Brain**(600~800앱 연결, 답+행동, 양방향 write-back).

#### Glean / Egnyte (엔터프라이즈 파일-AI)
- **Glean**: 100+ 커넥터 권한 미러링, Enterprise Graph(사람/문서 관계 + 개인 그래프→개인화), Assistant(딥링크 인용 RAG), Agents(plan→execute→evaluate, 노코드, 100+ 액션). **ACL을 LLM 전에 필터링**.
- **Egnyte(파일 드라이브+브라우저 AI, 가장 가까운 아날로그)**:
  - **Copilot Q&A**: 권한 파일 그라운딩, 인라인 인용(호버→소스파일→정확 섹션). 하이브리드 키워드+1024차원 벡터+쿼리 재작성+리랭크+청크 오프셋 매핑.
  - **Knowledge Bases**: 폴더를 질의가능 KB로(최대 20파일), 제안질문 생성, KB별 프롬프트.
  - **자동 메타데이터/분류**: Document Type 태그(Contract/RFI/Spec) 미리보기 시 자동, Smart Tags/학습가능 분류기로 구조화 추출, 파일브라우저 컬럼 노출.
  - **민감정보 탐지**: PII/PHI(HIPAA)/금융/GDPR 자동탐지·라벨, 파일별 위험점수, 컴플라이언스 대시보드.
  - **AI Safeguards**(차별화): AI 전용 2차 거버넌스 — AI 요청을 응답 전 가로채 "어떤 유저/그룹/속성을 AI가 처리·요약·인용해도 되는지" 관리자 정의, Assistant/agents/MCP 전반 적용, 전체 감사.

#### Adobe Acrobat AI Assistant
- 문서 Q&A + 생성 요약(우측 패널), **생성형 인용**(정확 구절 점프), 제안질문, **최대 10문서 교차 인사이트**, 계약 인텔리전스(자동 탐지·핵심조항·**10계약 비교**), **PDF Spaces/Acrobat Studio**(최대 100파일+링크 영속 허브 + 역할별 AI 에이전트).

#### Slack AI
- 스레드/채널 요약(읽지않음/7일/범위), 채널 recap 아침 다이제스트, **Search Answers**(목록 아닌 합성 답+인용), 파일 요약, huddle 노트(전사+요약+액션), 메시지 설명/번역, Enterprise Search 커넥터(Drive/Salesforce/GitHub). 권한 인지.

### 1-C. 공통 패턴 종합 (카테고리별)

| 카테고리 | 테이블 스테이크 | 차별화 상위 |
|---|---|---|
| **검색/리트리벌** | 검색바 NL/시맨틱 + 인용 AI Overview, 권한 스코핑 | cross-app 커넥터 통합검색(Dash/Notion/Glean) |
| **이해/요약** | 미리보기 자동요약, 파일 Q&A(span 인용) | 다중파일/폴더/컬렉션 질의, 파일 비교(Copilot), 변경요약(Confluence) |
| **생성** | 컨텍스트 그라운딩 초안(메일/FAQ/아웃라인) | 템플릿 문서생성(DocGen/Content Assembly), Audio/Video Overview |
| **정리/메타데이터** | — | 업로드 시 자동 추출→메타데이터 컬럼(Box Extract/Syntex/Egnyte/Coda Column), AI 폴더정리(Gemini) |
| **자동화/에이전트** | — | 메타데이터→워크플로우, 노코드 에이전트 빌더, 에이전틱 리서치, BYO-model |
| **거버넌스** | 권한 인지 답변 | PII/민감정보 탐지·위험점수, AI Safeguards 층, 프롬프트 인젝션 방어, AI 감사 |

**UX 배치 4대 표면**: ① 루트 우측 Ask 패널 ② 미리보기 패널 인텔리전스(자동요약+Q&A+칩+인용) ③ 다중선택 툴바/우클릭 액션(요약/비교/질의/에이전트화) ④ 검색바(NL→인용 오버뷰).

---

## 2. 우리 코드베이스 현황

### 2-A. 기존 앱 AI 인벤토리

| 앱 | 기능 | 호출 방식 | 패턴 |
|---|---|---|---|
| **Chat(이슈/메시징)** | @AI 답글, 암묵 어텐션 발굴, 캐치업 요약, L3 위임(이슈/일정 생성) | @AI 멘션 이벤트, 백그라운드 @Async, 버튼 | ai-agent run + MCP(profile별), classify fanout→conversation_attention, confirm 카드 |
| **Mail** | 분류(카테고리+회신필요), 요약, 답장초안, 초안 코칭 | @Scheduled 10분 배치 + on-demand 버튼 | sync HTTP POST /mail/*, 영속, classifyAndStore |
| **Home** | AI 채팅 컴포저(위젯+요약) | POST /ai/chat | EventStream SSE 스트리밍 + tool call + pending_action 카드, `assistant` profile(전 툴 union) |
| **Calendar** | 일정 생성/수정/삭제 제안 | AI가 propose_* MCP 툴 호출 | confirm 카드→ConfirmActionDispatcher(calendar:write 게이트) |
| **Drive(현존)** | list/search/create/rename/move/delete **구조 조작**, show_drive 표시 | home `assistant` profile 통해 drive-agent | MCP 9툴 + drive.delete_* confirm (콘텐츠 미접근) |

### 2-B. 재사용 가능한 AI 인프라 시ms

1. **SDK runner** — `ai-agent/src/agent/sdk-runner.ts`: buildSdkOptions / runSdkStream(SSE) / runSdkCollect. 인프로세스 query(), env로 ACTING_AGENT_ID/USER_ID 주입.
2. **MCP 툴 등록** — `ai-agent/src/mcp/tools.ts` buildTools() (profile별 분기 issue|chat|home|messaging|assistant) + `sdk-mcp-server.ts`. **Drive 콘텐츠 툴은 여기 assistant 브랜치에 추가**.
3. **서브에이전트 로더** — `subagent-loader.ts`가 `subagents/*/agent.md` 스캔. `drive-agent` 이미 존재 → tools: 목록에 새 툴 추가로 권한 부여.
4. **통합 SSE /events** — backend `EventStreamController.java` + `SseRegistry.java`(userId fanOut, prefix chat/messaging/notify). 프론트 `eventStream.ts`. **Drive 이벤트도 새 배관 없이 userId fanout**.
5. **ConfirmActionDispatcher** — `action/ConfirmActionDispatcher.java`: actionType→권한 매핑. `drive.delete_*` 이미 등록. 새 drive.* = 맵 1줄 + 핸들러. 프론트 카드 `ProposalCard.tsx`/`AIChatPanel.tsx`.
6. **백그라운드 스케줄러** — `mail/MailSummaryScheduler.java`: @Scheduled, **2단계**(RLS 하에 forEachActiveTenant로 수집 → 트랜잭션 밖에서 테넌트별 처리해 LLM/IO 중 DB커넥션 미점유). **Drive 추출/요약 배치의 템플릿**.
7. **분류 패턴** — `MailAiService.classifyAndStore()` → AiAgentMailClient POST → 파싱 → repo update. **Drive 콘텐츠 분류 템플릿**.
8. **백엔드→ai-agent 트리거** — 이벤트(IssueEventDispatcher→AiAgentEventClient POST /events) / sync(AiAgentMailClient POST /mail/*). 공유 시크릿 Internal 토큰.

### 2-C. Drive 현 상태 & 데이터 모델

- **백엔드**: `com.workplace.drive`(controller/service/repo) + 공유 `com.workplace.file`(FileUploadService). 엔드포인트(`/api/v1/drive`, space role OWNER/EDITOR/VIEWER 게이트): upload/download/content/thumbnail/delete/move/copy/versions/rollback, folder CRUD, space, share-link, **search(ILIKE name)**, bulk, trash, quota, backlinks.
- **데이터 모델**(jOOQ, 전부 RLS 테넌트 격리 fail-closed):
  - `file`: original_name, mime_type, size_bytes, category(IMAGE/PDF/TEXT/DATA/DOCUMENT), storage_path, thumbnail_path. **바이너리는 로컬 디스크**(오브젝트 스토리지 없음). **extracted_text/콘텐츠 컬럼 없음**.
  - `drive_space`(PERSONAL/TEAM/CHANNEL, linked_channel_id) — **spaceId 개념 존재**, CHANNEL space는 메시징 채널당 자동생성.
  - `drive_space_member`(role) — 권한은 space 멤버십만(파일별 ACL 없음).
  - `drive_folder`, `drive_file`(version_count, trashed_at), `drive_file_version`, `drive_share_link`, **`drive_file_ref`(폴리모픽 백링크 파일↔ISSUE/MESSAGE)**, tenant.quota_bytes.
- **프론트**: `DrivePage.tsx` (url 모드=풀페이지 / state 모드=채널 파일 드로워). 미리보기(IMAGE/PDF/TEXT≤200KB)+백링크, 드래그업로드, debounced ILIKE 검색, 버전/공유/휴지통/벌크/쿼터.

### 2-D. 존재 vs 공백
- **존재(즉시 재사용)**: 서버측 바이너리 read(FileUploadService.getFileContent), 조회가능 메타데이터, 버전체인, **백링크 drive_file_ref**, space 멤버십+linked_channel_id(Drive↔채널 컨텍스트 연결), 감사로그, **구조 AI 이미 배선**(drive-agent + 9 MCP + delete confirm).
- **공백(콘텐츠 AI에 필요)**: extracted_text/콘텐츠 컬럼 없음, PDF/Office 텍스트추출·이미지 OCR 없음, 전문 인덱스 없음(tsvector/trigram/벡터), AI 메타데이터 컬럼(summary/tags/classification/language/embedding) 없음, processing_status/last_analyzed_at 없음, 장시간 추출용 비동기 잡 큐 없음.

---

## 3. 앱간 AI 연동 관점 (우리만의 차별점)

경쟁사가 가장 비싸게 파는 **cross-app connector**(Dash/Notion/Glean의 해자)를 우리는 **이미 내부에 보유**. 별도 커넥터 없이 issue·chat·mail·calendar·wiki + Drive가 한 데이터 평면(RLS 테넌트) 위에 있음. 게다가 **`drive_file_ref` 백링크가 파일↔이슈/메시지를 이미 연결**.

연동 wedge 후보:
- **파일↔이슈/대화 양방향 Q&A**: "이 사양서 관련 이슈 있어?", "이 계약서 누가 논의했어?"(백링크 + 메시징 검색).
- **첨부 자동 분류·연결**: 채널/이슈에 올라온 첨부를 Drive에 자동 정리 + 요약 + 백링크.
- **회의록/문서→이슈·일정**: Drive 문서에서 L3 위임 패턴 재사용("이 문서에서 액션아이템 이슈로").
- **메일 첨부→Drive 저장 + 요약**: mail 모듈과 연동.
- **홈 컴포저가 Drive 콘텐츠까지 답변**: assistant profile에 Drive 콘텐츠 툴 추가하면 통합 Q&A가 Drive 파일 내용까지 그라운딩.

---

## 4. 기회 매핑 & 우선순위 제안

효과/노력 비율 기준. (실제 착수 전 브레인스토밍에서 범위 확정 권장.)

### Tier 1 — 베이스라인 (효과 큼·인프라 대부분 존재)
1. **미리보기 패널 자동 요약 + 파일 Q&A(인용)** — 가장 보편적 앵커. 필요: 텍스트 추출 파이프라인 + extracted_text 컬럼. ai-agent에 content-aware `read_file` MCP 툴. SSE 스트리밍 재사용.
2. **콘텐츠 시맨틱/NL 검색 + 인용 오버뷰** — 이름 ILIKE → 전문/임베딩 검색. 필요: tsvector(빠른 1차) 또는 pgvector 임베딩. **권한 스코핑은 RLS로 공짜 상속**.
3. **업로드 시 자동 메타데이터/요약/분류** — Box Extract/Egnyte/Coda Column 패턴. mail classifyAndStore + MailSummaryScheduler 2단계 배치 그대로. 새 AI 컬럼(summary/tags/category/language) + processing_status.

### Tier 2 — 차별화 (앱간 연동 활용)
4. **폴더/Space 단위 Knowledge Base + 다중파일 합성** — Box Hubs/Dropbox Stacks/Adobe Spaces. Drive에 이미 space 개념 있음.
5. **앱간 통합 Q&A** — 홈 컴포저 assistant profile에 Drive 콘텐츠 툴 + 백링크 활용. 우리만의 cross-app 강점.
6. **변경 요약(catch-up)** — Confluence "마지막 방문 이후 변경". 버전체인 + 캐치업 패턴 재사용.

### Tier 3 — 고급 (장기)
7. **메타데이터→워크플로우 자동화** (Box Automate 패턴), **노코드 Drive 에이전트**(AI Studio/SharePoint Agents, 우리 서브에이전트 아키텍처와 정렬).
8. **거버넌스**: PII/민감정보 탐지·파일 위험점수, AI 감사로그, 프롬프트 인젝션 방어(Egnyte AI Safeguards 모델) — 엔터프라이즈 신뢰.

### 핵심 기술 결정 포인트(착수 전 확정)
- 텍스트 추출: PDF/Office/이미지 OCR 범위 & 라이브러리.
- 검색 아키텍처: tsvector(간단·빠른 출시) vs pgvector 임베딩(시맨틱) vs 하이브리드.
- 추출 타이밍: 업로드 동기 vs @Scheduled 2단계 백필(MailSummaryScheduler 패턴) vs 이벤트 기반.
- 스토리지: 로컬 디스크 현황에서 대용량 추출/인덱싱 부하.

---

## 출처(주요)
경쟁사 공식 도움말/릴리즈/기술블로그 다수 인용 — Google Drive Help·Workspace Updates, MS Learn·Support, Dropbox Dash·dropbox.tech, Box Support·blog, Notion Help·Releases, Atlassian Support, Glean docs, Egnyte products, Adobe news, Slack Help. (상세 URL은 조사 로그 참조)
