package com.workplace.wiki.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.wiki.dto.WikiSpaceResponse;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

@Transactional
class WikiSpaceServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired WikiSpaceService spaceService;

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
        .set(USER.USERNAME, "wk_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Wk" + s)
        .set(USER.EMAIL, "wk_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void ensurePersonalSpace_isIdempotent() {
    long u = seedUser();
    WikiSpaceResponse a = spaceService.ensurePersonalSpace(u);
    WikiSpaceResponse b = spaceService.ensurePersonalSpace(u);
    assertThat(a.id()).isEqualTo(b.id());
    assertThat(a.type()).isEqualTo("PERSONAL");
    assertThat(a.role()).isEqualTo("OWNER");
  }

  @Test
  void listMySpaces_personalFirst() {
    long u = seedUser();
    spaceService.createTeamSpace(u, "팀 위키");
    List<WikiSpaceResponse> spaces = spaceService.listMySpaces(u);
    assertThat(spaces).hasSize(2);
    assertThat(spaces.get(0).type()).isEqualTo("PERSONAL");
  }

  @Test
  void getSpace_nonMember_throwsNotFound() {
    long owner = seedUser();
    long stranger = seedUser();
    WikiSpaceResponse team = spaceService.createTeamSpace(owner, "팀");
    assertThatThrownBy(() -> spaceService.getSpace(stranger, team.id()))
        .isInstanceOf(WikiSpaceNotFoundException.class);
  }
}
