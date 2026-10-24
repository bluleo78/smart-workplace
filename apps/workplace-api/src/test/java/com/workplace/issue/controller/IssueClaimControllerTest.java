package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.issue.AgentWorkTestSupport;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.label.repository.LabelRepository;
import com.workplace.support.TestFixtures;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * 라벨 대기열 이슈 가져가기(WP-800) 실제 HTTP 통합 테스트. AI 구성원이 ak_ 키로 {@code POST .../claim} 을 불러 「담당자 추가(사람 유지)
 * + 대기열 라벨 하나 제거」를 한 동작으로 하는지, 조건 불충족이 409 + errors.code 로 거절되는지, 동시 요청에서 하나만 이기는지 확인한다.
 *
 * <p>시드(상위 클래스 이슈를 대기열 상태로 바꾼다): 담당 = 사람 둘(human·other), 라벨 = 「AI 개발팀」(대기열)·「AI 탐색」, AI 담당 없음. 가져가는
 * AI = 프로젝트 구성원인 외부 실행 AI(claimer).
 */
class IssueClaimControllerTest extends AgentWorkTestSupport {

  private static final String QUEUE = "AI 개발팀";
  private static final String OTHER_LABEL = "AI 탐색";

  @Autowired private LabelRepository labelRepository;
  @Autowired private IssueLabelRepository issueLabelRepository;

  private long queueLabelId;
  private long otherLabelId;
  private long claimerId;
  private String claimerToken;

  @BeforeEach
  void seedQueue() {
    // 대기열 상태 — 상위 시드의 AI 담당을 빼고 사람 둘만 남긴다.
    inTenantRun(
        () -> {
          issueAssigneeRepository.remove(issueId, agentId);
          issueAssigneeRepository.add(issueId, otherId, humanId);
          queueLabelId = labelRepository.insert(projectId, QUEUE, "GRAY", humanId).id();
          otherLabelId = labelRepository.insert(projectId, OTHER_LABEL, "BLUE", humanId).id();
          issueLabelRepository.add(issueId, queueLabelId);
          issueLabelRepository.add(issueId, otherLabelId);
        });
    claimerId = addAgentMember("aw-claimer");
    makeExternal(claimerId);
    claimerToken = keyFor(claimerId);
  }

  @Test
  void claim_addsCallerKeepsHumansRemovesOnlyQueueLabel() {
    long assigneeEventsBefore = historyCount("ASSIGNEES_CHANGED");
    long labelEventsBefore = historyCount("LABELS_CHANGED");

    var res = claim(claimerToken, QUEUE);

    assertOk(res);
    JsonNode body = json(res);
    assertThat(field(body.get("assignees"), "id"))
        .containsExactlyInAnyOrder(
            String.valueOf(humanId), String.valueOf(otherId), String.valueOf(claimerId));
    assertThat(field(body.get("labels"), "name")).containsExactly(OTHER_LABEL);
    // DB 에서도 같다.
    assertThat(assignees()).containsExactlyInAnyOrder(humanId, otherId, claimerId);
    assertThat(labelIds()).containsExactly(otherLabelId);
    // 담당자 변경·라벨 변경 이력 각 1건 — 기존 교체 경로를 거친 증거.
    assertThat(historyCount("ASSIGNEES_CHANGED") - assigneeEventsBefore).isEqualTo(1);
    assertThat(historyCount("LABELS_CHANGED") - labelEventsBefore).isEqualTo(1);
  }

  @Test
  void claim_createsAgentWorkForExternalAi() {
    assertOk(claim(claimerToken, QUEUE));

    // 담당자 추가 경로가 만드는 값 그대로 — 외부 실행 AI 의 「시작 전」 진행 중 작업.
    assertThat(activeWork(issueId, claimerId).orElseThrow().state()).isEqualTo("SUBMITTED");
  }

  @Test
  void claim_aiAlreadyAssigned_409() {
    long other = addAgentMember("aw-holder");
    makeExternal(other);
    inTenantRun(() -> issueAssigneeRepository.add(issueId, other, humanId));

    assertRejected(claim(claimerToken, QUEUE), "AI_ALREADY_ASSIGNED");

    assertUnchanged(other);
  }

  @Test
  void claim_internalAiAssigned_409() {
    // 상위 시드 agentId 는 기본 내부 실행(INTERNAL) AI 다.
    inTenantRun(() -> issueAssigneeRepository.add(issueId, agentId, humanId));

    assertRejected(claim(claimerToken, QUEUE), "AI_ALREADY_ASSIGNED");

    assertUnchanged(agentId);
  }

  @Test
  void claim_noQueueLabel_409() {
    // 이슈에서 대기열 라벨을 뗀 경우.
    inTenantRun(() -> issueLabelRepository.remove(issueId, queueLabelId));
    assertRejected(claim(claimerToken, QUEUE), "NOT_IN_QUEUE");

    // 프로젝트에 그 이름의 라벨 자체가 없는 경우.
    assertRejected(claim(claimerToken, "없는 라벨"), "NOT_IN_QUEUE");

    assertThat(assignees()).containsExactlyInAnyOrder(humanId, otherId);
    assertThat(labelIds()).containsExactly(otherLabelId);
  }

  @Test
  void claim_closedIssue_409() {
    for (String status : List.of("DONE", "CANCELED")) {
      setStatus(status);

      assertRejected(claim(claimerToken, QUEUE), "ISSUE_CLOSED");

      assertThat(assignees()).containsExactlyInAnyOrder(humanId, otherId);
      assertThat(labelIds()).containsExactlyInAnyOrder(queueLabelId, otherLabelId);
    }
  }

  @Test
  void claim_byHuman_409() {
    // 사람(프로젝트 멤버)이 불러도 거절 — 라벨만 사라지고 AI 가 안 붙는 상태를 막는다.
    assertRejected(claim(patToken, QUEUE), "CLAIM_AGENT_ONLY");

    assertUnchanged();
  }

  @Test
  void claim_byInternalRuntimeAi_409() {
    // 내부 실행 AI 는 담당자가 돼도 AI 작업이 안 만들어져(외부 실행만 대상) 이슈만 대기열을 떠나 방치된다 — 막는다.
    long internal = addAgentMember("aw-internal");

    assertRejected(claim(keyFor(internal), QUEUE), "CLAIM_AGENT_ONLY");

    assertUnchanged();
  }

  @Test
  void claim_adminNonMember_forbidden() {
    // ADMIN 은 assertMember 를 우회하지만 담당자 후보(프로젝트 구성원)가 아니라, 잠금 전에 비구성원으로 거절돼야 한다.
    long admin = addAgent("aw-admin");
    makeExternal(admin);
    Long adminRole = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, admin)
        .set(USER_ROLE.ROLE_ID, adminRole)
        .onConflictDoNothing()
        .execute();

    var res = claim(keyFor(admin), QUEUE);

    assertThat(res.getStatusCode()).as(res.getBody()).isEqualTo(HttpStatus.FORBIDDEN);
    assertUnchanged();
  }

  /**
   * 목록 필터(IssueFilterResolver)가 라벨 이름을 대소문자 무시로 맞추므로 가져가기도 같아야 한다 — 입력의 대소문자·앞뒤 공백도 무시한다. 대소문자만 다른
   * 같은 이름 라벨이 둘 붙는 경우는 라벨 이름이 대소문자 무시로 유일해져(WP-911) 더는 생기지 않는다.
   */
  @Test
  void claim_labelNameDifferentCase_removesIt() {
    // 한글은 대소문자가 없어 영문 이름으로 바꾼 뒤 대소문자·공백이 다른 입력으로 가져간다.
    labelRepository.update(queueLabelId, "AI Dev Team", "GRAY");

    var res = claim(claimerToken, "  ai dev team ");

    assertOk(res);
    assertThat(labelIds()).containsExactly(otherLabelId);
    assertThat(assignees()).contains(claimerId);
    assertThat(field(json(res).get("labels"), "name")).containsExactly(OTHER_LABEL);
  }

  @Test
  void claim_nonMember_forbidden() {
    long outsider = addAgent("aw-outsider");

    String token = keyFor(outsider);

    var res = claim(token, QUEUE);

    // 기존 권한 오류와 같은 상태 — 담당자 교체(같은 assertMember 가드)가 비멤버에게 돌려주는 상태(비공개 프로젝트는 존재를 숨겨 404)와 같다.
    var existing = putAssignees(token, List.of(outsider), TOOL);
    assertThat(res.getStatusCode().is4xxClientError()).as(res.getBody()).isTrue();
    assertThat(res.getStatusCode()).isEqualTo(existing.getStatusCode());
    assertUnchanged();
  }

  @Test
  void claim_concurrent_onlyOneWins() throws Exception {
    long secondId = addAgentMember("aw-claimer2");
    makeExternal(secondId);
    String secondToken = keyFor(secondId);

    var ready = new CountDownLatch(2);
    var go = new CountDownLatch(1);
    var pool = Executors.newFixedThreadPool(2);
    try {
      List<Future<ResponseEntity<String>>> futures = new ArrayList<>();
      for (String token : List.of(claimerToken, secondToken)) {
        futures.add(
            pool.submit(
                () -> {
                  ready.countDown();
                  go.await();
                  return claim(token, QUEUE);
                }));
      }
      ready.await();
      go.countDown();
      var results = List.of(futures.get(0).get(), futures.get(1).get());

      assertThat(results.stream().filter(r -> r.getStatusCode().is2xxSuccessful()).count())
          .as("승자는 정확히 하나: %s", results)
          .isEqualTo(1);
      var loser =
          results.stream().filter(r -> r.getStatusCode().value() == 409).findFirst().orElseThrow();
      assertThat(json(loser).get("errors").get("code").asText())
          .isIn("NOT_IN_QUEUE", "AI_ALREADY_ASSIGNED");
    } finally {
      pool.shutdownNow();
    }
    // 최종 AI 담당은 1명, 사람 담당은 그대로, 대기열 라벨은 사라짐.
    var finalAssignees = assignees();
    assertThat(finalAssignees).contains(humanId, otherId);
    assertThat(finalAssignees.stream().filter(id -> id == claimerId || id == secondId).count())
        .isEqualTo(1);
    assertThat(labelIds()).containsExactly(otherLabelId);
  }

  @Test
  void claim_blankLabel_400() {
    assertThat(claim(claimerToken, "  ").getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(labelIds()).containsExactlyInAnyOrder(queueLabelId, otherLabelId);
  }

  // ---------------------------------------------------------------- helpers

  /** POST .../claim. */
  private ResponseEntity<String> claim(String token, String queueLabel) {
    return call(
        HttpMethod.POST, issuePath() + "/claim", token, Map.of("queueLabel", queueLabel), TOOL);
  }

  /** 거절 응답이 409 이고 errors.code 가 기대값인지. */
  private static void assertRejected(ResponseEntity<String> res, String code) {
    assertThat(res.getStatusCode()).as(res.getBody()).isEqualTo(HttpStatus.CONFLICT);
    assertThat(json(res).get("errors").get("code").asText()).isEqualTo(code);
  }

  /** 담당자(사람 둘 + extra)·라벨(대기열·다른 라벨)이 거절 전 그대로인지. */
  private void assertUnchanged(Long... extraAssignees) {
    var expected = new ArrayList<>(List.of(humanId, otherId));
    expected.addAll(List.of(extraAssignees));
    assertThat(assignees()).containsExactlyInAnyOrderElementsOf(expected);
    assertThat(labelIds()).containsExactlyInAnyOrder(queueLabelId, otherLabelId);
  }

  private List<Long> assignees() {
    return inTenant(() -> issueAssigneeRepository.findUserIdsByIssue(issueId));
  }

  private List<Long> labelIds() {
    return inTenant(() -> issueLabelRepository.findLabelIdsByIssue(issueId));
  }

  private long historyCount(String eventType) {
    return inTenant(
        () ->
            dsl.fetchCount(
                ISSUE_HISTORY,
                ISSUE_HISTORY.ISSUE_ID.eq(issueId).and(ISSUE_HISTORY.EVENT_TYPE.eq(eventType))));
  }

  private void setStatus(String status) {
    inTenant(
        () ->
            dsl.update(ISSUE)
                .set(ISSUE.STATUS, status)
                .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, status))
                .where(ISSUE.ID.eq(issueId))
                .execute());
  }

  /** JSON 배열 각 원소의 한 필드를 문자열로 뽑는다(id 도 문자열로 비교). */
  private static List<String> field(JsonNode array, String name) {
    var out = new ArrayList<String>();
    array.forEach(n -> out.add(n.get(name).asText()));
    return out;
  }
}
