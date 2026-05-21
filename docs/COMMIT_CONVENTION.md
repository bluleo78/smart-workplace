# Commit Convention

Conventional Commits 헤더 + 한국어 본문.

## 형식

```
<type>(<scope>): <한글 제목>

- #<issue>
- 내용 1
- 내용 2
- 내용 3 (선택)
- 내용 4 (선택, 최대 5줄)
```

## 규칙

- **제목**: 한국어, 명령형, 마침표 없음, 50자 권장
- **type**: `feat` / `fix` / `chore` / `docs` / `refactor` / `test`
- **scope**: `infra` / `web` / `api` / `api/<module>` / `ai` / `repo`
- **본문**: 첫 줄은 `- #N` (이슈 번호), 그 아래 변경 내역, **총 5줄 이내**
- **이슈 자동 종료**: 마지막 줄에 `- Closes #N`

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
- pnpm workspace + turbo 셋업
- 루트 .gitignore/.dockerignore/.npmrc/.env.example
- Closes #1
```

```
feat(api/identity): JWT 인증 추가

- #6
- /auth/signup, /login, /refresh 엔드포인트
- HttpOnly 쿠키로 refresh token 저장
- Closes #6
```
