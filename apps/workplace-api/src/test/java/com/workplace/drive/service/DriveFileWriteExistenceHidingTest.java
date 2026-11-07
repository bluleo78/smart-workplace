package com.workplace.drive.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;

import com.workplace.drive.dto.CreateShareLinkRequest;
import com.workplace.drive.dto.DriveFileResponse;
import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveFileNotFoundException;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveShareLinkNotFoundException;
import com.workplace.file.service.UploadSource;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1424 — 파일 id 로 들어오는 드라이브 쓰기 경로가 공간 비멤버에게 「공간 없음」 대신 없는 파일과 같은 「파일 없음」(404)을 돌려주는지 검증. 문구가 달라
 * 파일 id 를 넣어 보는 것만으로 존재 여부가 새던 문제를 막는다. 멤버의 역할 부족은 그대로 403.
 */
@Transactional
class DriveFileWriteExistenceHidingTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService fileService;
  @Autowired DriveShareLinkService shareLinkService;

  @BeforeEach
  void setTenantContext() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenantContext() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "wh_" + s)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "Wh" + s)
            .set(USER.EMAIL, "wh_" + s + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return id;
  }

  /** 소유자가 만든 텍스트 파일 — 비멤버 쓰기 호출의 대상. */
  private DriveFileResponse seedFile(long owner, long spaceId) throws Exception {
    return fileService.createTextFile(owner, spaceId, null, "a.md", "x", null);
  }

  @Test
  void nonMember_writePaths_seeFileNotFound() throws Exception {
    long owner = seedUser();
    long outsider = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");
    DriveFileResponse f = seedFile(owner, sp.id());
    long id = f.id();
    UploadSource src = UploadSource.ofBytes("a.md", null, "y".getBytes(StandardCharsets.UTF_8));

    assertThatThrownBy(() -> fileService.updateTextFile(outsider, id, "y", null))
        .isInstanceOf(DriveFileNotFoundException.class);
    assertThatThrownBy(() -> fileService.addVersion(outsider, id, src))
        .isInstanceOf(DriveFileNotFoundException.class);
    assertThatThrownBy(() -> fileService.validateVersionTarget(outsider, id))
        .isInstanceOf(DriveFileNotFoundException.class);
    assertThatThrownBy(() -> fileService.validateDeletable(outsider, id))
        .isInstanceOf(DriveFileNotFoundException.class);
    assertThatThrownBy(() -> fileService.delete(outsider, id))
        .isInstanceOf(DriveFileNotFoundException.class);
    assertThatThrownBy(() -> fileService.rollback(outsider, id, 1))
        .isInstanceOf(DriveFileNotFoundException.class);
    assertThatThrownBy(() -> fileService.rename(outsider, id, "b.md"))
        .isInstanceOf(DriveFileNotFoundException.class);
    assertThatThrownBy(() -> fileService.move(outsider, id, null))
        .isInstanceOf(DriveFileNotFoundException.class);
    assertThatThrownBy(() -> fileService.copy(outsider, id, null))
        .isInstanceOf(DriveFileNotFoundException.class);
    CreateShareLinkRequest req = new CreateShareLinkRequest("EXTERNAL", null, null);
    assertThatThrownBy(() -> shareLinkService.create(outsider, id, req))
        .isInstanceOf(DriveFileNotFoundException.class);
    assertThatThrownBy(() -> shareLinkService.list(outsider, id))
        .isInstanceOf(DriveFileNotFoundException.class);
  }

  /** 없는 id 와 남의 파일 id 의 메시지가 같아야 구분이 안 된다. */
  @Test
  void nonMember_message_equalsMissingFileMessage() throws Exception {
    long owner = seedUser();
    long outsider = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");
    DriveFileResponse f = seedFile(owner, sp.id());

    Throwable hidden = catchThrowable(() -> fileService.rename(outsider, f.id(), "b.md"));
    assertThat(hidden).isInstanceOf(DriveFileNotFoundException.class);
    assertThat(hidden.getMessage()).isEqualTo(new DriveFileNotFoundException(f.id()).getMessage());
  }

  @Test
  void viewer_writePaths_stayForbidden() throws Exception {
    long owner = seedUser();
    long viewer = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");
    spaceService.addMember(owner, sp.id(), viewer, "VIEWER");
    long id = seedFile(owner, sp.id()).id();

    assertThatThrownBy(() -> fileService.rename(viewer, id, "b.md"))
        .isInstanceOf(DriveForbiddenException.class);
    assertThatThrownBy(() -> fileService.delete(viewer, id))
        .isInstanceOf(DriveForbiddenException.class);
    assertThatThrownBy(
            () ->
                shareLinkService.create(
                    viewer, id, new CreateShareLinkRequest("EXTERNAL", null, null)))
        .isInstanceOf(DriveForbiddenException.class);
    assertThatThrownBy(() -> shareLinkService.list(viewer, id))
        .isInstanceOf(DriveForbiddenException.class);
  }

  @Test
  void editor_writePaths_succeed() throws Exception {
    long owner = seedUser();
    long editor = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");
    spaceService.addMember(owner, sp.id(), editor, "EDITOR");
    long id = seedFile(owner, sp.id()).id();

    assertThat(fileService.rename(editor, id, "b.md").name()).isEqualTo("b.md");
    assertThat(
            shareLinkService.create(editor, id, new CreateShareLinkRequest("EXTERNAL", null, null)))
        .isNotNull();
    assertThat(shareLinkService.list(editor, id)).hasSize(1);
  }

  /** WP-1424: 비멤버의 링크 폐기는 살아 있는 링크도 없는 링크 id 와 같은 404(같은 메시지), EDITOR 는 그대로 성공. */
  @Test
  void revoke_nonMember_seesShareLinkNotFound_editorSucceeds() throws Exception {
    long owner = seedUser();
    long editor = seedUser();
    long outsider = seedUser();
    DriveSpaceResponse sp = spaceService.createTeamSpace(owner, "팀");
    spaceService.addMember(owner, sp.id(), editor, "EDITOR");
    long id = seedFile(owner, sp.id()).id();
    long linkId =
        shareLinkService.create(owner, id, new CreateShareLinkRequest("EXTERNAL", null, null)).id();

    Throwable hidden = catchThrowable(() -> shareLinkService.revoke(outsider, linkId));
    Throwable missing = catchThrowable(() -> shareLinkService.revoke(outsider, Long.MAX_VALUE));

    assertThat(hidden).isInstanceOf(DriveShareLinkNotFoundException.class);
    assertThat(missing).isInstanceOf(DriveShareLinkNotFoundException.class);
    assertThat(hidden.getMessage()).isEqualTo(missing.getMessage());
    shareLinkService.revoke(editor, linkId);
    assertThat(shareLinkService.list(owner, id).get(0).revoked()).isTrue();
  }
}
