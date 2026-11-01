package com.workplace.agentruntime.repository;

import static com.workplace.jooq.Tables.AGENT_LOCATION;
import static com.workplace.jooq.Tables.AGENT_RUNNER_TOKEN;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;

import com.workplace.agentruntime.dto.Desired;
import com.workplace.global.tenant.TenantContext;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.With;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * AI 실행 위치(agent_location) 리포지토리(WP-1248). 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로 보장된다(애플리케이션은
 * tenant_id 를 넣지 않는다 — project_favorite 와 같은 방식). 연결 상태 계산용으로 쓸 수 있는 runner 토큰의 앞자리·마지막 사용 시각을 함께
 * 읽고, 자리 사용 수는 실행 설정(agent_runtime_setting, WP-1247)에서 센다.
 */
@Repository
@RequiredArgsConstructor
public class AgentLocationRepository {

  /** 테넌트별 위치·자리 변경을 차례로 세우는 advisory 락 클래스 — {@link #lockTenantLocations()} 참고. */
  private static final int TENANT_LOCK_CLASS = 0x41474c43; // "AGLC"

  private final DSLContext dsl;

  /** 위치 한 행 + 쓸 수 있는 토큰 정보(연결 상태 계산용). 수정·재발급 직후 응답을 다시 읽지 않고 만들 수 있게 {@code withXxx} 를 둔다. */
  @With
  public record Row(
      long id,
      String name,
      String description,
      boolean isDefault,
      int capacity,
      String tokenPrefix,
      OffsetDateTime lastSeenAt) {}

  private Row map(Record r) {
    return new Row(
        r.get(AGENT_LOCATION.ID),
        r.get(AGENT_LOCATION.NAME),
        r.get(AGENT_LOCATION.DESCRIPTION),
        r.get(AGENT_LOCATION.IS_DEFAULT),
        r.get(AGENT_LOCATION.CAPACITY),
        r.get(AGENT_RUNNER_TOKEN.TOKEN_PREFIX),
        r.get(AGENT_RUNNER_TOKEN.LAST_USED_AT));
  }

  /** 위치 + 쓸 수 있는(회수 안 된) 토큰을 left join — 위치당 활성 토큰은 최대 1개(부분 유니크). */
  private org.jooq.SelectOnConditionStep<? extends Record> baseSelect() {
    return dsl.select(
            AGENT_LOCATION.ID,
            AGENT_LOCATION.NAME,
            AGENT_LOCATION.DESCRIPTION,
            AGENT_LOCATION.IS_DEFAULT,
            AGENT_LOCATION.CAPACITY,
            AGENT_RUNNER_TOKEN.TOKEN_PREFIX,
            AGENT_RUNNER_TOKEN.LAST_USED_AT)
        .from(AGENT_LOCATION)
        .leftJoin(AGENT_RUNNER_TOKEN)
        .on(
            AGENT_RUNNER_TOKEN
                .LOCATION_ID
                .eq(AGENT_LOCATION.ID)
                .and(AGENT_RUNNER_TOKEN.REVOKED_AT.isNull()));
  }

  /** 이 워크스페이스의 모든 위치 — 기본 위치가 먼저, 그다음 이름순. */
  public List<Row> findAll() {
    return baseSelect()
        .orderBy(AGENT_LOCATION.IS_DEFAULT.desc(), AGENT_LOCATION.NAME, AGENT_LOCATION.ID)
        .fetch(this::map);
  }

  /** 단건 — 다른 워크스페이스의 위치는 RLS 로 보이지 않는다. */
  public Optional<Row> findById(long id) {
    return baseSelect().where(AGENT_LOCATION.ID.eq(id)).fetchOptional(this::map);
  }

  /** 기본 위치(없으면 비어 있음). */
  public Optional<Row> findDefault() {
    return baseSelect().where(AGENT_LOCATION.IS_DEFAULT.isTrue()).fetchOptional(this::map);
  }

  /** 기본 위치 id(없으면 비어 있음). */
  public Optional<Long> findDefaultId() {
    return dsl.select(AGENT_LOCATION.ID)
        .from(AGENT_LOCATION)
        .where(AGENT_LOCATION.IS_DEFAULT.isTrue())
        .fetchOptional(AGENT_LOCATION.ID);
  }

  public boolean existsByName(String name, Long exceptId) {
    var cond = AGENT_LOCATION.NAME.eq(name);
    if (exceptId != null) cond = cond.and(AGENT_LOCATION.ID.ne(exceptId));
    return dsl.fetchExists(AGENT_LOCATION, cond);
  }

  public long count() {
    return dsl.fetchCount(AGENT_LOCATION);
  }

  /** 위치 삽입 — 새 id 를 돌려준다. */
  public long insert(
      String name, String description, int capacity, boolean isDefault, Long createdBy) {
    return dsl.insertInto(AGENT_LOCATION)
        .set(AGENT_LOCATION.NAME, name)
        .set(AGENT_LOCATION.DESCRIPTION, description)
        .set(AGENT_LOCATION.CAPACITY, capacity)
        .set(AGENT_LOCATION.IS_DEFAULT, isDefault)
        .set(AGENT_LOCATION.CREATED_BY, createdBy)
        .returning(AGENT_LOCATION.ID)
        .fetchOne()
        .getId();
  }

  public int update(long id, String name, String description, int capacity) {
    return dsl.update(AGENT_LOCATION)
        .set(AGENT_LOCATION.NAME, name)
        .set(AGENT_LOCATION.DESCRIPTION, description)
        .set(AGENT_LOCATION.CAPACITY, capacity)
        .set(AGENT_LOCATION.UPDATED_AT, OffsetDateTime.now())
        .where(AGENT_LOCATION.ID.eq(id))
        .execute();
  }

  /** 기본 표시를 모두 내린다 — 기본 이동 때 새 기본을 올리기 전에 부른다(부분 유니크 때문에 순서가 중요). */
  public void clearDefault() {
    dsl.update(AGENT_LOCATION)
        .set(AGENT_LOCATION.IS_DEFAULT, false)
        .where(AGENT_LOCATION.IS_DEFAULT.isTrue())
        .execute();
  }

  public int markDefault(long id) {
    return dsl.update(AGENT_LOCATION)
        .set(AGENT_LOCATION.IS_DEFAULT, true)
        .set(AGENT_LOCATION.UPDATED_AT, OffsetDateTime.now())
        .where(AGENT_LOCATION.ID.eq(id))
        .execute();
  }

  /** 삭제 — 토큰은 FK CASCADE 로 함께 지워진다. */
  public int delete(long id) {
    return dsl.deleteFrom(AGENT_LOCATION).where(AGENT_LOCATION.ID.eq(id)).execute();
  }

  /**
   * 이 워크스페이스의 위치·자리 변경을 한 줄로 세우는 트랜잭션 advisory 락. 자리를 늘리거나 줄이거나 실제 위치를 바꾸는 모든 쓰기(위치 생성·수정·기본
   * 이동·삭제·토큰 재발급, AI 켜기, 실행 설정 저장)가 이 락을 잡은 <b>뒤에</b> 센다 — 그래서
   *
   * <ul>
   *   <li>동시 켜기·위치 이동·기본 이동·자리 수 줄이기가 서로의 결과를 본 뒤에 세어 자리 수를 넘지 않는다.
   *   <li>위치 삭제와 그 위치로의 설정 저장이 엇갈려 FK(ON DELETE RESTRICT) 500 이 나지 않는다 — 나중에 도는 쪽이 409·404 를 받는다.
   *   <li>동시 재발급이 「위치당 활성 토큰 1개」 부분 유니크를 깨지 않고, 첫 위치·기본 위치 유일성도 지켜진다.
   * </ul>
   *
   * <p>교착을 막으려고 이 락은 늘 <b>마지막</b>에 잡는다 — AI 행·실행 설정 행 잠금이 먼저이고, 이 락을 잡은 뒤에는 그런 잠금을 새로 잡지 않는다. 그래서
   * 위치 쪽 행은 {@code FOR UPDATE} 로 따로 잠그지 않아도 된다(위치를 바꾸는 쓰기가 모두 이 락 아래에서 돈다). 관리자 동작이라 워크스페이스 단위로 줄
   * 세워도 부담이 없다. 끄기·다시 시작은 자리를 늘리지 않으므로 잡지 않는다.
   */
  public void lockTenantLocations() {
    dsl.execute(
        "SELECT pg_advisory_xact_lock(?, ?)", TENANT_LOCK_CLASS, (int) TenantContext.require());
  }

  /**
   * 그 위치에서 켜져 있는(원하는 상태 RUN) AI 수 — 위치를 직접 지정한 설정과, {@code includeUnassigned} 면(그 위치가 기본일 때) 위치를
   * 지정하지 않은 설정까지 센다(WP-1247).
   */
  public int countRunning(long locationId, boolean includeUnassigned) {
    return dsl.fetchCount(
        AGENT_RUNTIME_SETTING,
        AgentRuntimeSettingRepository.runningAt(locationId, includeUnassigned));
  }

  /**
   * 위치별 켜져 있는 AI 수를 한 번에 센다(목록용 — 위치마다 {@link #countRunning} 을 부르지 않게). 키는 지정 위치 id 이고, 위치를 지정하지 않은
   * 설정은 키 {@code null} 로 모인다 — 호출자가 기본 위치에 더한다.
   */
  public Map<Long, Integer> countRunningByLocation() {
    Map<Long, Integer> out = new HashMap<>();
    dsl.select(AGENT_RUNTIME_SETTING.LOCATION_ID, DSL.count())
        .from(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.DESIRED.eq(Desired.RUN.name()))
        .groupBy(AGENT_RUNTIME_SETTING.LOCATION_ID)
        .forEach(r -> out.put(r.value1(), r.value2()));
    return out;
  }

  /** 이 위치를 직접 지정한 실행 설정 수(켜짐·꺼짐 모두) — 위치 삭제 가드용. */
  public int countSettingsUsing(long locationId) {
    return dsl.fetchCount(AGENT_RUNTIME_SETTING, AGENT_RUNTIME_SETTING.LOCATION_ID.eq(locationId));
  }
}
