package com.workplace.global.realtime;

import static com.workplace.jooq.Tables.STREAMING_GENERATION;

import com.workplace.global.exception.StreamingGenerationRejectedException;
import com.workplace.global.exception.StreamingGenerationRejectedException.Reason;
import com.workplace.global.realtime.StreamingGenerationRegistry.ActiveGeneration;
import com.workplace.global.realtime.StreamingGenerationRegistry.GenerationTag;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@link GenerationSlotStore} 의 DB 구현(WP-1974) — streaming_generation 표로 여러 api 파드가 같은 슬롯 상태를 본다.
 *
 * <p>모든 쓰기는 REQUIRES_NEW 트랜잭션으로 즉시 커밋한다 — 호출자 트랜잭션의 운명과 슬롯 상태를 분리해 다른 파드가 곧바로 같은 슬롯을 보게 한다. 다만 바깥
 * 트랜잭션 안에서 부르면 커넥션을 하나 더 빌려(요청 하나가 둘을 쥠) 동시 요청이 풀 크기를 넘을 때 서로를 기다리며 막힌다 — 호출자는 바깥 트랜잭션을 끝낸 뒤 레지스트리를
 * 부른다(WP-1974 리뷰 후속, WikiAiService). 어기면 경고를 남긴다({@link #write}). 만료 시각(expires_at)은 앱 시계로 계산해 적고,
 * 만료 비교는 DB 시계({@code now()})로 한다. 파드 시계가 DB 와 조금 어긋나면 임대가 그 오차만큼 당겨지거나 늘어날 뿐이며, 임대 여유(마진)가 이를
 * 흡수한다.
 */
@Component
public class JooqGenerationSlotStore implements GenerationSlotStore {

  /**
   * advisory 락 클래스 — 2인자 형식으로 다른 락과 공간을 나눈다(이슈 번호). 1인자 {@code pg_advisory_xact_lock(userId)} 는 다른
   * 곳의 1인자 락(예: UserRepository 의 키 1)과 userId 가 겹치면 서로 막는다.
   */
  private static final int LOCK_CLASS = 1974;

  private static final Logger log = LoggerFactory.getLogger(JooqGenerationSlotStore.class);

  private final DSLContext dsl;
  private final TransactionTemplate requiresNew;

  /** 중첩 대여 경고를 이미 남겼는지 — 스택을 담은 경고는 한 번만. */
  private final AtomicBoolean nestedWarned = new AtomicBoolean(false);

  public JooqGenerationSlotStore(DSLContext dsl, PlatformTransactionManager txManager) {
    this.dsl = dsl;
    this.requiresNew = new TransactionTemplate(txManager);
    this.requiresNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  /**
   * 쓰기를 자기 트랜잭션(REQUIRES_NEW)으로 즉시 커밋한다. 바깥 트랜잭션이 열려 있으면 커넥션 중첩 대여라 경고한다 — 동시 요청이 풀 크기를 넘으면 모두가 두
   * 번째 커넥션을 기다리며 막히므로, 새 호출부가 트랜잭션 안에서 부르게 되면 로그로 바로 드러나게 한다.
   */
  private void write(Runnable work) {
    if (TransactionSynchronizationManager.isActualTransactionActive()) {
      // 호출 위치(스택)는 처음 한 번만 경고로 남기고 이후는 debug — 그런 호출부가 생기면 AI 턴마다 여러 번 써서 로그가 넘친다.
      if (nestedWarned.compareAndSet(false, true)) {
        log.warn(
            "바깥 트랜잭션 안에서 생성 슬롯을 써 커넥션을 하나 더 빌립니다 — 호출부를 트랜잭션 밖으로 옮겨야 합니다",
            new IllegalStateException("호출 위치"));
      } else {
        log.debug("바깥 트랜잭션 안에서 생성 슬롯 쓰기(커넥션 중첩 대여)");
      }
    }
    requiresNew.executeWithoutResult(status -> work.run());
  }

  private static OffsetDateTime toOffset(Instant instant) {
    return instant.atOffset(ZoneOffset.UTC);
  }

  @Override
  public void reserve(
      long ownerUserId,
      GenerationTag tag,
      int perUserLimit,
      String correlationId,
      String podId,
      Instant expiresAt) {
    write(() -> doReserve(ownerUserId, tag, perUserLimit, correlationId, podId, expiresAt));
  }

  /** 소유자 단위 advisory 락 안에서 만료 정리 → 태그 BUSY/LIMIT 판정 → INSERT 를 한 번에 한다. */
  private void doReserve(
      long ownerUserId,
      GenerationTag tag,
      int perUserLimit,
      String correlationId,
      String podId,
      Instant expiresAt) {
    // 같은 소유자의 동시 예약을 직렬화 — 서로 못 본 채 함께 상한을 넘지 않게. 락은 트랜잭션 종료 때 풀린다.
    dsl.execute("SELECT pg_advisory_xact_lock(?, ?)", LOCK_CLASS, (int) ownerUserId);
    var now = DSL.currentOffsetDateTime();
    // 소유자의 만료 행과, 같은 id 의 만료 행(소유자 무관)을 한 번에 지운다 — 죽은 파드가 남긴 슬롯이 판정을 막지 않게.
    dsl.deleteFrom(STREAMING_GENERATION)
        .where(STREAMING_GENERATION.EXPIRES_AT.le(now))
        .and(
            STREAMING_GENERATION
                .OWNER_USER_ID
                .eq(ownerUserId)
                .or(STREAMING_GENERATION.CORRELATION_ID.eq(correlationId)))
        .execute();
    List<String> keys =
        dsl.select(STREAMING_GENERATION.GEN_KEY)
            .from(STREAMING_GENERATION)
            .where(STREAMING_GENERATION.OWNER_USER_ID.eq(ownerUserId))
            .and(STREAMING_GENERATION.SCOPE.eq(tag.scope()))
            .and(STREAMING_GENERATION.EXPIRES_AT.gt(now))
            .fetch(STREAMING_GENERATION.GEN_KEY);
    if (keys.contains(tag.key())) {
      throw new StreamingGenerationRejectedException(Reason.BUSY);
    }
    if (keys.size() >= perUserLimit) {
      throw new StreamingGenerationRejectedException(Reason.LIMIT);
    }
    insertOrBusy(ownerUserId, tag, correlationId, podId, expiresAt);
  }

  @Override
  public void registerUntagged(
      long ownerUserId, String correlationId, String podId, Instant expiresAt) {
    // 상한·태그 판정이 없어 advisory 락도 필요 없다 — 같은 id 충돌만 INSERT 가 가른다.
    write(() -> insertOrBusy(ownerUserId, null, correlationId, podId, expiresAt));
  }

  /**
   * INSERT ... ON CONFLICT (correlation_id) DO NOTHING — 살아 있는 같은 id(소유자 무관)가 있거나 동시에 다른 트랜잭션이 먼저
   * 넣었으면 0행이라 BUSY 로 거절한다(덮으면 기존 생성의 취소·종결 추적을 잃는다). tag 가 null 이면 scope·gen_key 를 비운다.
   */
  private void insertOrBusy(
      long ownerUserId, GenerationTag tag, String correlationId, String podId, Instant expiresAt) {
    int inserted =
        dsl.insertInto(STREAMING_GENERATION)
            .set(STREAMING_GENERATION.CORRELATION_ID, correlationId)
            .set(STREAMING_GENERATION.OWNER_USER_ID, ownerUserId)
            .set(STREAMING_GENERATION.SCOPE, tag == null ? null : tag.scope())
            .set(STREAMING_GENERATION.GEN_KEY, tag == null ? null : tag.key())
            .set(STREAMING_GENERATION.POD_ID, podId)
            .set(STREAMING_GENERATION.EXPIRES_AT, toOffset(expiresAt))
            .onConflict(STREAMING_GENERATION.CORRELATION_ID)
            .doNothing()
            .execute();
    if (inserted == 0) {
      throw new StreamingGenerationRejectedException(Reason.BUSY);
    }
  }

  @Override
  public void extend(String correlationId, Instant expiresAt) {
    write(
        () ->
            dsl.update(STREAMING_GENERATION)
                .set(STREAMING_GENERATION.EXPIRES_AT, toOffset(expiresAt))
                .where(STREAMING_GENERATION.CORRELATION_ID.eq(correlationId))
                .execute());
  }

  @Override
  public void remove(String correlationId) {
    write(
        () ->
            dsl.deleteFrom(STREAMING_GENERATION)
                .where(STREAMING_GENERATION.CORRELATION_ID.eq(correlationId))
                .execute());
  }

  @Override
  public Optional<GenerationSlot> find(String correlationId) {
    return dsl.select(STREAMING_GENERATION.OWNER_USER_ID, STREAMING_GENERATION.POD_ID)
        .from(STREAMING_GENERATION)
        .where(STREAMING_GENERATION.CORRELATION_ID.eq(correlationId))
        .and(STREAMING_GENERATION.EXPIRES_AT.gt(DSL.currentOffsetDateTime()))
        .fetchOptional(r -> new GenerationSlot(r.value1(), r.value2()));
  }

  @Override
  public List<ActiveGeneration> active(long ownerUserId, String scope) {
    return dsl.select(
            STREAMING_GENERATION.CORRELATION_ID,
            STREAMING_GENERATION.GEN_KEY,
            STREAMING_GENERATION.STARTED_AT)
        .from(STREAMING_GENERATION)
        .where(STREAMING_GENERATION.OWNER_USER_ID.eq(ownerUserId))
        .and(STREAMING_GENERATION.SCOPE.eq(scope))
        .and(STREAMING_GENERATION.EXPIRES_AT.gt(DSL.currentOffsetDateTime()))
        .orderBy(STREAMING_GENERATION.STARTED_AT.asc())
        .fetch(r -> new ActiveGeneration(r.value1(), r.value2(), r.value3().toInstant()));
  }

  @Override
  public void removeByPod(String podId, Collection<String> keepIds) {
    write(
        () ->
            dsl.deleteFrom(STREAMING_GENERATION)
                .where(STREAMING_GENERATION.POD_ID.eq(podId))
                // 아직 도는 생성의 행은 남긴다 — 자신의 반납이나 임대 만료로 사라진다.
                .and(
                    keepIds.isEmpty()
                        ? DSL.noCondition()
                        : STREAMING_GENERATION.CORRELATION_ID.notIn(keepIds))
                .execute());
  }
}
