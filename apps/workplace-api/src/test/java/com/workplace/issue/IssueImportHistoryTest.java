package com.workplace.issue;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.home.dto.ActivityEntryResponse;
import com.workplace.home.repository.HomeActivityRepository;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.ImportIssueRequest;
import com.workplace.issue.dto.IssueHistoryEntryResponse;
import com.workplace.issue.dto.ProjectStatusRow;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.exception.IssueImportException;
import com.workplace.issue.outbound.AgentToolWriteEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssuePriorityChangedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.issue.repository.ProjectStatusRepository;
import com.workplace.issue.service.IssueAssigneeService;
import com.workplace.issue.service.IssueImportService;
import com.workplace.issue.service.IssueLabelService;
import com.workplace.issue.service.IssueService;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.watcher.outbound.WatcherDomainEvents.WatcherAddedEvent;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
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
 * 이슈 가져오기의 변경 이력(WP-883) — 원래 행위자·시각, 상태는 id 로 받아 지금 이름으로 저장, 일반 변경과 같은 저장 모양, 잘못된 항목은 400 으로 전부
 * 롤백, 알림 원인 이벤트 0건. 준비는 {@link IssueImportContentTest} 와 같은 모양의 최소판이다.
 */
@Transactional
@RecordApplicationEvents
class IssueImportHistoryTest extends IssueImportTestSupport {

  @Autowired ApplicationEvents events;
  @Autowired ProjectStatusRepository statusRepository;
  @Autowired IssueTypeRepository typeRepository;
  @Autowired IssueService issueService;
  @Autowired IssueImportService importService;
  @Autowired PlatformTransactionManager txManager;
  @Autowired com.workplace.label.repository.LabelRepository labelRepository;
  @Autowired IssueAssigneeService assigneeService;
  @Autowired IssueLabelService labelService;
  @Autowired HomeActivityRepository homeActivityRepository;

  private long userB;
  private long userC;

  @BeforeEach
  void seed() {
    seedProject("IH", "이력");
    userB = member();
    userC = member();
  }

  private Map<String, Object> entry(String type, long actor, String at) {
    Map<String, Object> h = new LinkedHashMap<>();
    h.put("type", type);
    h.put("actor", username(actor));
    h.put("at", at);
    return h;
  }

  /** 상세 이력을 시각 오름차순으로. */
  private List<IssueHistoryEntryResponse> history(int number) {
    return issueService.get(admin, key, number).history().stream()
        .sorted(Comparator.comparing(IssueHistoryEntryResponse::createdAt))
        .toList();
  }

  /** 요청 트랜잭션처럼 savepoint 로 감싸 400(IssueImportException)이 나고 이슈·이력이 하나도 남지 않음을 본다(테스트 트랜잭션 안이라). */
  private void assertRejected(Map<String, Object> m) {
    ImportIssueRequest req = objectMapper.convertValue(m, ImportIssueRequest.class);
    var tt = new TransactionTemplate(txManager);
    tt.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    assertThatThrownBy(
            () -> tt.executeWithoutResult(s -> importService.importIssue(admin, key, req)))
        .isInstanceOfSatisfying(
            IssueImportException.class,
            e -> assertThat(e.status()).isEqualTo(HttpStatus.BAD_REQUEST));
    assertThat(dsl.fetchCount(ISSUE, ISSUE.PROJECT_ID.eq(projectId))).isZero();
    assertThat(dsl.fetchCount(ISSUE_HISTORY, ISSUE_HISTORY.ACTOR_ID.eq(userB))).isZero();
  }

  private void assertNoNotificationEvents() {
    assertThat(events.stream(IssueStatusChangedEvent.class)).isEmpty();
    assertThat(events.stream(IssuePriorityChangedEvent.class)).isEmpty();
    assertThat(events.stream(IssueAssignedEvent.class)).isEmpty();
    assertThat(events.stream(WatcherAddedEvent.class)).isEmpty();
    assertThat(events.stream(AgentToolWriteEvent.class)).isEmpty();
  }

  /** 프로젝트 상태를 위치순으로. */
  private List<ProjectStatusRow> statuses(long pid) {
    return statusRepository.findByProject(pid);
  }

  @Test
  void statusHistory_byStatusId_storesCurrentNames() throws Exception {
    List<ProjectStatusRow> st = statuses(projectId);
    ProjectStatusRow inProgress =
        st.stream().filter(s -> "IN_PROGRESS".equals(s.category())).findFirst().orElseThrow();
    ProjectStatusRow done =
        st.stream().filter(s -> "DONE".equals(s.category())).findFirst().orElseThrow();

    Map<String, Object> first = entry("STATUS_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    first.put("toStatusId", inProgress.id());
    Map<String, Object> second = entry("STATUS_CHANGED", userC, "2026-06-20T10:00:00+09:00");
    second.put("fromStatusId", inProgress.id());
    second.put("toStatusId", done.id());
    Map<String, Object> m = body("상태 이력");
    // 일부러 시각 역순으로 보내도 받은 대로 넣고 활동 목록이 시각으로 정렬한다.
    m.put("history", List.of(second, first));

    events.clear();
    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));

    var h = history(number);
    assertThat(h).hasSize(2);
    assertThat(h).extracting(x -> x.eventType()).containsOnly("STATUS_CHANGED");
    assertThat(h.get(0).fromValue()).isNull();
    assertThat(h.get(0).toValue()).isEqualTo(inProgress.name());
    assertThat(h.get(1).fromValue()).isEqualTo(inProgress.name());
    assertThat(h.get(1).toValue()).isEqualTo(done.name());
    assertThat(h.get(0).actorUsername()).isEqualTo(username(userB));
    assertThat(h.get(1).actorUsername()).isEqualTo(username(userC));
    assertThat(h.get(0).createdAt()).isEqualTo(t("2026-06-11T10:00:00+09:00").toInstant());
    assertThat(h.get(1).createdAt()).isEqualTo(t("2026-06-20T10:00:00+09:00").toInstant());
    assertNoNotificationEvents();
  }

  @Test
  void statusOfOtherProject_400() throws Exception {
    String otherKey =
        "IO" + UUID.randomUUID().toString().replace("-", "").substring(0, 6).toUpperCase();
    long otherId = projectService.create(owner, new CreateProjectRequest(otherKey, "다른", "x")).id();
    long foreign = statuses(otherId).get(0).id();
    Map<String, Object> e = entry("STATUS_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    e.put("toStatusId", foreign);
    Map<String, Object> m = body("남의 상태");
    m.put("history", List.of(e));
    assertRejected(m);
  }

  @Test
  void unknownType_400() throws Exception {
    Map<String, Object> e = entry("CYCLE_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    e.put("to", "x");
    Map<String, Object> m = body("모르는 유형");
    m.put("history", List.of(e));
    assertRejected(m);
  }

  @Test
  void badDate_400() throws Exception {
    Map<String, Object> ok = entry("TITLE_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    ok.put("to", "새 제목");
    Map<String, Object> e = entry("DUE_DATE_CHANGED", userB, "2026-06-12T10:00:00+09:00");
    e.put("to", "2026-13-45");
    Map<String, Object> m = body("나쁜 날짜");
    m.put("history", List.of(ok, e));
    // 앞의 정상 항목도 남지 않는다.
    assertRejected(m);
    assertThat(dsl.fetchCount(ISSUE_HISTORY, ISSUE_HISTORY.ACTOR_ID.eq(userB))).isZero();
  }

  @Test
  void badPriority_400() throws Exception {
    Map<String, Object> e = entry("PRIORITY_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    e.put("to", "URGENT");
    Map<String, Object> m = body("나쁜 우선순위");
    m.put("history", List.of(e));
    assertRejected(m);
  }

  /** 라벨 이름은 생성 때와 같은 규칙(앞뒤 공백 제거)으로 찾는다 — 같은 요청이 만든 라벨이 이력에서 못 찾히면 안 된다. */
  @Test
  void labelHistory_namesNormalizedLikeLabelNames() throws Exception {
    Map<String, Object> e = entry("LABELS_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    e.put("added", List.of(" Bug "));
    Map<String, Object> m = body("공백 라벨");
    m.put("labelNames", List.of(" Bug "));
    m.put("history", List.of(e));
    int number = numberOf(importAs(admin, m).andExpect(status().isCreated()));
    assertThat(history(number)).extracting(x -> x.eventType()).containsExactly("LABELS_CHANGED");
    assertThat(history(number).get(0).toValue()).contains("Bug");
  }

  /** 변화 없는 이력(from == to)은 활동 목록에 의미 없는 행만 남기므로 400. */
  @Test
  void noOpHistory_400() throws Exception {
    long status = statuses(projectId).get(0).id();
    long type = typeRepository.findByProject(projectId).get(0).id();
    Map<String, Object> s = entry("STATUS_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    s.put("fromStatusId", status);
    s.put("toStatusId", status);
    Map<String, Object> p = entry("PRIORITY_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    p.put("from", "MID");
    p.put("to", "MID");
    Map<String, Object> ti = entry("TITLE_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    ti.put("from", "같다");
    ti.put("to", "같다");
    Map<String, Object> d = entry("DUE_DATE_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    d.put("from", "2026-07-01");
    d.put("to", "2026-07-01");
    Map<String, Object> sd = entry("START_DATE_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    Map<String, Object> ty = entry("TYPE_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    ty.put("fromTypeId", type);
    ty.put("toTypeId", type);
    for (Map<String, Object> e : List.of(s, p, ti, d, sd, ty)) {
      Map<String, Object> m = body("변화 없음 " + e.get("type"));
      m.put("history", List.of(e));
      assertRejected(m);
    }
  }

  @Test
  void unknownLabel_400() throws Exception {
    Map<String, Object> e = entry("LABELS_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    e.put("added", List.of("없는라벨"));
    Map<String, Object> m = body("없는 라벨");
    m.put("history", List.of(e));
    assertRejected(m);
  }

  /** JSON 값의 키 경로 집합 — 값이 아니라 모양을 비교한다. 배열은 첫 원소 기준. */
  private Set<String> shape(String value) throws Exception {
    Set<String> out = new TreeSet<>();
    if (value == null) return out;
    if (!value.startsWith("{")) {
      out.add("<scalar>");
      return out;
    }
    collect("", objectMapper.readTree(value), out);
    return out;
  }

  private void collect(String prefix, JsonNode n, Set<String> out) {
    if (n.isObject()) {
      n.fields().forEachRemaining(f -> collect(prefix + "/" + f.getKey(), f.getValue(), out));
    } else if (n.isArray()) {
      if (n.size() > 0) collect(prefix + "[]", n.get(0), out);
      else out.add(prefix + "[]");
    } else {
      out.add(prefix);
    }
  }

  @Test
  void assigneesLabelsTypeTitleDates_roundTrip() throws Exception {
    var types = typeRepository.findByProject(projectId);
    long typeA = types.get(0).id();
    long typeB = types.get(1).id();

    // 가져오기 — 유형별 한 건씩.
    Map<String, Object> assignees = entry("ASSIGNEES_CHANGED", userB, "2026-06-11T10:00:00+09:00");
    assignees.put("added", List.of(username(userC)));
    assignees.put("removed", List.of(username(userB)));
    Map<String, Object> labels = entry("LABELS_CHANGED", userB, "2026-06-12T10:00:00+09:00");
    labels.put("added", List.of("가져온라벨"));
    Map<String, Object> type = entry("TYPE_CHANGED", userB, "2026-06-13T10:00:00+09:00");
    type.put("fromTypeId", typeA);
    type.put("toTypeId", typeB);
    Map<String, Object> title = entry("TITLE_CHANGED", userB, "2026-06-14T10:00:00+09:00");
    title.put("from", "이전");
    title.put("to", "이후");
    Map<String, Object> due = entry("DUE_DATE_CHANGED", userB, "2026-06-15T10:00:00+09:00");
    due.put("to", "2026-07-01");
    Map<String, Object> start = entry("START_DATE_CHANGED", userB, "2026-06-16T10:00:00+09:00");
    start.put("to", "2026-06-05");
    Map<String, Object> prio = entry("PRIORITY_CHANGED", userB, "2026-06-17T10:00:00+09:00");
    prio.put("from", "MID");
    prio.put("to", "HIGHEST");
    Map<String, Object> m = body("라운드트립");
    // 라벨은 이슈 라벨 생성 뒤 이름으로 찾으므로 이슈에 같은 이름 라벨을 붙여 둔다.
    m.put("labelNames", List.of("가져온라벨"));
    m.put("history", List.of(assignees, labels, type, title, due, start, prio));
    int imported = numberOf(importAs(admin, m).andExpect(status().isCreated()));

    // 일반 경로 — 같은 종류의 변경을 만든다.
    var created =
        issueService.create(
            owner,
            key,
            new CreateIssueRequest(
                "일반",
                null,
                "MID",
                null,
                List.of(userB),
                typeA,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null));
    int normal = created.number();
    assigneeService.replace(owner, key, normal, List.of(userC));
    long normalLabel = labelRepository.insert(projectId, "일반라벨", "GRAY", owner).id();
    labelService.replace(owner, key, normal, List.of(normalLabel));
    issueService.setType(owner, key, normal, typeB);
    issueService.update(
        owner,
        key,
        normal,
        new UpdateIssueRequest(
            "일반 새 제목",
            null,
            null,
            "HIGHEST",
            LocalDate.parse("2026-07-01"),
            false,
            LocalDate.parse("2026-06-05"),
            false,
            null,
            false,
            null,
            null,
            null));

    Map<String, IssueHistoryEntryResponse> normalByType = new LinkedHashMap<>();
    for (var e : history(normal)) normalByType.putIfAbsent(e.eventType(), e);
    var importedRows = history(imported);
    assertThat(importedRows)
        .extracting(x -> x.eventType())
        .containsExactly(
            "ASSIGNEES_CHANGED",
            "LABELS_CHANGED",
            "TYPE_CHANGED",
            "TITLE_CHANGED",
            "DUE_DATE_CHANGED",
            "START_DATE_CHANGED",
            "PRIORITY_CHANGED");
    for (var row : importedRows) {
      var reference = normalByType.get(row.eventType());
      assertThat(reference).as(row.eventType() + " 일반 행").isNotNull();
      assertThat(shape(row.fromValue()))
          .as(row.eventType() + " fromValue 모양")
          .isEqualTo(shape(reference.fromValue()));
      assertThat(shape(row.toValue()))
          .as(row.eventType() + " toValue 모양")
          .isEqualTo(shape(reference.toValue()));
      assertThat(row.actorUsername()).isEqualTo(username(userB));
    }
    // 값 확인 — 날짜·우선순위·제목은 그대로, 담당자 요약은 id·username 을 담는다.
    assertThat(importedRows.get(3).toValue()).isEqualTo("이후");
    assertThat(importedRows.get(4).toValue()).isEqualTo("2026-07-01");
    assertThat(importedRows.get(6).toValue()).isEqualTo("HIGHEST");
    assertThat(importedRows.get(0).toValue()).contains(username(userC));
    assertThat(importedRows.get(2).toValue()).contains("\"id\":" + typeB);
  }

  @Test
  void homeActivity_showsImportedHistoryAtOriginalTime() throws Exception {
    Map<String, Object> e = entry("TITLE_CHANGED", userB, "2026-06-14T10:00:00+09:00");
    e.put("from", "이전");
    e.put("to", "이후");
    Map<String, Object> m = body("홈 활동");
    m.put("watchers", List.of(username(userC)));
    m.put("history", List.of(e));
    events.clear();
    importAs(admin, m).andExpect(status().isCreated());

    List<ActivityEntryResponse> feed = homeActivityRepository.findRecent(userC, null, null, 20);
    assertThat(feed).hasSize(1);
    assertThat(feed.get(0).eventType()).isEqualTo("TITLE_CHANGED");
    assertThat(feed.get(0).createdAt()).isEqualTo(t("2026-06-14T10:00:00+09:00").toInstant());
    assertThat(feed.get(0).actorId()).isEqualTo(userB);
    assertNoNotificationEvents();
  }
}
