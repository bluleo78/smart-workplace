package com.workplace.project.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.exception.ProjectConflictException;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** OPEN 프로젝트 생성 경로 검증. TEAM 구조(key 필수·OWNER 등록·시퀀스·시스템 유형 4종 시드)를 그대로 사용하되 type=OPEN 으로 저장됨을 확인. */
@Transactional
class ProjectServiceOpenCreateTest extends IntegrationTestBase {

  @Autowired ProjectService projectService;
  @Autowired DSLContext dsl;

  private Long callerId;

  @BeforeEach
  void setUp() {
    // 테스트용 사용자 시드 (FK owner_id 충족)
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    callerId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "open-tester-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "오픈테스터")
            .set(USER.EMAIL, "open-tester-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
  }

  /** OPEN 프로젝트 생성 시 type=OPEN 으로 저장되고, key 가 그대로 보존되며, 호출자가 OWNER 멤버로 등록되는지 확인. */
  @Test
  void create_open_project_like_team() {
    var req = new CreateProjectRequest("OPN", "공개 접수함", "누구나 건의", "OPEN");
    var resp = projectService.create(callerId, req);

    assertThat(resp.type()).isEqualTo("OPEN");
    assertThat(resp.key()).isEqualTo("OPN");
    // 호출자가 OWNER 로 등록되었는지 확인
    assertThat(projectService.listMembers(callerId, "OPN")).anyMatch(m -> "OWNER".equals(m.role()));
  }

  /** OPEN 프로젝트에 key 를 지정하지 않으면 ProjectConflictException 이 발생해야 한다. */
  @Test
  void create_open_without_key_rejected() {
    var req = new CreateProjectRequest(null, "키없음", null, "OPEN");
    assertThatThrownBy(() -> projectService.create(callerId, req))
        .isInstanceOf(ProjectConflictException.class);
  }
}
