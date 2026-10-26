package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.ISSUE_VERSION;
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
 * 이슈 가져오기의 수정 버전·영향 버전(WP-888) — 이름(대소문자 무시)으로 프로젝트에 이미 있는 버전을 연결하고, 보관·출시된 버전도 지난 기록이라 허용하며, 없는
 * 이름은 만들지 않고 쓰기 전에 400 {@code IMPORT_UNKNOWN_VERSIONS} 로 거절한다. 버전 변경 이력은 원래 행위자·시각 그대로 남고, 가져오기는 변경
 * 알림을 내지 않는다.
 */
@Transactional
@RecordApplicationEvents
class IssueImportVersionsTest extends IssueImportTestSupport {

  @Autowired ApplicationEvents events;
  @Autowired IssueImportService importService;
  @Autowired PlatformTransactionManager txManager;

  private long member;

  @BeforeEach
  void seed() {
    seedProject("IV", "버전 가져오기");
    member = member();
  }

  /** 버전 시드 — 관리 API 는 따로 검증되므로 직접 넣는다. */
  private long version(String name) {
    return dsl.fetchOne(
            "INSERT INTO project_version (project_id, name) VALUES (?, ?) RETURNING id",
            projectId,
            name)
        .get(0, Long.class);
  }

  /** 요청 트랜잭션처럼 savepoint 로 감싸 400 이 나고 이슈가 하나도 남지 않음을 본다. 거절 사유(errors)를 돌려준다. */
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
    assertThat(dsl.fetchCount(ISSUE_VERSION)).isZero();
    return errors.get();
  }

  /** 이슈에 붙은 한 종류의 버전 이름(이름순). */
  private List<String> versionNamesOf(int number, String kind) {
    return dsl.fetch(
            "SELECT v.name FROM issue_version iv JOIN project_version v ON v.id = iv.version_id"
                + " WHERE iv.issue_id = ? AND iv.kind = ? ORDER BY v.name",
            issueId(number),
            kind)
        .getValues(0, String.class);
  }

  private Map<String, Object> historyEntry(String type, List<String> added, List<String> removed) {
    Map<String, Object> e = new LinkedHashMap<>();
    e.put("type", type);
    e.put("actor", username(member));
    e.put("at", "2026-06-11T10:00:00+09:00");
    if (added != null) e.put("added", added);
    if (removed != null) e.put("removed", removed);
    return e;
  }

  /** 두 종류 모두 이름을 대소문자·앞뒤 공백 무시로 찾아 붙는다. */
  @Test
  void importsBothKindsByNameIgnoringCase() throws Exception {
    version("v1.0");
    version("v2.0");
    Map<String, Object> m = body("버전");
    m.put("fixVersionNames", List.of("V1.0", " v2.0 "));
    m.put("affectsVersionNames", List.of("V1.0"));

    // 응답 요약에도 두 종류가 이름과 함께 실린다(일반 이슈 응답과 같은 모양).
    int number =
        numberOf(
            importAs(admin, m)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.fixVersions.length()").value(2))
                .andExpect(jsonPath("$.fixVersions[0].name").value("v1.0"))
                .andExpect(jsonPath("$.fixVersions[1].name").value("v2.0"))
                .andExpect(jsonPath("$.affectsVersions.length()").value(1))
                .andExpect(jsonPath("$.affectsVersions[0].name").value("v1.0")));

    assertThat(versionNamesOf(number, "FIX")).containsExactly("v1.0", "v2.0");
    assertThat(versionNamesOf(number, "AFFECTS")).containsExactly("v1.0");
  }

  /** 보관된 버전과 출시된 버전 모두 가져오기는 허용한다. */
  @Test
  void archivedAndReleasedAllowed() throws Exception {
    long old = version("old");
    long rel = version("rel");
    dsl.execute("UPDATE project_version SET archived_at = now() WHERE id = ?", old);
    dsl.execute("UPDATE project_version SET released_at = now() WHERE id = ?", rel);
    Map<String, Object> m = body("보관·출시");
    m.put("fixVersionNames", List.of("old", "rel"));

    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));

    assertThat(versionNamesOf(number, "FIX")).containsExactly("old", "rel");
  }

  /** 대소문자만 다른 같은 이름은 한 행으로 합친다(연결 테이블 중복 위반 500 방지). */
  @Test
  void duplicateNamesCollapse() throws Exception {
    version("v1");
    Map<String, Object> m = body("중복");
    m.put("fixVersionNames", List.of("v1", "V1"));

    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));

    assertThat(dsl.fetchCount(ISSUE_VERSION, ISSUE_VERSION.ISSUE_ID.eq(issueId(number))))
        .isEqualTo(1);
  }

  /** 없는 이름은 만들지 않고 거절 — 두 종류에서 없는 이름을 전부 알리고, 이슈도 버전도 남지 않는다. */
  @Test
  void unknownNameRejectedBeforeWrite() throws Exception {
    version("v1");
    Map<String, Object> m = body("모르는 버전");
    m.put("fixVersionNames", List.of("v1", "Nope"));
    m.put("affectsVersionNames", List.of("Other"));

    Map<String, String> errors = assertRejected(m);
    assertThat(errors).containsEntry("reason", "IMPORT_UNKNOWN_VERSIONS");
    assertThat(errors.get("versions")).isEqualTo("Nope,Other");
    assertThat(dsl.fetchCount(com.workplace.jooq.Tables.PROJECT_VERSION)).isEqualTo(1);
  }

  /** HTTP 응답도 400 + errors.reason 이다. */
  @Test
  void unknownNameIsReportedOverHttp() throws Exception {
    Map<String, Object> m = body("모르는 버전");
    m.put("affectsVersionNames", List.of("Nope"));
    importAs(admin, m)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.reason").value("IMPORT_UNKNOWN_VERSIONS"));
  }

  /** 두 종류의 이력은 원래 행위자·시각 그대로 한 건씩이고, 당시 이름은 저장된 표기로 남는다. 이력만 옮길 뿐 현재 연결은 만들지 않는다. */
  @Test
  void historyImported() throws Exception {
    long v153 = version("v1.5.3");
    version("v2");
    Map<String, Object> m = body("버전 이력");
    m.put(
        "history",
        List.of(
            historyEntry("FIX_VERSIONS_CHANGED", List.of("V1.5.3"), null),
            historyEntry("AFFECTS_VERSIONS_CHANGED", List.of("v2"), List.of("v1.5.3"))));

    events.clear();
    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));

    var fix =
        dsl.selectFrom(ISSUE_HISTORY)
            .where(
                ISSUE_HISTORY
                    .ISSUE_ID
                    .eq(issueId(number))
                    .and(ISSUE_HISTORY.EVENT_TYPE.eq("FIX_VERSIONS_CHANGED")))
            .fetchOne();
    assertThat(fix.getActorId()).isEqualTo(member);
    assertThat(fix.getCreatedAt().toInstant())
        .isEqualTo(t("2026-06-11T10:00:00+09:00").toInstant());
    JsonNode payload = objectMapper.readTree(fix.getToValue());
    assertThat(payload.get("added")).hasSize(1);
    assertThat(payload.get("added").get(0).get("id").asLong()).isEqualTo(v153);
    assertThat(payload.get("added").get(0).get("name").asText()).isEqualTo("v1.5.3");
    assertThat(payload.get("removed")).isEmpty();

    var affects =
        dsl.selectFrom(ISSUE_HISTORY)
            .where(
                ISSUE_HISTORY
                    .ISSUE_ID
                    .eq(issueId(number))
                    .and(ISSUE_HISTORY.EVENT_TYPE.eq("AFFECTS_VERSIONS_CHANGED")))
            .fetchOne();
    JsonNode p2 = objectMapper.readTree(affects.getToValue());
    assertThat(p2.get("added").get(0).get("name").asText()).isEqualTo("v2");
    assertThat(p2.get("removed").get(0).get("name").asText()).isEqualTo("v1.5.3");

    assertThat(versionNamesOf(number, "FIX")).isEmpty();
    assertThat(versionNamesOf(number, "AFFECTS")).isEmpty();
    // 가져오기는 담당자 지정·AI 작업 이벤트를 내지 않는다.
    assertThat(events.stream(IssueAssignedEvent.class)).isEmpty();
    assertThat(events.stream(AgentToolWriteEvent.class)).isEmpty();
  }

  /** 이력의 없는 이름은 거절 — 쓰기가 없다. */
  @Test
  void historyUnknownNameRejected() throws Exception {
    version("v1");
    Map<String, Object> m = body("모르는 이력");
    m.put("history", List.of(historyEntry("FIX_VERSIONS_CHANGED", List.of("v1"), List.of("Nope"))));

    Map<String, String> errors = assertRejected(m);
    assertThat(errors).containsEntry("reason", "IMPORT_UNKNOWN_VERSIONS");
    assertThat(errors.get("versions")).isEqualTo("Nope");
  }

  /** added·removed 가 모두 비면 입력 오류(다른 이력 유형과 같다). */
  @Test
  void historyWithoutChangeRejected() throws Exception {
    Map<String, Object> m = body("변경 없음");
    m.put("history", List.of(historyEntry("AFFECTS_VERSIONS_CHANGED", null, null)));

    Map<String, String> errors = assertRejected(m);
    assertThat(errors).containsEntry("reason", "IMPORT_INVALID_HISTORY");
  }
}
