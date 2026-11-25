package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static com.workplace.jooq.Tables.WORKFLOW;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static com.workplace.jooq.Tables.WORKFLOW_VERSION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.workflow.repository.WorkflowRepository;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectMemberGroupService;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * WP-1984 워크플로우 정의 REST 의 계약(경로·필드·상태·{@code errors.code})과 권한 경계. 요청은 시험 트랜잭션에 합류하고 끝나면 롤백된다 — 그래서
 * 실제 유일 위반·경합은 여기서 만들지 않고 {@code WorkflowPublishRaceTest} 가 커밋되는 트랜잭션으로 본다.
 */
@Transactional
class WorkflowDefinitionApiTest extends IntegrationTestBase {

  private static final String API = "/api/v1";
  private static final String HIDDEN_PROJECT = "프로젝트를 찾을 수 없거나 볼 수 없습니다";

  /** JSON 이스케이프 앞의 역슬래시 하나 — 자바 소스의 유니코드 이스케이프로 읽히지 않게 따로 둔다. */
  private static final String BS = "\\";

  private static final int MAX_BYTES = 256 * 1024;

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberGroupService memberGroupService;
  @Autowired WorkflowRepository repo;
  @Autowired WorkflowRunRepository runRepository;
  @Autowired IssueRepository issueRepository;
  @Autowired UserRepository userRepository;

  private long ownerId;
  private long memberId;
  private String key;
  private long projectId;

  /** OWNER·일반 멤버가 있는 TEAM 프로젝트 하나(TEAM 이라야 못 봄·AI OWNER 를 시험할 수 있다). */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    ownerId = human("USER");
    memberId = human("USER");
    key = newKey();
    projectId = newProject(key, "TEAM");
    projectService.addMember(ownerId, key, new AddMemberRequest(memberId, "MEMBER"));
  }

  /** 스레드에 심은 테넌트 문맥을 지워 다음 시험으로 새지 않게 한다. */
  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ───────────────────────── 만들기·읽기 ─────────────────────────

  @Test
  @DisplayName("만들기만 201 이고 Detail 을 돌려준다 — 이름은 요청 값(앞뒤 공백 제거)이지 YAML 의 name 이 아니다")
  void createReturns201() {
    String yaml = valid();
    Instant before = Instant.now().truncatedTo(ChronoUnit.MILLIS);
    Res res = send(createReq(projectId, "  요청한 이름  ", yaml), ownerId);

    assertThat(res.status()).isEqualTo(201);
    JsonNode d = res.body();
    assertThat(fields(d))
        .containsExactlyInAnyOrder(
            "id",
            "projectId",
            "name",
            "enabled",
            "activeVersion",
            "draftYaml",
            "draftUpdatedAt",
            "draftProblems");
    assertThat(d.get("projectId").asLong()).isEqualTo(projectId);
    assertThat(d.get("name").asString()).isEqualTo("요청한 이름");
    assertThat(d.get("enabled").asBoolean()).isFalse();
    assertThat(d.get("activeVersion").isNull()).isTrue();
    assertThat(d.get("draftYaml").asString()).isEqualTo(yaml);
    assertThat(d.get("draftProblems").isArray()).isTrue();
    assertThat(d.get("draftProblems")).isEmpty();
    Instant at = Instant.parse(d.get("draftUpdatedAt").asString());
    assertThat(at).isAfterOrEqualTo(before);
    assertThat(at.getNano() % 1_000_000).as("밀리초 단위").isZero();

    long id = d.get("id").asLong();
    assertThat(ok(get(path(id)), ownerId)).isEqualTo(d);
    assertThat(
            dsl.select(WORKFLOW.DRAFT_UPDATED_BY)
                .from(WORKFLOW)
                .where(WORKFLOW.ID.eq(id))
                .fetchSingle()
                .value1())
        .isEqualTo(ownerId);
  }

  @Test
  @DisplayName("목록은 요약만, 이름순이고 draftChanged 는 활성 버전의 원문을 따른다")
  void draftChanged_followsActiveVersion() {
    String first = valid();
    String second = first + "# 고침\n";
    long id = create("b 흐름", first);
    long other = create("A 흐름", first);

    JsonNode list = ok(get(listPath(projectId)), memberId);
    assertThat(list).hasSize(2);
    assertThat(list.get(0).get("id").asLong()).isEqualTo(other);
    JsonNode row = list.get(1);
    assertThat(fields(row))
        .containsExactlyInAnyOrder("id", "name", "enabled", "activeVersionNo", "draftChanged");
    assertThat(row.get("name").asString()).isEqualTo("b 흐름");
    assertThat(row.get("enabled").asBoolean()).isFalse();
    assertThat(row.get("activeVersionNo").isNull()).isTrue();
    assertThat(row.get("draftChanged").asBoolean()).as("활성 없음").isTrue();

    assertSummary(id, publish(id), false);
    save(id, second);
    assertSummary(id, 1, true);
    save(id, first);
    assertSummary(id, 1, false);
    save(id, second);
    assertSummary(id, publish(id), false);
    ok(post(path(id) + "/versions/1/restore-draft"), ownerId);
    assertSummary(id, 2, true);
  }

  @Test
  @DisplayName("버전 목록은 새 번호가 먼저인 요약이고, 게시자가 없어졌으면 createdBy 는 null")
  void versions_summaryNewestFirst() {
    long id = create("흐름", valid());
    publish(id);
    publish(id);
    dsl.update(WORKFLOW_VERSION)
        .setNull(WORKFLOW_VERSION.CREATED_BY)
        .where(WORKFLOW_VERSION.WORKFLOW_ID.eq(id).and(WORKFLOW_VERSION.VERSION_NO.eq(1)))
        .execute();

    publish(id);
    clearInvocations(userRepository);

    JsonNode list = ok(get(path(id) + "/versions"), memberId);

    verify(userRepository, times(1)).findAssigneeInfos(any(), eq(1L));
    assertThat(list).hasSize(3);
    JsonNode newest = list.get(0);
    assertThat(fields(newest))
        .containsExactlyInAnyOrder("versionNo", "createdAt", "createdBy", "activeRuns");
    assertThat(newest.get("versionNo").asInt()).isEqualTo(3);
    assertThat(newest.get("activeRuns").isNumber()).isTrue();
    assertThat(newest.get("activeRuns").asInt()).isZero();
    assertThat(Instant.parse(newest.get("createdAt").asString())).isNotNull();
    assertActor(newest.get("createdBy"), ownerId);
    assertThat(list.get(1).get("versionNo").asInt()).isEqualTo(2);
    assertThat(list.get(2).get("versionNo").asInt()).isEqualTo(1);
    assertThat(list.get(2).get("createdBy").isNull()).isTrue();

    JsonNode active = ok(get(path(id)), memberId).get("activeVersion");
    assertThat(fields(active)).containsExactlyInAnyOrder("no", "createdAt", "createdBy");
    assertThat(active.get("no").asInt()).isEqualTo(3);
    assertActor(active.get("createdBy"), ownerId);

    // 활성 버전의 게시자가 없어진 경우도 null 로 남는다.
    dsl.update(WORKFLOW_VERSION)
        .setNull(WORKFLOW_VERSION.CREATED_BY)
        .where(WORKFLOW_VERSION.WORKFLOW_ID.eq(id))
        .execute();
    assertThat(ok(get(path(id)), memberId).get("activeVersion").get("createdBy").isNull()).isTrue();
  }

  @Test
  @DisplayName("버전 상세의 model 은 저장한 JSON 글 그대로(문자열이 아니라 객체, nodes 는 key 든 배열)")
  void versionDetail_modelIsStoredJson() {
    String yaml = valid();
    long id = create("흐름", yaml);
    publish(id);

    Res res = send(get(path(id) + "/versions/1"), memberId);

    assertThat(res.status()).isEqualTo(200);
    JsonNode v = res.body();
    assertThat(fields(v)).containsExactlyInAnyOrder("versionNo", "sourceYaml", "model");
    assertThat(v.get("versionNo").asInt()).isEqualTo(1);
    assertThat(v.get("sourceYaml").asString()).isEqualTo(yaml);
    assertThat(v.get("model").isObject()).isTrue();
    JsonNode nodes = v.get("model").get("nodes");
    assertThat(nodes.isArray()).isTrue();
    List<String> keys = new ArrayList<>();
    nodes.forEach(n -> keys.add(n.get("key").asString()));
    assertThat(keys).containsExactly("start", "work", "end");
    // 다시 읽고 쓰면 JSONB 글의 띄어쓰기가 사라진다 — DB 글이 본문에 그대로 들어 있어야 한다.
    String stored =
        dsl.select(WORKFLOW_VERSION.MODEL)
            .from(WORKFLOW_VERSION)
            .where(WORKFLOW_VERSION.WORKFLOW_ID.eq(id))
            .fetchSingle()
            .value1()
            .data();
    assertThat(res.text()).contains(stored);
  }

  // ───────────────────────── 초안 ─────────────────────────

  @Test
  @DisplayName("초안은 오류가 있어도 원문 그대로 저장하고 문제를 함께 돌려준다")
  void draftSave_keepsYamlEvenWithErrors() {
    long id = create("흐름", valid());
    String yaml = broken();

    JsonNode saved = ok(putDraft(id, yaml, null), ownerId);

    assertThat(fields(saved)).containsExactlyInAnyOrder("draftUpdatedAt", "problems");
    assertBrokenLink(saved.get("problems"));
    JsonNode d = ok(get(path(id)), ownerId);
    assertThat(d.get("draftYaml").asString()).isEqualTo(yaml);
    assertThat(d.get("draftUpdatedAt")).isEqualTo(saved.get("draftUpdatedAt"));
    assertThat(d.get("draftProblems")).isEqualTo(saved.get("problems"));

    // 만들기도 같다.
    JsonNode made = expect(createReq(projectId, "오류 초안", yaml), ownerId, 201);
    assertThat(made.get("draftYaml").asString()).isEqualTo(yaml);
    assertBrokenLink(made.get("draftProblems"));
  }

  @Test
  @DisplayName("초안 시각이 다르면 저장·게시 모두 409 이고 아무것도 바뀌지 않는다")
  void draftConflict_409() {
    String first = valid();
    long id = create("흐름", first);
    String stale = time(id);
    String second = first + "# 먼저 저장\n";
    save(id, second);

    JsonNode onSave = expect(putDraft(id, first + "# 늦은 저장\n", stale), ownerId, 409);
    assertCode(onSave, "WORKFLOW_DRAFT_CONFLICT");
    assertThat(ok(get(path(id)), ownerId).get("draftYaml").asString()).isEqualTo(second);

    assertCode(expect(publishReq(id, stale), ownerId, 409), "WORKFLOW_DRAFT_CONFLICT");
    assertThat(versionCount(id)).isZero();

    // 충돌 검사가 내용 검증보다 먼저다 — 남의 초안을 검증한 422 를 주지 않는다.
    save(id, broken());
    assertCode(expect(publishReq(id, stale), ownerId, 409), "WORKFLOW_DRAFT_CONFLICT");
  }

  @Test
  @DisplayName("expectedDraftUpdatedAt 이 없거나 null 이면 검사를 건너뛴다(게시는 본문이 없어도 된다)")
  void nullExpected_skipsCheck() {
    String yaml = valid();
    long id = create("흐름", yaml);

    expect(put(path(id) + "/draft").content(body("yaml", yaml + "# 1\n")), ownerId, 200);
    expect(putDraft(id, yaml + "# 2\n", null), ownerId, 200);
    assertThat(expect(publishReq(id, null), ownerId, 200).get("versionNo").asInt()).isEqualTo(1);
    assertThat(expect(post(path(id) + "/publish").content("{}"), ownerId, 200).get("versionNo"))
        .hasToString("2");
    // 본문도 Content-Type 도 없는 요청.
    Res bare = sendRaw(post(path(id) + "/publish"), ownerId);
    assertThat(bare.status()).isEqualTo(200);
    assertThat(bare.body().get("versionNo").asInt()).isEqualTo(3);
  }

  @Test
  @DisplayName("초안 시각은 늘 앞으로 가는 밀리초이고, 돌려받은 값을 되보내면 거짓 충돌이 없다")
  void draftUpdatedAt_roundTripsWithoutFalseConflict() {
    String yaml = valid();
    JsonNode made = expect(createReq(projectId, "흐름", yaml), ownerId, 201);
    long id = made.get("id").asLong();
    String t0 = made.get("draftUpdatedAt").asString();

    // 같은 글이어도 저장하면 시각이 바뀐다.
    String t1 = ok(putDraft(id, yaml, t0), ownerId).get("draftUpdatedAt").asString();
    assertThat(Instant.parse(t1)).isAfter(Instant.parse(t0));
    assertThat(time(id)).isEqualTo(t1);
    String t2 = ok(putDraft(id, yaml, t1), ownerId).get("draftUpdatedAt").asString();
    assertThat(Instant.parse(t2)).isAfter(Instant.parse(t1));
    ok(publishReq(id, t2), ownerId);
    assertThat(time(id)).as("게시는 초안 시각을 바꾸지 않는다").isEqualTo(t2);

    // 시계가 뒤처졌고 DB 값에 마이크로초가 있어도: 밀리초로 비교하고, 이전(밀리초로 자름) + 1ms 로 저장한다.
    Instant ahead = Instant.now().truncatedTo(ChronoUnit.SECONDS).plus(1, ChronoUnit.HOURS);
    Instant micros = ahead.plusNanos(123_456_000);
    dsl.update(WORKFLOW)
        .set(WORKFLOW.DRAFT_UPDATED_AT, OffsetDateTime.ofInstant(micros, ZoneOffset.UTC))
        .where(WORKFLOW.ID.eq(id))
        .execute();
    String millisOnly = ahead.plusMillis(123).toString();
    ok(publishReq(id, millisOnly), ownerId);
    JsonNode saved = ok(putDraft(id, yaml, millisOnly), ownerId);
    assertThat(Instant.parse(saved.get("draftUpdatedAt").asString()))
        .isEqualTo(ahead.plusMillis(124));
    assertThat(time(id)).isEqualTo(saved.get("draftUpdatedAt").asString());
  }

  @Test
  @DisplayName("지원 범위 밖의 expectedDraftUpdatedAt 은 400")
  void expectedOutOfRange_400() {
    long id = create("흐름", valid());
    String old = "0001-01-01T00:00:00Z";

    assertThat(expect(putDraft(id, valid(), old), ownerId, 400).get("errors").propertyNames())
        .containsExactly("expectedDraftUpdatedAt");
    assertThat(expect(publishReq(id, old), ownerId, 400).get("errors").propertyNames())
        .containsExactly("expectedDraftUpdatedAt");
  }

  // ───────────────────────── 검증·게시 ─────────────────────────

  @Test
  @DisplayName("ERROR 가 있으면 게시 422 — 경고까지 줄과 함께 돌려주고 버전을 만들지 않는다")
  void publish_rejectedWhenErrors_422() {
    long id = create("흐름", broken());

    Res res = send(publishReq(id, null), ownerId);

    assertThat(res.status()).isEqualTo(422);
    JsonNode b = res.body();
    assertThat(fields(b))
        .containsExactlyInAnyOrder(
            "status", "error", "message", "errors", "timestamp", "path", "problems");
    assertThat(b.get("status").asInt()).isEqualTo(422);
    assertThat(b.get("error").asString()).isNotBlank();
    assertThat(b.get("path").asString()).isEqualTo(path(id) + "/publish");
    assertCode(b, "WORKFLOW_INVALID");
    assertBrokenLink(b.get("problems"));
    JsonNode warning = problem(b.get("problems"), "CAPABILITY_UNKNOWN");
    assertThat(warning.get("severity").asString()).isEqualTo("WARNING");
    assertThat(warning.get("line").asInt()).isEqualTo(7);
    assertThat(versionCount(id)).isZero();
    assertThat(ok(get(path(id)), ownerId).get("activeVersion").isNull()).isTrue();
  }

  @Test
  @DisplayName("경고는 게시를 막지 않고, 같은 내용을 다시 게시해도 번호가 1 → 2 로 는다")
  void publish_allowedWithWarnings_versionIncrements() {
    long id = create("흐름", task(username(ownerId), "gpu", "end"));
    JsonNode problems = ok(get(path(id)), ownerId).get("draftProblems");
    assertThat(codes(problems)).contains("CAPABILITY_UNKNOWN");
    problems.forEach(p -> assertThat(p.get("severity").asString()).isEqualTo("WARNING"));

    JsonNode first = ok(publishReq(id, null), ownerId);
    JsonNode second = ok(publishReq(id, null), ownerId);

    assertThat(fields(first)).containsExactlyInAnyOrder("versionNo", "runningRunsOnOlderVersions");
    assertThat(first.get("versionNo").asInt()).isEqualTo(1);
    assertThat(first.get("runningRunsOnOlderVersions").isNumber()).isTrue();
    assertThat(first.get("runningRunsOnOlderVersions").asInt()).isZero();
    assertThat(second.get("versionNo").asInt()).isEqualTo(2);
    assertThat(ok(get(path(id)), ownerId).get("activeVersion").get("no").asInt()).isEqualTo(2);
  }

  @Test
  @DisplayName("게시 응답의 runningRunsOnOlderVersions 는 새 버전 밖 버전의 활성 실행만 센다(끝난 실행 제외)")
  void publish_countsRunsOnOlderVersions() {
    long id = create("흐름", valid());
    publish(id);
    long v1 = versionId(id, 1);
    // v1: RUNNING·WAITING·SUSPENDED 각 하나(활성), COMPLETED·CANCELED 각 하나(끝남)
    seedRuns(v1, "RUNNING", "WAITING", "SUSPENDED", "COMPLETED", "CANCELED");

    JsonNode second = ok(publishReq(id, null), ownerId);
    assertThat(second.get("versionNo").asInt()).isEqualTo(2);
    assertThat(second.get("runningRunsOnOlderVersions").asInt()).isEqualTo(3);

    // v2 의 활성 실행은 v3 게시에서 옛 버전으로 센다 — 게시한 버전 자신의 것은 세지 않는다.
    seedRuns(versionId(id, 2), "RUNNING", "COMPLETED");
    JsonNode third = ok(publishReq(id, null), ownerId);
    assertThat(third.get("runningRunsOnOlderVersions").asInt()).isEqualTo(4);
  }

  @Test
  @DisplayName("버전 목록의 activeRuns 는 그 버전의 활성 실행 수 — 끝난 실행은 세지 않는다")
  void versions_countActiveRuns() {
    long id = create("흐름", valid());
    publish(id);
    publish(id);
    publish(id);
    seedRuns(versionId(id, 1), "RUNNING", "CANCELED", "COMPLETED");
    seedRuns(versionId(id, 2), "COMPLETED", "CANCELED");
    seedRuns(versionId(id, 3), "WAITING", "SUSPENDED");

    JsonNode list = ok(get(path(id) + "/versions"), memberId);

    assertThat(list.get(0).get("versionNo").asInt()).isEqualTo(3);
    assertThat(list.get(0).get("activeRuns").asInt()).isEqualTo(2);
    assertThat(list.get(1).get("activeRuns").asInt()).isZero();
    assertThat(list.get(2).get("activeRuns").asInt()).isEqualTo(1);
  }

  @Test
  @DisplayName("버전 목록의 activeRuns 는 삭제된 이슈의 실행을 세지 않는다 — 실행 목록·노드 배지와 같은 기준")
  void versions_activeRunsExcludeDeletedIssues() {
    long id = create("흐름", valid());
    publish(id);
    publish(id);
    List<Long> v1Issues = seedRuns(versionId(id, 1), "RUNNING", "WAITING");
    List<Long> v2Issues = seedRuns(versionId(id, 2), "RUNNING");
    softDeleteIssue(v1Issues.get(0));
    softDeleteIssue(v2Issues.get(0));

    JsonNode list = ok(get(path(id) + "/versions"), memberId);
    assertThat(list.get(0).get("versionNo").asInt()).isEqualTo(2);
    assertThat(list.get(0).get("activeRuns").asInt()).isZero();
    assertThat(list.get(1).get("activeRuns").asInt()).isEqualTo(1);
  }

  @Test
  @DisplayName("게시 응답의 runningRunsOnOlderVersions 는 삭제된 이슈의 실행을 세지 않는다")
  void publish_olderRunsExcludeDeletedIssues() {
    long id = create("흐름", valid());
    publish(id);
    List<Long> issues = seedRuns(versionId(id, 1), "RUNNING", "WAITING", "SUSPENDED");
    softDeleteIssue(issues.get(0));

    JsonNode second = ok(publishReq(id, null), ownerId);
    assertThat(second.get("runningRunsOnOlderVersions").asInt()).isEqualTo(2);
  }

  @Test
  @DisplayName("저장하지 않고 검증만 할 수 있다")
  void validate_returnsProblemsWithoutSaving() {
    JsonNode clean = ok(validateReq(projectId, valid()), memberId);
    assertThat(fields(clean)).containsExactly("problems");
    assertThat(clean.get("problems")).isEmpty();

    assertBrokenLink(ok(validateReq(projectId, broken()), memberId).get("problems"));
    assertThat(workflowCount(projectId)).isZero();
  }

  @Test
  @DisplayName("비정상 YAML 은 저장·검증 200, 게시 422 이고 어디서도 500 이 아니다")
  void abnormalYaml_not500() {
    String deep = "a: " + "[".repeat(60) + "]".repeat(60) + "\n";
    // YAML 이스케이프로 적은 깨진 문자는 저장할 수 있는 글이고, 문구에 되비쳐도 응답을 쓸 수 있어야 한다.
    String escaped = "\"x" + BS + "uD800\": 1\n\"x" + BS + "uD800\": 2\n";
    Map<String, List<String>> cases = new LinkedHashMap<>();
    cases.put("빈 문서", List.of("", "YAML_EMPTY"));
    cases.put("중복 키", List.of("schema: a\nschema: b\n", "YAML_DUPLICATE_KEY"));
    cases.put("별칭", List.of("a: &x 1\nb: *x\n", "YAML_ALIAS"));
    cases.put("깊이", List.of(deep, "YAML_TOO_DEEP"));
    cases.put("스칼라 최상위", List.of("hello\n", "SCHEMA_TYPE"));
    cases.put("깨진 문자 이스케이프", List.of(escaped, "YAML_INVALID_TEXT"));

    cases.forEach(
        (label, c) -> {
          String yaml = c.get(0);
          String code = c.get(1);
          JsonNode made = expect(createReq(projectId, label, yaml), ownerId, 201);
          long id = made.get("id").asLong();
          assertThat(codes(made.get("draftProblems"))).as(label).contains(code);
          assertThat(codes(ok(putDraft(id, yaml, null), ownerId).get("problems")))
              .as(label)
              .contains(code);
          assertThat(codes(ok(validateReq(projectId, yaml), ownerId).get("problems")))
              .as(label)
              .contains(code);
          assertThat(codes(ok(get(path(id)), ownerId).get("draftProblems")))
              .as(label)
              .contains(code);
          JsonNode rejected = expect(publishReq(id, null), ownerId, 422);
          assertCode(rejected, "WORKFLOW_INVALID");
          assertThat(codes(rejected.get("problems"))).as(label).contains(code);
          assertThat(versionCount(id)).as(label).isZero();
        });
  }

  @Test
  @DisplayName("구성원이 빠지면 초안에 오류가 뜨지만 게시된 버전은 그대로다")
  void memberLeaves_draftErrors_versionUnchanged() {
    String yaml = humanTask(username(memberId));
    long id = create("흐름", yaml);
    publish(id);
    JsonNode version = ok(get(path(id) + "/versions/1"), ownerId);
    JsonNode active = ok(get(path(id)), ownerId).get("activeVersion");

    projectService.removeMember(ownerId, key, memberId);
    TenantContext.set(1L);

    String code = "ROLE_MEMBER_NOT_IN_PROJECT";
    JsonNode d = ok(get(path(id)), ownerId);
    assertThat(codes(d.get("draftProblems"))).contains(code);
    assertThat(d.get("activeVersion")).isEqualTo(active);
    assertThat(codes(ok(validateReq(projectId, yaml), ownerId).get("problems"))).contains(code);
    assertThat(codes(ok(putDraft(id, yaml, null), ownerId).get("problems"))).contains(code);
    assertThat(codes(expect(publishReq(id, null), ownerId, 422).get("problems"))).contains(code);
    assertThat(versionCount(id)).isEqualTo(1);
    assertThat(ok(get(path(id) + "/versions/1"), ownerId)).isEqualTo(version);
  }

  @Test
  @DisplayName("워크스페이스에서 정지된 구성원은 활성 구성원이 아니다")
  void suspendedMember_isNotProjectMember() {
    String yaml = humanTask(username(memberId));
    assertThat(ok(validateReq(projectId, yaml), ownerId).get("problems")).isEmpty();

    TestFixtures.suspendMember(dsl, memberId, 1L);

    assertThat(codes(ok(validateReq(projectId, yaml), ownerId).get("problems")))
        .contains("ROLE_MEMBER_NOT_IN_PROJECT");
  }

  @Test
  @DisplayName("조직도 부서로 들어온 사람도 구성원이다")
  void departmentMember_isProjectMember() {
    long person = human("USER");
    String yaml = humanTask(username(person));
    assertThat(codes(ok(validateReq(projectId, yaml), ownerId).get("problems")))
        .contains("ROLE_MEMBER_NOT_IN_PROJECT");
    long group =
        dsl.insertInto(USER_GROUP)
            .set(USER_GROUP.NAME, "부서-" + UUID.randomUUID().toString().substring(0, 8))
            .set(USER_GROUP.VISIBILITY, "SHARED")
            .returning(USER_GROUP.ID)
            .fetchSingle()
            .getId();
    dsl.insertInto(USER_GROUP_MEMBER)
        .set(USER_GROUP_MEMBER.GROUP_ID, group)
        .set(USER_GROUP_MEMBER.TARGET_TYPE, "MEMBER")
        .set(USER_GROUP_MEMBER.TARGET_ID, person)
        .execute();

    memberGroupService.add(ownerId, key, group, "MEMBER");

    assertThat(ok(validateReq(projectId, yaml), ownerId).get("problems")).isEmpty();
  }

  @Test
  @DisplayName("게시 모델에는 저장된 정확한 username 이 중복 없이 남고, 원문·초안은 적은 그대로다")
  void publish_storesExactUsernames() {
    String ownerName = renamed(ownerId, "Mixed-", "@Example.com");
    String memberName = username(memberId);
    String yaml =
        """
        schema: genia/workflow@1
        name: 구성원
        roles:
          owner: { members: ["%s", "%s", "%s", "%s"] }
          checker: { members: ["%s"] }
        nodes:
          start: { type: start }
          work: { type: human_task, role: owner, outcomes: { done: { to: check, assignTo: checker } } }
          check: { type: human_task, role: checker, outcomes: { done: { to: end } } }
          end: { type: end }
        start:
          - { when: { assigneeRole: owner }, to: work }
        """
            .formatted(
                ownerName.toUpperCase(Locale.ROOT),
                memberName.toUpperCase(Locale.ROOT),
                ownerName,
                ownerName.toLowerCase(Locale.ROOT),
                memberName.toUpperCase(Locale.ROOT));
    long id = create("흐름", yaml);
    JsonNode draft = ok(get(path(id)), ownerId);
    assertThat(codes(draft.get("draftProblems")))
        .containsExactly("ROLE_MEMBER_DUPLICATE", "ROLE_MEMBER_DUPLICATE");
    clearInvocations(userRepository);

    publish(id);

    // 바꿀 때 구성원을 다시 읽으면 검증한 표와 달라질 수 있다.
    verify(userRepository, times(1)).findAssigneeInfosByUsernames(any(), eq(1L));
    JsonNode version = ok(get(path(id) + "/versions/1"), ownerId);
    assertThat(version.get("sourceYaml").asString()).isEqualTo(yaml);
    assertThat(storedMembers(version, "owner")).containsExactly(ownerName, memberName);
    assertThat(storedMembers(version, "checker")).containsExactly(memberName);
    JsonNode after = ok(get(path(id)), ownerId);
    assertThat(after.get("draftYaml").asString()).isEqualTo(yaml);
    assertThat(after.get("draftUpdatedAt")).isEqualTo(draft.get("draftUpdatedAt"));
    assertSummary(id, 1, false);
  }

  @Test
  @DisplayName("대소문자만 다른 두 구성원은 합쳐지지 않는다 — 모호하면 422, 정확히 적으면 그 사람으로 게시")
  void publish_caseOnlyTwins() {
    String upper = renamed(ownerId, "Twin-", "");
    String lower = upper.toLowerCase(Locale.ROOT);
    dsl.update(USER).set(USER.USERNAME, lower).where(USER.ID.eq(memberId)).execute();

    long unclear = create("모호", humanTask(upper.toUpperCase(Locale.ROOT)));
    JsonNode rejected = expect(publishReq(unclear, null), ownerId, 422);
    assertThat(codes(rejected.get("problems"))).containsExactly("ROLE_MEMBER_AMBIGUOUS");
    assertThat(problem(rejected.get("problems"), "ROLE_MEMBER_AMBIGUOUS").get("message").asString())
        .doesNotContain(upper)
        .doesNotContain(lower);
    assertThat(versionCount(unclear)).isZero();

    for (String exact : List.of(upper, lower)) {
      long id = create("정확 " + UUID.randomUUID(), humanTask(exact));
      publish(id);
      assertThat(storedMembers(ok(get(path(id) + "/versions/1"), ownerId), "owner"))
          .containsExactly(exact);
    }
  }

  @Test
  @DisplayName("사람의 agent_runtime 이 INTERNAL 이어도 내부 AI 로 보지 않는다")
  void humanWithInternalRuntime_hasNoLocalRepoWarning() {
    assertThat(TestFixtures.runtimeOf(dsl, memberId)).isEqualTo("INTERNAL");
    long agent = agentOwner();
    assertThat(TestFixtures.runtimeOf(dsl, agent)).isEqualTo("INTERNAL");

    JsonNode human =
        ok(validateReq(projectId, task(username(memberId), "local-repo", "end")), ownerId);
    JsonNode ai = ok(validateReq(projectId, task(username(agent), "local-repo", "end")), ownerId);

    assertThat(codes(human.get("problems"))).doesNotContain("CAPABILITY_MISSING");
    assertThat(codes(ai.get("problems"))).as("내부 AI 는 경고").contains("CAPABILITY_MISSING");

    dsl.update(USER).set(USER.AGENT_RUNTIME, "EXTERNAL").where(USER.ID.eq(agent)).execute();
    JsonNode external =
        ok(validateReq(projectId, task(username(agent), "local-repo", "end")), ownerId);
    assertThat(codes(external.get("problems"))).doesNotContain("CAPABILITY_MISSING");
  }

  // ───────────────────────── 되돌리기·켜기·이름 ─────────────────────────

  @Test
  @DisplayName("되돌리기는 그 버전 원문을 초안에 쓰기만 하고 게시하지 않는다")
  void restoreDraft_doesNotPublish() {
    String first = valid();
    String second = first + "# 둘째\n";
    long id = create("흐름", first);
    publish(id);
    save(id, second);
    publish(id);
    JsonNode before = ok(get(path(id)), ownerId);
    long admin = human("ADMIN");

    JsonNode after = ok(post(path(id) + "/versions/1/restore-draft"), admin);

    assertThat(after.get("draftYaml").asString()).isEqualTo(first);
    assertThat(after.get("activeVersion")).isEqualTo(before.get("activeVersion"));
    assertThat(after.get("activeVersion").get("no").asInt()).isEqualTo(2);
    assertThat(Instant.parse(after.get("draftUpdatedAt").asString()))
        .isAfter(Instant.parse(before.get("draftUpdatedAt").asString()));
    assertThat(versionCount(id)).isEqualTo(2);
    assertThat(
            dsl.select(WORKFLOW.DRAFT_UPDATED_BY)
                .from(WORKFLOW)
                .where(WORKFLOW.ID.eq(id))
                .fetchSingle()
                .value1())
        .as("되돌린 사람이 초안 저장자")
        .isEqualTo(admin);
    assertThat(ok(get(path(id)), ownerId)).isEqualTo(after);
  }

  @Test
  @DisplayName("본 뒤 남이 저장한 초안은 되돌리기로 덮이지 않는다(409, 초안·시각·활성 그대로)")
  void restoreDraft_staleExpected_409() {
    String first = valid();
    long id = create("흐름", first);
    publish(id);
    String stale = time(id);
    ok(putDraft(id, first + "# 남이 저장\n", null), human("ADMIN"));
    JsonNode before = ok(get(path(id)), ownerId);

    assertCode(expect(restoreReq(id, 1, stale), ownerId, 409), "WORKFLOW_DRAFT_CONFLICT");
    // 충돌 검사가 내용(버전 찾기)보다 먼저다 — 없는 버전이어도 409.
    assertCode(expect(restoreReq(id, 9, stale), ownerId, 409), "WORKFLOW_DRAFT_CONFLICT");

    assertThat(ok(get(path(id)), ownerId)).isEqualTo(before);
  }

  @Test
  @DisplayName("본 초안 시각이 맞으면(밀리초 비교) 되돌린다")
  void restoreDraft_matchingExpected_200() {
    String first = valid();
    long id = create("흐름", first);
    publish(id);
    save(id, first + "# 고침\n");
    Instant ahead = Instant.now().truncatedTo(ChronoUnit.SECONDS).plus(1, ChronoUnit.HOURS);
    dsl.update(WORKFLOW)
        .set(
            WORKFLOW.DRAFT_UPDATED_AT,
            OffsetDateTime.ofInstant(ahead.plusNanos(123_456_000), ZoneOffset.UTC))
        .where(WORKFLOW.ID.eq(id))
        .execute();

    JsonNode after = ok(restoreReq(id, 1, ahead.plusMillis(123).toString()), ownerId);

    assertThat(after.get("draftYaml").asString()).isEqualTo(first);
    assertThat(Instant.parse(after.get("draftUpdatedAt").asString()))
        .isEqualTo(ahead.plusMillis(124));
    ok(restoreReq(id, 1, after.get("draftUpdatedAt").asString()), ownerId);
  }

  @Test
  @DisplayName("되돌리기는 본문이 없거나 expected 가 null 이면 검사를 건너뛴다")
  void restoreDraft_noExpected_200() {
    String first = valid();
    long id = create("흐름", first);
    publish(id);
    String route = path(id) + "/versions/1/restore-draft";

    save(id, first + "# 1\n");
    assertThat(ok(restoreReq(id, 1, null), ownerId).get("draftYaml").asString()).isEqualTo(first);
    save(id, first + "# 2\n");
    assertThat(ok(post(route).content("{}"), ownerId).get("draftYaml").asString()).isEqualTo(first);
    save(id, first + "# 3\n");
    // 본문도 Content-Type 도 없는 요청.
    Res bare = sendRaw(post(route), ownerId);
    assertThat(bare.status()).isEqualTo(200);
    assertThat(bare.body().get("draftYaml").asString()).isEqualTo(first);
  }

  @Test
  @DisplayName("되돌리기도 지원 범위 밖의 expectedDraftUpdatedAt 은 400")
  void restoreDraft_expectedOutOfRange_400() {
    long id = createPublished(projectId);

    assertFieldError(
        expect(restoreReq(id, 1, "0001-01-01T00:00:00Z"), ownerId, 400), "expectedDraftUpdatedAt");
  }

  @Test
  @DisplayName("버전 번호는 그 워크플로우 안에서만 찾는다")
  void otherWorkflowsVersion_404() {
    String mine = valid();
    long a = create("가", mine);
    publish(a);
    long b = create("나", mine + "# 나\n");
    publish(b);
    publish(b);

    JsonNode read = expect(get(path(a) + "/versions/2"), ownerId, 404);
    JsonNode restore = expect(post(path(a) + "/versions/2/restore-draft"), ownerId, 404);

    assertCode(read, "WORKFLOW_VERSION_NOT_FOUND");
    assertCode(restore, "WORKFLOW_VERSION_NOT_FOUND");
    assertThat(read.get("problems")).isEmpty();
    assertThat(ok(get(path(a)), ownerId).get("draftYaml").asString()).isEqualTo(mine);
    assertThat(ok(get(path(a) + "/versions/1"), ownerId).get("sourceYaml").asString())
        .isEqualTo(mine);
  }

  @Test
  @DisplayName("게시 전에는 켤 수 없고, 거절된 PATCH 는 이름도 바꾸지 않는다")
  void enableBeforePublish_409() {
    long id = create("원래 이름", valid());

    JsonNode b = expect(patchReq(id, "enabled", true, "name", "새 이름"), ownerId, 409);

    assertCode(b, "WORKFLOW_NOT_PUBLISHED");
    assertThat(b.get("problems")).isEmpty();
    JsonNode d = ok(get(path(id)), ownerId);
    assertThat(d.get("enabled").asBoolean()).isFalse();
    assertThat(d.get("name").asString()).isEqualTo("원래 이름");

    publish(id);
    JsonNode on = ok(patchReq(id, "enabled", true, "name", "새 이름"), ownerId);
    assertThat(on.get("enabled").asBoolean()).isTrue();
    assertThat(on.get("name").asString()).isEqualTo("새 이름");
    assertThat(repo.existsEnabledPublished(projectId)).isTrue();
  }

  @Test
  @DisplayName("끄기는 활성 버전이 있든 없든 언제나 된다")
  void disable_alwaysAllowed() {
    long id = create("흐름", valid());
    assertThat(ok(patchReq(id, "enabled", false), ownerId).get("enabled").asBoolean()).isFalse();

    publish(id);
    ok(patchReq(id, "enabled", true), ownerId);
    assertThat(ok(patchReq(id, "enabled", false), ownerId).get("enabled").asBoolean()).isFalse();

    // 켜진 채 활성 버전이 사라진 정의도 끌 수 있어야 한다.
    ok(patchReq(id, "enabled", true), ownerId);
    dsl.update(WORKFLOW).setNull(WORKFLOW.ACTIVE_VERSION_ID).where(WORKFLOW.ID.eq(id)).execute();
    assertThat(ok(patchReq(id, "enabled", false), ownerId).get("enabled").asBoolean()).isFalse();
  }

  @Test
  @DisplayName("켜기는 켜진 다른 정의와 시작 역할 구성원이 겹치면 409 이고 이름도 쓰지 않는다")
  void enable_rejectsWhenStartRoleOverlapsEnabledWorkflow() {
    long a = create("가 흐름", valid());
    publish(a);
    ok(patchReq(a, "enabled", true), ownerId);
    long b = create("나 흐름", valid());
    publish(b);

    JsonNode body = expect(patchReq(b, "enabled", true, "name", "바꾼 이름"), ownerId, 409);

    assertCode(body, "WORKFLOW_START_CONDITION_OVERLAP");
    assertThat(body.get("message").asString()).contains("가 흐름");
    JsonNode d = ok(get(path(b)), ownerId);
    assertThat(d.get("enabled").asBoolean()).isFalse();
    assertThat(d.get("name").asString()).isEqualTo("나 흐름");
  }

  @Test
  @DisplayName("시작 역할 구성원이 서로 다르면 둘 다 켤 수 있다")
  void enable_allowedWhenStartRolesDisjoint() {
    long a = create("가 흐름", valid());
    publish(a);
    ok(patchReq(a, "enabled", true), ownerId);
    long b = create("나 흐름", humanTask(username(memberId)));
    publish(b);

    assertThat(ok(patchReq(b, "enabled", true), ownerId).get("enabled").asBoolean()).isTrue();
  }

  @Test
  @DisplayName("꺼진 정의는 겹쳐도 켜기를 막지 않는다")
  void enable_ignoresDisabledWorkflows() {
    long a = create("가 흐름", valid());
    publish(a);
    long b = create("나 흐름", valid());
    publish(b);

    assertThat(ok(patchReq(b, "enabled", true), ownerId).get("enabled").asBoolean()).isTrue();
  }

  @Test
  @DisplayName("겹침 상태로 켜져 있어도 끄기는 언제나 된다")
  void disable_alwaysAllowedEvenWhenOverlapping() {
    long a = create("가 흐름", valid());
    publish(a);
    long b = create("나 흐름", valid());
    publish(b);
    // API 는 겹침을 막으므로 DB 로 겹친 채 켜진 상태를 만든다.
    repo.updateEnabled(a, true);
    repo.updateEnabled(b, true);

    assertThat(ok(patchReq(b, "enabled", false), ownerId).get("enabled").asBoolean()).isFalse();
  }

  @Test
  @DisplayName("enable=true 로 게시하면 같은 요청에서 켜진다")
  void publish_withEnable_enablesInSameRequest() {
    long id = create("흐름", valid());

    ok(post(path(id) + "/publish").content(body("enable", true)), ownerId);

    assertThat(ok(get(path(id)), ownerId).get("enabled").asBoolean()).isTrue();
  }

  @Test
  @DisplayName("이미 게시 버전이 있으면 enable=true 를 보내도 켜지 않는다 — 다른 관리자가 끈 채 둔 선택을 덮지 않는다")
  void publish_withEnable_ignoredAfterFirstPublish() {
    long id = create("흐름", valid());
    publish(id);

    ok(post(path(id) + "/publish").content(body("enable", true)), ownerId);

    assertThat(ok(get(path(id)), ownerId).get("enabled").asBoolean()).isFalse();
    assertThat(versionCount(id)).isEqualTo(2);
  }

  @Test
  @DisplayName("enable 이 없으면 게시해도 꺼진 채다")
  void publish_withoutEnable_keepsDisabled() {
    long id = create("흐름", valid());

    publish(id);

    assertThat(ok(get(path(id)), ownerId).get("enabled").asBoolean()).isFalse();
  }

  @Test
  @DisplayName("enable=true 게시가 겹치면 409 이고 버전도 쌓지 않고 꺼진 채다")
  void publish_withEnable_overlap_rejectsWholePublish() {
    long a = create("가 흐름", valid());
    publish(a);
    ok(patchReq(a, "enabled", true), ownerId);
    long b = create("나 흐름", valid());

    JsonNode res = expect(post(path(b) + "/publish").content(body("enable", true)), ownerId, 409);

    assertCode(res, "WORKFLOW_START_CONDITION_OVERLAP");
    assertThat(versionCount(b)).isZero();
    assertThat(ok(get(path(b)), ownerId).get("enabled").asBoolean()).isFalse();
  }

  @Test
  @DisplayName("켜진 정의를 다른 켜진 정의와 겹치게 재게시하면 409 이고 활성 버전은 그대로다")
  void republish_enabledWorkflow_creatingOverlap_rejected() {
    long a = create("가 흐름", valid());
    publish(a);
    ok(patchReq(a, "enabled", true), ownerId);
    long b = create("나 흐름", humanTask(username(memberId)));
    publish(b);
    ok(patchReq(b, "enabled", true), ownerId);
    save(b, valid());

    JsonNode res = expect(publishReq(b, null), ownerId, 409);

    assertCode(res, "WORKFLOW_START_CONDITION_OVERLAP");
    assertThat(versionCount(b)).isEqualTo(1);
    assertThat(ok(get(path(b)), ownerId).get("activeVersion").get("no").asInt()).isEqualTo(1);
  }

  @Test
  @DisplayName("PATCH 는 보낸 칸만 바꾸고, 빈 본문이면 그대로 Detail")
  void patch_changesOnlySentFields() {
    long id = create("흐름", valid());
    publish(id);
    ok(patchReq(id, "enabled", true), ownerId);
    JsonNode before = ok(get(path(id)), ownerId);

    assertThat(ok(patchReq(id), ownerId)).isEqualTo(before);
    assertThat(ok(patchReq(id, "enabled", null, "name", null), ownerId)).isEqualTo(before);

    JsonNode renamed = ok(patchReq(id, "name", "  다른 이름 "), ownerId);
    assertThat(renamed.get("name").asString()).isEqualTo("다른 이름");
    assertThat(renamed.get("enabled").asBoolean()).isTrue();
    assertThat(renamed.get("draftYaml")).isEqualTo(before.get("draftYaml"));
    assertThat(renamed.get("draftUpdatedAt")).isEqualTo(before.get("draftUpdatedAt"));
  }

  @Test
  @DisplayName("같은 프로젝트의 같은 이름(대소문자·앞뒤 공백 무시)은 만들기·PATCH 모두 400")
  void nameTaken_400() {
    long flow = create("Flow", valid());
    long other = create("Other", valid());

    JsonNode made = expect(createReq(projectId, " fLOW ", valid()), ownerId, 400);
    assertCode(made, "WORKFLOW_NAME_TAKEN");
    assertThat(made.get("problems")).isEmpty();
    assertCode(expect(patchReq(other, "name", "FLOW"), ownerId, 400), "WORKFLOW_NAME_TAKEN");
    assertThat(workflowCount(projectId)).isEqualTo(2);
    assertThat(ok(get(path(other)), ownerId).get("name").asString()).isEqualTo("Other");

    // 자기 이름의 대소문자 바꾸기와 다른 프로젝트의 같은 이름은 된다.
    assertThat(ok(patchReq(flow, "name", "FLOW"), ownerId).get("name").asString())
        .isEqualTo("FLOW");
    expect(createReq(newProject(newKey(), "TEAM"), "flow", valid()), ownerId, 201);
  }

  // ───────────────────────── 입력 ─────────────────────────

  @Test
  @DisplayName("256 KiB(UTF-8 바이트)를 넘으면 만들기·저장 400, 검증은 문제로")
  void tooLarge_400() {
    String tooLarge = "# " + "가".repeat(MAX_BYTES / 3 + 1);
    assertThat(tooLarge.length()).as("글자 수는 상한보다 적다").isLessThan(MAX_BYTES);
    String original = valid();
    long id = create("흐름", original);

    JsonNode made = expect(createReq(projectId, "큰 것", tooLarge), ownerId, 400);
    assertCode(made, "WORKFLOW_YAML_TOO_LARGE");
    assertThat(made.get("problems")).isEmpty();
    assertCode(expect(putDraft(id, tooLarge, null), ownerId, 400), "WORKFLOW_YAML_TOO_LARGE");
    assertThat(workflowCount(projectId)).isEqualTo(1);
    assertThat(ok(get(path(id)), ownerId).get("draftYaml").asString()).isEqualTo(original);
    assertThat(codes(ok(validateReq(projectId, tooLarge), ownerId).get("problems")))
        .containsExactly("YAML_TOO_LARGE");

    // 딱 상한은 저장된다.
    expect(createReq(projectId, "딱 맞음", "#" + "a".repeat(MAX_BYTES - 1)), ownerId, 201);
  }

  @Test
  @DisplayName("NUL 은 만들기·초안에서 필드 400, validate 는 줄·열이 든 문제")
  void nulInYaml_400() {
    assertUnstorableYaml(BS + "u0000");
  }

  @Test
  @DisplayName("짝 없는 서로게이트도 만들기·초안에서 필드 400, validate 는 줄·열이 든 문제")
  void surrogateInYaml_400() {
    assertUnstorableYaml(BS + "ud800");
    assertUnstorableYaml(BS + "udc00");
  }

  @Test
  @DisplayName("짝이 맞는 서로게이트(이모지 등)는 저장되고 그대로 돌아온다")
  void pairedSurrogate_allowed() {
    String astral = new String(Character.toChars(0x1F600));
    String yaml = valid() + "# " + astral + "\n";

    JsonNode d = expect(createReq(projectId, "이름" + astral, yaml), ownerId, 201);

    assertThat(d.get("name").asString()).isEqualTo("이름" + astral);
    assertThat(d.get("draftYaml").asString()).isEqualTo(yaml);
  }

  @Test
  @DisplayName("이름은 다듬은 뒤 1~100자 — 보이는 글자 없음·짝 없는 서로게이트는 400(만들기 필수)")
  void invalidName_400() {
    long id = create("원래", valid());
    String yaml = "\"yaml\":\"a\"";
    List<String> bad =
        List.of(
            "\"\"",
            "\"   \"",
            "\"" + "가".repeat(101) + "\"",
            // 다듬으면 보이는 글자가 남지 않는 이름들(제로폭·채움, 방향 제어, NUL·줄 바꿈, 결합 문자).
            "\"" + BS + "u200b" + BS + "u3164\"",
            "\"" + BS + "u202e\"",
            "\"" + BS + "u0000" + BS + "n\"",
            "\"" + BS + "ufe0f\"",
            "\"a" + BS + "ud800b\"",
            "\"" + BS + "udc00\"");
    for (String json : bad) {
      String field = "\"name\":" + json;
      assertFieldError(
          expect(post(listPath(projectId)).content("{" + field + "," + yaml + "}"), ownerId, 400),
          "name");
      assertFieldError(expect(patch(path(id)).content("{" + field + "}"), ownerId, 400), "name");
    }
    assertFieldError(
        expect(post(listPath(projectId)).content("{" + yaml + "}"), ownerId, 400), "name");
    assertThat(ok(get(path(id)), ownerId).get("name").asString()).isEqualTo("원래");
    assertThat(workflowCount(projectId)).isEqualTo(1);

    expect(createReq(projectId, " " + "나".repeat(100) + " ", "a"), ownerId, 201);
  }

  @Test
  @DisplayName("이름은 프로젝트·버전 이름과 같은 규칙으로 다듬어 저장한다(만들기·PATCH)")
  void name_normalized() {
    Map<String, String> cases = new LinkedHashMap<>();
    cases.put("첫" + BS + "n줄", "첫 줄");
    cases.put("탭" + BS + "r" + BS + "n" + BS + "t다음", "탭 다음");
    cases.put("문단" + BS + "u2028구분", "문단 구분");
    cases.put("가운데" + BS + "u0000널", "가운데 널");
    cases.put("방향" + BS + "u202e제어", "방향제어");
    cases.put("격리" + BS + "u2066제어" + BS + "u2069", "격리제어");
    cases.put(BS + "u200b제로폭" + BS + "ufeff", "제로폭");
    cases.put(BS + "u3000전각 공백" + BS + "u00a0", "전각 공백");
    cases.put(BS + "u1100" + BS + "u1161 조합", "가 조합");
    // 만든 것과 PATCH 한 것이 같은 이름이라 서로 다른 프로젝트에서 본다.
    long other = newProject(newKey(), "TEAM");
    long patched = expect(createReq(other, "바꾸기 전", "a"), ownerId, 201).get("id").asLong();

    cases.forEach(
        (sent, saved) -> {
          String field = "\"name\":\"" + sent + "\"";
          JsonNode made =
              expect(
                  post(listPath(projectId)).content("{" + field + ",\"yaml\":\"a\"}"),
                  ownerId,
                  201);
          assertThat(made.get("name").asString()).as("만들기 %s", sent).isEqualTo(saved);
          JsonNode renamed = ok(patch(path(patched)).content("{" + field + "}"), ownerId);
          assertThat(renamed.get("name").asString()).as("PATCH %s", sent).isEqualTo(saved);
        });

    // 길이도 다듬은 뒤로 센다: 풀어 쓴 「가」 100자(200 코드 단위) + 앞뒤 제로폭.
    String decomposed = (BS + "u1100" + BS + "u1161").repeat(100);
    String field = "\"name\":\"" + BS + "u200b" + decomposed + BS + "u200b\"";
    JsonNode made =
        expect(post(listPath(projectId)).content("{" + field + ",\"yaml\":\"a\"}"), ownerId, 201);
    assertThat(made.get("name").asString()).isEqualTo("가".repeat(100));
  }

  @Test
  @DisplayName("다듬은 뒤 겹치는 이름은 만들기·PATCH 모두 WORKFLOW_NAME_TAKEN")
  void nameTaken_afterNormalization_400() {
    long first = create("Flow Two", valid());
    create("가 흐름", valid());
    long other = create("Other", valid());
    List<String> same =
        List.of(
            "Flow" + BS + "nTwo",
            "fl" + BS + "u202eow two",
            BS + "u200bFLOW TWO" + BS + "ufeff",
            "Flow" + BS + "u0000Two",
            BS + "u1100" + BS + "u1161 흐름");

    for (String sent : same) {
      String field = "\"name\":\"" + sent + "\"";
      assertCode(
          expect(post(listPath(projectId)).content("{" + field + ",\"yaml\":\"a\"}"), ownerId, 400),
          "WORKFLOW_NAME_TAKEN");
      assertCode(
          expect(patch(path(other)).content("{" + field + "}"), ownerId, 400),
          "WORKFLOW_NAME_TAKEN");
    }
    assertThat(workflowCount(projectId)).isEqualTo(3);
    assertThat(ok(get(path(other)), ownerId).get("name").asString()).isEqualTo("Other");

    // 자기 이름으로 다듬어지는 값은 겹침이 아니다.
    String own = "{\"name\":\"" + BS + "u200bFlow" + BS + "nTwo\"}";
    assertThat(ok(patch(path(first)).content(own), ownerId).get("name").asString())
        .isEqualTo("Flow Two");
  }

  @Test
  @DisplayName("만들기: 이름 원문 1,000자는 다듬어 통과, 1,001자는 다듬으면 짧아도 400")
  void createNameRawLimit() {
    rawNames(1001)
        .forEach(
            (trimmed, raw) ->
                assertFieldError(expect(createReq(projectId, raw, "a"), ownerId, 400), "name"));
    assertThat(workflowCount(projectId)).isZero();

    rawNames(1000)
        .forEach(
            (trimmed, raw) -> {
              JsonNode made = expect(createReq(projectId, raw, "a"), ownerId, 201);
              assertThat(made.get("name").asString()).isEqualTo(trimmed);
            });
  }

  @Test
  @DisplayName("PATCH: 이름 원문 1,000자는 다듬어 통과, 1,001자는 다듬으면 짧아도 400")
  void patchNameRawLimit() {
    long id = create("원래", valid());
    rawNames(1001)
        .forEach(
            (trimmed, raw) ->
                assertFieldError(
                    expect(patch(path(id)).content(body("name", raw)), ownerId, 400), "name"));
    assertThat(ok(get(path(id)), ownerId).get("name").asString()).isEqualTo("원래");

    rawNames(1000)
        .forEach(
            (trimmed, raw) -> {
              JsonNode renamed = ok(patch(path(id)).content(body("name", raw)), ownerId);
              assertThat(renamed.get("name").asString()).isEqualTo(trimmed);
            });
  }

  @Test
  @DisplayName("필수 칸이 없으면 400")
  void missingRequired_400() {
    long id = create("흐름", valid());

    assertFieldError(
        expect(post(listPath(projectId)).content(body("name", "x")), ownerId, 400), "yaml");
    assertFieldError(expect(put(path(id) + "/draft").content("{}"), ownerId, 400), "yaml");
    String validate = API + "/workflows/validate";
    assertFieldError(
        expect(post(validate).content(body("projectId", projectId)), ownerId, 400), "yaml");
    assertFieldError(expect(post(validate).content(body("yaml", "a")), ownerId, 400), "projectId");
  }

  // ───────────────────────── 권한 ─────────────────────────

  @Test
  @DisplayName("OPEN 프로젝트의 비멤버는 읽기·검증만 되고 쓰기 다섯은 403")
  void nonManager_cannotEdit_403() {
    long pid = newProject(newKey(), "OPEN");
    long id = createPublished(pid);

    assertWritesForbidden(pid, id, human("USER"), "프로젝트 멤버가 아닙니다");
  }

  @Test
  @DisplayName("OWNER 라도 AGENT 역할뿐이면(project:manage 없음) 쓰기 다섯은 403")
  void agentRoleOwner_cannotWrite_403() {
    long id = createPublished(projectId);

    assertWritesForbidden(projectId, id, agentOwner(), "project:manage");
  }

  @Test
  @DisplayName("project:manage 가 있어도 OWNER 가 아니면 쓰기 다섯은 403")
  void manageButNotOwner_cannotWrite_403() {
    long id = createPublished(projectId);

    assertWritesForbidden(projectId, id, memberId, "OWNER 필요");
  }

  @Test
  @DisplayName("OWNER 와 테넌트 ADMIN 은 쓰기 다섯이 모두 된다(위 403 시험들의 짝)")
  void ownerAndAdmin_canWrite() {
    long admin = human("ADMIN");
    for (long caller : List.of(ownerId, admin)) {
      long id = createPublished(projectId);
      List<MockHttpServletRequestBuilder> writes = writes(projectId, id);
      assertThat(send(writes.get(0), caller).status()).isEqualTo(201);
      for (int i = 1; i < writes.size(); i++) {
        assertThat(send(writes.get(i), caller).status()).as("쓰기 %d", i).isEqualTo(200);
      }
      // 같은 프로젝트의 다음 순회가 앞 정의와 시작 조건이 겹쳐 켜기에서 막히지 않게 끈다.
      ok(patchReq(id, "enabled", false), ownerId);
    }
  }

  @Test
  @DisplayName("project:read 가 없으면 읽기·검증도 403")
  void withoutReadPermission_403() {
    long pid = newProject(newKey(), "OPEN");
    long id = createPublished(pid);
    long caller = withMembership(TestFixtures.createHuman(dsl));

    for (MockHttpServletRequestBuilder read : reads(pid, id)) {
      assertThat(expect(read, caller, 403).get("message").asString()).contains("project:read");
    }
  }

  @Test
  @DisplayName("못 보는 워크플로우는 없는 것과 같은 404 본문이고, 쓰기 권한·내용 검사보다 먼저다")
  void unreadable_sameBodyAsMissing() {
    long id = createPublished(projectId);
    // project:manage 는 있고 프로젝트는 못 보는 사람 — 그래야 인터셉터가 아니라 서비스의 순서를 본다.
    long outsider = human("USER");
    long missing = id + 1_000_000;

    List<Supplier<MockHttpServletRequestBuilder>> hidden = idRoutes(id);
    List<Supplier<MockHttpServletRequestBuilder>> absent = idRoutes(missing);
    List<JsonNode> missingBodies = new ArrayList<>();
    for (int i = 0; i < hidden.size(); i++) {
      JsonNode none = stable(expect(absent.get(i).get(), outsider, 404));
      JsonNode unseen = stable(expect(hidden.get(i).get(), outsider, 404));
      assertCode(none, "WORKFLOW_NOT_FOUND");
      assertThat(unseen).as("경로 %d", i).isEqualTo(none);
      assertThat(none.get("message").asString()).doesNotContain(String.valueOf(missing));
      missingBodies.add(none);
    }
    assertThat(versionCount(id)).isEqualTo(1);

    // 지운 프로젝트의 것도 OWNER 에게 같은 404.
    dsl.update(PROJECT)
        .set(PROJECT.DELETED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(PROJECT.ID.eq(projectId))
        .execute();
    for (int i = 0; i < hidden.size(); i++) {
      assertThat(stable(expect(hidden.get(i).get(), ownerId, 404)))
          .as("지운 프로젝트, 경로 %d", i)
          .isEqualTo(missingBodies.get(i));
    }
  }

  @Test
  @DisplayName("못 보는·없는 프로젝트의 validate 는 프로젝트 404(목록·만들기도 같다)")
  void validate_unreadableProject_404() {
    create("이미 있는 이름", valid());
    long outsider = human("USER");
    long missing = projectId + 1_000_000;

    for (long pid : List.of(projectId, missing)) {
      List<MockHttpServletRequestBuilder> requests =
          List.of(
              validateReq(pid, valid()), get(listPath(pid)), createReq(pid, "이미 있는 이름", valid()));
      for (MockHttpServletRequestBuilder req : requests) {
        JsonNode b = expect(req, outsider, 404);
        assertThat(b.get("message").asString()).isEqualTo(HIDDEN_PROJECT);
        assertThat(b.get("errors").isNull()).as("WORKFLOW_NOT_FOUND 가 아니다").isTrue();
      }
    }
  }

  @Test
  @DisplayName("내용 검사(크기·이름·충돌·켜기)는 권한 확인 뒤에 한다")
  void contentChecks_afterPermission() {
    create("겹치는 이름", valid());
    long id = create("흐름", valid());
    String tooLarge = "a".repeat(MAX_BYTES + 1);
    String stale = "2020-01-01T00:00:00Z";

    expect(createReq(projectId, "겹치는 이름", valid()), memberId, 403);
    expect(createReq(projectId, "새 이름", tooLarge), memberId, 403);
    expect(putDraft(id, tooLarge, null), memberId, 403);
    expect(putDraft(id, valid(), stale), memberId, 403);
    expect(publishReq(id, stale), memberId, 403);
    expect(patchReq(id, "enabled", true), memberId, 403);
    expect(patchReq(id, "name", "겹치는 이름"), memberId, 403);
    expect(restoreReq(id, 9, stale), memberId, 403);
  }

  @Test
  @DisplayName("다른 테넌트의 것은 OPEN 프로젝트여도 ADMIN 에게조차 없는 것이다")
  void otherTenant_cannotSee() {
    long admin = human("ADMIN");
    long tid2 = ensureFixtureTenant("wf-api-rls");
    useTenant(tid2);
    long p2 =
        dsl.insertInto(PROJECT)
            .set(PROJECT.KEY, newKey())
            .set(PROJECT.NAME, "남의 프로젝트")
            .set(PROJECT.TYPE, "OPEN")
            .set(PROJECT.OWNER_ID, ownerId)
            .returning(PROJECT.ID)
            .fetchSingle()
            .getId();
    long w2 = repo.insert(p2, "남의 것", "a", ownerId, Instant.now());
    repo.insertVersion(w2, "a", "{}", ownerId);
    useTenant(1L);

    for (Supplier<MockHttpServletRequestBuilder> route : idRoutes(w2)) {
      assertCode(expect(route.get(), admin, 404), "WORKFLOW_NOT_FOUND");
    }
    for (MockHttpServletRequestBuilder req :
        List.of(get(listPath(p2)), createReq(p2, "침범", "a"), validateReq(p2, "a"))) {
      assertThat(expect(req, admin, 404).get("message").asString()).isEqualTo(HIDDEN_PROJECT);
    }

    useTenant(tid2);
    assertThat(workflowCount(p2)).isEqualTo(1);
    assertThat(repo.findById(w2).orElseThrow().draftYaml()).isEqualTo("a");
    useTenant(1L);
  }

  // ───────────────────────── 시험 도우미 ─────────────────────────

  /** 정의의 그 번호 버전 id. */
  private long versionId(long workflowId, int no) {
    return repo.findVersion(workflowId, no).orElseThrow().id();
  }

  /**
   * 버전에 실행 행을 직접 심는다 — 상태마다 이슈 하나(활성 실행은 이슈당 하나라). 끝난 상태는 RUNNING 으로 넣은 뒤 상태·끝난 시각을 바꾼다(CANCELED 는
   * 아직 API 로 만들 수 없다).
   */
  private List<Long> seedRuns(long versionId, String... statuses) {
    List<Long> issues = new ArrayList<>();
    for (String status : statuses) {
      Res res =
          send(post(API + "/projects/" + key + "/issues").content(body("title", "실행 이슈")), ownerId);
      assertThat(res.status()).as("%s", res.text()).isBetween(200, 201);
      long issue = res.body().get("id").asLong();
      issues.add(issue);
      long run =
          runRepository
              .insertRun(issue, versionId, "RUNNING", "work", "{}", ownerId, Instant.now())
              .orElseThrow()
              .id();
      if (!"RUNNING".equals(status)) {
        dsl.update(WORKFLOW_RUN)
            .set(WORKFLOW_RUN.STATUS, status)
            .set(
                WORKFLOW_RUN.ENDED_AT,
                "COMPLETED".equals(status) || "CANCELED".equals(status)
                    ? OffsetDateTime.now(ZoneOffset.UTC)
                    : null)
            .where(WORKFLOW_RUN.ID.eq(run))
            .execute();
      }
    }
    return issues;
  }

  /**
   * 이슈의 deleted_at 만 채운다(저장소 softDelete) — 실행은 활성 그대로 둔다. 삭제 API 는 실행을 닫으므로, 닫히지 않고 남은 실행(삭제 경로가
   * 실행을 닫지 않은 경우·예전 데이터)을 집계가 빼는지 보려고 API 를 거치지 않는다.
   */
  private void softDeleteIssue(long issueId) {
    issueRepository.softDelete(issueId, Instant.now());
  }

  /** 응답 하나(상태·본문 글·읽은 JSON). */
  private record Res(int status, String text, JsonNode body) {}

  /** 시스템 역할을 가진 테넌트 1 의 사람. */
  private long human(String role) {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, role);
    return id;
  }

  /** 기본 AGENT 역할만 가진 AI 를 시험 프로젝트(TEAM)의 OWNER 로 넣는다. */
  private long agentOwner() {
    long id = withMembership(TestFixtures.createAgentNoToken(dsl));
    TestFixtures.grantRole(dsl, id, "AGENT");
    projectService.addMember(ownerId, key, new AddMemberRequest(id, "OWNER"));
    return id;
  }

  /** 다른 시험과 겹치지 않는 프로젝트 키. */
  private static String newKey() {
    return "WA" + UUID.randomUUID().toString().replace("-", "").substring(0, 7).toUpperCase();
  }

  /** ownerId 가 OWNER 인 프로젝트를 만든다. */
  private long newProject(String projectKey, String type) {
    long id =
        projectService
            .create(ownerId, new CreateProjectRequest(projectKey, "워크플로우", "x", type))
            .id();
    TenantContext.set(1L);
    return id;
  }

  /** YAML 의 members 에 넣을 실제 username(아니면 구성원 오류로 엉뚱하게 실패한다). */
  private String username(long userId) {
    return dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(userId)).fetchSingle().value1();
  }

  /** 대소문자가 섞인 새 username 으로 바꾸고 돌려준다(칸은 50자). */
  private String renamed(long userId, String prefix, String suffix) {
    String name = prefix + UUID.randomUUID().toString().substring(0, 8) + suffix;
    dsl.update(USER).set(USER.USERNAME, name).where(USER.ID.eq(userId)).execute();
    return name;
  }

  /** 게시 버전 응답의 저장 모델에서 그 역할의 구성원 목록. */
  private static List<String> storedMembers(JsonNode version, String role) {
    for (JsonNode r : version.get("model").get("roles")) {
      if (r.get("key").asString().equals(role)) {
        List<String> out = new ArrayList<>();
        r.get("memberUsernames").forEach(m -> out.add(m.asString()));
        return out;
      }
    }
    throw new AssertionError("역할이 없다: " + role);
  }

  /** OWNER 만으로 된, 문제 없는 정의. */
  private String valid() {
    return humanTask(username(ownerId));
  }

  /** 역할 구성원이 {@code member} 한 명인 사람 작업 정의. */
  private static String humanTask(String member) {
    return """
    schema: genia/workflow@1
    name: YAML 안의 이름
    roles:
      owner: { members: ["%s"] }
    nodes:
      start: { type: start }
      work: { type: human_task, role: owner, outcomes: { done: { to: end } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: owner }, to: work }
    """
        .formatted(member);
  }

  /** AI 작업 하나(7행 work)짜리 정의 — 능력과 가는 곳을 바꿔 경고·오류를 만든다. */
  private static String task(String member, String capability, String to) {
    return """
    schema: genia/workflow@1
    name: YAML 안의 이름
    roles:
      owner: { members: ["%s"] }
    nodes:
      start: { type: start }
      work: { type: agent_task, role: owner, instructions: 일, requires: [%s], outcomes: { done: { to: %s } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: owner }, to: work }
    """
        .formatted(member, capability, to);
  }

  /** 7행에 없는 노드로 가는 선(ERROR)과 모르는 능력(WARNING)이 함께 있는 정의. */
  private String broken() {
    return task(username(ownerId), "gpu", "nowhere");
  }

  /** 문제 한 건의 모양과 줄·열·노드까지 본다(편집기가 쓰는 계약). */
  private void assertBrokenLink(JsonNode problems) {
    JsonNode p = problem(problems, "REF_NODE_UNKNOWN");
    assertThat(fields(p))
        .containsExactlyInAnyOrder("severity", "code", "message", "line", "column", "nodeKey");
    assertThat(p.get("severity").asString()).isEqualTo("ERROR");
    assertThat(p.get("line").asInt()).isEqualTo(7);
    assertThat(p.get("column").asInt()).isGreaterThan(1);
    assertThat(p.get("nodeKey").asString()).isEqualTo("work");
  }

  /** 저장할 수 없는 글자(JSON 이스케이프로 보낸다 — 글로 보내면 UTF-8 변환이 바꿔 버린다). */
  private void assertUnstorableYaml(String escape) {
    long id = create("흐름" + UUID.randomUUID(), valid());
    String original = ok(get(path(id)), ownerId).get("draftYaml").asString();
    int count = workflowCount(projectId);
    String yaml = "\"yaml\":\"a: b" + BS + "nc: x" + escape + "y\"";

    assertFieldError(
        expect(post(listPath(projectId)).content("{\"name\":\"n\"," + yaml + "}"), ownerId, 400),
        "yaml");
    assertFieldError(
        expect(put(path(id) + "/draft").content("{" + yaml + "}"), ownerId, 400), "yaml");
    assertThat(workflowCount(projectId)).isEqualTo(count);
    assertThat(ok(get(path(id)), ownerId).get("draftYaml").asString()).isEqualTo(original);

    JsonNode checked =
        ok(
            post(API + "/workflows/validate")
                .content("{\"projectId\":" + projectId + "," + yaml + "}"),
            ownerId);
    JsonNode p = problem(checked.get("problems"), "YAML_INVALID_TEXT");
    assertThat(p.get("severity").asString()).isEqualTo("ERROR");
    assertThat(p.get("line").asInt()).isEqualTo(2);
    assertThat(p.get("column").asInt()).isEqualTo(5);
  }

  /** 쓰기 다섯: 만들기·초안·게시·되돌리기·PATCH(요청은 한 번씩만 쓴다). */
  private List<MockHttpServletRequestBuilder> writes(long pid, long id) {
    return List.of(
        createReq(pid, "새로 " + UUID.randomUUID(), valid()),
        putDraft(id, valid() + "# 쓰기\n", null),
        publishReq(id, null),
        post(path(id) + "/versions/1/restore-draft"),
        patchReq(id, "enabled", true, "name", "바꾼 이름 " + id));
  }

  /** 읽기 넷과 validate. */
  private List<MockHttpServletRequestBuilder> reads(long pid, long id) {
    return List.of(
        get(listPath(pid)),
        get(path(id)),
        validateReq(pid, valid()),
        get(path(id) + "/versions"),
        get(path(id) + "/versions/1"));
  }

  /** {id} 경로 일곱 — 쓰기에는 내용 검사에 걸릴 값을 실어, 404 가 먼저임을 함께 본다. */
  private List<Supplier<MockHttpServletRequestBuilder>> idRoutes(long id) {
    String stale = "2020-01-01T00:00:00Z";
    return List.of(
        () -> get(path(id)),
        () -> get(path(id) + "/versions"),
        () -> get(path(id) + "/versions/1"),
        () -> putDraft(id, "a".repeat(MAX_BYTES + 1), stale),
        () -> publishReq(id, stale),
        () -> restoreReq(id, 1, stale),
        () -> patchReq(id, "enabled", true, "name", "침범"));
  }

  /** 읽기·validate 는 200, 쓰기 다섯은 각각 403 이고 아무것도 바뀌지 않았음을 본다. */
  private void assertWritesForbidden(long pid, long id, long caller, String message) {
    for (MockHttpServletRequestBuilder read : reads(pid, id)) {
      ok(read, caller);
    }
    JsonNode before = ok(get(path(id)), ownerId);
    int count = workflowCount(pid);
    List<MockHttpServletRequestBuilder> writes = writes(pid, id);
    assertThat(writes).hasSize(5);
    for (int i = 0; i < writes.size(); i++) {
      Res res = send(writes.get(i), caller);
      assertThat(res.status()).as("쓰기 %d: %s", i, res.text()).isEqualTo(403);
      assertThat(res.body().get("message").asString()).as("쓰기 %d", i).contains(message);
    }
    assertThat(ok(get(path(id)), ownerId)).isEqualTo(before);
    assertThat(workflowCount(pid)).isEqualTo(count);
    assertThat(versionCount(id)).isEqualTo(1);
  }

  /** OWNER 로 만들고 id 를 돌려준다. */
  private long create(String name, String yaml) {
    return expect(createReq(projectId, name, yaml), ownerId, 201).get("id").asLong();
  }

  /** 되돌리기·버전 읽기까지 부를 수 있게 1 번 버전이 있는 정의. */
  private long createPublished(long pid) {
    long id =
        expect(createReq(pid, "흐름 " + UUID.randomUUID(), valid()), ownerId, 201).get("id").asLong();
    publish(id);
    return id;
  }

  /** OWNER 로 충돌 검사 없이 게시한다. */
  private int publish(long id) {
    return ok(publishReq(id, null), ownerId).get("versionNo").asInt();
  }

  /** OWNER 로 충돌 검사 없이 초안을 저장한다. */
  private void save(long id, String yaml) {
    ok(putDraft(id, yaml, null), ownerId);
  }

  /** GET 이 돌려준 초안 시각 글(클라이언트가 되보내는 값). */
  private String time(long id) {
    return ok(get(path(id)), ownerId).get("draftUpdatedAt").asString();
  }

  /** 목록에서 그 정의의 활성 번호와 draftChanged 를 본다. */
  private void assertSummary(long id, int activeNo, boolean changed) {
    for (JsonNode row : ok(get(listPath(projectId)), ownerId)) {
      if (row.get("id").asLong() == id) {
        assertThat(row.get("activeVersionNo").asInt()).isEqualTo(activeNo);
        assertThat(row.get("draftChanged").asBoolean()).isEqualTo(changed);
        return;
      }
    }
    throw new AssertionError("목록에 없다: " + id);
  }

  /** createdBy 가 세 칸짜리 요약인지 본다. */
  private void assertActor(JsonNode actor, long userId) {
    assertThat(fields(actor)).containsExactlyInAnyOrder("id", "username", "name");
    assertThat(actor.get("id").asLong()).isEqualTo(userId);
    assertThat(actor.get("username").asString()).isEqualTo(username(userId));
    assertThat(actor.get("name").asString()).isNotBlank();
  }

  /** 오류 코드는 {@code errors.code} 에 있다. */
  private static void assertCode(JsonNode body, String code) {
    assertThat(body.path("errors").path("code").asString("")).as("%s", body).isEqualTo(code);
  }

  /** 입력 검증 400 은 전역 본문에 필드 이름·한국어 문구로 나온다. */
  private static void assertFieldError(JsonNode body, String field) {
    assertThat(body.get("errors").propertyNames()).as("%s", body).containsExactly(field);
    assertThat(body.get("errors").get(field).asString()).containsPattern("[가-힣]");
  }

  /**
   * 다듬으면 짧아지는, 원문이 {@code length} 자(UTF-16)인 이름들(다듬은 값 → 원문) — 셈이 코드 포인트나 다듬은 뒤 길이면 경계가 어긋나게 뒤
   * 공백·가운데 방향 제어·보조 평면 글자를 하나씩 쓴다.
   */
  private static Map<String, String> rawNames(int length) {
    String bidi = Character.toString(0x202E);
    String zeroWidth = Character.toString(0x200B);
    String emoji = Character.toString(0x1F600);
    return Map.of(
        "흐름",
        "흐름" + " ".repeat(length - 2),
        "방향제어",
        "방향" + bidi.repeat(length - 4) + "제어",
        emoji,
        emoji + zeroWidth.repeat(length - 2));
  }

  /** 그 코드의 첫 문제(없으면 실패). */
  private static JsonNode problem(JsonNode problems, String code) {
    for (JsonNode p : problems) {
      if (p.get("code").asString().equals(code)) {
        return p;
      }
    }
    throw new AssertionError(code + " 문제가 없다: " + problems);
  }

  /** 문제 목록의 코드들. */
  private static List<String> codes(JsonNode problems) {
    List<String> out = new ArrayList<>();
    problems.forEach(p -> out.add(p.get("code").asString()));
    return out;
  }

  /** 응답 칸 이름들 — 빠지거나 더해진 칸을 잡는다. */
  private static List<String> fields(JsonNode node) {
    return new ArrayList<>(node.propertyNames());
  }

  /** 404 본문에서 요청마다 다른 두 칸만 뺀다. */
  private static JsonNode stable(JsonNode body) {
    ObjectNode copy = (ObjectNode) body.deepCopy();
    copy.remove("timestamp");
    copy.remove("path");
    return copy;
  }

  /** API 를 거치지 않고 센 버전 수. */
  private int versionCount(long id) {
    return dsl.fetchCount(WORKFLOW_VERSION, WORKFLOW_VERSION.WORKFLOW_ID.eq(id));
  }

  /** API 를 거치지 않고 센 정의 수. */
  private int workflowCount(long pid) {
    return dsl.fetchCount(WORKFLOW, WORKFLOW.PROJECT_ID.eq(pid));
  }

  /** 워크플로우 한 건의 경로. */
  private static String path(long id) {
    return API + "/workflows/" + id;
  }

  /** 프로젝트 아래 목록·만들기 경로. */
  private static String listPath(long pid) {
    return API + "/projects/" + pid + "/workflows";
  }

  /** 만들기 요청. */
  private MockHttpServletRequestBuilder createReq(long pid, String name, String yaml) {
    return post(listPath(pid)).content(body("name", name, "yaml", yaml));
  }

  /** 초안 저장 요청(expected 는 null 이어도 실어 보낸다). */
  private MockHttpServletRequestBuilder putDraft(long id, String yaml, String expected) {
    return put(path(id) + "/draft").content(body("yaml", yaml, "expectedDraftUpdatedAt", expected));
  }

  /** 게시 요청. */
  private MockHttpServletRequestBuilder publishReq(long id, String expected) {
    return post(path(id) + "/publish").content(body("expectedDraftUpdatedAt", expected));
  }

  /** 되돌리기 요청(expected 는 null 이어도 실어 보낸다 — 본문 없는 호출은 경로로 바로 부른다). */
  private MockHttpServletRequestBuilder restoreReq(long id, int no, String expected) {
    return post(path(id) + "/versions/" + no + "/restore-draft")
        .content(body("expectedDraftUpdatedAt", expected));
  }

  /** 저장 없는 검증 요청. */
  private MockHttpServletRequestBuilder validateReq(long pid, String yaml) {
    return post(API + "/workflows/validate").content(body("projectId", pid, "yaml", yaml));
  }

  /** 보낼 칸만 실은 PATCH 요청. */
  private MockHttpServletRequestBuilder patchReq(long id, Object... pairs) {
    return patch(path(id)).content(body(pairs));
  }

  /** 이름·값 쌍을 JSON 본문으로(null 값도 실린다). */
  private String body(Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) {
      map.put((String) pairs[i], pairs[i + 1]);
    }
    return om.writeValueAsString(map);
  }

  /** 200 을 기대하고 본문을 돌려준다. */
  private JsonNode ok(MockHttpServletRequestBuilder req, long caller) {
    return expect(req, caller, 200);
  }

  /** 상태를 확인하고 본문을 돌려준다(실패 때 본문을 보인다). */
  private JsonNode expect(MockHttpServletRequestBuilder req, long caller, int status) {
    Res res = send(req, caller);
    assertThat(res.status()).as("%s", res.text()).isEqualTo(status);
    return res.body();
  }

  /** JSON 본문으로 부른다. */
  private Res send(MockHttpServletRequestBuilder req, long caller) {
    return sendRaw(req.contentType(MediaType.APPLICATION_JSON), caller);
  }

  /** 실제 인증 필터를 지나게 Bearer 로 부른다. */
  private Res sendRaw(MockHttpServletRequestBuilder req, long caller) {
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L));
    try {
      var response = mvc.perform(req).andReturn().getResponse();
      String text = response.getContentAsString(StandardCharsets.UTF_8);
      return new Res(response.getStatus(), text, text.isBlank() ? null : om.readTree(text));
    } catch (Exception e) {
      throw new IllegalStateException("요청 실패", e);
    } finally {
      // 요청 처리가 지우는 테넌트 문맥을 다시 심는다.
      TenantContext.set(1L);
    }
  }
}
