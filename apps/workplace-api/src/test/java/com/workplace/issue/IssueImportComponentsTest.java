package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_COMPONENT;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.PROJECT_COMPONENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.issue.dto.ImportIssueRequest;
import com.workplace.issue.exception.IssueImportException;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.service.IssueImportService;
import com.workplace.issue.service.IssueService;
import com.workplace.watcher.outbound.WatcherDomainEvents.WatcherAddedEvent;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 이슈 가져오기의 구성요소(WP-933) — 이름(대소문자 무시)으로 이미 있는 구성요소를 연결하고, 보관된 것도 지난 기록이라 허용하며, 없는 이름은 만들지 않고 쓰기 전에
 * 400 {@code IMPORT_UNKNOWN_COMPONENTS} 로 거절한다. 구성요소 변경 이력은 원래 행위자·시각 그대로 남고, 가져오기는 구성요소 담당자 자동 지정을
 * 하지 않는다.
 */
@Transactional
@RecordApplicationEvents
class IssueImportComponentsTest extends IssueImportTestSupport {

  @Autowired ApplicationEvents events;
  @Autowired IssueImportService importService;
  @Autowired IssueService issueService;
  @Autowired PlatformTransactionManager txManager;

  private long member;

  @BeforeEach
  void seed() {
    seedProject("IK", "구성요소 가져오기");
    member = member();
  }

  /** 구성요소 시드 — 관리 API 는 따로 검증되므로 직접 넣는다. */
  private long component(String name, Long defaultAssigneeId) {
    return dsl.insertInto(PROJECT_COMPONENT)
        .set(PROJECT_COMPONENT.PROJECT_ID, projectId)
        .set(PROJECT_COMPONENT.NAME, name)
        .set(PROJECT_COMPONENT.DEFAULT_ASSIGNEE_ID, defaultAssigneeId)
        .returning(PROJECT_COMPONENT.ID)
        .fetchOne()
        .getId();
  }

  /** 요청 트랜잭션처럼 savepoint 로 감싸 400 이 나고 이슈가 하나도 남지 않음을 본다. 거절 사유(errors.reason)와 이름 목록을 돌려준다. */
  private Map<String, String> assertRejected(Map<String, Object> m) {
    ImportIssueRequest req = objectMapper.convertValue(m, ImportIssueRequest.class);
    var tt = new TransactionTemplate(txManager);
    tt.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    AtomicReference<Map<String, String>> errors = new AtomicReference<>();
    assertThatThrownBy(
            () -> tt.executeWithoutResult(s -> importService.importIssue(admin, key, req)))
        .isInstanceOfSatisfying(
            IssueImportException.class,
            e -> {
              assertThat(e.status()).isEqualTo(HttpStatus.BAD_REQUEST);
              errors.set(e.errors());
            });
    assertThat(dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId))).isZero();
    assertThat(dsl.fetchCount(ISSUE_COMPONENT)).isZero();
    return errors.get();
  }

  private List<String> componentNamesOf(int number) {
    return dsl.select(PROJECT_COMPONENT.NAME)
        .from(ISSUE_COMPONENT)
        .join(PROJECT_COMPONENT)
        .on(PROJECT_COMPONENT.ID.eq(ISSUE_COMPONENT.COMPONENT_ID))
        .where(ISSUE_COMPONENT.ISSUE_ID.eq(issueId(number)))
        .orderBy(PROJECT_COMPONENT.NAME)
        .fetch(PROJECT_COMPONENT.NAME);
  }

  /** 이름은 대소문자·앞뒤 공백을 무시해 찾고, 응답 요약과 저장된 연결이 같다. 같은 구성요소를 다른 표기로 두 번 적어도 한 번만 붙는다. */
  @Test
  void importsComponentsByNameIgnoringCase() throws Exception {
    component("Compute", null);
    component("Network", null);
    Map<String, Object> m = body("구성요소");
    m.put("componentNames", List.of("compute", " Network ", "COMPUTE"));

    var r = importAs(admin, m).andExpect(status().isCreated());
    r.andExpect(jsonPath("$.components.length()").value(2))
        .andExpect(jsonPath("$.components[0].name").value("Compute"))
        .andExpect(jsonPath("$.components[1].name").value("Network"));

    int number = numberOf(r);
    assertThat(componentNamesOf(number)).containsExactly("Compute", "Network");
    // 상세 조회도 같은 이름.
    assertThat(issueService.get(admin, key, number).summary().components())
        .extracting(c -> c.name())
        .containsExactly("Compute", "Network");
  }

  /**
   * 저장된 이름은 NFC 인데 요청이 분해형(NFD) 한글이거나 줄바꿈이 섞여 와도 같은 구성요소로 찾는다 — 현재 연결(componentNames)과 이력 모두. 정규화가
   * 없으면 IMPORT_UNKNOWN_COMPONENTS 로 거절됐다.
   */
  @Test
  void importsComponentsByNormalizedName() throws Exception {
    long compute = component("컴퓨트", null);
    component("Network", null);
    String nfd = java.text.Normalizer.normalize("컴퓨트", java.text.Normalizer.Form.NFD);
    assertThat(nfd).isNotEqualTo("컴퓨트");
    Map<String, Object> e = new LinkedHashMap<>();
    e.put("type", "COMPONENTS_CHANGED");
    e.put("actor", username(member));
    e.put("at", "2026-06-11T10:00:00+09:00");
    e.put("added", List.of(nfd));
    Map<String, Object> m = body("정규화 이름");
    // 줄바꿈이 끼거나 끝에 붙은 이름도 저장 이름 규칙(줄바꿈→공백, 앞뒤 제거)으로 맞춰진다.
    m.put("componentNames", List.of(nfd, "Network\n"));
    m.put("history", List.of(e));

    var r =
        importAs(admin, m)
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.components.length()").value(2));
    int number = numberOf(r);
    assertThat(componentNamesOf(number)).containsExactly("컴퓨트", "Network");
    var rows =
        dsl.selectFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.eq(issueId(number))).fetch();
    assertThat(rows).hasSize(1);
    assertThat(
            objectMapper.readTree(rows.get(0).getToValue()).get("added").get(0).get("id").asLong())
        .isEqualTo(compute);
  }

  /** 보관된 구성요소도 지난 기록이라 이름으로 연결된다(일반 생성은 400 COMPONENT_ARCHIVED). */
  @Test
  void archivedAllowed() throws Exception {
    long old = component("Legacy", null);
    dsl.execute("UPDATE project_component SET archived_at = now() WHERE id = ?", old);
    Map<String, Object> m = body("보관된 구성요소");
    m.put("componentNames", List.of("Legacy"));

    var r =
        importAs(admin, m)
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.components[0].name").value("Legacy"))
            .andExpect(jsonPath("$.components[0].archived").value(true));
    assertThat(componentNamesOf(numberOf(r))).containsExactly("Legacy");
  }

  /** 없는 이름은 만들지 않고 거절 — 없는 이름을 전부 알리고, 이슈도 구성요소도 남지 않는다. */
  @Test
  void unknownNameRejectedBeforeWrite() throws Exception {
    component("Compute", null);
    Map<String, Object> m = body("모르는 구성요소");
    m.put("componentNames", List.of("Compute", "Nope", "Other"));

    Map<String, String> errors = assertRejected(m);
    assertThat(errors).containsEntry("reason", "IMPORT_UNKNOWN_COMPONENTS");
    assertThat(errors.get("components")).isEqualTo("Nope,Other");
    // 가져오기가 구성요소를 만들지 않았다.
    assertThat(dsl.fetchCount(PROJECT_COMPONENT, PROJECT_COMPONENT.PROJECT_ID.eq(projectId)))
        .isEqualTo(1);
  }

  /** HTTP 응답도 400 + errors.reason 이다. */
  @Test
  void unknownNameIsReportedOverHttp() throws Exception {
    Map<String, Object> m = body("모르는 구성요소");
    m.put("componentNames", List.of("Nope"));
    importAs(admin, m)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_UNKNOWN_COMPONENTS"));
  }

  /** COMPONENTS_CHANGED 이력은 원래 행위자·시각 그대로 한 건이고, 당시 이름은 저장된 표기로 남는다. */
  @Test
  void historyImported() throws Exception {
    long compute = component("Compute", null);
    component("Network", null);
    Map<String, Object> added = new LinkedHashMap<>();
    added.put("type", "COMPONENTS_CHANGED");
    added.put("actor", username(member));
    added.put("at", "2026-06-11T10:00:00+09:00");
    added.put("added", List.of("compute"));
    Map<String, Object> m = body("구성요소 이력");
    m.put("history", List.of(added));

    events.clear();
    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));

    var rows =
        dsl.selectFrom(ISSUE_HISTORY).where(ISSUE_HISTORY.ISSUE_ID.eq(issueId(number))).fetch();
    assertThat(rows).hasSize(1);
    var row = rows.get(0);
    assertThat(row.getEventType()).isEqualTo("COMPONENTS_CHANGED");
    assertThat(row.getActorId()).isEqualTo(member);
    assertThat(row.getCreatedAt().toInstant())
        .isEqualTo(t("2026-06-11T10:00:00+09:00").toInstant());
    JsonNode payload = objectMapper.readTree(row.getToValue());
    assertThat(payload.get("added")).hasSize(1);
    assertThat(payload.get("added").get(0).get("id").asLong()).isEqualTo(compute);
    assertThat(payload.get("added").get(0).get("name").asText()).isEqualTo("Compute");
    assertThat(payload.get("removed")).isEmpty();
    // 이력만 옮겼을 뿐 현재 연결은 만들지 않는다 — 연결은 componentNames 가 정한다.
    assertThat(componentNamesOf(number)).isEmpty();
  }

  /** 이력의 없는 이름은 거절 — 쓰기가 없다. */
  @Test
  void historyUnknownNameRejected() throws Exception {
    component("Compute", null);
    Map<String, Object> e = new LinkedHashMap<>();
    e.put("type", "COMPONENTS_CHANGED");
    e.put("actor", username(member));
    e.put("at", "2026-06-11T10:00:00+09:00");
    e.put("added", List.of("Compute"));
    e.put("removed", List.of("Nope"));
    Map<String, Object> m = body("모르는 이력");
    m.put("history", List.of(e));

    Map<String, String> errors = assertRejected(m);
    assertThat(errors).containsEntry("reason", "IMPORT_UNKNOWN_COMPONENTS");
    assertThat(errors.get("components")).isEqualTo("Nope");
  }

  /** added·removed 가 모두 비면 입력 오류(다른 이력 유형과 같다). */
  @Test
  void historyWithoutChangeRejected() throws Exception {
    Map<String, Object> e = new LinkedHashMap<>();
    e.put("type", "COMPONENTS_CHANGED");
    e.put("actor", username(member));
    e.put("at", "2026-06-11T10:00:00+09:00");
    Map<String, Object> m = body("변경 없음");
    m.put("history", List.of(e));

    Map<String, String> errors = assertRejected(m);
    assertThat(errors).containsEntry("reason", "IMPORT_INVALID_HISTORY");
  }

  /** 담당자 없이, 담당자가 있는 구성요소로 가져와도 자동 지정이 없다 — 담당자·담당자 이력·알림 원인 이벤트가 모두 없다. */
  @Test
  void importDoesNotAutoAssign() throws Exception {
    component("Compute", member);
    Map<String, Object> m = body("자동 지정 없음");
    m.put("componentNames", List.of("Compute"));

    events.clear();
    var r =
        importAs(admin, m)
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.assignees.length()").value(0))
            .andExpect(jsonPath("$.components[0].name").value("Compute"));
    long issueId = issueId(numberOf(r));

    assertThat(dsl.fetchCount(ISSUE_ASSIGNEE, ISSUE_ASSIGNEE.ISSUE_ID.eq(issueId))).isZero();
    assertThat(
            dsl.fetchCount(
                ISSUE_HISTORY,
                ISSUE_HISTORY
                    .ISSUE_ID
                    .eq(issueId)
                    .and(ISSUE_HISTORY.EVENT_TYPE.eq("ASSIGNEES_CHANGED"))))
        .isZero();
    assertThat(events.stream(IssueAssignedEvent.class)).isEmpty();
    assertThat(events.stream(WatcherAddedEvent.class)).isEmpty();
    assertThat(events.stream(AgentToolWriteEvent.class)).isEmpty();
  }
}
