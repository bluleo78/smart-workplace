package com.workplace.issue.profile;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORK_PROFILE;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.tenant.WorkspaceActive;
import com.workplace.issue.dto.MeOverviewPeriod;
import com.workplace.issue.metrics.MetricsPeriod;
import com.workplace.issue.profile.WorkProfileCalc.Count;
import com.workplace.jooq.tables.records.WorkProfileRecord;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.jooq.SelectConditionStep;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 업무 프로파일(work_profile) jOOQ 리포지토리(WP-1485). 사람×기간 한 행을 덮어쓰며, tasks/areas/skills 는 JSONB 로 저장한다.
 *
 * <p>모든 쓰기는 {@code updated_at = now()} 를 함께 갱신한다. 테넌트 격리는 RLS 가 맡는다(행 키는 테넌트×사람×기간).
 *
 * <p><b>점유 토큰:</b> 워커가 쓰는 결과 저장({@link #saveReady}·{@link #markUnchanged}·{@link #markFailed})은 자기가
 * 점유한 {@code pending_since} 값을 토큰으로 받아 「아직 PENDING 이고 점유 시각이 그 토큰과 같을 때」만 쓴다. 10분이 지나 다른 요청이 다시
 * 점유했으면 늦게 끝난 옛 워커의 결과(특히 늦은 FAILED)가 새 점유를 덮지 못한다. 토큰은 DB 정밀도(마이크로초)로 잘라 넘겨야 같게 비교된다.
 */
@Repository
@RequiredArgsConstructor
public class WorkProfileRepository {

  private static final TypeReference<List<Count>> COUNTS = new TypeReference<>() {};
  private static final TypeReference<List<String>> STRINGS = new TypeReference<>() {};

  private final DSLContext dsl;
  private final ObjectMapper objectMapper;

  /** 분석 완료 내용 — saveReady 가 한 번에 덮어쓰는 값. */
  public record WorkProfileReady(
      MetricsPeriod range,
      String fingerprint,
      int totalCount,
      int analyzedCount,
      String summary,
      List<Count> tasks,
      List<Count> areas,
      List<String> skills,
      OffsetDateTime analyzedAt) {}

  /** 사람×기간 키 — 현재 테넌트 안에서 행을 식별한다. */
  public record Key(long userId, MeOverviewPeriod period) {}

  /** 사람×기간 한 행 조회. */
  public Optional<WorkProfileRow> find(long userId, MeOverviewPeriod period) {
    return selectRow(userId, period).fetchOptional().map(this::toRow);
  }

  /** 행을 잠그고 조회(FOR UPDATE) — 같은 행을 동시에 갱신하는 흐름을 직렬화할 때 쓴다. */
  public Optional<WorkProfileRow> findForUpdate(long userId, MeOverviewPeriod period) {
    return selectRow(userId, period).forUpdate().fetchOptional().map(this::toRow);
  }

  /** 사람×기간 한 행을 고르는 select — find·findForUpdate 가 같은 조건을 공유한다. */
  private SelectConditionStep<WorkProfileRecord> selectRow(long userId, MeOverviewPeriod period) {
    return dsl.selectFrom(WORK_PROFILE)
        .where(WORK_PROFILE.USER_ID.eq(userId), WORK_PROFILE.PERIOD_TYPE.eq(period.name()));
  }

  /**
   * 분석 점유를 시도한다. 행이 없으면 PENDING 으로 만들고, 있으면 PENDING 이 아니거나 점유가 staleBefore 보다 오래됐을 때만 PENDING 으로
   * 바꾼다. 이미 누가 분석 중이면(신선한 PENDING) 아무것도 바꾸지 않아 false — 중복 분석을 막는다.
   *
   * @return 행이 들어가거나 바뀌었으면 true
   */
  public boolean claimPending(
      long userId, MeOverviewPeriod period, OffsetDateTime now, OffsetDateTime staleBefore) {
    int n =
        dsl.insertInto(WORK_PROFILE)
            .set(WORK_PROFILE.USER_ID, userId)
            .set(WORK_PROFILE.PERIOD_TYPE, period.name())
            .set(WORK_PROFILE.STATUS, WorkProfileStatus.PENDING.name())
            .set(WORK_PROFILE.PENDING_SINCE, now)
            .onConflict(WORK_PROFILE.TENANT_ID, WORK_PROFILE.USER_ID, WORK_PROFILE.PERIOD_TYPE)
            .doUpdate()
            .set(WORK_PROFILE.STATUS, WorkProfileStatus.PENDING.name())
            .set(WORK_PROFILE.PENDING_SINCE, now)
            .set(WORK_PROFILE.UPDATED_AT, DSL.currentOffsetDateTime())
            .where(
                WORK_PROFILE
                    .STATUS
                    .ne(WorkProfileStatus.PENDING.name())
                    .or(WORK_PROFILE.PENDING_SINCE.lt(staleBefore)))
            .execute();
    return n > 0;
  }

  /** 「다시 분석」 하루 호출 계수 — 같은 서울 날짜면 +1, 날짜가 바뀌었으면 1 로 다시 센다. 행이 있어야 한다(claimPending 뒤). */
  public void countManualRun(long userId, MeOverviewPeriod period, LocalDate today) {
    dsl.update(WORK_PROFILE)
        .set(
            WORK_PROFILE.MANUAL_COUNT,
            DSL.when(WORK_PROFILE.MANUAL_DATE.eq(today), WORK_PROFILE.MANUAL_COUNT.plus(1))
                .otherwise(DSL.inline(1)))
        .set(WORK_PROFILE.MANUAL_DATE, today)
        .set(WORK_PROFILE.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(WORK_PROFILE.USER_ID.eq(userId), WORK_PROFILE.PERIOD_TYPE.eq(period.name()))
        .execute();
  }

  /**
   * 분석 결과 저장 — READY 로 두고 오류·점유 표시를 지우며 내용을 전부 덮어쓴다. 점유 토큰이 맞을 때만.
   *
   * @return 썼으면 true, 점유를 잃었으면(다른 요청이 다시 점유) false
   */
  public boolean saveReady(
      long userId, MeOverviewPeriod period, OffsetDateTime token, WorkProfileReady r) {
    return dsl.update(WORK_PROFILE)
            .set(WORK_PROFILE.STATUS, WorkProfileStatus.READY.name())
            .set(WORK_PROFILE.ERROR, (String) null)
            .set(WORK_PROFILE.PENDING_SINCE, (OffsetDateTime) null)
            .set(WORK_PROFILE.PERIOD_FROM, r.range().from())
            .set(WORK_PROFILE.PERIOD_TO, r.range().to())
            .set(WORK_PROFILE.ANALYZED_AT, r.analyzedAt())
            .set(WORK_PROFILE.FINGERPRINT, r.fingerprint())
            .set(WORK_PROFILE.TOTAL_COUNT, r.totalCount())
            .set(WORK_PROFILE.ANALYZED_COUNT, r.analyzedCount())
            .set(WORK_PROFILE.SUMMARY, r.summary())
            .set(WORK_PROFILE.TASKS, json(r.tasks()))
            .set(WORK_PROFILE.AREAS, json(r.areas()))
            .set(WORK_PROFILE.SKILLS, json(r.skills()))
            .set(WORK_PROFILE.UPDATED_AT, DSL.currentOffsetDateTime())
            .where(owned(userId, period, token))
            .execute()
        > 0;
  }

  /**
   * 입력이 그대로라 다시 분석하지 않을 때 — READY 로 되돌리고 기간·전체 건수만 갱신한다(분석 시각·내용은 유지). 상한 100건 밖의 변화로 전체 건수만 달라질 수
   * 있어 「n건 중 최근 100건」이 맞게 남도록 total 도 새로 쓴다. 점유 토큰이 맞을 때만.
   *
   * @return 썼으면 true, 점유를 잃었으면 false
   */
  public boolean markUnchanged(
      long userId,
      MeOverviewPeriod period,
      OffsetDateTime token,
      MetricsPeriod range,
      int totalCount) {
    return dsl.update(WORK_PROFILE)
            .set(WORK_PROFILE.STATUS, WorkProfileStatus.READY.name())
            .set(WORK_PROFILE.ERROR, (String) null)
            .set(WORK_PROFILE.PENDING_SINCE, (OffsetDateTime) null)
            .set(WORK_PROFILE.PERIOD_FROM, range.from())
            .set(WORK_PROFILE.PERIOD_TO, range.to())
            .set(WORK_PROFILE.TOTAL_COUNT, totalCount)
            .set(WORK_PROFILE.UPDATED_AT, DSL.currentOffsetDateTime())
            .where(owned(userId, period, token))
            .execute()
        > 0;
  }

  /**
   * 분석 실패 기록 — 이전 내용은 남기고 FAILED·오류 문구와 점유한 기간을 적고 점유를 푼다. 점유 토큰이 맞을 때만.
   *
   * <p>기간(period_from/to)을 함께 쓰는 이유: 쓰지 않으면 주·달이 바뀐 뒤의 분석이 실패했을 때 행이 지난 기간을 그대로 담아, 카드 조회({@code
   * isRolledOver})가 매번 다시 점유해 하루 상한 밖에서 AI 를 끝없이 다시 부른다.
   *
   * @param range 이 점유가 분석하려던 기간
   * @return 썼으면 true, 점유를 잃었으면 false
   */
  public boolean markFailed(
      long userId,
      MeOverviewPeriod period,
      OffsetDateTime token,
      MetricsPeriod range,
      String error) {
    return dsl.update(WORK_PROFILE)
            .set(WORK_PROFILE.STATUS, WorkProfileStatus.FAILED.name())
            .set(WORK_PROFILE.ERROR, error)
            .set(WORK_PROFILE.PERIOD_FROM, range.from())
            .set(WORK_PROFILE.PERIOD_TO, range.to())
            .set(WORK_PROFILE.PENDING_SINCE, (OffsetDateTime) null)
            .set(WORK_PROFILE.UPDATED_AT, DSL.currentOffsetDateTime())
            .where(owned(userId, period, token))
            .execute()
        > 0;
  }

  /** 사람×기간 행이 아직 이 점유(토큰)의 PENDING 인가 — 워커 결과 저장의 공통 조건. */
  private static Condition owned(long userId, MeOverviewPeriod period, OffsetDateTime token) {
    return WORK_PROFILE
        .USER_ID
        .eq(userId)
        .and(WORK_PROFILE.PERIOD_TYPE.eq(period.name()))
        .and(WORK_PROFILE.STATUS.eq(WorkProfileStatus.PENDING.name()))
        .and(WORK_PROFILE.PENDING_SINCE.eq(token));
  }

  /**
   * 현재 테넌트(RLS)의 행 키 중 이 워크스페이스에서 활성인 사람(계정 활성 + 멤버십 ACTIVE)의 것만 — 주기 재분석 대상을 모을 때 쓴다. 행은 사용자 삭제에만
   * CASCADE 되므로, 워크스페이스를 떠났거나 정지된 사람의 행까지 매일 AI 로 갱신하지 않게 거른다.
   */
  public List<Key> findAllKeys() {
    return dsl.select(WORK_PROFILE.USER_ID, WORK_PROFILE.PERIOD_TYPE)
        .from(WORK_PROFILE)
        .join(USER)
        .on(USER.ID.eq(WORK_PROFILE.USER_ID))
        .join(MEMBERSHIP)
        .on(WorkspaceActive.join(WORK_PROFILE.USER_ID, WORK_PROFILE.TENANT_ID))
        .where(WorkspaceActive.condition())
        .fetch(r -> new Key(r.value1(), MeOverviewPeriod.valueOf(r.value2())));
  }

  /** jOOQ 레코드 → 행 매핑. JSONB 는 문자열을 읽어 목록으로 푼다. */
  private WorkProfileRow toRow(WorkProfileRecord r) {
    return new WorkProfileRow(
        r.getUserId(),
        MeOverviewPeriod.valueOf(r.getPeriodType()),
        WorkProfileStatus.valueOf(r.getStatus()),
        r.getPeriodFrom(),
        r.getPeriodTo(),
        r.getAnalyzedAt(),
        r.getFingerprint(),
        r.getTotalCount(),
        r.getAnalyzedCount(),
        r.getSummary(),
        read(r.getTasks(), COUNTS),
        read(r.getAreas(), COUNTS),
        read(r.getSkills(), STRINGS),
        r.getError(),
        r.getPendingSince(),
        r.getManualDate(),
        r.getManualCount());
  }

  private JSONB json(Object value) {
    try {
      return JSONB.valueOf(objectMapper.writeValueAsString(value));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("업무 프로파일 JSON 직렬화 실패", e);
    }
  }

  private <T> T read(JSONB jsonb, TypeReference<T> type) {
    try {
      return objectMapper.readValue(jsonb.data(), type);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("업무 프로파일 JSON 파싱 실패", e);
    }
  }
}
