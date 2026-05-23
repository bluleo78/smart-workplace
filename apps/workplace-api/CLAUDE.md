# CLAUDE.md (workplace-api)

루트 [CLAUDE.md](../../CLAUDE.md) 와 함께 본다. 본 문서는 백엔드 단독 사항만 다룬다.

## 이 앱의 목적

Smart Workplace 의 **모듈러 모놀리스 백엔드**. 현재 인증·권한·감사·파일 코어 모듈을 제공한다.

새 도메인 모듈을 추가할 때의 원칙: 같은 프로세스 안에 모듈로 추가하고, 다른 도메인 패키지를 직접 import 하지 않는다 (`global` 만 의존, 도메인 간 통신은 이벤트).

## Commands

```bash
# 실행
./gradlew bootRun --args='--spring.profiles.active=local'   # 로컬 서버 (port 9090)
./gradlew build                                              # 빌드 (테스트 포함)
./gradlew build -x test                                      # 테스트 제외 빌드

# 테스트
./gradlew test                                                            # 전체
./gradlew test --tests "com.workplace.auth.service.AuthServiceTest"       # 단일 클래스
./gradlew test --tests "*.AuthServiceTest.login_success"                  # 단일 메서드
./gradlew test --tests "com.workplace.auth.*"                             # 패키지 와일드카드
./gradlew test jacocoTestReport                                           # + 커버리지

# jOOQ codegen (DB 가 떠 있어야 함)
./gradlew generateJooq                                       # → src/main/generated/
```

루트에서 `pnpm db:up` 으로 Postgres 두 컨테이너 기동 후 테스트 가능.

## Architecture

패키지 베이스: `com.workplace`. Feature-sliced 모듈 구조, 각 모듈은 `controller/` → `service/` → `repository/` + `dto/`, `exception/`.

### Modules

| Module | 책임 |
|--------|------|
| `auth` | JWT signup/login/refresh/logout. Access token → body, refresh → HttpOnly 쿠키. 로그인 실패 카운터(`login_attempts`) 로 브루트포스 방어 |
| `user` | 사용자 CRUD·프로필·역할 할당 |
| `role` | 역할 CRUD·권한 할당. 시스템 역할(ADMIN/USER) 수정 불가 |
| `permission` | 권한 목록 조회. 코드 형식 `{resource}:{action}` (예: `user:read`) |
| `audit` | 행위 감사 로그 (JSONB 메타) |
| `file` | 업로드 파일 메타. 바이너리는 디스크/오브젝트 스토리지에 별도 저장 |
| `health` | `/api/v1/health`, Actuator 헬스 |
| `global` | SecurityConfig, JwtAuthenticationFilter, GlobalExceptionHandler, `@RequirePermission`, 공통 DTO, EncryptionService(AES-256-GCM) |

### 데이터 접근: jOOQ (not JPA)

- Repository 는 `DSLContext` 로 type-safe SQL 작성
- 코드젠 결과: `src/main/generated/` (public 스키마)
- 빌드와 codegen 은 분리(`generateSchemaSourceOnCompilation = false`) — 스키마 변경 후 명시적으로 `./gradlew generateJooq`
- Flyway 마이그레이션: `src/main/resources/db/migration/V{n}__*.sql` (현재 V1~V4)

### Auth & Permission

- **JWT**: HS384. Access 30분, Refresh 7일 (HttpOnly 쿠키)
- **`@RequirePermission("code")`**: 컨트롤러 메서드/클래스에 선언, `PermissionInterceptor` 가 검증
- **공개 엔드포인트**: `/api/v1/auth/**`, `/api/v1/health`
- **`Authentication.getPrincipal()`**: `Long userId`

### Encryption

`EncryptionService` (global/security): AES/GCM/NoPadding, 12바이트 IV, 256비트 키. 출력 `Base64(iv:ciphertext)`. 민감 설정 암호화에 사용. local/test 프로파일은 하드코딩된 개발용 키.

## Configuration

| Profile | DB | Notes |
|---------|----|-------|
| `local` | `workplace` (localhost:5434) | 개발 |
| `test`  | `workplace_test` (localhost:5435) | 통합 테스트 격리 |

환경변수 (프로덕션 필수): `JWT_SECRET` (Base64 256비트 이상), `ENCRYPTION_MASTER_KEY` (Base64 32바이트).

## Testing

- 모든 테스트는 `IntegrationTestBase` 상속 (`@SpringBootTest` + `@ActiveProfiles("test")`)
- Mockito + `spring-security-test` 사용
- JDK 25 호환 JVM args 는 `build.gradle.kts` 에 설정됨
- JaCoCo: `build/reports/jacoco/test/html/index.html`. jOOQ 코드젠/DTO/Exception 제외
- 현재 커버리지: Line ~81% / Class ~97%

## Local DB Access

```bash
# 컨테이너 이름: smart-workplace-db-1 (dev), smart-workplace-db-test-1 (test)
# 유저: app / 비번: app

# psql 접속
docker exec -it smart-workplace-db-1 psql -U app -d workplace

# "user" 는 예약어 — 반드시 큰따옴표
docker exec smart-workplace-db-1 psql -U app -d workplace -c 'SELECT * FROM "user";'
```

주의: `pnpm db:reset` 은 모든 데이터를 삭제. 데이터 보존이 필요한 경우 절대 사용 금지.

## Flyway Rules

- 마이그레이션 경로: `src/main/resources/db/migration/V{n}__*.sql`, 번호 순차 증가
- 적용은 `./gradlew bootRun` 이 자동 수행. 적용 후 `./gradlew generateJooq` 로 코드 재생성
- 머지된 마이그레이션 파일은 수정 금지 (checksum 변경 → 다른 환경 검증 실패). 정정은 V{n+1} 로
- `flyway_schema_history` 직접 INSERT/UPDATE 금지 (가짜 checksum → 부팅 시 validation 실패)
- `flyway clean`, `pnpm db:reset`, `baseline-version` 다운그레이드, `flyway repair`, `--no-verify` 는 사용자 명시 승인 후에만

## Key Conventions

- **한국어 주석 필수**: 클래스·메서드·주요 로직 (Javadoc/인라인). 상세는 루트 [코딩 컨벤션](../../docs/CODING_CONVENTION.md)
- 새 모듈은 기존 구조를 따름: `controller/service/repository + dto/exception`
- `@RequirePermission` 은 메서드/클래스 레벨 모두 지원
- Spotless(Google Java Format 1.34.1) — `./gradlew spotlessApply` 로 자동 포맷
