package com.workplace.issue.outbound;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * WP-36 통합 테스트 — 이슈 생성 → AFTER_COMMIT IssueSseDispatcher → issue.created 가 프로젝트 멤버 전원에게 fan-out
 * 되는지.
 *
 * <p>핵심 검증: 이슈의 watcher 가 아닌(담당자도 reporter 도 아닌) 멤버도 받아야 한다 — AI Chat 으로 만든 이슈가 목록 화면에 즉시 뜨려면 목록을
 * 보는 모든 멤버가 갱신 신호를 받아야 하기 때문. REQUIRES_NEW 에서 RLS 가 재주입되지 않으면 멤버 조회가 빈 목록이 되므로, 실제 DB 경로로 검증한다.
 * AFTER_COMMIT 발화를 위해 클래스에 @Transactional 을 붙이지 않는다.
 */
@DisplayName("이슈 생성 → issue.created SSE 프로젝트 멤버 fan-out 통합")
class IssueSseFanOutIntegrationTest extends IntegrationTestBase {

  @MockitoBean SseRegistry registry;
  @MockitoBean AiAgentEventClient aiClient; // ai-agent 실제 호출 차단

  @Autowired DSLContext dsl;
  @Autowired IssueService issueService;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository memberRepository;

  // 비-Tx 테스트: 커밋된 row 추적 → @AfterEach 회수.
  private final List<Long> createdUserIds = new ArrayList<>();
  private final List<Long> createdProjectIds = new ArrayList<>();

  @AfterEach
  void cleanup() {
    if (!createdProjectIds.isEmpty()) {
      // issue.project_id 는 CASCADE 아님 → issue 먼저, 그다음 project(member/types CASCADE).
      dsl.deleteFrom(ISSUE).where(ISSUE.PROJECT_ID.in(createdProjectIds)).execute();
      dsl.deleteFrom(PROJECT).where(PROJECT.ID.in(createdProjectIds)).execute();
    }
    if (!createdUserIds.isEmpty()) {
      dsl.deleteFrom(USER_ROLE).where(USER_ROLE.USER_ID.in(createdUserIds)).execute();
      dsl.deleteFrom(USER).where(USER.ID.in(createdUserIds)).execute();
    }
    createdProjectIds.clear();
    createdUserIds.clear();
  }

  /** HUMAN 유저 한 명 생성 + USER 역할 부여. username 은 UUID 접미사로 격리. */
  private Long createHuman(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    createdUserIds.add(id);
    return id;
  }

  /** key 는 2~10자 대문자/숫자. 충돌 회피 위해 UUID 4자 접미사. */
  private String uniqueKey(String prefix) {
    String suffix = UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 4);
    String key = prefix + suffix;
    return key.substring(0, Math.min(10, key.length()));
  }

  @Test
  @DisplayName("담당자 없는 이슈 생성 → watcher 가 아닌 멤버까지 issue.created 수신")
  void create_fansOutIssueCreatedToAllProjectMembers() {
    Long owner = createHuman("owner");
    Long viewer = createHuman("viewer"); // 이슈와 무관한 일반 멤버 — watcher 로 등록되지 않는다
    var proj =
        projectService.create(owner, new CreateProjectRequest(uniqueKey("WP"), "P-sse", "x"));
    createdProjectIds.add(proj.id());
    memberRepository.insert(proj.id(), viewer, "MEMBER");

    var issue =
        issueService.create(
            owner,
            proj.key(),
            new CreateIssueRequest(
                "AI Chat 에서 만든 이슈", "본문", "MID", null, List.of(), null, null, null));

    @SuppressWarnings("unchecked")
    ArgumentCaptor<Collection<Long>> ids = ArgumentCaptor.forClass(Collection.class);
    ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
    verify(registry, timeout(2000)).fanOut(ids.capture(), eq("issue.created"), payload.capture());
    assertThat(ids.getValue()).containsExactlyInAnyOrder(owner, viewer);
    @SuppressWarnings("unchecked")
    var p = (Map<String, Object>) payload.getValue();
    assertThat(p)
        .containsEntry("projectKey", proj.key())
        .containsEntry("issueKey", proj.key() + "-" + issue.number());
  }
}
