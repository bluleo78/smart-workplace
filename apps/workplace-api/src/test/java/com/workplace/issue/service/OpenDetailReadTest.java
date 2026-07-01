package com.workplace.issue.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.cycle.service.CycleService;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.support.TenantScopedIntegrationTest;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * OPEN 프로젝트 상세 페이지가 마운트 시 조회하는 read 엔드포인트 개방 통합 테스트.
 *
 * <p>OPEN 이슈 상세는 프로퍼티 레일(사이클·커스텀필드·첨부·드라이브링크)을 함께 로드한다. 이들이 여전히 assertMember 가드면 비멤버
 * reporter/viewer 가 403 을 맞아 레일이 조용히 깨진다("3분기 함정"). 각 read 목록 메서드가 비멤버(stranger)에게도 200 을 반환하는지
 * 검증한다. 반례로 TEAM 은 비멤버 조회 거부(개방은 OPEN 에만).
 *
 * <p>witness 는 프로젝트와 무관한 stranger 로 고정 — reporter-특화 경로가 버그를 가리지 않도록. 목록이 비어도 무방하며(가드가 throw 하지 않는
 * 것이 요점) isNotNull 만 단언한다. @Transactional 롤백 + TenantContext 테넌트 1 고정으로 RLS GUC 주입 보장.
 */
@Transactional
class OpenDetailReadTest extends TenantScopedIntegrationTest {

  @Autowired IssueCycleService issueCycleService;
  @Autowired CycleService cycleService;
  @Autowired IssueFieldDefService issueFieldDefService;
  @Autowired IssueAttachmentService issueAttachmentService;
  @Autowired IssueDriveLinkService issueDriveLinkService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired DSLContext dsl;

  private OpenScenario.Result openScenario() {
    return OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
  }

  /** 비멤버 stranger 가 OPEN 이슈의 연결 사이클 목록을 조회 성공(가드 미throw). */
  @Test
  void open_stranger_can_list_issue_cycles() {
    var s = openScenario();
    var list = issueCycleService.list(s.strangerId(), s.projectKey(), s.issueNumber());
    assertThat(list).isNotNull();
  }

  /** 비멤버 stranger 가 OPEN 프로젝트의 사이클 목록을 조회 성공. */
  @Test
  void open_stranger_can_list_project_cycles() {
    var s = openScenario();
    var list = cycleService.list(s.strangerId(), s.projectKey());
    assertThat(list).isNotNull();
  }

  /** 비멤버 stranger 가 OPEN 프로젝트의 커스텀 필드 정의 목록을 조회 성공. */
  @Test
  void open_stranger_can_list_field_defs() {
    var s = openScenario();
    var list = issueFieldDefService.list(s.strangerId(), s.projectKey());
    assertThat(list).isNotNull();
  }

  /** 비멤버 stranger 가 OPEN 이슈의 첨부 목록을 조회 성공(다운로드는 여전히 멤버 게이트). */
  @Test
  void open_stranger_can_list_attachments() {
    var s = openScenario();
    var list = issueAttachmentService.list(s.strangerId(), s.projectKey(), s.issueNumber());
    assertThat(list).isNotNull();
  }

  /** 비멤버 stranger 가 OPEN 이슈의 드라이브 링크 목록을 조회 성공(list 전용 readable resolve 검증). */
  @Test
  void open_stranger_can_list_drive_links() {
    var s = openScenario();
    var list = issueDriveLinkService.list(s.strangerId(), s.projectKey(), s.issueNumber());
    assertThat(list).isNotNull();
  }

  /** 반례: TEAM 프로젝트는 비멤버 목록 조회 거부 — 개방은 OPEN 에만. */
  @Test
  void team_stranger_cannot_list_field_defs() {
    var s = OpenScenario.createTeam(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
    assertThatThrownBy(() -> issueFieldDefService.list(s.strangerId(), s.projectKey()))
        .isInstanceOf(ProjectAccessDeniedException.class);
  }
}
