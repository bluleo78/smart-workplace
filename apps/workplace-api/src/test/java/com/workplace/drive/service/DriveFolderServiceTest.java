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
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;

class DriveFolderServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFolderService folderService;
  @Autowired DriveFileService fileService;

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

  @Test
  void delete_removesFolderAndSubtree_andExpiresNestedFiles() throws Exception {
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
    assertThat(
            dsl.select(FILE.EXPIRES_AT)
                .from(FILE)
                .where(FILE.ID.eq(nested.fileId()))
                .fetchOne(FILE.EXPIRES_AT))
        .isNull();

    folderService.delete(u, parent.id());

    // 폴더 트리 제거됨
    assertThat(folderService.listItems(u, sp.id(), null).folders()).isEmpty();
    // 재귀 수집이 중첩 파일의 FILE.expires_at 을 설정해 바이트 정리 대상으로 만들었는지 검증
    assertThat(
            dsl.select(FILE.EXPIRES_AT)
                .from(FILE)
                .where(FILE.ID.eq(nested.fileId()))
                .fetchOne(FILE.EXPIRES_AT))
        .isNotNull();
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
}
