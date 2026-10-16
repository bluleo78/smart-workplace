package com.workplace.filepreview.service;

import com.workplace.filepreview.outbound.ConvertOutcome;
import com.workplace.filepreview.outbound.ConverterClient;
import com.workplace.filepreview.outbound.ConverterProperties;
import com.workplace.filepreview.repository.PreviewStateStore;
import com.workplace.filepreview.repository.PreviewStateStore.Row;
import com.workplace.filepreview.service.PreviewTarget.SourceFile;
import com.workplace.global.tenant.TenantContext;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Supplier;
import lombok.extern.slf4j.Slf4j;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 미리보기 변환 상태기계(WP-431 에서 뽑아냄, WP-432) — 판정·CAS 선점·대화형 실행기 제출·변환·결과 기록을 대상({@link PreviewTarget})과
 * 무관하게 한 곳에서 한다. 드라이브와 메일 첨부가 같은 규칙(재선점·쿨다운·리스·고아 결과 정리)을 따르게 하려는 것이다.
 *
 * <p>드라이브·메일이 공유하는 빈 하나로 둔다({@link FilePreviewExecutorConfig#previewEngine}) — 테스트는 직접 만들어 쓸 수 있다.
 * 클래스·메서드에 {@code @Transactional} 을 두지 않는다: 변환 호출은 최대 75초라 그동안 DB 연결을 잡으면 안 되므로, 읽기·선점·기록만 {@link
 * TransactionTemplate} 의 짧은 트랜잭션으로 묶는다. 선점은 커밋한 뒤에 실행기에 넘긴다 — 작업이 먼저 시작해 커밋 전 행을 보지 못하는 일이 없게.
 *
 * <p>실행기 스레드에서는 {@link TenantContext#runAs} 를 먼저 세운 뒤 트랜잭션을 연다. TenantAwareTransactionManager 가
 * 트랜잭션 시작 시점의 컨텍스트로 RLS GUC 를 심기 때문에, 순서가 바뀌면 세션 기본 GUC 로 기록돼 RLS 에 막힌다(WP-417).
 */
@Slf4j
public final class PreviewEngine {

  private static final String TOO_LARGE = "TOO_LARGE";

  private final ConverterClient converter;
  private final ConverterProperties props;
  private final TransactionTemplate tx;
  private final Executor interactiveExecutor;

  public PreviewEngine(
      ConverterClient converter,
      ConverterProperties props,
      PlatformTransactionManager txManager,
      Executor interactiveExecutor) {
    this.converter = converter;
    this.props = props;
    this.tx = new TransactionTemplate(txManager);
    this.interactiveExecutor = interactiveExecutor;
  }

  /**
   * 판정 트랜잭션 안에서 서비스가 만든 대상과 그 상태 행.
   *
   * @param row 같은 트랜잭션에서 읽은 상태 행(드라이브는 file 행과 한 번의 조인으로 읽는다) — 행이 없으면 empty
   */
  public record Prepared<K>(PreviewTarget<K> target, Optional<Row> row) {}

  /** 백그라운드 선점 결과 — 선점한 대상과 리스 토큰. */
  public record Claimed<K>(PreviewTarget<K> target, OffsetDateTime leaseToken) {}

  /** 판정 결과 — 바로 응답할 값이거나, 이 요청이 선점한 리스 토큰(선점 시 outcome 은 null). */
  private record Decision(PreviewOutcome outcome, OffsetDateTime leaseToken) {
    static Decision of(PreviewOutcome outcome) {
      return new Decision(outcome, null);
    }
  }

  /** 판정 트랜잭션의 결과 — 대상 아님이면 target 이 null. */
  private record Opened<K>(PreviewTarget<K> target, Decision decision) {}

  /**
   * 미리보기를 연다 — 대상을 이미 만든 경우(메일). 상태 행은 판정 트랜잭션 안에서 읽는다. 대상 아님(꺼짐·형식)은 호출자가 먼저 걸렀다.
   *
   * @param start 시도의 첫 요청(뷰어 열기·[다시 시도])이면 true — 이때만 FAILED 행을 다시 선점한다. 폴링은 false.
   */
  public <K> PreviewOutcome open(PreviewTarget<K> t, boolean start) {
    return open(() -> new Prepared<>(t, t.store().find(t.key())), start);
  }

  /**
   * 미리보기를 연다. 필요하면 변환을 선점해 대화형 실행기에 넘기고 {@code Converting} 을 돌려준다. 요청 스레드의 활성 테넌트로 동작한다.
   *
   * <p>{@code prepare} 는 판정과 같은 트랜잭션에서 불린다 — 드라이브가 file 행과 상태 행을 한 번에 읽고 그 행으로 판정하게(왕복·트랜잭션 1회).
   *
   * @param prepare 대상과 상태 행을 만든다. 대상이 아니면(형식 밖) null — 그러면 NotApplicable. 꺼짐·형식 판정은 서비스 몫이다.
   * @param start 시도의 첫 요청(뷰어 열기·[다시 시도])이면 true — 이때만 FAILED 행을 다시 선점한다. 폴링은 false.
   */
  public <K> PreviewOutcome open(Supplier<Prepared<K>> prepare, boolean start) {
    Opened<K> opened =
        tx.execute(
            s -> {
              Prepared<K> p = prepare.get();
              if (p == null) {
                return new Opened<K>(null, Decision.of(new PreviewOutcome.NotApplicable()));
              }
              return new Opened<>(p.target(), decide(p.target(), p.row(), start, true));
            });
    Decision decision = opened.decision();
    if (decision.leaseToken() == null) {
      return decision.outcome();
    }
    PreviewTarget<K> t = opened.target();
    OffsetDateTime token = decision.leaseToken();
    try {
      interactiveExecutor.execute(() -> convertClaimed(t, token));
      return new PreviewOutcome.Converting();
    } catch (RejectedExecutionException e) {
      // 대화형 큐까지 가득 — 시작도 못 한 시도라 선점(과 시도 횟수)을 돌려주고 일시 실패로 응답한다.
      log.warn("미리보기 대화형 실행기 거절 — 선점 반납: {}", t.logKey());
      tx.executeWithoutResult(s -> t.store().release(t.key(), token));
      return new PreviewOutcome.Failed("BUSY", true);
    }
  }

  /**
   * 백그라운드(미리 변환)용 선점 — 폴링처럼(start=false) FAILED 를 다시 잡지 않고, 크기 초과도 기록하지 않는다(열람이 기록한다). 호출자가 테넌트
   * 컨텍스트를 세운 뒤 부른다.
   *
   * @param prepare {@link #open(Supplier, boolean)} 와 같다 — 같은 트랜잭션에서 대상·상태 행을 만들고, 대상 아님이면 null
   * @return 선점했으면 대상과 리스 토큰, 아니면 empty
   */
  public <K> Optional<Claimed<K>> claimQuietly(Supplier<Prepared<K>> prepare) {
    return tx.execute(
        s -> {
          Prepared<K> p = prepare.get();
          if (p == null) {
            return Optional.<Claimed<K>>empty();
          }
          Decision decision = decide(p.target(), p.row(), false, false);
          return Optional.ofNullable(decision.leaseToken())
              .map(token -> new Claimed<>(p.target(), token));
        });
  }

  /**
   * 열람 판정(트랜잭션 안) — 행 상태 → 크기 상한 → 선점. 꺼짐·형식·원본 유무는 서비스가 대상을 만들 때 이미 걸렀다.
   *
   * <p>크기 상한은 행 상태 뒤에 본다 — 다른 작업이 유효한 리스로 변환 중이거나 READY 인 행을 {@code markTooLarge} 가 덮지 않게 하기 위해서다.
   *
   * @param recordTooLarge false 면 크기 초과를 기록하지 않고 응답만(백그라운드 — 열람이 기록한다)
   */
  private <K> Decision decide(
      PreviewTarget<K> t, Optional<Row> row, boolean start, boolean recordTooLarge) {
    PreviewStateStore<K> store = t.store();
    if (row.isPresent()) {
      PreviewOutcome settled = settled(t, row.get(), start);
      if (settled != null) {
        return Decision.of(settled);
      }
    }
    switch (t.sizeCheck(props.maxBytes())) {
      case OVER -> {
        // 원본 크기는 바뀌지 않으므로 변환 서비스를 부르지 않고 영구 실패로 굳힌다.
        if (recordTooLarge) {
          store.markTooLarge(t.key(), t.tenantId(), props.preview().engineVersion());
        }
        return Decision.of(new PreviewOutcome.Failed(TOO_LARGE, false));
      }
      case OVER_ESTIMATED -> {
        // 추정 크기 초과 — 응답만 한다. 같은 키를 공유하는 다른 원본의 행을 추정으로 덮지 않는다(실제 초과는 작업이 기록).
        return Decision.of(new PreviewOutcome.Failed(TOO_LARGE, false));
      }
      case WITHIN -> {
        // 선점으로 간다.
      }
    }
    Optional<OffsetDateTime> token =
        store.claim(
            t.key(),
            t.tenantId(),
            props.preview().engineVersion(),
            props.preview().lease(),
            props.preview().maxAttempts(),
            props.preview().transientCooldown(),
            start);
    if (token.isPresent()) {
      return new Decision(null, token.get());
    }
    // 경합으로 선점을 놓침 — 이긴 쪽이 남긴 상태를 한 번만 다시 읽어 판정한다(대개 변환 중). 루프하지 않는다.
    // 재판정은 폴링처럼(start=false) 한다 — FAILED 를 여기서 다시 "선점 가능"으로 보면(앱·DB 시계 차 등으로 settled 와 claim 이
    // 어긋날 때) 아무도 변환하지 않는데 변환 중으로 답하게 되므로, 선점을 놓친 FAILED 는 실패 그대로 돌려준다.
    PreviewOutcome again = store.find(t.key()).map(r -> settled(t, r, false)).orElse(null);
    return Decision.of(again != null ? again : new PreviewOutcome.Converting());
  }

  /**
   * 행 상태만으로 응답이 정해지면 그 응답을, 선점을 시도해야 하면 null 을 돌려준다(트랜잭션 안).
   *
   * <p>FAILED 재선점 여부는 {@link PreviewStateStore#claim} 의 SQL 조건과 같아야 한다 — 어긋나면 여기서 선점 가능으로 보고 claim
   * 은 거절해(또는 반대) 상한을 넘겨 변환하거나 엔진 변경 재시도를 막는다.
   */
  private <K> PreviewOutcome settled(PreviewTarget<K> t, Row row, boolean start) {
    int maxAttempts = props.preview().maxAttempts();
    boolean engineChanged = !props.preview().engineVersion().equals(row.engineVersion());
    switch (row.status()) {
      case "READY" -> {
        if (engineChanged) {
          // 이전 엔진의 결과 — start 와 무관하게 새 엔진으로 다시 변환한다(claim 도 이 READY 를 선점한다).
          return null;
        }
        Optional<PreviewOutcome.Ready> result = t.loadResult();
        if (result.isPresent()) {
          return result.get();
        }
        // READY 인데 결과가 사라짐(볼륨 이전·수동 정리) — 500 대신 다시 변환하도록 되돌린다.
        log.warn("미리보기 결과 유실 — 다시 변환: {}", t.logKey());
        t.store().resetReady(t.key());
        return null;
      }
      case "CONVERTING" -> {
        boolean leaseValid =
            row.leasedUntil() != null && row.leasedUntil().isAfter(OffsetDateTime.now());
        // 리스가 만료됐으면(변환 중 API 가 죽음) 다시 선점한다.
        return leaseValid ? new PreviewOutcome.Converting() : null;
      }
      case "FAILED" -> {
        boolean transientFailure = row.failureTransient();
        boolean underCap = transientFailure && row.attempts() < maxAttempts;
        // 상한에 닿은 일시 실패도 마지막 실패에서 쿨다운이 지나면 다시 시도한다 — 변환 서비스 장애가 지나간 뒤 영원히 굳지 않게.
        boolean cooledDown =
            transientFailure
                && row.updatedAt() != null
                && row.updatedAt()
                    .isBefore(OffsetDateTime.now().minus(props.preview().transientCooldown()));
        // 폴링(start=false)은 절대 다시 선점하지 않는다 — 몇 초 장애가 폴링 몇 번에 시도 상한을 소진하지 않게.
        if (start && (engineChanged || underCap || cooledDown)) {
          return null;
        }
        // 일시 실패는 상한에 닿아도 transient 그대로 — 웹이 [다시 시도]를 계속 보이고, 쿨다운 뒤 그 버튼이 다시 변환한다.
        return new PreviewOutcome.Failed(row.failureCode(), transientFailure);
      }
      default -> {
        // PENDING(실행기 거절·결과 유실 복구) — 선점한다.
        return null;
      }
    }
  }

  /**
   * 선점한 변환 작업 본문(실행기 스레드) — 리스 갱신 → 원본 열기·변환 호출(트랜잭션 밖) → 원본 정리 → 쓰기 직전 리스 재확인 → 결과 저장 → 완료 기록. 예상
   * 밖 예외(원본을 여는 provider 실패 포함)도 일시 실패로 기록해 CONVERTING 으로 남기지 않는다(리스 만료까지 202 가 이어지지 않게).
   *
   * <p>시작할 때 선점 토큰으로 리스를 새로 잡는다(CAS) — 큐에서 기다린 시간만큼 리스가 줄어 변환 도중 만료되지 않게 하고, 그 사이 리스가 만료돼 다른 쪽이 다시
   * 선점했으면 CAS 가 실패해 헛변환하지 않는다. 이후 모든 기록은 새 토큰으로 한다.
   *
   * @param claimToken 선점({@link PreviewStateStore#claim}) 때 받은 리스 토큰
   */
  public <K> void convertClaimed(PreviewTarget<K> t, OffsetDateTime claimToken) {
    TenantContext.runAs(
        t.tenantId(),
        () -> {
          Optional<OffsetDateTime> refreshed;
          try {
            refreshed =
                tx.execute(
                    s -> t.store().refreshLease(t.key(), claimToken, props.preview().lease()));
          } catch (RuntimeException e) {
            log.error("미리보기 리스 갱신 실패: {}", t.logKey(), e);
            recordFailure(t, claimToken, "UNAVAILABLE", true);
            return;
          }
          if (refreshed == null || refreshed.isEmpty()) {
            log.debug("미리보기 리스를 잃어 변환 건너뜀: {}", t.logKey());
            return;
          }
          OffsetDateTime token = refreshed.get();
          try {
            convertHoldingLease(t, token);
          } catch (RuntimeException e) {
            log.error("미리보기 변환 작업 실패: {}", t.logKey(), e);
            recordFailure(t, token, "UNAVAILABLE", true);
          }
        });
  }

  private <K> void convertHoldingLease(PreviewTarget<K> t, OffsetDateTime leaseToken) {
    String mime = t.targetMime();
    if (mime == null) {
      // 선점 뒤 다시 읽은 메타가 대상 형식이 아님(mime 이 바뀐 드문 경우) — 같은 원본은 다시 해도 같으므로 영구 실패.
      recordFailure(t, leaseToken, "UNSUPPORTED", false);
      return;
    }
    SourceFile opened;
    try {
      opened = t.openSource();
    } catch (RuntimeException e) {
      // 원본을 열지 못함 — 대상이 영구(원본 소실·실제 크기 초과)/일시(provider 장애)를 가른다.
      PreviewOutcome.Failed failed = t.sourceFailure(e);
      if (failed == null) {
        // 요청자 한정 실패 — 공유 행은 건드리지 않고 선점만 돌려준다(다른 요청자가 다시 선점해 변환할 수 있게).
        log.info("미리보기 원본 열기 실패(요청자 한정) — 선점 반납: {} error={}", t.logKey(), e.toString());
        try {
          tx.executeWithoutResult(s -> t.store().release(t.key(), leaseToken));
        } catch (RuntimeException re) {
          log.warn("미리보기 선점 반납 실패: {} error={}", t.logKey(), re.toString());
        }
        return;
      }
      log.warn("미리보기 원본 열기 실패: {} code={} error={}", t.logKey(), failed.code(), e.toString());
      recordFailure(t, leaseToken, failed.code(), failed.transientFailure());
      return;
    }
    ConvertOutcome outcome;
    // 블록 안에서는 변환 호출만 한다 — 원본(메일은 평문 임시 파일) 정리가 결과 저장·상태 기록보다 먼저 끝나야
    // 평문이 디스크에 있는 시간이 짧고, 상태를 보고 판정하는 쪽도 정리가 끝났음을 확실히 볼 수 있다.
    try (SourceFile source = opened) {
      outcome = converter.convertPdf(source.path(), mime);
    }
    switch (outcome) {
      case ConvertOutcome.Success success -> storeResult(t, leaseToken, success);
      case ConvertOutcome.Failure failure ->
          recordFailure(t, leaseToken, failure.code(), failure.transientFailure());
    }
  }

  /**
   * 변환 성공 결과를 저장하고 READY 로 기록한다. 고아 결과를 남기지 않는 것이 핵심이다.
   *
   * <ul>
   *   <li>쓰기 직전 리스를 다시 확인한다 — 변환 중 원본이 지워졌거나(행 CASCADE 삭제) 리스를 잃었으면 쓰지 않는다. 삭제가 먼저 끝난 뒤 쓰면 정리를 피한
   *       결과가 디스크에 영영 남는다.
   *   <li>쓴 뒤 READY 기록(CAS)이 실패하면 방금 쓴 결과를 지운다. 단 다른 작업이 이미 READY 로 기록했으면 같은 위치의 그 결과라 지우지 않는다.
   * </ul>
   */
  private <K> void storeResult(
      PreviewTarget<K> t, OffsetDateTime leaseToken, ConvertOutcome.Success success) {
    if (!Boolean.TRUE.equals(tx.execute(s -> t.store().isCurrentLease(t.key(), leaseToken)))) {
      log.info("미리보기 리스를 잃어(또는 원본 삭제) 결과 저장 생략: {}", t.logKey());
      return;
    }
    try {
      t.storeResult(success.pdf());
    } catch (RuntimeException e) {
      log.warn("미리보기 결과 저장 실패: {} error={}", t.logKey(), e.toString());
      recordFailure(t, leaseToken, "STORAGE_ERROR", true);
      return;
    }
    Boolean recorded =
        tx.execute(s -> t.store().markReady(t.key(), leaseToken, success.pageCount()));
    if (Boolean.TRUE.equals(recorded)) {
      return;
    }
    // 쓰기와 기록 사이에 리스를 잃음(원본 삭제·재선점) — 행을 잠근 채 판정하고 지운다. 다른 작업의 결과(READY)나 살아 있는 리스로 변환 중인
    // 행이면 같은 위치에 그 작업이 쓴(쓸) 결과라 지우지 않는다. 잠근 동안 다른 작업의 선점·완료 기록은 기다린다.
    Boolean deleted =
        tx.execute(
            s -> {
              boolean ownedByOther =
                  t.store().findForUpdate(t.key()).map(this::ownedByOther).orElse(false);
              if (ownedByOther) {
                return false;
              }
              try {
                t.deleteResult();
              } catch (RuntimeException e) {
                log.warn("미리보기 고아 결과 삭제 실패: {} error={}", t.logKey(), e.toString());
              }
              return true;
            });
    log.info("미리보기 리스를 잃어 완료 기록 생략: {} resultDeleted={}", t.logKey(), deleted);
  }

  /** 리스를 잃은 작업이 볼 때 이 행이 다른 작업의 것인지 — READY 이거나 살아 있는 리스로 변환 중. */
  private boolean ownedByOther(Row r) {
    return switch (r.status()) {
      case "READY" -> true;
      case "CONVERTING" -> r.leasedUntil() != null && r.leasedUntil().isAfter(OffsetDateTime.now());
      default -> false;
    };
  }

  /** 실패 기록(리스 CAS). 기록 자체가 실패해도 던지지 않는다 — 리스가 끝나면 다음 열람이 다시 선점한다. */
  private <K> void recordFailure(
      PreviewTarget<K> t, OffsetDateTime leaseToken, String code, boolean transientFailure) {
    try {
      tx.executeWithoutResult(
          s -> t.store().markFailed(t.key(), leaseToken, code, transientFailure));
    } catch (RuntimeException e) {
      log.warn("미리보기 실패 기록 실패: {} code={} error={}", t.logKey(), code, e.toString());
    }
  }
}
