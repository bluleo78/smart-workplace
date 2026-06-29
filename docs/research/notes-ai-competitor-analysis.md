# 노트앱 AI 기능 경쟁사 심층 분석

> 작성일: 2026-06-27 · 목적: Smart Workplace 노트앱(wiki) AI 기능 기획을 위한 경쟁 지형 조사
> 방법: deep-research 하니스(웹 fan-out → 24개 소스 fetch → 107개 주장 추출 → 상위 25개 선별).
> 검증 주의: 적대적 검증 단계는 세션 한도로 미완료. 아래 주장은 **출처에 근거하나 교차검증은 부분적**이며, 1차 출처(공식 사이트·벤더 블로그·TechCrunch)는 별도 표기.

---

## 1. 기능 카테고리별 지형도

| 카테고리 | 강자 | 핵심 양상 |
|---|---|---|
| 작성 보조 (continue/rewrite/tone) | Notion AI, Apple Notes, Craft | 슬래시(`/ai`)·선택영역 변형. 사실상 코모디티화 |
| 노트 위 Q&A (RAG) | NotebookLM, Notion(Ask Notion), Obsidian Copilot | 출처 인용 + grounding이 차별점 |
| 자동 태깅/정리 | Mem, Tana | 백그라운드 무노력 분류가 셀링포인트 |
| 자동 연결 (관련 노트 surfacing) | Mem, Obsidian(Smart Connections), Reflect | "쓰는 동안 6개월 전 노트를 띄움" |
| 회의록·음성 전사+요약 | Granola, Notion(`/meet`), NotebookLM | 2024~26 최대 격전지 |
| 작업/일정 추출 | Granola, Notion, Coda | 액션아이템 → 외부 툴 티켓화 |
| 멀티모달/오디오 생성 | NotebookLM(Audio Overview), Apple | 팟캐스트형 요약 |
| 에이전트형 작업 | Notion Custom Agents, Obsidian Copilot v4, MS Copilot | 2026 최전선 |

---

## 2. 제품별 요점

### Notion AI
- **작성보조**: 불릿 → 본문 한 클릭 전개, 톤 옵션(formal/casual/technical), 붙여넣은 전사·기사 자동 요약, DB 필드 자동 생성·채움. [techno-pulse, storyflow]
- **Ask Notion (RAG Q&A)**: 워크스페이스 전반 + **Google Drive·Slack 외부 소스 횡단** 질의, 출처 페이지 인용. [get-alfred, 공식]
- **회의 전사 `/meet`** (2025-05): Mac 앱 v4.7.0+, 참가자 동의 필요. Granola·Otter·Circleback·ClickUp·Zoom·Read AI 시장에 정면 진입. [TechCrunch 2025-05-13 · secondary]
- **에이전트화** (2026): Custom Agents(2026-02, 200만+ 생성 — FAQ 응답·상태보고·워크플로우 자동화), 이어 **외부 AI 에이전트 허브**(Claude Code·Cursor·Codex·Decagon을 워크스페이스에 붙여 작업 할당·추적). [TechCrunch 2026-05-13 · secondary]
- **가격**: AI는 2025-05부터 Business/Enterprise 번들로 흡수(별도 add-on 폐지), AI Agents는 Business $20/user/월. [undetectable, get-alfred]

### Granola — 회의 노트테이커 대표주자 (2026 $1.5B 밸류, $125M 조달)
- 봇 없이 **로컬 상주** 전사 + 사용자 메모와 오디오를 **합쳐** 구조화 노트 생성("거슬리는 회의 봇"보다 덜 노출). [granola.ai · primary, TechCrunch 2026-03-25]
- 회의 corpus 횡단 **RAG Q&A**("최근 20개 회의에서…"). [granola.ai · primary]
- 액션아이템 **Linear/Jira/Asana 티켓화**. [granola.ai · primary]
- **MCP 서버 + 개인/엔터프라이즈 API** → Claude·ChatGPT·Lovable·Figma Make·Replit 등과 cross-app 연동. [TechCrunch 2026-03-25]

### NotebookLM (Google) — grounding의 교과서
- 답변을 **업로드 소스에만 한정**, **문단 단위 인용** 부착("외부 소스 환각 0"). [storyflow, kunalganglani]
- PDF·Google Docs·URL·YouTube 자막·붙여넣기 텍스트 수용. 무료 노트북당 50소스 / Plus 500. [aitooldiscovery]
- **Audio Overview**: 문서 → 6~15분 AI 호스트 팟캐스트. 2025년 Deep Dive/Brief/Debate/Critique 4유형 추가. 스터디 가이드도 생성. [공식, storyflow]
- 한계(Reddit r/privacy): Google 서버 경유라 민감문서 비권장, Audio Overview 호스트가 소스 밖 배경지식 끌어오는 환각 사례, 소스 상한. "ChatGPT 대체가 아니라 정의된 소스의 리서치 동반자". [aitooldiscovery · 실사용 후기]

### Mem — 무노력 자동화 철학
- 입력 없이 **자동 시맨틱 태깅**, 쓰는 중 관련 노트 자동 surfacing(6개월 전 노트), 개념 기반 시맨틱 검색, Mem Graphs로 관계 시각화. [techno-pulse, aitoolbriefing]
- Mem Chat: 노트 라이브러리 횡단 Q&A. **한계**: 노트를 구조화된 프로젝트 산출물로 전환하는 데 약함. [storyflow]

### Obsidian — 네이티브 AI 없음, 플러그인 생태계
- 역할 분리(2025 Reddit 합의): **Smart Composer**(작성보조, 무료 Llama 3.2, 가장 빠름) / **Smart Connections**(시맨틱 검색·임베딩 자동 링크) / **Copilot**(vault 전역 RAG chat) / **Local GPT**(오프라인). [aitooldiscovery, aitoolbriefing]
- **Copilot for Obsidian** (공식): 모델 무관 BYOK(OpenAI/Anthropic/Google/LM Studio/Ollama/OpenAI 호환), 노트·PDF·이미지·URL 횡단 RAG Q&A + 인라인 인용(lexical 기본 + 옵션 시맨틱 인덱싱), **v4 agent mode(preview)** — 인라인/챗에서 Obsidian 네이티브 명령 실행. [obsidiancopilot.com · primary]
- 강점: 로컬·프라이버시·모델 선택 자유.

### Apple Notes (Apple Intelligence)
- **온디바이스** 긴 노트 요약·단락 재작성·리스트 생성·음성메모 전사. [storyflow]
- 한계: synthesis 깊이 얕음, 단일 사용자.

### Microsoft (OneNote/Loop → Copilot)
- "Frontier Firm"(human-led, agent-operated)으로 재정의. **Work IQ**(Data·Memory·Inference) 인텔리전스 레이어가 메일·파일·회의·챗 횡단으로 Copilot에 사용자 역할·조직 맥락 grounding. [microsoft.com Ignite 2025-11 · primary]

### 기타
- **Coda AI**: 문서=앱, DB 위 AI 자동화. **Tana**: 슈퍼태그 기반 구조화 + AI. **Reflect/Craft**: 개인 PKM + GPT 연동. **Evernote AI**: 요약·검색(후발).

---

## 3. UX 노출 패턴 (4가지로 수렴)

1. **인라인 슬래시/선택영역** — 작성보조 표준 (Notion `/ai`, Craft, Apple). [notion.com 공식]
2. **사이드 패널 챗** — RAG Q&A 표준 (NotebookLM, Obsidian Copilot, Ask Notion).
3. **백그라운드 자동 처리** — 태깅·관련노트·전사 (Mem, Granola). "사용자가 아무것도 안 해도"가 핵심 가치.
4. **확인 카드/에이전트 작업** — 액션아이템→티켓, 멀티스텝 자동화 (Granola, Notion Agents).

---

## 4. 2024~2026 동향 3가지

1. **회의록 전사가 기본기로** — Granola가 만든 카테고리에 Notion·Zoom·Otter·ClickUp 전부 진입.
2. **노트앱 → 에이전트 허브** — 노트가 "쓰는 곳"에서 "에이전트가 읽고/실행하는 데이터 레이어"로 재정의. **MCP/API 개방**이 신무기(Granola, Notion).
3. **grounding + 인용이 신뢰의 척도** — 환각 대신 "내 문서 안에서, 출처 달아서"(NotebookLM이 표준 세움).

---

## 5. Smart Workplace 관점 — 시사점

- wiki 앱은 이미 **In-Editor AI(summarize/draft/continue) + 백링크 + SSE 스트리밍** 보유 → 작성보조는 사실상 갖춤.
- **Proposal→ConfirmActionDispatcher 패턴 + 8개 subagent + `show_*` 위젯** → cross-app 에이전트 연동 인프라가 이미 존재(경쟁사가 2026에 따라가는 영역).
- **차별화 한 방은 "노트 ↔ 메일/캘린더/이슈/채팅 cross-app AI"** — 우리에겐 dispatcher 재사용으로 저비용, Notion·Granola는 외부 통합으로 고비용.
- 비어 있는 영역: **노트 위 RAG Q&A(출처 인용)**, **자동 연결(관련 노트 surfacing)**, **회의록/음성** — 경쟁 핵심이나 우리 미구현.

---

## 부록: 출처 목록 (품질 등급)

**1차(primary)**: granola.ai/ai-note-taker, obsidiancopilot.com, notion.com/help(slash commands), microsoft.com(Ignite 2025)
**2차(secondary)**: TechCrunch ×3 (Notion 전사 2025-05, Notion 에이전트 허브 2026-05, Granola 조달 2026-03)
**블로그/리뷰**: aitoolbriefing, techno-pulse, storyflow, get-alfred, mytheai, futurepicker, slite, tech-insider, workflowautomation, undetectable, aitooldiscovery(NotebookLM/Obsidian Reddit), kunalganglani, artemxtech, atlasworkspace, uxdesign.cc
