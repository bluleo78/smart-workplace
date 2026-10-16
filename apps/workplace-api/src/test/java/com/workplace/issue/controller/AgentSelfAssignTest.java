package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.support.RowLockWaits.awaitLockWaiter;
import static com.workplace.support.RowLockWaits.awaitQuietly;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.AgentWorkTestSupport;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.exception.IssueAssigneeAgentRestrictionException;
import com.workplace.issue.service.IssueAssigneeService;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * AI 구성원의 하위 항목 자기 배정(WP-375 §3.5) 실제 HTTP 통합 테스트. AI 가 맡은 이슈의 바로 아래 "빈·열린" 하위 항목만 자기 혼자 맡을 수 있고, 그
 * 밖의 담당자 변경은 기존대로 403 임을 확인한다.
 */
class AgentSelfAssignTest extends AgentWorkTestSupport {

  @Autowired private IssueAssigneeService assigneeService;

  private int epicNumber;
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
    epicNumber = e.number();
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
    // 수행 도구 헤더 없이 보낸다 — 담당자 추가가 "시작 전" 작업을 만드는지만 본다(담당자 변경은 정리성 쓰기라 헤더가 있어도 시작하지 않는다, WP-425).
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

  @Test
  void 자기가_자기_이슈_아래로_옮긴_이슈는_맡을_수_없고_사람이_옮긴_이슈는_맡을_수_있다() {
    // AI 가 부모 없는 X 를 자기 에픽 아래로 옮긴 뒤 맡으려 하면 거부 — 아무 빈 이슈나 끌어와 맡는 우회를 막는다.
    assertOk(setParent(xNumber, akToken, TOOL, epicNumber));
    assertForbidden(xNumber, List.of(agentId));
    // 사람이 다시 옮겨 마지막 부모 변경자가 사람이면 기존 규칙대로 맡을 수 있다.
    assertOk(setParent(xNumber, jwtToken, null, null));
    assertOk(setParent(xNumber, jwtToken, null, epicNumber));
    assertOk(
        call(
            HttpMethod.PUT,
            assignPath(xNumber),
            akToken,
            Map.of("userIds", List.of(agentId)),
            TOOL));
  }

  @Test
  void 같은_빈_자식의_담당을_동시에_바꾸면_뒤에_온_AI_자기_배정은_앞의_담당을_보고_거부된다() throws Exception {
    // 사람이 C1 을 다른 사람에게 배정하는 동안 AI 가 C1 을 맡으려 하면, AI 는 C1 행 잠금에서 기다렸다가 배정 뒤 상태로 판정된다.
    var result =
        claimWhileHolding(
            () -> assigneeService.replace(humanId, projectKey, c1Number, List.of(otherId)));
    assertThat(result).isInstanceOf(IssueAssigneeAgentRestrictionException.class);
    assertThat(inTenant(() -> issueAssigneeRepository.findUserIdsByIssue(c1Id)))
        .containsExactly(otherId);
  }

  @Test
  void 부모에서_AI_를_빼는_교체와_겹치면_AI_자기_배정은_그_교체가_끝난_뒤_판정돼_거부된다() throws Exception {
    // 사람이 에픽 E 담당자에서 AI 를 빼는 동안 AI 가 C1 을 맡으려 하면, AI 는 부모 E 행 공유 잠금에서 기다렸다가 빠진 뒤 상태로 판정된다.
    var result =
        claimWhileHolding(
            () -> assigneeService.replace(humanId, projectKey, epicNumber, List.of()));
    assertThat(result).isInstanceOf(IssueAssigneeAgentRestrictionException.class);
    assertThat(inTenant(() -> issueAssigneeRepository.findUserIdsByIssue(c1Id))).isEmpty();
  }

  /**
   * holder 를 커밋하지 않은 트랜잭션에서 실행해 행 잠금을 쥔 채, 다른 스레드에서 AI 의 C1 자기 배정을 보낸다. 자기 배정이 잠금 대기에 든 것을 확인한 뒤
   * holder 를 커밋하고 자기 배정 결과(성공이면 null, 실패면 예외)를 돌려준다. 잠그지 않는 구현이면 자기 배정이 대기 없이 끝나 대기 확인에서 실패한다.
   */
  private Throwable claimWhileHolding(Runnable holderAction) throws Exception {
    CountDownLatch locked = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> holder =
          pool.submit(
              () ->
                  inTenant(
                      () -> {
                        holderAction.run();
                        locked.countDown();
                        awaitQuietly(release);
                        return null;
                      }));
      assertThat(locked.await(10, TimeUnit.SECONDS)).isTrue();
      Future<Throwable> claimer = pool.submit(() -> claimInBackground(c1Number));
      awaitLockWaiter(claimer);
      release.countDown();
      holder.get(10, TimeUnit.SECONDS);
      return claimer.get(10, TimeUnit.SECONDS);
    } finally {
      release.countDown();
      pool.shutdownNow();
    }
  }

  /**
   * 다른 스레드에서 AI 자기 배정 — 성공이면 null, 실패면 던진 예외. 바깥 트랜잭션 없이 불러 거부 예외가 감싼 트랜잭션을 rollback-only 로 만들지 않게.
   */
  private Throwable claimInBackground(int number) {
    return withTenant(
        () -> {
          try {
            assigneeService.replace(agentId, projectKey, number, List.of(agentId));
            return null;
          } catch (Throwable t) {
            return t;
          }
        });
  }

  private void assertForbidden(int number, List<Long> userIds) {
    var r = call(HttpMethod.PUT, assignPath(number), akToken, Map.of("userIds", userIds), TOOL);
    assertThat(r.getStatusCode())
        .as("%s → %s", number, r.getBody())
        .isEqualTo(HttpStatus.FORBIDDEN);
  }

  /** 부모 설정(parent 가 null 이면 해제). singletonMap 은 Map.of 와 달리 null 값을 받는다. */
  private ResponseEntity<String> setParent(int number, String token, String tool, Integer parent) {
    return call(
        HttpMethod.PATCH,
        "/api/v1/projects/" + projectKey + "/issues/" + number + "/parent",
        token,
        Collections.singletonMap("parentNumber", parent),
        tool);
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
