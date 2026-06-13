package com.workplace.drive.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveFolderResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveDuplicateNameException;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class DriveFolderServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveFileService fileService;

  /** drive 복사(copyFile)는 TenantContext 를 요구한다 — 테스트에선 tenant#1 로 고정. */
  @BeforeEach
  void setTenantContext() {
    TenantContext.set(1L);
  }

  /** ThreadLocal 누수 방지. */
  @AfterEach
  void clearTenantContext() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "df_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Df" + s)
        .set(USER.EMAIL, "df_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  private MockMultipartFile txt() {
    return new MockMultipartFile("file", "memo.txt", "text/plain", "hello".getBytes());
  }

  @Test
  void create_thenListItems_returnsFolder() {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFolderResponse f = folderService.create(u, sp.id(), null, "문서");
    assertThat(folderService.listItems(u, sp.id(), null).folders())
        .extracting(DriveFolderResponse::name)
        .contains("문서");
    assertThat(f.parentId()).isNull();
  }

  @Test
  void create_duplicateNameSameParent_throws() {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    folderService.create(u, sp.id(), null, "문서");
    assertThatThrownBy(() -> folderService.create(u, sp.id(), null, "문서"))
        .isInstanceOf(DriveDuplicateNameException.class);
  }

  @Test
  void rename_works() {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFolderResponse f = folderService.create(u, sp.id(), null, "old");
    DriveFolderResponse renamed = folderService.rename(u, f.id(), "new");
    assertThat(renamed.name()).isEqualTo("new");
  }

  /** 폴더 삭제(소프트) = 휴지통으로. 중첩 파일 blob 은 보존(expires_at NULL 유지). */
  @Test
  void delete_trashesSubtree_andPreservesNestedFileBlobs() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    DriveFolderResponse parent = folderService.create(u, sp.id(), null, "부모");
    DriveFolderResponse child = folderService.create(u, sp.id(), parent.id(), "자식");
    // 중첩 폴더에 파일 업로드 → 영구화(expires_at = null)
    DriveFileResponse nested =
        fileService.upload(
            u,
            sp.id(),
            child.id(),
            new MockMultipartFile("file", "n.txt", "text/plain", "x".getBytes()));

    folderService.delete(u, parent.id());

    // 브라우즈에서 폴더 트리 사라짐(soft-delete)
    assertThat(folderService.listItems(u, sp.id(), null).folders()).isEmpty();
    // blob 은 보존 — expires_at 여전히 NULL(soft-delete 는 물리 삭제 없음)
    assertThat(
            dsl.select(FILE.EXPIRES_AT)
                .from(FILE)
                .where(FILE.ID.eq(nested.fileId()))
                .fetchOne(FILE.EXPIRES_AT))
        .isNull();
  }

  @Test
  void viewer_cannotCreateFolder() {
    long owner = seedUser();
    long viewer = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");
    spaceService.addMember(owner, sp.id(), viewer, "VIEWER");
    assertThatThrownBy(() -> folderService.create(viewer, sp.id(), null, "x"))
        .isInstanceOf(DriveForbiddenException.class);
  }

  @Test
  void move_changesParent_andCarriesSubtree() {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var parent = folderService.create(u, sp.id(), null, "부모");
    var child = folderService.create(u, sp.id(), parent.id(), "자식");
    var target = folderService.create(u, sp.id(), null, "대상");

    folderService.move(u, parent.id(), target.id());

    var movedParent =
        dsl.select(com.workplace.jooq.Tables.DRIVE_FOLDER.PARENT_ID)
            .from(com.workplace.jooq.Tables.DRIVE_FOLDER)
            .where(com.workplace.jooq.Tables.DRIVE_FOLDER.ID.eq(parent.id()))
            .fetchOne(com.workplace.jooq.Tables.DRIVE_FOLDER.PARENT_ID);
    assertThat(movedParent).isEqualTo(target.id());
    var childParent =
        dsl.select(com.workplace.jooq.Tables.DRIVE_FOLDER.PARENT_ID)
            .from(com.workplace.jooq.Tables.DRIVE_FOLDER)
            .where(com.workplace.jooq.Tables.DRIVE_FOLDER.ID.eq(child.id()))
            .fetchOne(com.workplace.jooq.Tables.DRIVE_FOLDER.PARENT_ID);
    assertThat(childParent).isEqualTo(parent.id());
  }

  @Test
  void move_intoOwnDescendant_isRejected() {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var parent = folderService.create(u, sp.id(), null, "부모");
    var child = folderService.create(u, sp.id(), parent.id(), "자식");

    assertThatThrownBy(() -> folderService.move(u, parent.id(), child.id()))
        .isInstanceOf(com.workplace.drive.exception.DriveInvalidTargetException.class);
  }

  @Test
  void move_intoItself_isRejected() {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var folder = folderService.create(u, sp.id(), null, "f");

    assertThatThrownBy(() -> folderService.move(u, folder.id(), folder.id()))
        .isInstanceOf(com.workplace.drive.exception.DriveInvalidTargetException.class);
  }

  @Test
  void move_whenTargetHasSameName_conflicts() {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var a = folderService.create(u, sp.id(), null, "보고서");
    var box = folderService.create(u, sp.id(), null, "상자");
    folderService.create(u, sp.id(), box.id(), "보고서");

    assertThatThrownBy(() -> folderService.move(u, a.id(), box.id()))
        .isInstanceOf(DriveDuplicateNameException.class);
  }

  @Test
  void copy_recursivelyDuplicatesSubtree_withIndependentBlobs() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var src = folderService.create(u, sp.id(), null, "원본");
    var sub = folderService.create(u, sp.id(), src.id(), "하위");
    DriveFileResponse f =
        fileService.upload(
            u,
            sp.id(),
            sub.id(),
            new MockMultipartFile("file", "a.txt", "text/plain", "x".getBytes()));
    var dest = folderService.create(u, sp.id(), null, "대상");

    DriveFolderResponse copied = folderService.copy(u, src.id(), dest.id());

    assertThat(copied.id()).isNotEqualTo(src.id());
    assertThat(copied.parentId()).isEqualTo(dest.id());
    assertThat(copied.name()).isEqualTo("원본");
    var copiedSub = folderService.listItems(u, sp.id(), copied.id()).folders().get(0);
    assertThat(copiedSub.name()).isEqualTo("하위");
    var copiedFile = folderService.listItems(u, sp.id(), copiedSub.id()).files().get(0);
    assertThat(copiedFile.name()).isEqualTo("a.txt");
    assertThat(copiedFile.fileId()).isNotEqualTo(f.fileId());
    String srcPath =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(f.fileId()))
            .fetchOne(FILE.STORAGE_PATH);
    String copyPath =
        dsl.select(FILE.STORAGE_PATH)
            .from(FILE)
            .where(FILE.ID.eq(copiedFile.fileId()))
            .fetchOne(FILE.STORAGE_PATH);
    assertThat(copyPath).isNotEqualTo(srcPath);
    var exp =
        dsl.select(FILE.EXPIRES_AT)
            .from(FILE)
            .where(FILE.ID.eq(copiedFile.fileId()))
            .fetchOne(FILE.EXPIRES_AT);
    assertThat(exp).isNull();
  }

  @Test
  void move_toSameParent_isNoOp() {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var box = folderService.create(u, sp.id(), null, "상자");
    var f = folderService.create(u, sp.id(), box.id(), "f");

    folderService.move(u, f.id(), box.id()); // 같은 부모로 재이동 — 409 없이 no-op

    var parent =
        dsl.select(com.workplace.jooq.Tables.DRIVE_FOLDER.PARENT_ID)
            .from(com.workplace.jooq.Tables.DRIVE_FOLDER)
            .where(com.workplace.jooq.Tables.DRIVE_FOLDER.ID.eq(f.id()))
            .fetchOne(com.workplace.jooq.Tables.DRIVE_FOLDER.PARENT_ID);
    assertThat(parent).isEqualTo(box.id());
  }

  @Test
  void copy_whenTargetHasSameName_conflicts() {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var src = folderService.create(u, sp.id(), null, "문서");
    var box = folderService.create(u, sp.id(), null, "상자");
    folderService.create(u, sp.id(), box.id(), "문서");

    assertThatThrownBy(() -> folderService.copy(u, src.id(), box.id()))
        .isInstanceOf(DriveDuplicateNameException.class);
  }

  /** 폴더 삭제 = 하위 통째 휴지통. 최상위만 trash_root, 하위는 같은 op_id. */
  @Test
  void deleteFolder_trashesSubtreeUnderOneOp() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var parent = folderService.create(u, sp.id(), null, "부모");
    var child = folderService.create(u, sp.id(), parent.id(), "자식");
    fileService.upload(u, sp.id(), child.id(), txt());

    folderService.delete(u, parent.id());

    var pf = trashed(parent.id());
    var cf = trashed(child.id());
    assertThat(pf.trashedAt()).isNotNull();
    assertThat(cf.trashedAt()).isNotNull();
    assertThat(pf.opId()).isEqualTo(cf.opId()); // 같은 작업
    assertThat(pf.root()).isTrue();
    assertThat(cf.root()).isFalse();
    // 브라우즈에서 사라짐
    assertThat(folderService.listItems(u, sp.id(), null).folders()).isEmpty();
  }

  /** 중첩 독립삭제: 파일 X 삭제 후 부모폴더 삭제 → X 는 자기 op 유지(부모 op 와 다름). */
  @Test
  void deleteFolder_skipsAlreadyTrashedChild() throws Exception {
    long u = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(u, "팀");
    var parent = folderService.create(u, sp.id(), null, "부모");
    DriveFileResponse x = fileService.upload(u, sp.id(), parent.id(), txt());

    fileService.delete(u, x.id()); // op1
    folderService.delete(u, parent.id()); // op2

    Long xop =
        dsl.select(com.workplace.jooq.Tables.DRIVE_FILE.TRASH_OP_ID)
            .from(com.workplace.jooq.Tables.DRIVE_FILE)
            .where(com.workplace.jooq.Tables.DRIVE_FILE.ID.eq(x.id()))
            .fetchOne(com.workplace.jooq.Tables.DRIVE_FILE.TRASH_OP_ID);
    Long pop =
        dsl.select(com.workplace.jooq.Tables.DRIVE_FOLDER.TRASH_OP_ID)
            .from(com.workplace.jooq.Tables.DRIVE_FOLDER)
            .where(com.workplace.jooq.Tables.DRIVE_FOLDER.ID.eq(parent.id()))
            .fetchOne(com.workplace.jooq.Tables.DRIVE_FOLDER.TRASH_OP_ID);
    assertThat(xop).isNotEqualTo(pop); // X 는 op1, 부모는 op2
    assertThat(
            dsl.select(com.workplace.jooq.Tables.DRIVE_FILE.TRASH_ROOT)
                .from(com.workplace.jooq.Tables.DRIVE_FILE)
                .where(com.workplace.jooq.Tables.DRIVE_FILE.ID.eq(x.id()))
                .fetchOne(com.workplace.jooq.Tables.DRIVE_FILE.TRASH_ROOT))
        .isTrue();
  }

  // 헬퍼: 폴더의 trashed 메타 조회
  private record TrashMeta(java.time.OffsetDateTime trashedAt, Long opId, Boolean root) {}

  private TrashMeta trashed(long folderId) {
    var t = com.workplace.jooq.Tables.DRIVE_FOLDER;
    var r =
        dsl.select(t.TRASHED_AT, t.TRASH_OP_ID, t.TRASH_ROOT)
            .from(t)
            .where(t.ID.eq(folderId))
            .fetchOne();
    return new TrashMeta(r.get(t.TRASHED_AT), r.get(t.TRASH_OP_ID), r.get(t.TRASH_ROOT));
  }
}
