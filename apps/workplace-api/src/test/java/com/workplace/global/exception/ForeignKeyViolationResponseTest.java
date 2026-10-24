package com.workplace.global.exception;

import static com.workplace.jooq.Tables.ISSUE_LABEL;
import static com.workplace.jooq.Tables.PROJECT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import com.workplace.global.dto.ErrorResponse;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.annotation.Transactional;

/**
 * 외래 키 위반 응답(WP-754) — 가리키는 행이 없어서 난 위반은 404, 다른 데이터가 아직 가리켜서 난 위반은 409.
 *
 * <p>라벨·사이클·마일스톤·유형·커스텀 필드·노트 부모를 지우는 요청과 그것을 이슈에 붙이거나 바꾸는 요청이 겹치면, 서비스의 존재 확인을 지난 뒤 삭제가 커밋돼 쓰기가 외래
 * 키 위반(insert or update … violates foreign key constraint)으로 실패한다. 순차로는 「찾을 수 없습니다」인 상황인데 충돌 409 로
 * 나갔다. 반대로 지우려는 행을 다른 데이터가 아직 가리키는 위반(update or delete … is still referenced)은 그대로 409 다. 실제 DB 가
 * 내는 예외로 두 갈래를 확인한다(각 테스트는 실패하는 문장을 마지막에 한 번만 — 실패하면 트랜잭션이 중단된다).
 */
@Transactional
class ForeignKeyViolationResponseTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired ProjectRepository projectRepository;
  @Autowired IssueRepository issueRepository;
  @Autowired IssueTypeService issueTypeService;

  private final GlobalExceptionHandler handler = new GlobalExceptionHandler();
  private final MockHttpServletRequest request =
      new MockHttpServletRequest("PUT", "/api/v1/projects/X/issues/1/labels");

  @Test
  void 가리키는_행이_사라진_쓰기는_한국어_404() {
    long issueId = seedIssue();
    var ex =
        catchThrowableOfType(
            DataIntegrityViolationException.class,
            () ->
                dsl.insertInto(ISSUE_LABEL)
                    .set(ISSUE_LABEL.ISSUE_ID, issueId)
                    .set(ISSUE_LABEL.LABEL_ID, Long.MAX_VALUE)
                    .execute());

    ResponseEntity<ErrorResponse> res = handler.handleDataIntegrityViolation(ex, request);

    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
    assertThat(res.getBody().message()).isEqualTo("참조한 항목을 찾을 수 없습니다. 방금 삭제되었을 수 있습니다");
  }

  @Test
  void 다른_데이터가_아직_가리키는_삭제는_그대로_409() {
    long issueId = seedIssue();
    long projectId =
        issueRepository
            .findById(issueId)
            .orElseThrow()
            .projectId(); // issue → project 는 CASCADE 가 없다
    var ex =
        catchThrowableOfType(
            DataIntegrityViolationException.class,
            () -> dsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(projectId)).execute());

    ResponseEntity<ErrorResponse> res = handler.handleDataIntegrityViolation(ex, request);

    assertThat(res.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(res.getBody().message()).isEqualTo("연결된 다른 데이터가 있어 처리하지 못했습니다");
  }

  /** 프로젝트 하나와 그 이슈 하나를 만들고 이슈 id 를 돌려준다. */
  private long seedIssue() {
    long owner = TestFixtures.createHuman(dsl);
    String key = "F" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    var project = projectRepository.insert(key, "fk", null, owner, "TEAM", false);
    issueTypeService.seedSystemTypes(project.id(), true);
    return IssueSeeds.insert(
            issueRepository, baseDsl, project.id(), 1, "t", null, "MID", null, owner)
        .id();
  }
}
