# Commit Convention

Conventional Commits 헤더 + 한국어 평문 본문.

## 형식

```
<type>(<scope>): <한글 제목>

- #<issue>
- 내용 1 (한글 평문 문장)
- 내용 2
- 내용 3 (선택, 최대 5줄)
```

## 규칙

- **제목**: 한국어, 명령형, 마침표 없음, 50자 권장
- **type**: `feat` / `fix` / `chore` / `docs` / `refactor` / `test`
- **scope**: `infra` / `web` / `api` / `api/<module>` / `ai` / `repo`
- **본문 첫 줄**: `- #N` — 관련 이슈 번호
- **본문 본문**: 한글 평문 문장으로 **"무엇을 + 왜"** 명확히. **5줄 이내**
- **이슈 종료**: 본문에 `Closes #N` 같은 자동 종료 키워드 넣지 않음. 작업 완료 후 `gh issue close` 로 수동 처리

## 본문 작성 가이드

좋은 본문은 **나중에 git log 만 봐도 변경의 의도가 한눈에 들어와야** 한다 (사람·AI 공통).

- ✅ 한글 평문 문장 — 무엇을 했고 왜 가치 있는지
- ❌ 셸 brace 표기(`{a,b,c}.ts`), 식별자 단순 나열, 영문 단축어
- ✅ 효과·동기 포함 ("X 가 가능해진다", "Y 를 위해 Z")
- ❌ "X.java 추가", "Y 변경" 같은 사실 나열만

### 나쁜 예

```
- api/{auth,users,roles,permissions,auditLogs,files}.ts 이식
- AuthProvider + useAuth + hooks/queries (useUsers/useAuditLogs)
- Closes #10
```

### 좋은 예

```
- axios 클라이언트: JWT 자동 첨부, 401 발생 시 refresh 토큰으로 재발급 후 큐잉된 요청 재시도
- 인증·사용자·역할·권한·감사·파일 6개 API 호출 모듈 이식
- 전역 인증 컨텍스트(AuthProvider/useAuth)로 화면 어디서나 현재 사용자/권한 조회 가능
```

## type 가이드

| type | 사용 시점 |
|---|---|
| feat | 새 기능 |
| fix | 버그 수정 |
| chore | 빌드/설정/의존성 등 코드 외 변경 |
| docs | 문서만 변경 |
| refactor | 동작 변경 없는 내부 리팩토링 |
| test | 테스트 추가/변경 |

## 예시

```
chore(infra): 모노레포 골격 초기화

- #1
- pnpm workspace + Turborepo 로 모노레포 진입점 셋업
- 루트 .gitignore/.dockerignore/.npmrc/.env.example 초기 셋팅
- 이후 모든 앱(workplace-api, workplace-web)이 같은 진입점에서 빌드/테스트 가능
```

```
feat(api/identity): JWT 기반 로그인·회원가입 추가

- #6
- /auth/signup, /login, /refresh 엔드포인트로 토큰 발급/갱신 흐름 완성
- refresh 토큰은 HttpOnly 쿠키, access 토큰은 응답 본문으로 분리해 XSS 노출 최소화
- 후속 모듈이 @RequirePermission 으로 권한 검증 가능
```
