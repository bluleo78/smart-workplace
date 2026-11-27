package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW;
import static com.workplace.support.TestFixtures.uniqueProjectKey;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModelJson;
import com.workplace.issue.workflow.domain.WorkflowYamlParser;
import com.workplace.issue.workflow.repository.WorkflowRepository;
import com.workplace.issue.workflow.repository.WorkflowRow;
import com.workplace.issue.workflow.repository.WorkflowSummaryRow;
import com.workplace.issue.workflow.repository.WorkflowVersionRow;
import com.workplace.issue.workflow.repository.WorkflowVersionSummaryRow;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;

/**
 * WP-1984 워크플로우 정의·버전 저장소 통합 시험. 중복 이름 위반은 트랜잭션을 망가뜨리므로 {@code @Transactional} 없이 커밋된 행으로 시험하고, 시험이
 * 만든 프로젝트·사용자를 {@link #cleanup()} 이 지운다(workflow·workflow_version 은 프로젝트 삭제에 CASCADE 로 따라 지워진다).
 */
class WorkflowRepositoryTest extends IntegrationTestBase {

  @Autowired WorkflowRepository repo;

  /** 시험이 만든 (테넌트, 프로젝트) 와 사용자 — 끝에서 지운다. */
  private final List<long[]> projects = new ArrayList<>();

  private final List<Long> users = new ArrayList<>();

  private static final Instant AT = Instant.parse("2026-11-22T01:02:03.456Z");

  @AfterEach
  void cleanup() {
    for (long[] p : projects) {
      cleanupInTenant(p[0], () -> baseDsl.deleteFrom(PROJECT).where(PROJECT.ID.eq(p[1])).execute());
    }
    for (Long u : users) {
      cleanupInTenant(1L, () -> baseDsl.deleteFrom(USER).where(USER.ID.eq(u)).execute());
    }
  }

  private long newUser() {
    long id = callInTenant(1L, () -> TestFixtures.createHuman(baseDsl));
    users.add(id);
    return id;
  }

  private long newProject(long tenantId, long ownerId) {
    long id =
        callInTenant(
            tenantId,
            () ->
                baseDsl
                    .insertInto(PROJECT)
                    .set(PROJECT.KEY, uniqueProjectKey("WF"))
                    .set(PROJECT.NAME, "workflow repo test")
                    .set(PROJECT.OWNER_ID, ownerId)
                    .returning(PROJECT.ID)
                    .fetchOne()
                    .getId());
    projects.add(new long[] {tenantId, id});
    return id;
  }

  /** 버전 행의 목록 요약(원문·모델 없음). */
  private static WorkflowVersionSummaryRow summaryOf(WorkflowVersionRow v) {
    return new WorkflowVersionSummaryRow(v.id(), v.versionNo(), v.createdAt(), v.createdBy());
  }

  private long insertWorkflow(long projectId, String name, long actor) {
    return callInTenant(1L, () -> repo.insert(projectId, name, "schema: x\n", actor, AT));
  }

  private WorkflowVersionRow publish(long workflowId, String yaml, String json, long actor) {
    return callInTenant(
        1L,
        () -> {
          repo.lockById(workflowId);
          return repo.insertVersion(workflowId, yaml, json, actor);
        });
  }

  @Test
  @DisplayName("넣은 정의를 그대로 읽고, 켜짐은 꺼짐·활성 버전은 없음으로 시작한다")
  void insertAndFind() {
    long actor = newUser();
    long pid = newProject(1L, actor);

    long id = insertWorkflow(pid, "흐름", actor);

    WorkflowRow row = callInTenant(1L, () -> repo.findById(id)).orElseThrow();
    assertThat(row.id()).isEqualTo(id);
    assertThat(row.projectId()).isEqualTo(pid);
    assertThat(row.name()).isEqualTo("흐름");
    assertThat(row.enabled()).isFalse();
    assertThat(row.activeVersionId()).isNull();
    assertThat(row.draftYaml()).isEqualTo("schema: x\n");
    assertThat(row.draftUpdatedBy()).isEqualTo(actor);
    // 넘겨받은 Instant 를 그대로 쓴다(DB 의 마이크로초 안에서 같음).
    assertThat(row.draftUpdatedAt()).isEqualTo(AT);
    assertThat(row.createdAt()).isNotNull();
    assertThat(callInTenant(1L, () -> repo.findById(id + 1_000_000))).isEmpty();
    assertThat(callInTenant(1L, () -> repo.lockById(id))).isPresent();
  }

  @Test
  @DisplayName("이름은 프로젝트 안에서 대소문자 무시로 유일하고, 다른 프로젝트는 같아도 된다")
  void nameUnique_caseInsensitive_perProject() {
    long actor = newUser();
    long p1 = newProject(1L, actor);
    long p2 = newProject(1L, actor);
    long a = insertWorkflow(p1, "Flow", actor);

    assertThatThrownBy(() -> insertWorkflow(p1, "fLOW", actor))
        .isInstanceOf(DuplicateKeyException.class);
    long other = insertWorkflow(p1, "Other", actor);
    assertThatThrownBy(
            () ->
                callInTenant(
                    1L,
                    () -> {
                      repo.updateName(other, "FLOW");
                      return null;
                    }))
        .isInstanceOf(DuplicateKeyException.class);
    insertWorkflow(p2, "flow", actor);

    assertThat(callInTenant(1L, () -> repo.existsByName(p1, "FLOW", null))).isTrue();
    // 자기 자신은 겹침에서 뺀다(이름만 대소문자를 바꿔 저장하는 경우).
    assertThat(callInTenant(1L, () -> repo.existsByName(p1, "FLOW", a))).isFalse();
    assertThat(callInTenant(1L, () -> repo.existsByName(p1, "nope", null))).isFalse();
    callInTenant(
        1L,
        () -> {
          repo.updateName(a, "FLOW");
          return null;
        });
    assertThat(callInTenant(1L, () -> repo.findById(a)).orElseThrow().name()).isEqualTo("FLOW");
    // 목록은 lower(name), id 순.
    assertThat(callInTenant(1L, () -> repo.findByProject(p1)))
        .extracting(WorkflowSummaryRow::name)
        .containsExactly("FLOW", "Other");
  }

  @Test
  @DisplayName("버전 번호는 정의마다 1부터 하나씩 늘고, 목록은 새 번호가 먼저다")
  void versionNo_startsAtOne_andIncrements() {
    long actor = newUser();
    long pid = newProject(1L, actor);
    long w1 = insertWorkflow(pid, "a", actor);
    long w2 = insertWorkflow(pid, "b", actor);

    WorkflowVersionRow v1 = publish(w1, "y1", "{\"a\":1}", actor);
    WorkflowVersionRow v2 = publish(w1, "y2", "{\"a\":2}", actor);
    WorkflowVersionRow other = publish(w2, "y3", "{\"a\":3}", actor);

    assertThat(v1.versionNo()).isEqualTo(1);
    assertThat(v2.versionNo()).isEqualTo(2);
    assertThat(other.versionNo()).isEqualTo(1);
    assertThat(v1.workflowId()).isEqualTo(w1);
    assertThat(v1.createdBy()).isEqualTo(actor);
    assertThat(v1.sourceYaml()).isEqualTo("y1");
    assertThat(callInTenant(1L, () -> repo.findVersions(w1)))
        .containsExactly(summaryOf(v2), summaryOf(v1));
    assertThat(callInTenant(1L, () -> repo.findVersion(w1, 2)).orElseThrow().id())
        .isEqualTo(v2.id());
    assertThat(callInTenant(1L, () -> repo.findVersion(w1, 3))).isEmpty();
    assertThat(callInTenant(1L, () -> repo.findVersionSummaryById(v1.id())))
        .contains(summaryOf(v1));
    assertThat(callInTenant(1L, () -> repo.findVersionById(v1.id())).orElseThrow().sourceYaml())
        .isEqualTo("y1");
  }

  @Test
  @DisplayName("목록 요약은 활성 번호와 draftChanged(활성 없음 또는 활성 원문과 다름)를 DB 에서 계산한다")
  void findByProject_summary() {
    long actor = newUser();
    long pid = newProject(1L, actor);
    long none = insertWorkflow(pid, "a", actor);
    long same = insertWorkflow(pid, "b", actor);
    long changed = insertWorkflow(pid, "c", actor);
    long unset = insertWorkflow(pid, "d", actor);
    publish(same, "옛 원문", "{}", actor);
    WorkflowVersionRow sameActive = publish(same, "schema: x\n", "{}", actor);
    WorkflowVersionRow changedActive = publish(changed, "다른 원문", "{}", actor);
    // 활성으로 지정하지 않은 버전은 원문이 같아도 「활성 없음」이다.
    publish(unset, "schema: x\n", "{}", actor);
    callInTenant(
        1L,
        () -> {
          repo.setActiveVersion(same, sameActive.id());
          repo.setActiveVersion(changed, changedActive.id());
          repo.updateEnabled(changed, true);
          return null;
        });

    assertThat(callInTenant(1L, () -> repo.findByProject(pid)))
        .containsExactly(
            new WorkflowSummaryRow(none, "a", false, null, true),
            new WorkflowSummaryRow(same, "b", false, 2, false),
            new WorkflowSummaryRow(changed, "c", true, 1, true),
            new WorkflowSummaryRow(unset, "d", false, null, true));
  }

  /** 모든 배열(roles·shared·nodes·outcomes·outputs·layout)에서 쓰는, 일부러 알파벳 순이 아닌 정의. */
  private static final String ORDERED_YAML =
      """
      schema: genia/workflow@1
      name: 순서
      shared:
        zeta: 글 하나
        alpha: 글 둘
        mid: 글 셋
      roles:
        zed:  { name: 제트, members: [] }
        abe:  { name: 에이, members: [] }
        owner: { name: 확인자, members: [] }
      nodes:
        start: { type: start }
        zulu:
          type: agent_task
          name: 줄루
          role: zed
          outputs: { zOut: { type: url, required: true }, aOut: { type: string, required: false }, mOut: { type: url, required: false } }
          outcomes:
            zdone: { to: alpha_n }
            adone: { to: end }
            mdone: { to: end }
        alpha_n:
          type: agent_task
          name: 알파
          role: abe
          outcomes:
            fin: { to: end }
        end: { type: end }
      start:
        - { when: { assigneeRole: zed }, to: zulu }
      layout:
        zulu: { x: 1.5, y: 2 }
        alpha_n: { x: 3, y: 4 }
        end: { x: 5, y: 6 }
      """;

  @Test
  @DisplayName("parse → write → DB → read 뒤에도 여섯 배열의 순서와 값이 같다")
  void modelJson_roundTrip_keepsArrayOrder() {
    long actor = newUser();
    long pid = newProject(1L, actor);
    long wid = insertWorkflow(pid, "순서", actor);
    var parsed = WorkflowYamlParser.parse(ORDERED_YAML);
    WorkflowModel model = parsed.model();
    assertThat(model).as("시험용 YAML 문제: " + parsed.problems()).isNotNull();
    String json = WorkflowModelJson.write(model);

    WorkflowVersionRow saved = publish(wid, ORDERED_YAML, json, actor);
    WorkflowVersionRow loaded =
        callInTenant(1L, () -> repo.findVersionById(saved.id())).orElseThrow();
    WorkflowModel back = WorkflowModelJson.read(loaded.modelJson());

    assertThat(back).isEqualTo(model);
    assertThat(new ArrayList<>(back.roles().keySet())).containsExactly("zed", "abe", "owner");
    assertThat(new ArrayList<>(back.shared().keySet())).containsExactly("zeta", "alpha", "mid");
    assertThat(new ArrayList<>(back.nodes().keySet()))
        .containsExactly("start", "zulu", "alpha_n", "end");
    var zulu = back.nodes().get("zulu");
    assertThat(new ArrayList<>(zulu.outcomes().keySet()))
        .containsExactly("zdone", "adone", "mdone");
    assertThat(new ArrayList<>(zulu.outputs().keySet())).containsExactly("zOut", "aOut", "mOut");
    assertThat(new ArrayList<>(back.layout().keySet())).containsExactly("zulu", "alpha_n", "end");
  }

  @Test
  @DisplayName("조건의 equals 값(아주 큰 수·소수·큰 지수·불리언·글)이 JSONB 를 거쳐도 같다")
  void modelJson_roundTrip_equalsValues() {
    long actor = newUser();
    long pid = newProject(1L, actor);
    long wid = insertWorkflow(pid, "값", actor);
    var conds =
        List.of(
            new WorkflowModel.Condition(null, "a.b", Long.MAX_VALUE, "x"),
            new WorkflowModel.Condition(null, "a.b", 1.5, "x"),
            new WorkflowModel.Condition(null, "a.b", 1e300, "x"),
            new WorkflowModel.Condition(null, "a.b", true, "x"),
            new WorkflowModel.Condition(null, "a.b", "글 \"따옴표\"", "x"),
            new WorkflowModel.Condition("lead", null, null, "x"));
    WorkflowModel model =
        new WorkflowModel(
            "genia/workflow@1", "n", null, null, new java.util.LinkedHashMap<>(), conds, Map.of());

    WorkflowVersionRow saved = publish(wid, "y", WorkflowModelJson.write(model), actor);
    WorkflowVersionRow loaded =
        callInTenant(1L, () -> repo.findVersionById(saved.id())).orElseThrow();

    assertThat(WorkflowModelJson.read(loaded.modelJson()).start()).isEqualTo(conds);
  }

  @Test
  @DisplayName("초안을 고쳐도 게시 버전은 그대로이고, 초안 저장자·시각이 바뀐다")
  void updateDraft_keepsVersions() {
    long actor = newUser();
    long other = newUser();
    long pid = newProject(1L, actor);
    long wid = insertWorkflow(pid, "d", actor);
    WorkflowVersionRow v = publish(wid, "게시본", "{}", actor);
    Instant later = AT.plus(5, ChronoUnit.MINUTES);

    callInTenant(
        1L,
        () -> {
          repo.updateDraft(wid, "새 초안", other, later);
          return null;
        });

    WorkflowRow row = callInTenant(1L, () -> repo.findById(wid)).orElseThrow();
    assertThat(row.draftYaml()).isEqualTo("새 초안");
    assertThat(row.draftUpdatedBy()).isEqualTo(other);
    assertThat(row.draftUpdatedAt()).isEqualTo(later);
    assertThat(callInTenant(1L, () -> repo.findVersions(wid))).containsExactly(summaryOf(v));
    assertThat(callInTenant(1L, () -> repo.findVersionById(v.id()))).contains(v);
  }

  @Test
  @DisplayName("켜진 프로젝트는 켜짐과 활성 게시 버전이 둘 다 있어야 한다")
  void existsEnabledPublished_needsBoth() {
    long actor = newUser();
    long pid = newProject(1L, actor);
    long wid = insertWorkflow(pid, "e", actor);
    assertThat(callInTenant(1L, () -> repo.existsEnabledPublished(pid))).isFalse();

    // 켜기만 한 것
    callInTenant(
        1L,
        () -> {
          repo.updateEnabled(wid, true);
          return null;
        });
    assertThat(callInTenant(1L, () -> repo.existsEnabledPublished(pid))).isFalse();

    // 활성 버전만 있고 꺼진 것
    WorkflowVersionRow v = publish(wid, "y", "{}", actor);
    callInTenant(
        1L,
        () -> {
          repo.setActiveVersion(wid, v.id());
          repo.updateEnabled(wid, false);
          return null;
        });
    assertThat(callInTenant(1L, () -> repo.existsEnabledPublished(pid))).isFalse();

    // 둘 다
    callInTenant(
        1L,
        () -> {
          repo.updateEnabled(wid, true);
          return null;
        });
    assertThat(callInTenant(1L, () -> repo.existsEnabledPublished(pid))).isTrue();
    assertThat(callInTenant(1L, () -> repo.findById(wid)).orElseThrow().activeVersionId())
        .isEqualTo(v.id());
  }

  @Test
  @DisplayName("다른 정의의 버전을 활성으로 지정하면 IllegalStateException 이고 바뀌지 않는다")
  void setActiveVersion_rejectsForeignVersion() {
    long actor = newUser();
    long pid = newProject(1L, actor);
    long w1 = insertWorkflow(pid, "a", actor);
    long w2 = insertWorkflow(pid, "b", actor);
    WorkflowVersionRow foreign = publish(w2, "y", "{}", actor);

    assertThatThrownBy(
            () ->
                callInTenant(
                    1L,
                    () -> {
                      repo.setActiveVersion(w1, foreign.id());
                      return null;
                    }))
        .isInstanceOf(IllegalStateException.class);
    assertThat(callInTenant(1L, () -> repo.findById(w1)).orElseThrow().activeVersionId()).isNull();
  }

  @Test
  @DisplayName("다른 테넌트의 정의·버전은 보이지 않고 앱 런타임 롤로 접속한 것이 맞다")
  void otherTenant_invisible() {
    long actor = newUser();
    long tid2 = ensureFixtureTenant("wf-repo-rls");
    long p2 = newProject(tid2, actor);
    long w2 = callInTenant(tid2, () -> repo.insert(p2, "남의 것", "y", actor, AT));
    WorkflowVersionRow v2 =
        callInTenant(
            tid2,
            () -> {
              repo.lockById(w2);
              return repo.insertVersion(w2, "y", "{}", actor);
            });

    // 풀 커넥션이 BYPASSRLS 소유자(app)면 아래 단언이 거짓 통과하므로 롤부터 확인한다.
    assertThat(callInTenant(1L, () -> baseDsl.fetchValue("SELECT current_user")))
        .isEqualTo("app_tenant");
    assertThat(callInTenant(tid2, () -> repo.findById(w2))).isPresent();
    // 자기 테넌트에서는 두 목록 요약 모두 보인다(아래 빈 목록이 거짓 통과가 아니다).
    assertThat(callInTenant(tid2, () -> repo.findByProject(p2)))
        .containsExactly(new WorkflowSummaryRow(w2, "남의 것", false, null, true));
    assertThat(callInTenant(tid2, () -> repo.findVersions(w2))).containsExactly(summaryOf(v2));
    assertThat(callInTenant(1L, () -> repo.findById(w2))).isEmpty();
    assertThat(callInTenant(1L, () -> repo.lockById(w2))).isEmpty();
    assertThat(callInTenant(1L, () -> repo.findByProject(p2))).isEmpty();
    assertThat(callInTenant(1L, () -> repo.existsByName(p2, "남의 것", null))).isFalse();
    assertThat(callInTenant(1L, () -> repo.findVersions(w2))).isEmpty();
    assertThat(callInTenant(1L, () -> repo.findVersion(w2, 1))).isEmpty();
    assertThat(callInTenant(1L, () -> repo.findVersionById(v2.id()))).isEmpty();
    assertThat(callInTenant(1L, () -> repo.existsEnabledPublished(p2))).isFalse();
    // 저장소를 거치지 않은 직접 조회도 같은 결과(RLS 가 표에서 막는다).
    assertThat(callInTenant(1L, () -> baseDsl.fetchCount(WORKFLOW, WORKFLOW.ID.eq(w2)))).isZero();
    assertThat(callInTenant(tid2, () -> baseDsl.fetchCount(WORKFLOW, WORKFLOW.ID.eq(w2))))
        .isEqualTo(1);
  }

  @Test
  @DisplayName("정의를 지우면 그 버전도 함께 지워지고, 활성 버전이 먼저 지워져도 정의는 남는다")
  void deleteWorkflow_cascadesVersions() {
    long actor = newUser();
    long pid = newProject(1L, actor);
    long w1 = insertWorkflow(pid, "a", actor);
    long w2 = insertWorkflow(pid, "b", actor);
    WorkflowVersionRow v1 = publish(w1, "y", "{}", actor);
    WorkflowVersionRow v2 = publish(w2, "y", "{}", actor);
    callInTenant(
        1L,
        () -> {
          repo.setActiveVersion(w1, v1.id());
          repo.setActiveVersion(w2, v2.id());
          return null;
        });

    callInTenant(1L, () -> baseDsl.deleteFrom(WORKFLOW).where(WORKFLOW.ID.eq(w1)).execute());
    assertThat(callInTenant(1L, () -> repo.findVersionById(v1.id()))).isEmpty();

    // 활성 버전만 지우면 정의의 active_version_id 는 NULL 이 된다(SET NULL).
    callInTenant(
        1L,
        () ->
            baseDsl
                .deleteFrom(com.workplace.jooq.Tables.WORKFLOW_VERSION)
                .where(com.workplace.jooq.Tables.WORKFLOW_VERSION.ID.eq(v2.id()))
                .execute());
    assertThat(callInTenant(1L, () -> repo.findById(w2)).orElseThrow().activeVersionId()).isNull();
  }
}
