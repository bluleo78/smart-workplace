package com.workplace.drive.service;

import static com.workplace.jooq.Tables.AUDIT_LOG;
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

/** 벌크 삭제/이동 — 최상위 항목별 op-id(따로 복원), 단일 트랜잭션 롤백. */
@org.springframework.transaction.annotation.Transactional
class DriveBulkServiceTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired DriveBulkService bulkService;
  @Autowired DriveFileService fileService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveTrashService trashService;

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

  /** 폴더의 trash_op_id(휴지통이 아니면 null). */
  private Long folderOp(long folderId) {
    return dsl.select(DRIVE_FOLDER.TRASH_OP_ID)
        .from(DRIVE_FOLDER)
        .where(DRIVE_FOLDER.ID.eq(folderId))
        .fetchOne(DRIVE_FOLDER.TRASH_OP_ID);
  }

  /** 파일의 trash_op_id(휴지통이 아니면 null). */
  private Long fileOp(long fileId) {
    return dsl.select(DRIVE_FILE.TRASH_OP_ID)
        .from(DRIVE_FILE)
        .where(DRIVE_FILE.ID.eq(fileId))
        .fetchOne(DRIVE_FILE.TRASH_OP_ID);
  }

  /** 폴더가 휴지통에 있는지. */
  private boolean folderTrashed(long folderId) {
    return dsl.fetchExists(
        DRIVE_FOLDER, DRIVE_FOLDER.ID.eq(folderId).and(DRIVE_FOLDER.TRASHED_AT.isNotNull()));
  }

  /** 파일이 휴지통에 있는지. */
  private boolean fileTrashed(long fileId) {
    return dsl.fetchExists(
        DRIVE_FILE, DRIVE_FILE.ID.eq(fileId).and(DRIVE_FILE.TRASHED_AT.isNotNull()));
  }

  /** WP-1467: 휴지통 최상위가 되는 항목은 저마다 다른 op-id 를 받는다 — 한 행 복원이 다른 항목을 끌고 오지 않도록. */
  @Test
  void 벌크삭제는_최상위_항목마다_다른_opId를_부여한다() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFolderResponse folderA = folderService.create(owner, space.id(), null, "folderA");
    DriveFolderResponse folderB = folderService.create(owner, space.id(), null, "folderB");
    DriveFileResponse file = uploadFile(space.id(), null, "a.txt");

    bulkService.bulkDelete(
        owner, space.id(), List.of(file.id()), List.of(folderA.id(), folderB.id()));

    Long opA = folderOp(folderA.id());
    Long opB = folderOp(folderB.id());
    Long opFile = fileOp(file.id());
    assertThat(opA).isNotNull();
    assertThat(opB).isNotNull();
    assertThat(opFile).isNotNull();
    assertThat(java.util.Set.of(opA, opB, opFile)).hasSize(3);
  }

  /** WP-1467: 여러 항목을 벌크 삭제한 뒤 한 행만 복원하면 그 항목(과 하위)만 돌아오고 나머지는 휴지통에 남는다. */
  @Test
  void 벌크삭제후_한_항목만_복원하면_그_항목만_돌아온다() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFolderResponse folderA = folderService.create(owner, space.id(), null, "folderA");
    DriveFileResponse inA = uploadFile(space.id(), folderA.id(), "in-a.txt");
    DriveFolderResponse folderB = folderService.create(owner, space.id(), null, "folderB");
    DriveFileResponse rootFile = uploadFile(space.id(), null, "root.txt");

    bulkService.bulkDelete(
        owner, space.id(), List.of(rootFile.id()), List.of(folderA.id(), folderB.id()));

    // 폴더 A 만 복원 — A 와 그 안의 파일만 돌아온다.
    trashService.restoreFolder(owner, folderA.id());
    assertThat(folderTrashed(folderA.id())).isFalse();
    assertThat(fileTrashed(inA.id())).isFalse();
    assertThat(folderTrashed(folderB.id())).isTrue();
    assertThat(fileTrashed(rootFile.id())).isTrue();

    // 파일만 복원 — 그 파일만 돌아오고 폴더 B 는 여전히 휴지통.
    trashService.restoreFile(owner, rootFile.id());
    assertThat(fileTrashed(rootFile.id())).isFalse();
    assertThat(folderTrashed(folderB.id())).isTrue();
  }

  /** WP-782·WP-1467: 부모와 그 안의 폴더·파일을 함께 골라 지워도 부모를 복원하면 안쪽 항목이 함께 돌아온다(부모 op 에 묶임). */
  @Test
  void 부모와_하위를_함께_지운뒤_부모를_복원하면_하위도_돌아온다() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFolderResponse parent = folderService.create(owner, space.id(), null, "parent");
    DriveFolderResponse child = folderService.create(owner, space.id(), parent.id(), "child");
    DriveFileResponse inChild = uploadFile(space.id(), child.id(), "in-child.txt");
    DriveFileResponse inParent = uploadFile(space.id(), parent.id(), "in-parent.txt");

    bulkService.bulkDelete(
        owner, space.id(), List.of(inChild.id(), inParent.id()), List.of(child.id(), parent.id()));

    trashService.restoreFolder(owner, parent.id());

    assertThat(folderTrashed(parent.id())).isFalse();
    assertThat(folderTrashed(child.id())).isFalse();
    assertThat(fileTrashed(inChild.id())).isFalse();
    assertThat(fileTrashed(inParent.id())).isFalse();
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

  /** WP-1467: 감사 로그는 한 벌크 삭제의 파일들을 같은 bulkOpId 로 묶고, 파일마다 자기 복원 단위(trashOpId)를 남긴다. */
  @Test
  void 벌크삭제_감사로그는_같은_bulkOpId와_파일별_trashOpId를_남긴다() throws Exception {
    DriveSpaceResponse space = createSpace();
    DriveFileResponse a = uploadFile(space.id(), null, "audit-a.txt");
    DriveFileResponse b = uploadFile(space.id(), null, "audit-b.txt");

    bulkService.bulkDelete(owner, space.id(), List.of(a.id(), b.id()), List.of());

    List<String> metas =
        dsl.select(AUDIT_LOG.METADATA)
            .from(AUDIT_LOG)
            .where(AUDIT_LOG.ACTION_TYPE.eq("FILE_DELETE"))
            .and(AUDIT_LOG.RESOURCE_ID.in(String.valueOf(a.id()), String.valueOf(b.id())))
            .orderBy(AUDIT_LOG.RESOURCE_ID)
            .fetch(r -> r.value1().data());
    assertThat(metas).hasSize(2);
    com.fasterxml.jackson.databind.ObjectMapper om =
        new com.fasterxml.jackson.databind.ObjectMapper();
    var m0 = om.readTree(metas.get(0));
    var m1 = om.readTree(metas.get(1));
    // 같은 묶음
    assertThat(m0.get("bulkOpId").asLong()).isEqualTo(m1.get("bulkOpId").asLong());
    // 파일마다 다른 복원 단위이고, 그 값은 휴지통 행의 trash_op_id 와 같다
    assertThat(m0.get("trashOpId").asLong()).isNotEqualTo(m1.get("trashOpId").asLong());
    long idOf0 =
        Long.parseLong(
            dsl.select(AUDIT_LOG.RESOURCE_ID)
                .from(AUDIT_LOG)
                .where(AUDIT_LOG.ACTION_TYPE.eq("FILE_DELETE"))
                .and(AUDIT_LOG.RESOURCE_ID.in(String.valueOf(a.id()), String.valueOf(b.id())))
                .orderBy(AUDIT_LOG.RESOURCE_ID)
                .limit(1)
                .fetchOne(AUDIT_LOG.RESOURCE_ID));
    assertThat(m0.get("trashOpId").asLong()).isEqualTo(fileOp(idOf0));
  }
}
