package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.AgentWorkTestSupport;
import com.workplace.issue.dto.CreateIssueRequest;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;

/**
 * AI 구성원의 하위 항목 자기 배정(WP-375 §3.5) 실제 HTTP 통합 테스트. AI 가 맡은 이슈의 바로 아래 "빈·열린" 하위 항목만 자기 혼자 맡을 수 있고, 그
 * 밖의 담당자 변경은 기존대로 403 임을 확인한다.
 */
class AgentSelfAssignTest extends AgentWorkTestSupport {

  private long c1Id;
  private int c1Number;
  private int c2Number;
  private int c3Number;
  private int s1Number;
  private int xNumber;
  private int oNumber;

  /** 에픽 E(AI 담당) 아래 자식 C1~C3, C1 의 서브태스크 S1, 무관한 이슈 X, 남의 에픽 E2 의 자식 O 를 시드한다. */
  @BeforeEach
  void seedTree() {
    long epicType = typeId("EPIC");
    long subtaskType = typeId("SUBTASK");
    var e = create("에픽 E", epicType, null);
    issueAssigneeRepository.add(e.id(), agentId, humanId);
    var c1 = create("C1", null, e.number());
    c1Id = c1.id();
    c1Number = c1.number();
    var c2 = create("C2", null, e.number());
    c2Number = c2.number();
    issueAssigneeRepository.add(c2.id(), otherId, humanId);
    var c3 = create("C3", null, e.number());
    c3Number = c3.number();
    withTenant(() -> issueService.updateStatus(humanId, projectKey, c3Number, "DONE"));
    s1Number = create("S1", subtaskType, c1Number).number();
    xNumber = create("X", null, null).number();
    var e2 = create("에픽 E2", epicType, null);
    oNumber = create("O", null, e2.number()).number();
  }

  @Test
  void 내가_담당한_에픽의_빈_자식은_자기_혼자_맡을_수_있고_외부_실행이면_시작전_작업이_생긴다() {
    inTenant(
        () -> {
          makeExternal(agentId);
          return null;
        });
    // 수행 도구 헤더를 싣지 않는다 — 헤더가 있으면 쓰기 요청이 곧바로 작업을 WORKING 으로 시작시켜 "시작 전" 상태를 볼 수 없다.
    var r =
        call(
            HttpMethod.PUT,
            assignPath(c1Number),
            akToken,
            Map.of("userIds", List.of(agentId)),
            null);
    assertOk(r);
    assertThat(activeWork(c1Id, agentId).orElseThrow().state()).isEqualTo("SUBMITTED");
  }

  @Test
  void 거부_경계는_모두_403() {
    // 담당자 있는 자식
    assertForbidden(c2Number, List.of(agentId, otherId));
    assertForbidden(c2Number, List.of(agentId));
    // 손자(자식을 아직 맡지 않음)
    assertForbidden(s1Number, List.of(agentId));
    // 닫힌 자식
    assertForbidden(c3Number, List.of(agentId));
    // 부모 없는 이슈, 남이 담당(또는 미담당)한 에픽의 자식
    assertForbidden(xNumber, List.of(agentId));
    assertForbidden(oNumber, List.of(agentId));
    // 빈 자식에 자기 + 다른 사람 동시 추가
    assertForbidden(c1Number, List.of(agentId, otherId));
  }

  @Test
  void 자식을_먼저_맡으면_그_서브태스크도_맡을_수_있다() {
    assertOk(
        call(
            HttpMethod.PUT,
            assignPath(c1Number),
            akToken,
            Map.of("userIds", List.of(agentId)),
            TOOL));
    assertOk(
        call(
            HttpMethod.PUT,
            assignPath(s1Number),
            akToken,
            Map.of("userIds", List.of(agentId)),
            TOOL));
  }

  @Test
  void 자기_제거는_기존대로_허용() {
    assertOk(
        call(
            HttpMethod.PUT,
            assignPath(c1Number),
            akToken,
            Map.of("userIds", List.of(agentId)),
            TOOL));
    assertOk(
        call(HttpMethod.PUT, assignPath(c1Number), akToken, Map.of("userIds", List.of()), TOOL));
  }

  private void assertForbidden(int number, List<Long> userIds) {
    var r = call(HttpMethod.PUT, assignPath(number), akToken, Map.of("userIds", userIds), TOOL);
    assertThat(r.getStatusCode())
        .as("%s → %s", number, r.getBody())
        .isEqualTo(HttpStatus.FORBIDDEN);
  }

  private String assignPath(int number) {
    return "/api/v1/projects/" + projectKey + "/issues/" + number + "/assignees";
  }

  /** 프로젝트의 유형 이름 → id. */
  private long typeId(String name) {
    return inTenant(
        () ->
            dsl.select(ISSUE_TYPE_DEF.ID)
                .from(ISSUE_TYPE_DEF)
                .where(ISSUE_TYPE_DEF.PROJECT_ID.eq(projectId).and(ISSUE_TYPE_DEF.NAME.eq(name)))
                .fetchOne(ISSUE_TYPE_DEF.ID));
  }

  /** 사람 소유자 권한으로 이슈를 만든다(서비스 호출은 요청 밖이라 테넌트를 직접 잡는다). */
  private com.workplace.issue.dto.IssueResponse create(
      String title, Long typeId, Integer parentNumber) {
    return withTenant(
        () ->
            issueService.create(
                humanId,
                projectKey,
                new CreateIssueRequest(
                    title, "본문", "MID", null, List.of(), typeId, parentNumber, null)));
  }

  private <T> T withTenant(java.util.function.Supplier<T> body) {
    TenantContext.set(TENANT_ID);
    try {
      return body.get();
    } finally {
      TenantContext.clear();
    }
  }
}
