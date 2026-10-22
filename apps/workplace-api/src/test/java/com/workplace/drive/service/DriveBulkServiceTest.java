package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_FOLDER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;

/** 벌크 삭제/이동 — 단일 op-id, 단일 트랜잭션 롤백. */
@org.springframework.transaction.annotation.Transactional
class DriveBulkServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveBulkService bulkService;
  @Autowired DriveFileService fileService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveSpaceService spaceService;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  /** 테스트 사용자 생성. */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "bk_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Bk" + s)
        .set(USER.EMAIL, "bk_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 소유자 + 빈 팀 공간 생성, 소유자 id 를 함께 반환. */
  private long owner;

  private DriveSpaceResponse createSpace() {
    owner = seedUser();
    return spaceService.createTeamSpace(owner, "팀_" + UUID.randomUUID().toString().substring(0, 4));
  }

  private DriveFileResponse uploadFile(long spaceId, Long folderId, String name) throws Exception {
    MockMultipartFile f = new MockMultipartFile("file", name, "text/plain", "x".getBytes());
    return fileService.upload(owner, spaceId, folderId, f);
  }

  @Test
  void 벌크삭제는_파일과_폴더에_같은_opId를_부여한다() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFolderResponse folder = folderService.create(owner, space.id(), null, "folderA");
    DriveFileResponse file = uploadFile(space.id(), null, "a.txt");

    bulkService.bulkDelete(owner, space.id(), List.of(file.id()), List.of(folder.id()));

    Long fileOp =
        dsl.select(DRIVE_FILE.TRASH_OP_ID)
            .from(DRIVE_FILE)
            .where(DRIVE_FILE.ID.eq(file.id()))
            .fetchOne(DRIVE_FILE.TRASH_OP_ID);
    Long folderOp =
        dsl.select(DRIVE_FOLDER.TRASH_OP_ID)
            .from(DRIVE_FOLDER)
            .where(DRIVE_FOLDER.ID.eq(folder.id()))
            .fetchOne(DRIVE_FOLDER.TRASH_OP_ID);

    assertThat(fileOp).isNotNull();
    assertThat(folderOp).isNotNull();
    assertThat(fileOp).isEqualTo(folderOp);
  }

  /** WP-782: 부모 폴더와 그 안의 폴더·파일을 함께 골라도(순서 무관) 404 없이 지워지고, 휴지통 최상위는 부모 하나다. */
  @Test
  void 부모와_하위를_함께_골라도_한번에_지워지고_최상위는_부모만() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFolderResponse parent = folderService.create(owner, space.id(), null, "parent");
    DriveFolderResponse child = folderService.create(owner, space.id(), parent.id(), "child");
    DriveFileResponse inChild = uploadFile(space.id(), child.id(), "in-child.txt");
    DriveFileResponse inParent = uploadFile(space.id(), parent.id(), "in-parent.txt");

    bulkService.bulkDelete(
        owner,
        space.id(),
        List.of(inChild.id(), inParent.id(), inParent.id()),
        List.of(child.id(), parent.id()));

    assertThat(
            dsl.select(DRIVE_FOLDER.ID, DRIVE_FOLDER.TRASH_ROOT)
                .from(DRIVE_FOLDER)
                .where(DRIVE_FOLDER.ID.in(parent.id(), child.id()))
                .and(DRIVE_FOLDER.TRASHED_AT.isNotNull())
                .fetchMap(DRIVE_FOLDER.ID, DRIVE_FOLDER.TRASH_ROOT))
        .containsEntry(parent.id(), true)
        .containsEntry(child.id(), false);
    assertThat(
            dsl.select(DRIVE_FILE.ID, DRIVE_FILE.TRASH_ROOT)
                .from(DRIVE_FILE)
                .where(DRIVE_FILE.ID.in(inChild.id(), inParent.id()))
                .and(DRIVE_FILE.TRASHED_AT.isNotNull())
                .fetchMap(DRIVE_FILE.ID, DRIVE_FILE.TRASH_ROOT))
        .containsEntry(inChild.id(), false)
        .containsEntry(inParent.id(), false);
  }
}
