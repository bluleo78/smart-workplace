# 드라이브 TEAM 공간 이름 변경 + 삭제

작성일: 2026-06-30

## 배경 / 문제

드라이브 공간은 생성(`POST /drive/spaces`)만 가능하고 **이름 변경·삭제 기능이 전 계층에 부재**하다. 팀 공간을 잘못 만들거나 이름을 바꾸고 싶어도, 더 이상 쓰지 않는 공간을 정리하고 싶어도 방법이 없다.

## 목표

TEAM 타입 공간에 한해 **이름 변경**과 **즉시 하드삭제**를 추가한다.

## 설계 결정 (확정)

| 항목 | 결정 | 근거 |
|------|------|------|
| 범위 | **TEAM 공간만** | PERSONAL("내 드라이브")은 시스템 고정·유저당 1개, CHANNEL은 채널 소유·연동 — 둘 다 드라이브에서 직접 변경/삭제 대상이 아니다 |
| 삭제 방식 | **즉시 하드삭제**(복구 없음) | 폴더/파일/버전/blob 통째 제거. 휴지통/2단계 비동기 purge 미도입 |
| 권한 | 이름 변경·삭제 **둘 다 OWNER** | 멤버 관리(addMember/removeMember)와 동일 수준 |
| 내용물 있는 공간 | **경고 후 통째 삭제 허용** | 프론트가 명시적 경고 표시. 비어있어야 한다는 제약 없음 |

## 비범위 (YAGNI)

- PERSONAL/CHANNEL 공간의 이름 변경·삭제
- 공간 보관(archive) 토글 UI 노출 — 컬럼은 있으나 사용자 도달 경로 없음
- 삭제 취소(undo), 휴지통 경유, 2단계 비동기 purge
- 삭제 전 "비어있음" 강제

---

## 아키텍처

### 데이터 모델 (변경 없음 — 마이그레이션 0)

`V30__drive.sql` 의 FK가 이미 정리를 보장한다:

```
drive_space_member.space_id → drive_space(id) ON DELETE CASCADE
drive_folder.space_id       → drive_space(id) ON DELETE CASCADE
drive_file.space_id         → drive_space(id) ON DELETE CASCADE
drive_file_version          → drive_file       ON DELETE CASCADE
```

따라서 `drive_space` 행 1건 삭제 시 멤버·폴더·파일·버전이 DB 레벨에서 자동 cascade 제거된다. **신규 마이그레이션 불필요.**

단, **blob 바이트(file core)는 cascade 대상이 아니다.** 행 삭제 전에 참조하는 모든 `file.id` 를 만료 처리(`expireFiles`)해 `FileCleanupService` 가 디스크 바이트를 회수하도록 해야 한다 — 휴지통 영구삭제(`DriveTrashService.purgeFolder/emptyTrash`)와 동일한 reference-counting GC 패턴.

---

## 백엔드 (`apps/workplace-api`)

### 1. 타입 가드 (linchpin)

이름 변경·삭제가 공유하는 단일 가드. `DriveSpaceService` 에 추가:

```java
// TEAM 공간이 아니면 거부 — PERSONAL/CHANNEL 보호. rename·delete 공유.
private void requireTeamSpace(long spaceId) {
  String type = spaces.findType(spaceId)
      .orElseThrow(() -> new DriveSpaceNotFoundException(spaceId));
  if (!"TEAM".equals(type)) {
    throw new DriveSpaceTypeNotEditableException(spaceId, type); // → 409
  }
}
```

신규 예외 `DriveSpaceTypeNotEditableException` → `GlobalExceptionHandler`(또는 드라이브 핸들러)에서 **409 Conflict** 매핑.

> 권한 검사(`requireRole`)를 타입 가드보다 **먼저** 호출한다. 멤버가 아니면 타입을 노출하기 전에 NotFound(존재 은닉)로 끝나야 일관된다.

### 2. 이름 변경 — `PATCH /api/v1/drive/spaces/{id}`

- 요청 DTO: `RenameSpaceRequest(@NotBlank @Size(max = 255) String name)` (CreateSpaceRequest 와 동일 규칙)
- 서비스:
  ```java
  @Transactional
  public DriveSpaceResponse renameTeamSpace(long callerId, long spaceId, String name) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    spaces.rename(spaceId, name);
    return spaces.findForUser(spaceId, callerId)
        .orElseThrow(() -> new DriveSpaceNotFoundException(spaceId));
  }
  ```
- 응답: 갱신된 `DriveSpaceResponse` (200)

### 3. 삭제 — `DELETE /api/v1/drive/spaces/{id}`

- 서비스:
  ```java
  @Transactional
  public void deleteTeamSpace(long callerId, long spaceId) {
    perms.requireRole(spaceId, callerId, "OWNER");
    requireTeamSpace(spaceId);
    // blob 만료: 공간 내 현재 파일 + 전 버전의 file_id 모두 (FileCleanupService 가 바이트 회수)
    files.expireFiles(files.allFileIdsInSpace(spaceId));
    files.expireFiles(versions.fileIdsForSpace(spaceId));
    spaces.deleteSpace(spaceId); // CASCADE: member/folder/file/version 자동 제거
  }
  ```
- **단일 `@Transactional`** — 수집 SELECT(`allFileIdsInSpace`/`fileIdsForSpace`)가 같은 tx 안에 있어야 RLS GUC 가 주입돼 fail-closed 누수가 없다(이 코드베이스의 반복 함정).
- 응답: 204 No Content

### 4. 신규 Repository 메서드

`DriveSpaceRepository`:
```java
Optional<String> findType(long spaceId);              // SELECT type
void rename(long spaceId, String name);               // UPDATE name
void deleteSpace(long spaceId);                        // DELETE row (CASCADE)
```

`DriveFileRepository`:
```java
List<Long> allFileIdsInSpace(long spaceId);           // SELECT file_id WHERE space_id (trashed 무관 전체)
```

`DriveFileVersionRepository`:
```java
List<Long> fileIdsForSpace(long spaceId);             // JOIN drive_file ON drive_file_id, WHERE space_id
```

### 5. 컨트롤러 (`DriveSpaceController`)

기존 `PatchMapping/DeleteMapping` 은 `/spaces/{id}/members/{userId}` 만 대상. 공간 자체 대상으로 신규 추가:

```java
@PatchMapping("/spaces/{id}")
public ResponseEntity<DriveSpaceResponse> rename(
    @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId,
    @Valid @RequestBody RenameSpaceRequest req) {
  return ResponseEntity.ok(spaceService.renameTeamSpace(callerId, spaceId, req.name()));
}

@DeleteMapping("/spaces/{id}")
public ResponseEntity<Void> delete(
    @AuthenticationPrincipal Long callerId, @PathVariable("id") long spaceId) {
  spaceService.deleteTeamSpace(callerId, spaceId);
  return ResponseEntity.noContent().build();
}
```

### 에러 처리

| 상황 | 응답 |
|------|------|
| 멤버 아님 | 404 (`DriveSpaceNotFoundException`, 존재 은닉) |
| 멤버지만 OWNER 미만 | 403 (`DriveForbiddenException`) |
| PERSONAL/CHANNEL 대상 | 409 (`DriveSpaceTypeNotEditableException`) |
| 이름 빈값/255 초과 | 400 (Bean Validation) |
| 다른 테넌트 공간 | 404 (RLS — 행 비가시) |

---

## 프론트엔드 (`apps/workplace-web`)

### 1. API 클라이언트 (`api/drive.ts`)

```ts
renameSpace: (spaceId: number, name: string) =>
  client.patch<DriveSpace>(`/drive/spaces/${spaceId}`, { name }),

deleteSpace: (spaceId: number) =>
  client.delete<void>(`/drive/spaces/${spaceId}`),
```

### 2. UI (`DriveSidebar`)

TEAM 공간 행에 hover 시 노출되는 kebab(⋯) `DropdownMenu` 추가:

- **이름 변경** → 기존 생성 다이얼로그(`space-name-dialog`)와 동일 패턴의 rename 다이얼로그. 현재 이름 prefill. 확인 시 `renameSpace` → `reload()`.
- **삭제** → `AlertDialog` 확인 다이얼로그.
  - 경고문: "이 공간과 **모든 파일·폴더가 영구 삭제**됩니다. 되돌릴 수 없습니다." + 공간명 표시.
  - 확인 시 `deleteSpace` → 현재 보고 있던 공간이면 다른 공간(또는 개인 드라이브)으로 navigate → `reload()`.

렌더 조건:
- kebab 은 `s.type === 'TEAM'` 행에만 (PERSONAL 제외). CHANNEL 은 사이드바에 애초에 없음.
- OWNER 만 동작 가능. `DriveSpace.role` 이 목록 응답에 포함되므로 `s.role === 'OWNER'` 일 때만 kebab 렌더(미달 시 메뉴 자체 숨김). 서버는 403 으로 최종 방어.

> shadcn `dropdown-menu`, `alert-dialog` primitive 가 없으면 `npx shadcn` 으로 추가.

### 디자인 시스템

`docs/design-system/` 준수 — 시맨틱 토큰만, hex 금지. 파괴적 액션(삭제)은 `destructive` 변형 버튼.

---

## 테스트

### 백엔드 (JUnit 통합, `IntegrationTestBase`)

이름 변경:
- happy: OWNER 가 TEAM 공간 이름 변경 → 200 + 응답 name 반영 + DB 확인
- 권한 거부: EDITOR/VIEWER → 403
- 타입 거부: PERSONAL·CHANNEL → 409
- 검증: 빈 이름 → 400

삭제:
- happy(내용물 포함): 폴더+파일 있는 TEAM 공간 삭제 → 204, drive_space 행 제거 + 폴더/파일/멤버 cascade 제거 + 해당 file.id 가 expires_at 설정됨(blob GC 트리거) 확인
- 권한 거부: EDITOR/VIEWER → 403
- 타입 거부: PERSONAL·CHANNEL → 409
- RLS 격리: 다른 테넌트 공간 → 404

### 프론트엔드 (Playwright E2E)

입력 → 처리 → 출력 파이프라인 검증:
- kebab 노출: TEAM(OWNER) 행에만 메뉴 버튼 존재, PERSONAL 행엔 없음
- 이름 변경: 메뉴 → 다이얼로그 → 입력 → **PATCH payload `{name}` 검증** → 목록에 새 이름 반영
- 삭제: 메뉴 → AlertDialog 경고문·공간명 표시 → 확인 → **DELETE 호출 검증** → navigate + 목록에서 제거
- 권한: role !== OWNER 인 공간엔 kebab 미노출

---

## 작업 순서

1. 백엔드 repo 메서드(findType/rename/deleteSpace/allFileIdsInSpace/fileIdsForSpace) + 예외
2. 백엔드 서비스(requireTeamSpace/renameTeamSpace/deleteTeamSpace) + 컨트롤러 + DTO
3. 백엔드 통합 테스트 (green)
4. 프론트 API + DriveSidebar kebab/다이얼로그/AlertDialog
5. 프론트 E2E (green)
