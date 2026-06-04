package com.workplace.drive.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class DriveTrashServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService fileService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveTrashService trashService;

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "tr_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Tr" + s)
        .set(USER.EMAIL, "tr_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private MockMultipartFile txt() {
    return new MockMultipartFile("file", "memo.txt", "text/plain", "hello".getBytes());
  }

  /** 폴더 복원 → 하위까지 통째 복귀(브라우즈 재등장). */
  @Test
  void restore_folder_bringsBackSubtree() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var folder = folderService.create(u, sp.id(), null, "보고서");
    fileService.upload(u, sp.id(), folder.id(), txt());
    folderService.delete(u, folder.id());

    trashService.restoreFolder(u, folder.id());

    assertThat(folderService.listItems(u, sp.id(), null).folders())
        .anyMatch(f -> f.id() == folder.id());
    assertThat(folderService.listItems(u, sp.id(), folder.id()).files()).hasSize(1);
    assertThat(trashService.listTrash(u, sp.id()).items()).isEmpty();
  }

  /** 중첩 독립삭제: 파일X 삭제 → 부모 삭제 → 부모 복원 시 X 는 여전히 휴지통. */
  @Test
  void restore_folder_keepsIndependentlyTrashedChild() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var parent = folderService.create(u, sp.id(), null, "부모");
    DriveFileResponse x = fileService.upload(u, sp.id(), parent.id(), txt());
    fileService.delete(u, x.id()); // op1
    folderService.delete(u, parent.id()); // op2

    trashService.restoreFolder(u, parent.id()); // op2 만 복원

    assertThat(folderService.listItems(u, sp.id(), null).folders())
        .anyMatch(f -> f.id() == parent.id());
    var xTrashed =
        dsl.select(com.workplace.jooq.Tables.DRIVE_FILE.TRASHED_AT)
            .from(com.workplace.jooq.Tables.DRIVE_FILE)
            .where(com.workplace.jooq.Tables.DRIVE_FILE.ID.eq(x.id()))
            .fetchOne(com.workplace.jooq.Tables.DRIVE_FILE.TRASHED_AT);
    assertThat(xTrashed).isNotNull();
  }

  /** 원래 부모가 사라지면 루트로 복원. */
  @Test
  void restore_file_toRoot_whenOriginalFolderGone() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var folder = folderService.create(u, sp.id(), null, "임시");
    DriveFileResponse f = fileService.upload(u, sp.id(), folder.id(), txt());
    fileService.delete(u, f.id()); // 파일만 휴지통
    folderService.delete(u, folder.id()); // 원래 폴더도 휴지통(=사라짐)

    trashService.restoreFile(u, f.id());

    assertThat(folderService.listItems(u, sp.id(), null).files()).anyMatch(x -> x.id() == f.id());
  }

  /** 개별 영구삭제 — 행 하드삭제 + blob 만료(expires_at 세팅). */
  @Test
  void purge_file_hardDeletesAndExpiresBlob() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse f = fileService.upload(u, sp.id(), null, txt());
    fileService.delete(u, f.id());

    trashService.purgeFile(u, f.id());

    assertThat(
            dsl.fetchExists(
                dsl.selectOne()
                    .from(com.workplace.jooq.Tables.DRIVE_FILE)
                    .where(com.workplace.jooq.Tables.DRIVE_FILE.ID.eq(f.id()))))
        .isFalse();
    var exp =
        dsl.select(FILE.EXPIRES_AT)
            .from(FILE)
            .where(FILE.ID.eq(f.fileId()))
            .fetchOne(FILE.EXPIRES_AT);
    assertThat(exp).isNotNull();
  }

  /** 휴지통 비우기 — 공간의 모든 trashed 행 제거. */
  @Test
  void emptyTrash_removesAllTrashed() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var folder = folderService.create(u, sp.id(), null, "보고서");
    fileService.upload(u, sp.id(), folder.id(), txt());
    DriveFileResponse loose = fileService.upload(u, sp.id(), null, txt());
    folderService.delete(u, folder.id());
    fileService.delete(u, loose.id());

    trashService.emptyTrash(u, sp.id());

    assertThat(trashService.listTrash(u, sp.id()).items()).isEmpty();
    assertThat(
            dsl.fetchCount(
                com.workplace.jooq.Tables.DRIVE_FILE,
                com.workplace.jooq.Tables.DRIVE_FILE.SPACE_ID.eq(sp.id())))
        .isEqualTo(0);
  }

  /** 보존기간 경과한 trash_root 만 자동 영구삭제. */
  @Test
  void autoCleanup_purgesOnlyExpired() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFileResponse old = fileService.upload(u, sp.id(), null, txt());
    DriveFileResponse fresh = fileService.upload(u, sp.id(), null, txt());
    fileService.delete(u, old.id());
    fileService.delete(u, fresh.id());
    // old 의 trashed_at 을 31일 전으로 조작
    dsl.update(com.workplace.jooq.Tables.DRIVE_FILE)
        .set(
            com.workplace.jooq.Tables.DRIVE_FILE.TRASHED_AT,
            java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).minusDays(31))
        .where(com.workplace.jooq.Tables.DRIVE_FILE.ID.eq(old.id()))
        .execute();

    trashService.purgeExpired(java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).minusDays(30));

    assertThat(
            dsl.fetchExists(
                dsl.selectOne()
                    .from(com.workplace.jooq.Tables.DRIVE_FILE)
                    .where(com.workplace.jooq.Tables.DRIVE_FILE.ID.eq(old.id()))))
        .isFalse();
    assertThat(
            dsl.fetchExists(
                dsl.selectOne()
                    .from(com.workplace.jooq.Tables.DRIVE_FILE)
                    .where(com.workplace.jooq.Tables.DRIVE_FILE.ID.eq(fresh.id()))))
        .isTrue();
  }

  /** 삭제한 파일·폴더가 휴지통 목록에 trash_root 단위로 나타난다. */
  @Test
  void listTrash_showsDeletedRoots() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var folder = folderService.create(u, sp.id(), null, "보고서");
    fileService.upload(u, sp.id(), folder.id(), txt()); // 폴더 안 파일(하위)
    DriveFileResponse loose = fileService.upload(u, sp.id(), null, txt());

    folderService.delete(u, folder.id()); // 폴더 통째
    fileService.delete(u, loose.id()); // 루트 파일

    var list = trashService.listTrash(u, sp.id());
    assertThat(list.items()).hasSize(2); // 폴더1 + 루트파일1 (폴더 안 파일은 하위라 제외)
    assertThat(list.items()).anyMatch(i -> i.type().equals("FOLDER") && i.name().equals("보고서"));
    assertThat(list.items()).anyMatch(i -> i.type().equals("FILE"));
    assertThat(list.items()).allMatch(i -> i.autoPurgeAt().isAfter(i.trashedAt()));
  }
}
