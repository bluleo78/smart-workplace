package com.workplace.issue.workflow.repository;

import static com.workplace.jooq.Tables.WORKFLOW;
import static com.workplace.jooq.Tables.WORKFLOW_VERSION;
import static org.jooq.impl.DSL.exists;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.lower;
import static org.jooq.impl.DSL.max;
import static org.jooq.impl.DSL.selectOne;

import com.workplace.jooq.tables.records.WorkflowRecord;
import com.workplace.jooq.tables.records.WorkflowVersionRecord;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.JSONB;
import org.jooq.Record4;
import org.jooq.SelectJoinStep;
import org.springframework.stereotype.Repository;

/**
 * 워크플로우 정의(workflow)·게시 버전(workflow_version) 저장소(WP-1984). 테넌트 격리는 RLS 와 tenant_id GUC 기본값이 맡으므로
 * tenant_id 를 넣지 않는다. 다만 RLS 는 FK 삽입을 막지 않으므로 부모 id(프로젝트·정의)는 부르는 쪽이 권한 확인·잠금을 지난 값만 넘긴다.
 *
 * <p>트랜잭션·시각·검사는 부르는 쪽(서비스) 몫이다. 저장소는 부르는 쪽 트랜잭션 안에서 돌고, 넘겨받은 시각을 그대로 쓰며, YAML·JSON 의 내용(크기·NUL 등)은
 * 검사하지 않는다. 게시 버전은 고치지 않는 것이 규칙이라 버전을 갱신하는 메서드를 일부러 두지 않는다.
 */
@Repository
@RequiredArgsConstructor
public class WorkflowRepository {

  private final DSLContext dsl;

  /**
   * 새 정의를 만든다(꺼짐, 활성 버전 없음). 같은 프로젝트에 대소문자만 다른 이름이 있으면 DuplicateKeyException — 유일 위반은 Spring 의 jOOQ
   * 예외 변환이 그 예외로 바꾼다. 이 표에서 쓰기가 부딪칠 수 있는 유일 제약은 이름 색인뿐이다. 유일 제약을 더하면 부르는 쪽의 이름 중복 해석도 함께 본다. {@code
   * projectId} 는 부르는 쪽이 권한 확인을 지난 값만 넘긴다 — RLS 는 FK 삽입을 막지 않는다.
   */
  public long insert(long projectId, String name, String yaml, long actorId, Instant at) {
    return dsl.insertInto(WORKFLOW)
        .set(WORKFLOW.PROJECT_ID, projectId)
        .set(WORKFLOW.NAME, name)
        .set(WORKFLOW.DRAFT_YAML, yaml)
        .set(WORKFLOW.DRAFT_UPDATED_BY, actorId)
        .set(WORKFLOW.DRAFT_UPDATED_AT, utc(at))
        .returning(WORKFLOW.ID)
        .fetchSingle()
        .getId();
  }

  /** id 로 정의를 읽는다. 다른 테넌트의 것은 RLS 로 보이지 않는다. */
  public Optional<WorkflowRow> findById(long id) {
    return dsl.selectFrom(WORKFLOW).where(WORKFLOW.ID.eq(id)).fetchOptional().map(this::toRow);
  }

  /**
   * 정의를 행 잠금(FOR UPDATE)으로 읽는다. 부르는 쪽 트랜잭션 안에서 불러야 잠금이 유지되며, 게시(번호 매김)·활성 버전 지정처럼 같은 정의를 동시에 바꾸는
   * 쓰기를 직렬화하려고 쓴다.
   */
  public Optional<WorkflowRow> lockById(long id) {
    return dsl.selectFrom(WORKFLOW)
        .where(WORKFLOW.ID.eq(id))
        .forUpdate()
        .fetchOptional()
        .map(this::toRow);
  }

  /**
   * 프로젝트의 정의 목록 요약 — 이름(대소문자 무시)·id 순. 초안·활성 원문은 나르지 않고 다른지(draftChanged)만 DB 에서 계산한다: 정의 수에 상한이 없어
   * 원문을 실으면 읽기 한 번이 공유 API 힙을 넘길 수 있다.
   */
  public List<WorkflowSummaryRow> findByProject(long projectId) {
    Field<Boolean> draftChanged =
        field(
            WORKFLOW
                .ACTIVE_VERSION_ID
                .isNull()
                .or(WORKFLOW.DRAFT_YAML.isDistinctFrom(WORKFLOW_VERSION.SOURCE_YAML)));
    return dsl.select(
            WORKFLOW.ID, WORKFLOW.NAME, WORKFLOW.ENABLED, WORKFLOW_VERSION.VERSION_NO, draftChanged)
        .from(WORKFLOW)
        .leftJoin(WORKFLOW_VERSION)
        .on(WORKFLOW_VERSION.ID.eq(WORKFLOW.ACTIVE_VERSION_ID))
        .where(WORKFLOW.PROJECT_ID.eq(projectId))
        .orderBy(lower(WORKFLOW.NAME), WORKFLOW.ID)
        .fetch(
            r ->
                new WorkflowSummaryRow(r.value1(), r.value2(), r.value3(), r.value4(), r.value5()));
  }

  /**
   * 같은 프로젝트에 같은 이름(대소문자 무시)이 있는지. {@code exceptId} 의 정의는 겹침에서 뺀다(자기 이름을 다시 저장하는 경우). 비교를 DB {@code
   * lower()} 양쪽에 맡겨 유일 색인과 같은 규칙을 쓴다.
   */
  public boolean existsByName(long projectId, String name, Long exceptId) {
    Condition c = WORKFLOW.PROJECT_ID.eq(projectId).and(lower(WORKFLOW.NAME).eq(lower(name)));
    if (exceptId != null) {
      c = c.and(WORKFLOW.ID.ne(exceptId));
    }
    return dsl.fetchExists(WORKFLOW, c);
  }

  /** 초안을 덮어쓴다(게시 버전은 건드리지 않는다). 저장자와 시각은 넘겨받은 값 그대로. */
  public void updateDraft(long id, String yaml, long actorId, Instant at) {
    dsl.update(WORKFLOW)
        .set(WORKFLOW.DRAFT_YAML, yaml)
        .set(WORKFLOW.DRAFT_UPDATED_BY, actorId)
        .set(WORKFLOW.DRAFT_UPDATED_AT, utc(at))
        .where(WORKFLOW.ID.eq(id))
        .execute();
  }

  /**
   * 이름을 바꾼다. 다른 정의와 겹치면(대소문자 무시) DuplicateKeyException — {@link #insert} 와 같은 Spring 변환이며, 유일 제약을
   * 더하면 부르는 쪽의 해석도 함께 본다.
   */
  public void updateName(long id, String name) {
    dsl.update(WORKFLOW).set(WORKFLOW.NAME, name).where(WORKFLOW.ID.eq(id)).execute();
  }

  /** 켜짐 여부를 바꾼다. */
  public void updateEnabled(long id, boolean enabled) {
    dsl.update(WORKFLOW).set(WORKFLOW.ENABLED, enabled).where(WORKFLOW.ID.eq(id)).execute();
  }

  /**
   * 새 게시 버전을 쌓는다 — 번호는 그 정의의 마지막 번호 + 1(처음은 1). 번호를 읽고 넣는 사이에 다른 게시가 끼지 않도록 부르는 쪽이 먼저 {@link
   * #lockById} 로 정의 행을 잠갔다고 전제한다(어기면 유일 제약 위반으로 막힌다 — 이 번호 충돌도 이름 중복과 같은 DuplicateKeyException 이므로
   * 부르는 쪽이 이름 중복으로 읽지 않게 한다). {@code modelJson} 은 Task 1 의 {@code WorkflowModelJson.write} 글을 그대로
   * JSONB 로 넣는다. {@code workflowId} 는 부르는 쪽이 권한 확인·잠금을 지난 값만 넘긴다 — RLS 는 FK 삽입을 막지 않는다.
   */
  public WorkflowVersionRow insertVersion(
      long workflowId, String sourceYaml, String modelJson, long actorId) {
    Integer max =
        dsl.select(max(WORKFLOW_VERSION.VERSION_NO))
            .from(WORKFLOW_VERSION)
            .where(WORKFLOW_VERSION.WORKFLOW_ID.eq(workflowId))
            .fetchSingle()
            .value1();
    int next = (max == null ? 0 : max) + 1;
    return toVersionRow(
        dsl.insertInto(WORKFLOW_VERSION)
            .set(WORKFLOW_VERSION.WORKFLOW_ID, workflowId)
            .set(WORKFLOW_VERSION.VERSION_NO, next)
            .set(WORKFLOW_VERSION.SOURCE_YAML, sourceYaml)
            .set(WORKFLOW_VERSION.MODEL, JSONB.valueOf(modelJson))
            .set(WORKFLOW_VERSION.CREATED_BY, actorId)
            .returning()
            .fetchSingle());
  }

  /**
   * 활성 버전을 지정한다. 그 버전이 이 정의의 것일 때만 바꾸며(같은 UPDATE 의 조건), 바뀐 행이 없으면 — 정의가 없거나 다른 정의의 버전이면 — 서비스의 결함이라
   * IllegalStateException 을 던진다.
   */
  public void setActiveVersion(long id, long versionId) {
    int updated =
        dsl.update(WORKFLOW)
            .set(WORKFLOW.ACTIVE_VERSION_ID, versionId)
            .where(WORKFLOW.ID.eq(id))
            .and(
                exists(
                    selectOne()
                        .from(WORKFLOW_VERSION)
                        .where(WORKFLOW_VERSION.ID.eq(versionId))
                        .and(WORKFLOW_VERSION.WORKFLOW_ID.eq(id))))
            .execute();
    if (updated == 0) {
      throw new IllegalStateException(
          "workflow " + id + " 의 버전이 아니거나 정의가 없다: versionId=" + versionId);
    }
  }

  /** 정의의 게시 버전 요약들 — 새 번호가 먼저. 원문·모델은 쌓이기만 하므로 나르지 않는다(하나씩은 {@link #findVersion}). */
  public List<WorkflowVersionSummaryRow> findVersions(long workflowId) {
    return selectVersionSummary()
        .where(WORKFLOW_VERSION.WORKFLOW_ID.eq(workflowId))
        .orderBy(WORKFLOW_VERSION.VERSION_NO.desc())
        .fetch(this::toSummaryRow);
  }

  /** 정의의 버전 하나를 번호로 읽는다. */
  public Optional<WorkflowVersionRow> findVersion(long workflowId, int no) {
    return dsl.selectFrom(WORKFLOW_VERSION)
        .where(WORKFLOW_VERSION.WORKFLOW_ID.eq(workflowId))
        .and(WORKFLOW_VERSION.VERSION_NO.eq(no))
        .fetchOptional()
        .map(this::toVersionRow);
  }

  /** 버전을 id 로 읽는다. */
  public Optional<WorkflowVersionRow> findVersionById(long id) {
    return dsl.selectFrom(WORKFLOW_VERSION)
        .where(WORKFLOW_VERSION.ID.eq(id))
        .fetchOptional()
        .map(this::toVersionRow);
  }

  /**
   * 버전이 속한 정의 id 와 게시 번호만 id 로 읽는다(WP-1985) — 실행 view 는 이 둘만 쓰고 모델은 캐시에서 꺼내므로 원문·모델을 나르지 않는다. 다른
   * 테넌트의 것은 RLS 로 보이지 않는다.
   */
  public Optional<WorkflowVersionRef> findVersionRefById(long id) {
    return dsl.select(WORKFLOW_VERSION.WORKFLOW_ID, WORKFLOW_VERSION.VERSION_NO)
        .from(WORKFLOW_VERSION)
        .where(WORKFLOW_VERSION.ID.eq(id))
        .fetchOptional(r -> new WorkflowVersionRef(id, r.value1(), r.value2()));
  }

  /** 버전 요약을 id 로 읽는다 — 상세 응답은 번호·시각·게시자만 쓰므로 원문·모델(합쳐 수 MB 까지)을 나르지 않는다. */
  public Optional<WorkflowVersionSummaryRow> findVersionSummaryById(long id) {
    return selectVersionSummary()
        .where(WORKFLOW_VERSION.ID.eq(id))
        .fetchOptional(this::toSummaryRow);
  }

  /** 「켜진 프로젝트」인지 — 켜져 있고 활성 게시 버전이 있는 정의가 하나라도 있는가(둘 중 하나만으로는 아니다). */
  public boolean existsEnabledPublished(long projectId) {
    return dsl.fetchExists(
        WORKFLOW,
        WORKFLOW
            .PROJECT_ID
            .eq(projectId)
            .and(WORKFLOW.ENABLED.isTrue())
            .and(WORKFLOW.ACTIVE_VERSION_ID.isNotNull()));
  }

  /** 요약에 쓰는 칸만 고른다(원문·모델 없이). */
  private SelectJoinStep<Record4<Long, Integer, OffsetDateTime, Long>> selectVersionSummary() {
    return dsl.select(
            WORKFLOW_VERSION.ID,
            WORKFLOW_VERSION.VERSION_NO,
            WORKFLOW_VERSION.CREATED_AT,
            WORKFLOW_VERSION.CREATED_BY)
        .from(WORKFLOW_VERSION);
  }

  /** 요약 칸을 행으로 옮긴다. */
  private WorkflowVersionSummaryRow toSummaryRow(Record4<Long, Integer, OffsetDateTime, Long> r) {
    return new WorkflowVersionSummaryRow(
        r.value1(), r.value2(), r.value3().toInstant(), r.value4());
  }

  /** jOOQ 레코드를 행으로 옮긴다(시각은 Instant). */
  private WorkflowRow toRow(WorkflowRecord r) {
    return new WorkflowRow(
        r.getId(),
        r.getProjectId(),
        r.getName(),
        r.getEnabled(),
        r.getActiveVersionId(),
        r.getDraftYaml(),
        r.getDraftUpdatedBy(),
        r.getDraftUpdatedAt().toInstant(),
        r.getCreatedAt().toInstant());
  }

  /** 버전 레코드를 행으로 옮긴다(model 은 JSONB 의 글 그대로). */
  private WorkflowVersionRow toVersionRow(WorkflowVersionRecord r) {
    return new WorkflowVersionRow(
        r.getId(),
        r.getWorkflowId(),
        r.getVersionNo(),
        r.getSourceYaml(),
        r.getModel().data(),
        r.getCreatedBy(),
        r.getCreatedAt().toInstant());
  }

  /** Instant 를 DB 시각 칸에 넣을 UTC OffsetDateTime 으로. */
  private static OffsetDateTime utc(Instant at) {
    return OffsetDateTime.ofInstant(at, ZoneOffset.UTC);
  }
}
