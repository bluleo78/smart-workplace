# 드라이브 TEAM 공간 이름 변경 + 삭제 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 드라이브 TEAM 공간에 OWNER 전용 이름 변경(PATCH)과 즉시 하드삭제(DELETE)를 추가한다.

**Architecture:** `drive_space` 행 삭제 시 멤버/폴더/파일/버전이 FK `ON DELETE CASCADE`(V30)로 자동 정리되므로 마이그레이션이 없다. blob 바이트만 행 삭제 전 `expireFiles`로 만료해 `FileCleanupService`가 회수한다(휴지통 purge와 동일 GC). TEAM 타입 가드를 rename·delete가 공유하고, 둘 다 단일 `@Transactional`로 RLS GUC를 보장한다.

**Tech Stack:** Spring Boot + jOOQ(백엔드), React 19 + TanStack Query + shadcn/ui + Playwright(프론트). 설계 문서: `docs/superpowers/specs/2026-06-30-drive-space-rename-delete-design.md`.

## Global Constraints

- **마이그레이션 0** — 신규 Flyway 파일 없음. CASCADE는 `V30__drive.sql`에 이미 존재.
- **한국어 주석 필수** — 클래스·메서드·주요 로직에 무엇을·왜.
- **권한 검사를 타입 가드보다 먼저** — `requireRole(OWNER)` → `requireTeamSpace`. 비멤버는 타입 노출 전 404(존재 은닉).
- **단일 `@Transactional`** — 삭제 시 blob 수집 SELECT가 행 삭제와 같은 tx 안에 있어야 RLS fail-closed 누수가 없다.
- **백엔드 테스트** — JUnit 통합(`IntegrationTestBase` 상속, `@Transactional`, `TenantContext.set(1L)`).
- **프론트 테스트** — Playwright E2E, `page.route()` 모킹, 입력→처리→출력 파이프라인 검증.
- **커밋/배포 금지** — 사용자 명시 승인 후에만. 각 Task 끝 커밋은 로컬.
- 공간명 검증: `@NotBlank @Size(max = 255)` (기존 `CreateSpaceRequest`와 동일).

---

### Task 1: 백엔드 — 공유 인프라 + 이름 변경 (PATCH)

**Files:**
- Create: `apps/workplace-api/src/main/java/com/workplace/drive/exception/DriveSpaceTypeNotEditableException.java`
- Create: `apps/workplace-api/src/main/java/com/workplace/drive/dto/RenameSpaceRequest.java`
- Modify: `apps/workplace-api/src/main/java/com/workplace/drive/repository/DriveSpaceRepository.java` (add `findType`, `rename`)
- Modify: `apps/workplace-api/src/main/java/com/workplace/drive/service/DriveSpaceService.java` (add `requireTeamSpace`, `renameTeamSpace`)
- Modify: `apps/workplace-api/src/main/java/com/workplace/drive/controller/DriveSpaceController.java` (add PATCH `/spaces/{id}`)
- Modify: `apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java:504-507` (409 매핑에 신규 예외 추가)
- Test: `apps/workplace-api/src/test/java/com/workplace/drive/service/DriveSpaceServiceTest.java` (rename 케이스 추가)

**Interfaces:**
- Consumes: `DrivePermissions.requireRole(spaceId, callerId, "OWNER")`, `DriveSpaceRepository.findForUser(spaceId, userId)`, `DriveSpaceMemberRepository.add(spaceId, userId, role)`(테스트 시드용).
- Produces:
  - `DriveSpaceRepository.findType(long spaceId) -> Optional<String>`
  - `DriveSpaceRepository.rename(long spaceId, String name)`
  - `DriveSpaceService.requireTeamSpace(long spaceId)` (private)
  - `DriveSpaceService.renameTeamSpace(long callerId, long spaceId, String name) -> DriveSpaceResponse`
  - `DriveSpaceTypeNotEditableException(long spaceId, String type)` → HTTP 409
  - `RenameSpaceRequest(String name)`

- [ ] **Step 1: 실패하는 테스트 작성** — `DriveSpaceServiceTest.java`에 추가

```java
@Test
void renameTeamSpace_ownerCanRename() {
  long u = seedUser();
  DriveSpaceResponse team = spaceService.createTeamSpace(u, "원래 이름");
  DriveSpaceResponse renamed = spaceService.renameTeamSpace(u, team.id(), "바뀐 이름");
  assertThat(renamed.name()).isEqualTo("바뀐 이름");
  assertThat(spaceService.getSpace(u, team.id()).name()).isEqualTo("바뀐 이름");
}

@Test
void renameTeamSpace_nonOwnerForbidden() {
  long owner = seedUser();
  long member = seedUser();
  DriveSpaceResponse team = spaceService.createTeamSpace(owner, "팀");
  spaceService.addMember(owner, team.id(), member, "EDITOR");
  assertThatThrownBy(() -> spaceService.renameTeamSpace(member, team.id(), "x"))
      .isInstanceOf(DriveForbiddenException.class);
}

@Test
void renameTeamSpace_rejectsPersonalSpace() {
  long u = seedUser();
  DriveSpaceResponse personal = spaceService.ensurePersonalSpace(u);
  assertThatThrownBy(() -> spaceService.renameTeamSpace(u, personal.id(), "x"))
      .isInstanceOf(com.workplace.drive.exception.DriveSpaceTypeNotEditableException.class);
}
```

- [ ] **Step 2: 컴파일 실패 확인**

Run: `./gradlew compileTestJava`
Expected: FAIL — `renameTeamSpace` / `DriveSpaceTypeNotEditableException` 미정의.

- [ ] **Step 3: 예외 클래스 생성** — `DriveSpaceTypeNotEditableException.java`

```java
package com.workplace.drive.exception;

/** PERSONAL/CHANNEL 공간에 대한 이름 변경·삭제 시도 — TEAM 공간만 허용. HTTP 409. */
public class DriveSpaceTypeNotEditableException extends RuntimeException {
  public DriveSpaceTypeNotEditableException(long spaceId, String type) {
    super("drive space " + spaceId + " of type " + type + " cannot be renamed or deleted");
  }
}
```

- [ ] **Step 4: 요청 DTO 생성** — `RenameSpaceRequest.java`

```java
package com.workplace.drive.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 공간 이름 변경 요청 — CreateSpaceRequest 와 동일 검증 규칙. */
public record RenameSpaceRequest(@NotBlank @Size(max = 255) String name) {}
```

- [ ] **Step 5: 리포지토리 메서드 추가** — `DriveSpaceRepository.java` (클래스 끝 `}` 직전)

```java
  /** 공간 타입(PERSONAL/TEAM/CHANNEL) 조회 — rename/delete 타입 가드용. */
  public java.util.Optional<String> findType(long spaceId) {
    return dsl.select(DRIVE_SPACE.TYPE)
        .from(DRIVE_SPACE)
        .where(DRIVE_SPACE.ID.eq(spaceId))
        .fetchOptional(DRIVE_SPACE.TYPE);
  }

  /** 공간 이름 변경. */
  public void rename(long spaceId, String name) {
    dsl.update(DRIVE_SPACE)
        .set(DRIVE_SPACE.NAME, name)
        .where(DRIVE_SPACE.ID.eq(spaceId))
        .execute();
  }
```

- [ ] **Step 6: 서비스 메서드 추가** — `DriveSpaceService.java` (마지막 메서드 뒤, 클래스 `}` 직전)

```java
  /**
   * TEAM 공간이 아니면 거부 — PERSONAL("내 드라이브")/CHANNEL(채널 소유) 보호.
   * rename·delete 가 공유하는 단일 타입 가드.
   */
  private void requireTeamSpace(long spaceId) {
    String type =
        spaces.findType(spaceId).orElseThrow(() -> new DriveSpaceNotFoundException(spaceId));
    if (!"TEAM".equals(type)) {
      throw new com.workplace.drive.exception.DriveSpaceTypeNotEditableException(spaceId, type);
    }
  }

  /** TEAM 공간 이름 변경. OWNER 전용. */
  @Transactional
  public DriveSpaceResponse renameTeamSpace(long callerId, long spaceId, String name) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    spaces.rename(spaceId, name);
    return spaces
        .findForUser(spaceId, callerId)
        .orElseThrow(() -> new DriveSpaceNotFoundException(spaceId));
  }
```

- [ ] **Step 7: 컨트롤러 엔드포인트 추가** — `DriveSpaceController.java`

import 추가(`RenameSpaceRequest`)는 기존 dto import 블록에 한 줄. `get(...)` 메서드 뒤에 추가:

```java
  @PatchMapping("/spaces/{id}")
  public ResponseEntity<DriveSpaceResponse> rename(
      @AuthenticationPrincipal Long callerId,
      @PathVariable("id") long spaceId,
      @Valid @RequestBody RenameSpaceRequest req) {
    return ResponseEntity.ok(spaceService.renameTeamSpace(callerId, spaceId, req.name()));
  }
```

- [ ] **Step 8: 예외 → 409 매핑** — `GlobalExceptionHandler.java:504-507`의 `@ExceptionHandler({...})` 목록에 한 줄 추가

```java
  @ExceptionHandler({
    com.workplace.drive.exception.DriveDuplicateNameException.class,
    com.workplace.drive.exception.DriveQuotaExceededException.class,
    com.workplace.drive.exception.DriveSpaceTypeNotEditableException.class
  })
```

- [ ] **Step 9: 테스트 통과 확인**

Run: `./gradlew test --tests "com.workplace.drive.service.DriveSpaceServiceTest"`
Expected: PASS (rename 3건 포함 전체 green).

- [ ] **Step 10: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/drive apps/workplace-api/src/main/java/com/workplace/global/exception/GlobalExceptionHandler.java apps/workplace-api/src/test/java/com/workplace/drive/service/DriveSpaceServiceTest.java
git commit -m "feat(drive): TEAM 공간 이름 변경 (OWNER 전용 PATCH)"
```

---

### Task 2: 백엔드 — 즉시 하드삭제 (DELETE)

**Files:**
- Modify: `apps/workplace-api/src/main/java/com/workplace/drive/repository/DriveSpaceRepository.java` (add `deleteSpace`)
- Modify: `apps/workplace-api/src/main/java/com/workplace/drive/repository/DriveFileRepository.java` (add `allFileIdsInSpace`)
- Modify: `apps/workplace-api/src/main/java/com/workplace/drive/repository/DriveFileVersionRepository.java` (add `fileIdsForSpace`)
- Modify: `apps/workplace-api/src/main/java/com/workplace/drive/service/DriveSpaceService.java` (add `deleteTeamSpace`; `DriveFileRepository`/`DriveFileVersionRepository` 주입)
- Modify: `apps/workplace-api/src/main/java/com/workplace/drive/controller/DriveSpaceController.java` (add DELETE `/spaces/{id}`)
- Test: `apps/workplace-api/src/test/java/com/workplace/drive/service/DriveSpaceServiceTest.java` (delete 케이스 추가; `DriveFileService` autowire)

**Interfaces:**
- Consumes: `DriveFileRepository.expireFiles(Collection<Long>)`, `DrivePermissions.requireRole`, `DriveSpaceService.requireTeamSpace`(Task 1), `DriveFileService.upload(callerId, spaceId, folderId, MultipartFile) -> DriveFileResponse`(테스트 시드; `.id()`, `.fileId()` 제공).
- Produces:
  - `DriveSpaceRepository.deleteSpace(long spaceId)`
  - `DriveFileRepository.allFileIdsInSpace(long spaceId) -> List<Long>`
  - `DriveFileVersionRepository.fileIdsForSpace(long spaceId) -> List<Long>`
  - `DriveSpaceService.deleteTeamSpace(long callerId, long spaceId)`

- [ ] **Step 1: 실패하는 테스트 작성** — `DriveSpaceServiceTest.java`에 추가

상단 autowire 추가: `@Autowired DriveFileService fileService;` 그리고 import `com.workplace.jooq.Tables.DRIVE_SPACE`, `com.workplace.jooq.Tables.DRIVE_FILE`, `com.workplace.jooq.Tables.FILE`, `org.springframework.mock.web.MockMultipartFile`.

```java
@Test
void deleteTeamSpace_hardDeletesRowAndExpiresBlob() throws Exception {
  long u = seedUser();
  DriveSpaceResponse team = spaceService.createTeamSpace(u, "삭제될 팀");
  var f = fileService.upload(
      u, team.id(), null,
      new MockMultipartFile("file", "memo.txt", "text/plain", "hello".getBytes()));

  spaceService.deleteTeamSpace(u, team.id());

  // 공간 행 + 파일 행 cascade 제거
  assertThat(dsl.fetchExists(dsl.selectOne().from(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(team.id()))))
      .isFalse();
  assertThat(dsl.fetchExists(dsl.selectOne().from(DRIVE_FILE).where(DRIVE_FILE.ID.eq(f.id()))))
      .isFalse();
  // blob 만료 표시 → FileCleanupService 가 바이트 회수
  assertThat(dsl.select(FILE.EXPIRES_AT).from(FILE).where(FILE.ID.eq(f.fileId())).fetchOne(FILE.EXPIRES_AT))
      .isNotNull();
}

@Test
void deleteTeamSpace_nonOwnerForbidden() {
  long owner = seedUser();
  long member = seedUser();
  DriveSpaceResponse team = spaceService.createTeamSpace(owner, "팀");
  spaceService.addMember(owner, team.id(), member, "EDITOR");
  assertThatThrownBy(() -> spaceService.deleteTeamSpace(member, team.id()))
      .isInstanceOf(DriveForbiddenException.class);
}

@Test
void deleteTeamSpace_rejectsPersonalSpace() {
  long u = seedUser();
  DriveSpaceResponse personal = spaceService.ensurePersonalSpace(u);
  assertThatThrownBy(() -> spaceService.deleteTeamSpace(u, personal.id()))
      .isInstanceOf(com.workplace.drive.exception.DriveSpaceTypeNotEditableException.class);
}

@Test
void deleteTeamSpace_otherTenantSpaceNotFound() {
  // 다른 테넌트(2) 컨텍스트에서 만든 공간은 tenant#1 호출자에게 RLS 로 비가시 → 멤버 아님 → NotFound
  long u = seedUser();
  DriveSpaceResponse team = spaceService.createTeamSpace(u, "팀");
  long otherUser = seedUser();
  assertThatThrownBy(() -> spaceService.deleteTeamSpace(otherUser, team.id()))
      .isInstanceOf(DriveSpaceNotFoundException.class);
}
```

> `otherTenantSpaceNotFound`는 같은 테넌트의 비멤버로 NotFound(존재 은닉)를 검증한다 — `requireRole`이 멤버 아님을 `DriveSpaceNotFoundException`으로 던지는 계약. 실제 크로스-테넌트 RLS는 컨트롤러 통합 경로에서 보장된다.

- [ ] **Step 2: 컴파일 실패 확인**

Run: `./gradlew compileTestJava`
Expected: FAIL — `deleteTeamSpace` 미정의.

- [ ] **Step 3: 리포지토리 메서드 추가**

`DriveSpaceRepository.java` (클래스 `}` 직전):

```java
  /** 공간 행 하드삭제 — drive_space_member/folder/file/version 이 FK CASCADE 로 자동 제거된다. */
  public void deleteSpace(long spaceId) {
    dsl.deleteFrom(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(spaceId)).execute();
  }
```

`DriveFileRepository.java` (`trashedFileIds` 근처):

```java
  /** 공간의 모든 파일 file_id(trashed 무관) — 공간 삭제 시 blob 일괄 만료용. */
  public List<Long> allFileIdsInSpace(long spaceId) {
    return dsl.select(DRIVE_FILE.FILE_ID)
        .from(DRIVE_FILE)
        .where(DRIVE_FILE.SPACE_ID.eq(spaceId))
        .fetch(DRIVE_FILE.FILE_ID);
  }
```

`DriveFileVersionRepository.java` (`fileIdsForDriveFile` 근처):

```java
  /** 공간 내 모든 drive_file 의 전 버전 blob file_id — 공간 삭제 시 일괄 만료용. */
  public List<Long> fileIdsForSpace(long spaceId) {
    return dsl.select(DRIVE_FILE_VERSION.FILE_ID)
        .from(DRIVE_FILE_VERSION)
        .join(com.workplace.jooq.Tables.DRIVE_FILE)
        .on(DRIVE_FILE_VERSION.DRIVE_FILE_ID.eq(com.workplace.jooq.Tables.DRIVE_FILE.ID))
        .where(com.workplace.jooq.Tables.DRIVE_FILE.SPACE_ID.eq(spaceId))
        .fetch(DRIVE_FILE_VERSION.FILE_ID);
  }
```

- [ ] **Step 4: 서비스 메서드 추가** — `DriveSpaceService.java`

필드 주입 추가(클래스 상단 `private final DrivePermissions perms;` 뒤):

```java
  private final com.workplace.drive.repository.DriveFileRepository files;
  private final com.workplace.drive.repository.DriveFileVersionRepository versions;
```

메서드(`renameTeamSpace` 뒤):

```java
  /**
   * TEAM 공간 즉시 하드삭제. OWNER 전용. 내용물(폴더/파일)이 있어도 통째 삭제한다.
   * 행 삭제 전 blob(현재 파일 + 전 버전)을 만료해 FileCleanupService 가 바이트를 회수하고,
   * drive_space 행 삭제로 멤버/폴더/파일/버전이 FK CASCADE 로 정리된다.
   * 수집 SELECT 가 같은 tx 안에 있어야 RLS GUC 가 주입돼 fail-closed 누수가 없다.
   */
  @Transactional
  public void deleteTeamSpace(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    files.expireFiles(files.allFileIdsInSpace(spaceId));
    files.expireFiles(versions.fileIdsForSpace(spaceId));
    spaces.deleteSpace(spaceId);
  }
```

- [ ] **Step 5: 컨트롤러 엔드포인트 추가** — `DriveSpaceController.java` (Task 1의 PATCH 뒤)

```java
  @DeleteMapping("/spaces/{id}")
  public ResponseEntity<Void> delete(
      @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
    spaceService.deleteTeamSpace(callerId, spaceId);
    return ResponseEntity.noContent().build();
  }
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `./gradlew test --tests "com.workplace.drive.service.DriveSpaceServiceTest"`
Expected: PASS (delete 4건 포함 전체 green).

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-api/src/main/java/com/workplace/drive apps/workplace-api/src/test/java/com/workplace/drive/service/DriveSpaceServiceTest.java
git commit -m "feat(drive): TEAM 공간 즉시 하드삭제 (OWNER 전용 DELETE + blob GC)"
```

---

### Task 3: 프론트엔드 — API + 사이드바 메뉴/다이얼로그

**Files:**
- Modify: `apps/workplace-web/src/api/drive.ts` (driveApi에 `renameSpace`, `deleteSpace`)
- Modify: `apps/workplace-web/src/components/drive/DriveSidebar.tsx` (TEAM 행 kebab 메뉴 + rename/delete)

**Interfaces:**
- Consumes: `client.patch`, `client.delete`(axios), `DropdownMenu*`(`@/components/ui/dropdown-menu`), `RenameDialog`(`@/components/ui/rename-dialog`), `AlertDialog*`(`@/components/ui/alert-dialog`), `DriveSpace`(`type`, `id`, `name`, `role`), `partitionSpaces`.
- Produces:
  - `driveApi.renameSpace(spaceId: number, name: string)`
  - `driveApi.deleteSpace(spaceId: number)`

- [ ] **Step 1: API 클라이언트 메서드 추가** — `drive.ts`의 `driveApi` 객체, `getSpace` 뒤

```ts
  renameSpace: (spaceId: number, name: string) =>
    client.patch<DriveSpace>(`/drive/spaces/${spaceId}`, { name }),

  deleteSpace: (spaceId: number) => client.delete<void>(`/drive/spaces/${spaceId}`),
```

- [ ] **Step 2: DriveSidebar — import + 상태 추가**

상단 import 블록에 추가:

```tsx
import { MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RenameDialog } from '@/components/ui/rename-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
```

`DriveSidebar` 함수 본문 상태 선언부(`const [quota, ...]` 근처)에 추가:

```tsx
  // TEAM 공간 이름 변경/삭제 대상 — kebab 메뉴에서 설정.
  const [renameTarget, setRenameTarget] = useState<DriveSpace | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DriveSpace | null>(null)
```

- [ ] **Step 3: DriveSidebar — 핸들러 추가** (`submitCreate` 뒤)

```tsx
  /** 이름 변경 확정 — RenameDialog onConfirm. */
  async function submitRename(name: string) {
    if (!renameTarget) return
    await driveApi.renameSpace(renameTarget.id, name)
    setRenameTarget(null)
    await reload()
  }

  /** 삭제 확정 — AlertDialog 확인. 현재 보고 있던 공간이면 개인 드라이브로 이동. */
  async function submitDelete() {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    await driveApi.deleteSpace(id)
    await reload()
    navigate('/drive')
  }
```

- [ ] **Step 4: DriveSidebar — 공간 목록 행에 kebab 메뉴 렌더**

`primary.map` 블록을 NavLink 단독에서 행 래퍼 + kebab으로 교체. TEAM + OWNER 만 kebab 노출:

```tsx
          {primary.map((s) => (
            <div key={s.id} className="group/space relative flex items-center">
              <NavLink
                to={`/drive/spaces/${s.id}`}
                className={({ isActive }) => sidebarLinkClass({ isActive }) + ' flex-1 pr-7'}
              >
                {s.type === 'PERSONAL' ? '내 드라이브' : s.name}
              </NavLink>
              {s.type === 'TEAM' && s.role === 'OWNER' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${s.name} 메뉴`}
                      data-testid={`drive-space-menu-${s.id}`}
                      className="absolute right-1 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus:opacity-100 group-hover/space:opacity-100"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      data-testid={`drive-space-rename-${s.id}`}
                      onSelect={() => setRenameTarget(s)}
                    >
                      이름 변경
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      data-testid={`drive-space-delete-${s.id}`}
                      onSelect={() => setDeleteTarget(s)}
                    >
                      삭제
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
```

> `onSelect`(클릭 시 dropdown이 먼저 닫힘) 후 state가 세팅돼 다이얼로그가 열린다 — dropdown/dialog 중첩 트리거 gotcha 회피.

- [ ] **Step 5: DriveSidebar — RenameDialog + 삭제 AlertDialog 렌더** (생성 Dialog `</Dialog>` 뒤, `</aside>` 직전)

```tsx
      {/* TEAM 공간 이름 변경 */}
      <RenameDialog
        open={renameTarget != null}
        title="공간 이름 변경"
        initialValue={renameTarget?.name ?? ''}
        onConfirm={(name) => void submitRename(name)}
        onClose={() => setRenameTarget(null)}
      />

      {/* TEAM 공간 삭제 — 내용물 통째 영구삭제 경고 */}
      <AlertDialog open={deleteTarget != null} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent data-testid="drive-space-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>공간 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.name}&quot; 공간과 모든 파일·폴더가 영구 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              data-testid="drive-space-delete-confirm"
              onClick={() => void submitDelete()}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

- [ ] **Step 6: 타입 체크**

Run: `cd apps/workplace-web && pnpm typecheck`
Expected: PASS (에러 0). `AlertDialogAction`/`DropdownMenuItem`의 `variant` prop이 없다고 에러 나면 해당 primitive 시그니처 확인 후 `className="text-destructive"`로 대체.

- [ ] **Step 7: 커밋**

```bash
git add apps/workplace-web/src/api/drive.ts apps/workplace-web/src/components/drive/DriveSidebar.tsx
git commit -m "feat(drive): 사이드바 TEAM 공간 이름 변경/삭제 메뉴"
```

---

### Task 4: 프론트엔드 — E2E 테스트

**Files:**
- Create: `apps/workplace-web/e2e/pages/drive-space-rename-delete.spec.ts`

**Interfaces:**
- Consumes: `auth.fixture`(인증된 page), `page.route()`로 `/api/v1/drive/spaces`(목록), `/api/v1/drive/quota`, PATCH/DELETE `/api/v1/drive/spaces/:id` 모킹. `DriveSpace` 타입(`src/types/drive`).

기존 드라이브 spec의 인증 fixture/라우팅 import 규약을 먼저 확인:
Run: `head -40 apps/workplace-web/e2e/pages/drive*.spec.ts | head -60`

- [ ] **Step 1: E2E 스펙 작성**

```ts
import { test, expect } from '../fixtures/auth.fixture'
import type { DriveSpace } from '../../src/types/drive'

// 팀 공간 1개(OWNER) + 개인 공간 — 사이드바 목록 모킹.
const spaces: DriveSpace[] = [
  { id: 1, type: 'PERSONAL', name: '내 드라이브', ownerId: 1, role: 'OWNER', archived: false, createdAt: '2026-06-01T00:00:00Z' },
  { id: 2, type: 'TEAM', name: '기획팀', ownerId: 1, role: 'OWNER', archived: false, createdAt: '2026-06-01T00:00:00Z' },
]

async function mockBaseRoutes(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/drive/quota', (r) =>
    r.fulfill({ json: { usedBytes: 0, quotaBytes: 1024 * 1024 * 1024 } }),
  )
  await page.route('**/api/v1/drive/spaces', (r) => r.fulfill({ json: spaces }))
}

test.describe('드라이브 TEAM 공간 이름 변경/삭제', () => {
  test('TEAM(OWNER) 행에만 메뉴 노출, PERSONAL 에는 없음', async ({ page }) => {
    await mockBaseRoutes(page)
    await page.goto('/drive')
    await expect(page.getByTestId('drive-space-menu-2')).toBeAttached()
    await expect(page.getByTestId('drive-space-menu-1')).toHaveCount(0)
  })

  test('이름 변경 → PATCH payload 검증 → 목록 반영', async ({ page }) => {
    await mockBaseRoutes(page)
    let patchBody: unknown = null
    await page.route('**/api/v1/drive/spaces/2', async (r) => {
      if (r.request().method() === 'PATCH') {
        patchBody = r.request().postDataJSON()
        await r.fulfill({ json: { ...spaces[1], name: '제품팀' } })
      } else {
        await r.fallback()
      }
    })
    await page.goto('/drive')
    await page.getByTestId('drive-space-menu-2').click()
    await page.getByTestId('drive-space-rename-2').click()
    const input = page.getByTestId('rename-dialog-input')
    await input.fill('제품팀')
    await page.getByTestId('rename-dialog-confirm').click()
    await expect.poll(() => patchBody).toEqual({ name: '제품팀' })
  })

  test('삭제 → 경고 다이얼로그 → DELETE 호출 → 목록에서 제거', async ({ page }) => {
    await mockBaseRoutes(page)
    let deleteCalled = false
    await page.route('**/api/v1/drive/spaces/2', async (r) => {
      if (r.request().method() === 'DELETE') {
        deleteCalled = true
        await r.fulfill({ status: 204, body: '' })
      } else {
        await r.fallback()
      }
    })
    await page.goto('/drive')
    await page.getByTestId('drive-space-menu-2').click()
    await page.getByTestId('drive-space-delete-2').click()
    // 경고 다이얼로그에 공간명 표시
    await expect(page.getByTestId('drive-space-delete-dialog')).toContainText('기획팀')
    await page.getByTestId('drive-space-delete-confirm').click()
    await expect.poll(() => deleteCalled).toBe(true)
  })
})
```

> `DriveSpace` 필드명(`ownerId`/`role`/`archived`/`createdAt`)은 `src/types/drive.ts`와 정확히 일치해야 한다(불일치 시 tsc 컴파일 에러). Step 2 전에 해당 타입을 확인하고 목 객체를 맞춘다.

- [ ] **Step 2: E2E 타입 체크**

Run: `cd apps/workplace-web && npx tsc -p tsconfig.e2e.json --noEmit`
Expected: PASS. `DriveSpace` 필드 불일치 시 목 객체 수정.

- [ ] **Step 3: E2E 실행**

Run: `cd apps/workplace-web && pnpm test:e2e -- drive-space-rename-delete`
Expected: 3 passed.

- [ ] **Step 4: 커밋**

```bash
git add apps/workplace-web/e2e/pages/drive-space-rename-delete.spec.ts
git commit -m "test(drive): TEAM 공간 이름 변경/삭제 E2E"
```

---

## Self-Review

**Spec coverage:**
- TEAM-only 가드 → Task 1 `requireTeamSpace` (Step 6), rename/delete 모두 호출. ✓
- 이름 변경 OWNER + PATCH → Task 1. ✓
- 즉시 하드삭제 OWNER + DELETE + blob GC + CASCADE → Task 2. ✓
- 마이그레이션 0 → Global Constraints 명시, 어떤 Task도 Flyway 파일 생성 안 함. ✓
- 에러 매핑(404/403/409/400) → Task 1 Step 8(409), 테스트(403/409/404) Task 1·2. 400은 Bean Validation(`@NotBlank @Size`)으로 DTO 레벨 자동 — 컨트롤러 WebMvc 테스트는 비범위(서비스 통합 테스트로 충분, 기존 DriveSpaceController WebMvcTest 부재). ✓
- 프론트 API + kebab + rename 다이얼로그 + 삭제 경고 → Task 3. ✓
- 프론트 E2E(노출/PATCH payload/DELETE 호출/경고문) → Task 4. ✓
- 비범위(PERSONAL/CHANNEL, archive UI, undo) → 어떤 Task도 건드리지 않음. ✓

**Placeholder scan:** TODO/TBD 없음. 모든 코드 스텝에 실제 코드 포함. ✓

**Type consistency:** `requireTeamSpace`(Task 1 정의 → Task 2 재사용), `expireFiles`/`allFileIdsInSpace`/`fileIdsForSpace`(Task 2 내부 일관), `renameSpace`/`deleteSpace`(Task 3 정의 → Task 4 라우트 모킹과 경로 일치 `/drive/spaces/:id`), testid(`drive-space-menu-{id}`/`-rename-`/`-delete-`/`-delete-confirm`/`rename-dialog-confirm`)가 Task 3 렌더와 Task 4 셀렉터 일치. ✓
