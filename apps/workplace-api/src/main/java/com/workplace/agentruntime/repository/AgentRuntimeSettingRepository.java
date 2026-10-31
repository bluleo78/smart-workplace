package com.workplace.agentruntime.repository;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.dto.ApplyMode;
import com.workplace.agentruntime.dto.Desired;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.With;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * AI 별 실행 설정(agent_runtime_setting) 리포지토리(WP-1247). 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로
 * 보장된다(애플리케이션은 tenant_id 를 넣지 않는다). 관찰 칸(observed_* 등)은 이 웨이브에서 읽기만 한다 — 쓰는 쪽은 웨이브 B.
 */
@Repository
@RequiredArgsConstructor
public class AgentRuntimeSettingRepository {

  private static final ObjectMapper MAPPER = new ObjectMapper();
  private static final TypeReference<LinkedHashMap<String, String>> CONFIG_TYPE =
      new TypeReference<>() {};

  private final DSLContext dsl;

  /**
   * 실행 설정 한 행(원하는 상태 + 관찰 상태). 원하는 상태 칸은 {@code withXxx} 로 바꾼 다음 행을 만들어 {@link #update} 에 넘긴다 —
   * 호출자가 바뀌지 않은 칸을 되풀이해 넘기지 않게.
   */
  public record Row(
      long agentUserId,
      @With String templateName,
      @With String templateVersion,
      @With Long locationId,
      @With Map<String, String> config,
      @With Desired desired,
      @With ApplyMode applyMode,
      @With long generation,
      Long observedGeneration,
      String phase,
      String observedMessage,
      Integer cpuMillicores,
      Long memoryBytes,
      OffsetDateTime startedAt,
      OffsetDateTime observedAt,
      String agentState,
      String agentIssueKey,
      OffsetDateTime agentNextCheckAt) {}

  private Row map(Record r) {
    return new Row(
        r.get(AGENT_RUNTIME_SETTING.AGENT_USER_ID),
        r.get(AGENT_RUNTIME_SETTING.TEMPLATE_NAME),
        r.get(AGENT_RUNTIME_SETTING.TEMPLATE_VERSION),
        r.get(AGENT_RUNTIME_SETTING.LOCATION_ID),
        readConfig(r.get(AGENT_RUNTIME_SETTING.CONFIG)),
        Desired.valueOf(r.get(AGENT_RUNTIME_SETTING.DESIRED)),
        ApplyMode.valueOf(r.get(AGENT_RUNTIME_SETTING.APPLY_MODE)),
        r.get(AGENT_RUNTIME_SETTING.GENERATION),
        r.get(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION),
        r.get(AGENT_RUNTIME_SETTING.PHASE),
        r.get(AGENT_RUNTIME_SETTING.OBSERVED_MESSAGE),
        r.get(AGENT_RUNTIME_SETTING.CPU_MILLICORES),
        r.get(AGENT_RUNTIME_SETTING.MEMORY_BYTES),
        r.get(AGENT_RUNTIME_SETTING.STARTED_AT),
        r.get(AGENT_RUNTIME_SETTING.OBSERVED_AT),
        r.get(AGENT_RUNTIME_SETTING.AGENT_STATE),
        r.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY),
        r.get(AGENT_RUNTIME_SETTING.AGENT_NEXT_CHECK_AT));
  }

  /** 단건 — 다른 워크스페이스의 설정은 RLS 로 보이지 않는다. */
  public Optional<Row> find(long agentUserId) {
    return dsl.selectFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .fetchOptional(this::map);
  }

  /**
   * 단건을 {@code SELECT … FOR UPDATE} 로 잠가 읽는다 — 켜기·끄기·설정 변경이 같은 AI 에 동시에 와도 generation 이 차례로 오르게 한다.
   */
  public Optional<Row> findForUpdate(long agentUserId) {
    return dsl.selectFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .forUpdate()
        .fetchOptional(this::map);
  }

  /** 새 설정 — generation 1·desired STOP·apply_mode IDLE(컬럼 기본값). */
  public void insert(
      long agentUserId,
      String templateName,
      String templateVersion,
      Long locationId,
      Map<String, String> config,
      long updatedBy) {
    dsl.insertInto(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.AGENT_USER_ID, agentUserId)
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_NAME, templateName)
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_VERSION, templateVersion)
        .set(AGENT_RUNTIME_SETTING.LOCATION_ID, locationId)
        .set(AGENT_RUNTIME_SETTING.CONFIG, writeConfig(config))
        .set(AGENT_RUNTIME_SETTING.UPDATED_BY, updatedBy)
        .execute();
  }

  /** 원하는 상태 칸을 {@code next} 로 덮어쓴다(호출자가 바뀐 경우에만 부르고 generation 을 올려 넘긴다). 관찰 칸은 건드리지 않는다. */
  public void update(Row next, Long updatedBy) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_NAME, next.templateName())
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_VERSION, next.templateVersion())
        .set(AGENT_RUNTIME_SETTING.LOCATION_ID, next.locationId())
        .set(AGENT_RUNTIME_SETTING.CONFIG, writeConfig(next.config()))
        .set(AGENT_RUNTIME_SETTING.DESIRED, next.desired().name())
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, next.applyMode().name())
        .set(AGENT_RUNTIME_SETTING.GENERATION, next.generation())
        .set(AGENT_RUNTIME_SETTING.UPDATED_BY, updatedBy)
        .set(AGENT_RUNTIME_SETTING.UPDATED_AT, OffsetDateTime.now())
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(next.agentUserId()))
        .execute();
  }

  public int delete(long agentUserId) {
    return dsl.deleteFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .execute();
  }

  private static JSONB writeConfig(Map<String, String> config) {
    try {
      return JSONB.valueOf(MAPPER.writeValueAsString(config == null ? Map.of() : config));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("실행 설정을 저장 형식으로 바꾸지 못했습니다", e);
    }
  }

  private static Map<String, String> readConfig(JSONB json) {
    if (json == null || json.data() == null || json.data().isBlank()) return new LinkedHashMap<>();
    try {
      return MAPPER.readValue(json.data(), CONFIG_TYPE);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("저장된 실행 설정을 읽지 못했습니다", e);
    }
  }
}
