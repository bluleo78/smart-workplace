package com.workplace.issue;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueAiSummaryRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * IssueService.get() 이 저장된 요약 + 계산된 블로커를 aiContext 로 내려주는지 검증.
 *
 * <p>케이스 A: 저장 요약 있음 → aiContext 비-null, summary 일치. 케이스 B: 저장 요약 없음 + 블로커 없음 → aiContext null.
 */
@Transactional
class IssueDetailAiContextTest extends IntegrationTestBase {

  @Autowired private IssueService issueService;
  @Autowired private IssueAiSummaryRepository summaryRepo;
  @Autowired private IssueRepository issueRepository;
  @Autowired private ProjectService projectService;

  // ── 케이스 A: 저장 요약 있음 ─────────────────────────────────────────────────────

  /** 이슈에 AI 요약이 upsert 돼 있으면 get() 결과의 aiContext 가 비-null 이고, summary 가 일치해야 한다. */
  @Test
  void get_includesStoredSummary_inAiContext() {
    // 픽스처: 사용자 + 프로젝트 + 이슈
    long userId = createUser("aic-a");
    TenantContext.set(1L); // tenant#1 (test DB 시드 테넌트)
    String projKey = uniqueKey("AICA");
    long projectId =
        projectService.create(userId, new CreateProjectRequest(projKey, "AiContext A", "x")).id();
    var issue = issueRepository.insert(projectId, 1, "테스트 이슈 A", null, "MID", null, userId);

    // 요약 저장
    summaryRepo.upsert(issue.id(), "리뷰 대기 중", "리뷰어 지정");

    // get() 호출 후 검증
    var detail = issueService.get(userId, projKey, 1);

    assertThat(detail.aiContext()).isNotNull();
    assertThat(detail.aiContext().summary()).isEqualTo("리뷰 대기 중");
    assertThat(detail.aiContext().nextAction()).isEqualTo("리뷰어 지정");
    assertThat(detail.aiContext().generatedAt()).isNotNull();
    assertThat(detail.aiContext().blockers()).isNotNull();
  }

  // ── 케이스 B: 저장 요약 없음 + 블로커 없음 ────────────────────────────────────────

  /** 저장 요약이 없고 블로커도 없으면(TODO 상태, 마감 없음, 선행 이슈 없음) aiContext 가 null 이어야 한다. 프론트 카드 미렌더 조건. */
  @Test
  void get_aiContextNull_whenNoStoredSummary_andNoBlockers() {
    // 픽스처: 사용자 + 프로젝트 + 이슈 (요약 없음, status=TODO, dueDate=null, blocked=false)
    long userId = createUser("aic-b");
    TenantContext.set(1L);
    String projKey = uniqueKey("AICB");
    long projectId =
        projectService.create(userId, new CreateProjectRequest(projKey, "AiContext B", "x")).id();
    issueRepository.insert(projectId, 1, "테스트 이슈 B", null, "MID", null, userId);

    var detail = issueService.get(userId, projKey, 1);

    assertThat(detail.aiContext()).isNull();
  }

  // ── 헬퍼 ────────────────────────────────────────────────────────────────────────

  /** 테스트용 USER + USER_ROLE("USER") 직접 삽입. */
  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        baseDsl
            .insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = baseDsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    baseDsl
        .insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, id)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    return id;
  }

  /** 프로젝트 key 충돌 방지용 고유 키 생성. */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }
}
