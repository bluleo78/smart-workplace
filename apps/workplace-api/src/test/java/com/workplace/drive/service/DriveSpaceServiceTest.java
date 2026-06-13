package com.workplace.drive.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.drive.dto.DriveSpaceResponse;
import com.workplace.drive.exception.DriveForbiddenException;
import com.workplace.drive.exception.DriveSpaceNotFoundException;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class DriveSpaceServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired DriveSpaceService spaceService;

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
}
