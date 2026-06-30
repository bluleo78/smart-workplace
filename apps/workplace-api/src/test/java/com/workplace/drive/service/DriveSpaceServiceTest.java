package com.workplace.drive.service;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.DRIVE_SPACE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.drive.exception.DriveSpaceTypeNotEditableException;
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
class DriveSpaceServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;
  @Autowired DriveFileService fileService;

  // RLS(V53) 적용 후 drive_space/drive_space_member INSERT 가 WITH CHECK 를 통과하려면
  // 트랜잭션에 app.tenant_id GUC 가 있어야 한다. 요청 필터를 흉내내 tenant#1 컨텍스트를 명시한다.
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "ds_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Ds" + s)
        .set(USER.EMAIL, "ds_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void ensurePersonalSpace_isIdempotent_andOwnerHasOwnerRole() {
    long u = seedUser();
    DriveSpaceResponse a = spaceService.ensurePersonalSpace(u);
    DriveSpaceResponse b = spaceService.ensurePersonalSpace(u);
    assertThat(a.id()).isEqualTo(b.id()); // 멱등
    assertThat(a.type()).isEqualTo("PERSONAL");
    assertThat(a.role()).isEqualTo("OWNER");
  }

  @Test
  void createTeamSpace_makesCallerOwner_andAppearsInMySpaces() {
    long u = seedUser();
    DriveSpaceResponse team = spaceService.createTeamSpace(u, "팀 공간");
    assertThat(team.type()).isEqualTo("TEAM");
    assertThat(team.role()).isEqualTo("OWNER");
    assertThat(spaceService.listMySpaces(u))
        .anyMatch(s -> s.id() == team.id())
        .anyMatch(s -> "PERSONAL".equals(s.type()));
  }

  @Test
  void addMember_thenMemberCanRead_butNotManage() {
    long owner = seedUser();
    long member = seedUser();
    DriveSpaceResponse team = spaceService.createTeamSpace(owner, "팀");
    spaceService.addMember(owner, team.id(), member, "VIEWER");

    assertThat(spaceService.getSpace(member, team.id()).id()).isEqualTo(team.id());
    assertThatThrownBy(() -> spaceService.addMember(member, team.id(), owner, "EDITOR"))
        .isInstanceOf(DriveForbiddenException.class);
  }

  @Test
  void nonMember_getSpace_throwsNotFound() {
    long owner = seedUser();
    long stranger = seedUser();
    DriveSpaceResponse team = spaceService.createTeamSpace(owner, "비밀");
    assertThatThrownBy(() -> spaceService.getSpace(stranger, team.id()))
        .isInstanceOf(DriveSpaceNotFoundException.class);
  }

  // ── 이름 변경 ─────────────────────────────────────────────────────────

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
        .isInstanceOf(DriveSpaceTypeNotEditableException.class);
  }

  // ── 즉시 하드삭제 ─────────────────────────────────────────────────────

  @Test
  void deleteTeamSpace_hardDeletesRowAndExpiresBlob() throws Exception {
    long u = seedUser();
    DriveSpaceResponse team = spaceService.createTeamSpace(u, "삭제될 팀");
    var f =
        fileService.upload(
            u,
            team.id(),
            null,
            new MockMultipartFile("file", "memo.txt", "text/plain", "hello".getBytes()));

    spaceService.deleteTeamSpace(u, team.id());

    // 공간 행 + 파일 행 cascade 제거
    assertThat(
            dsl.fetchExists(dsl.selectOne().from(DRIVE_SPACE).where(DRIVE_SPACE.ID.eq(team.id()))))
        .isFalse();
    assertThat(dsl.fetchExists(dsl.selectOne().from(DRIVE_FILE).where(DRIVE_FILE.ID.eq(f.id()))))
        .isFalse();
    // blob 만료 표시 → FileCleanupService 가 바이트 회수
    assertThat(
            dsl.select(FILE.EXPIRES_AT)
                .from(FILE)
                .where(FILE.ID.eq(f.fileId()))
                .fetchOne(FILE.EXPIRES_AT))
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
        .isInstanceOf(DriveSpaceTypeNotEditableException.class);
  }

  @Test
  void deleteTeamSpace_nonMemberNotFound() {
    long owner = seedUser();
    long stranger = seedUser();
    DriveSpaceResponse team = spaceService.createTeamSpace(owner, "팀");
    // 비멤버는 존재 은닉 — NotFound (테넌트 격리/RLS 와 동일 계약)
    assertThatThrownBy(() -> spaceService.deleteTeamSpace(stranger, team.id()))
        .isInstanceOf(DriveSpaceNotFoundException.class);
  }
}
