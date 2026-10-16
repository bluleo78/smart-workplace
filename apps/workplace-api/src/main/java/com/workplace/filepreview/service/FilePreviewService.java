package com.workplace.filepreview.service;

import com.workplace.file.exception.FileBlobMissingException;
import com.workplace.file.exception.FileNotFoundException;
import com.workplace.file.storage.FileStore;
import com.workplace.filepreview.PreviewTypes;
import com.workplace.filepreview.outbound.ConvertOutcome;
import com.workplace.filepreview.outbound.ConverterClient;
import com.workplace.filepreview.outbound.ConverterProperties;
import com.workplace.filepreview.repository.FilePreviewRepository;
import com.workplace.filepreview.repository.FilePreviewRepository.FileMeta;
import com.workplace.filepreview.repository.FilePreviewRepository.FileWithPreview;
import com.workplace.filepreview.repository.FilePreviewRepository.Row;
import com.workplace.global.tenant.TenantContext;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 드라이브 문서 미리보기(서버 변환 PDF) 오케스트레이션(WP-431) — 형식 판정, file_preview CAS 선점, 실행기 제출, 변환 결과 기록.
 *
 * <p>클래스·메서드에 {@code @Transactional} 을 두지 않는다: 변환 서비스 호출은 최대 75초라 그동안 DB 연결을 잡으면 안 되므로, 읽기·선점·기록만
 * {@link TransactionTemplate} 의 짧은 트랜잭션으로 묶고 변환 호출은 트랜잭션 밖에서 한다. 선점은 커밋한 뒤에 실행기에 넘긴다 — 작업이 먼저 시작해
 * 커밋 전 행을 보지 못하는 일이 없게.
 *
 * <p>실행기 스레드에서는 {@link TenantContext#runAs} 를 먼저 세운 뒤 트랜잭션을 연다. TenantAwareTransactionManager 가
 * 트랜잭션 시작 시점의 컨텍스트로 RLS GUC 를 심기 때문에, 순서가 바뀌면 세션 기본 GUC 로 기록돼 RLS 에 막힌다(WP-417).
 */
@Slf4j
@Service
public class FilePreviewService {

  private static final String TOO_LARGE = "TOO_LARGE";

  private final FilePreviewRepository repo;
  private final ConverterClient converter;
  private final ConverterProperties props;
  private final FileStore fileStore;
  private final TransactionTemplate tx;
  private final Executor interactiveExecutor;
  private final Executor backgroundExecutor;

  public FilePreviewService(
      FilePreviewRepository repo,
      ConverterClient converter,
      ConverterProperties props,
      FileStore fileStore,
      PlatformTransactionManager txManager,
      @Qualifier("filePreviewInteractiveExecutor") Executor interactiveExecutor,
      @Qualifier("filePreviewBackgroundExecutor") Executor backgroundExecutor) {
    this.repo = repo;
    this.converter = converter;
    this.props = props;
    this.fileStore = fileStore;
    this.tx = new TransactionTemplate(txManager);
    this.interactiveExecutor = interactiveExecutor;
    this.backgroundExecutor = backgroundExecutor;
  }

  /**
   * 판정 결과 — 바로 응답할 값이거나, 이 요청이 선점한 리스 토큰(선점 시 outcome 은 null). 선점했으면 판정 때 읽은 file 메타를 변환 작업에 그대로 넘겨
   * 다시 읽지 않는다.
   */
  private record Decision(PreviewOutcome outcome, OffsetDateTime leaseToken, FileMeta meta) {
    static Decision of(PreviewOutcome outcome) {
      return new Decision(outcome, null, null);
    }
  }

  /**
   * 미리보기를 연다(웹 {@code GET /drive/files/{id}/preview}). 필요하면 변환을 선점해 대화형 실행기에 넘기고 {@code Converting}
   * 을 돌려준다. 호출자가 권한을 확인한 core file.id 여야 하며, 요청 스레드의 활성 테넌트로 동작한다.
   *
   * @param start 시도의 첫 요청(뷰어 열기·[다시 시도])이면 true — 이때만 FAILED 행을 다시 선점한다. 폴링은 false.
   * @throws FileBlobMissingException 원본 blob 이 디스크에 없을 때(기존 {@code /content} 와 같은 404)
   */
  public PreviewOutcome open(long fileId, boolean start) {
    if (!props.enabled()) {
      return new PreviewOutcome.NotApplicable();
    }
    long tenantId = TenantContext.require();
    Decision decision = tx.execute(s -> decide(fileId, tenantId, start, true));
    if (decision.leaseToken() == null) {
      return decision.outcome();
    }
    OffsetDateTime token = decision.leaseToken();
    try {
      interactiveExecutor.execute(() -> convertClaimed(tenantId, fileId, token, decision.meta()));
      return new PreviewOutcome.Converting();
    } catch (RejectedExecutionException e) {
      // 대화형 큐까지 가득 — 시작도 못 한 시도라 선점(과 시도 횟수)을 돌려주고 일시 실패로 응답한다.
      log.warn("미리보기 대화형 실행기 거절 — 선점 반납: fileId={}", fileId);
      tx.executeWithoutResult(s -> repo.release(fileId, token));
      return new PreviewOutcome.Failed("BUSY", true);
    }
  }

  /**
   * 업로드 직후 미리 변환을 백그라운드 실행기에 맡긴다. 대상 형식이 아니거나 변환 서비스가 꺼져 있으면 무시한다.
   *
   * <p>여기서는 DB 에 쓰지 않고 작업이 <b>시작할 때</b> 선점한다 — 큐에서 기다리는 동안 리스를 쥐고 있으면 그 사이 사용자가 문서를 열어도 리스가 끝날 때까지
   * 변환 중으로만 보이기 때문이다. 큐가 넘치면 경고만 남긴다(첫 열람이 변환한다).
   *
   * <p>여기서의 형식 판정은 큐에 넣을지만 거르는 1차 필터다 — mime 이 범용(octet-stream)이어도 파일명 확장자로 고르도록 이름을 함께 받는다. 실제 변환
   * 대상·mime 은 작업이 시작할 때 file 행(mime_type + original_name)으로 다시 정한다({@link #decide}).
   *
   * @param mime 업로드 시 정규화된 file.mime_type
   * @param originalName 원본 파일명(확장자 폴백용, null 가능)
   */
  public void requestBackground(long tenantId, long fileId, String mime, String originalName) {
    if (!props.enabled() || PreviewTypes.targetMime(mime, originalName) == null) {
      return;
    }
    try {
      backgroundExecutor.execute(() -> runBackground(tenantId, fileId));
    } catch (RejectedExecutionException e) {
      log.warn("미리보기 백그라운드 큐 초과 — 첫 열람 때 변환: fileId={}", fileId);
    }
  }

  /** 백그라운드 작업 본문 — 시작 시 선점(FAILED 재선점·TOO_LARGE 기록은 하지 않음)하고 성공하면 같은 스레드에서 변환한다. */
  private void runBackground(long tenantId, long fileId) {
    TenantContext.runAs(
        tenantId,
        () -> {
          try {
            Decision decision = tx.execute(s -> decide(fileId, tenantId, false, false));
            if (decision.leaseToken() != null) {
              convertClaimed(tenantId, fileId, decision.leaseToken(), decision.meta());
            }
          } catch (RuntimeException e) {
            // 원본 유실·파일 삭제 등 — 미리 변환은 최선 노력이라 경고만 남긴다(첫 열람이 같은 판정을 다시 한다).
            log.warn("미리보기 백그라운드 변환 건너뜀: fileId={} error={}", fileId, e.toString());
          }
        });
  }

  /**
   * 열람 판정(트랜잭션 안) — 계획서의 판정 순서 그대로: 형식 → 원본 유무 → 행 상태 → 크기 상한 → 선점.
   *
   * <p>크기 상한은 행 상태 뒤에 본다 — 다른 작업이 유효한 리스로 변환 중이거나 READY 인 행을 {@code markTooLarge} 가 덮지 않게 하기 위해서다.
   *
   * @param recordTooLarge false 면 크기 초과를 기록하지 않고 응답만(백그라운드 — 열람이 기록한다)
   */
  private Decision decide(long fileId, long tenantId, boolean start, boolean recordTooLarge) {
    FileWithPreview found =
        repo.findWithFile(fileId).orElseThrow(() -> new FileNotFoundException(fileId));
    FileMeta meta = found.file();
    if (PreviewTypes.targetMime(meta.mime(), meta.originalName()) == null) {
      return Decision.of(new PreviewOutcome.NotApplicable());
    }
    if (!fileStore.exists(meta.storagePath())) {
      throw new FileBlobMissingException(fileId);
    }
    if (found.preview() != null) {
      PreviewOutcome settled = settled(fileId, meta, found.preview(), start);
      if (settled != null) {
        return Decision.of(settled);
      }
    }
    if (meta.sizeBytes() > props.maxBytes()) {
      // 원본 크기는 바뀌지 않으므로 변환 서비스를 부르지 않고 영구 실패로 굳힌다.
      if (recordTooLarge) {
        repo.markTooLarge(fileId, tenantId, props.preview().engineVersion());
      }
      return Decision.of(new PreviewOutcome.Failed(TOO_LARGE, false));
    }
    Optional<OffsetDateTime> token =
        repo.claim(
            fileId,
            tenantId,
            props.preview().engineVersion(),
            props.preview().lease(),
            props.preview().maxAttempts(),
            props.preview().transientCooldown(),
            start);
    if (token.isPresent()) {
      return new Decision(null, token.get(), meta);
    }
    // 경합으로 선점을 놓침 — 이긴 쪽이 남긴 상태를 한 번만 다시 읽어 판정한다(대개 변환 중). 루프하지 않는다.
    // 재판정은 폴링처럼(start=false) 한다 — FAILED 를 여기서 다시 "선점 가능"으로 보면(앱·DB 시계 차 등으로 settled 와 claim 이
    // 어긋날 때) 아무도 변환하지 않는데 변환 중으로 답하게 되므로, 선점을 놓친 FAILED 는 실패 그대로 돌려준다.
    PreviewOutcome again = repo.find(fileId).map(r -> settled(fileId, meta, r, false)).orElse(null);
    return Decision.of(again != null ? again : new PreviewOutcome.Converting());
  }

  /**
   * 행 상태만으로 응답이 정해지면 그 응답을, 선점을 시도해야 하면 null 을 돌려준다.
   *
   * <p>FAILED 재선점 여부는 {@link FilePreviewRepository#claim} 의 SQL 조건과 같아야 한다 — 어긋나면 여기서 선점 가능으로 보고
   * claim 은 거절해(또는 반대) 상한을 넘겨 변환하거나 엔진 변경 재시도를 막는다.
   */
  private PreviewOutcome settled(long fileId, FileMeta meta, Row row, boolean start) {
    int maxAttempts = props.preview().maxAttempts();
    boolean engineChanged = !props.preview().engineVersion().equals(row.engineVersion());
    switch (row.status()) {
      case "READY" -> {
        if (engineChanged) {
          // 이전 엔진의 결과 — start 와 무관하게 새 엔진으로 다시 변환한다(claim 도 이 READY 를 선점한다).
          return null;
        }
        Path pdf = fileStore.resolve(PreviewTypes.previewPath(meta.storagePath()));
        try {
          // 크기·수정 시각을 한 번의 파일 속성 조회로 읽는다.
          BasicFileAttributes attrs = Files.readAttributes(pdf, BasicFileAttributes.class);
          return new PreviewOutcome.Ready(
              pdf, attrs.size(), row.engineVersion(), attrs.lastModifiedTime().toMillis());
        } catch (IOException e) {
          // READY 인데 PDF 가 사라짐(볼륨 이전·수동 정리) — 500 대신 다시 변환하도록 되돌린다.
          log.warn("미리보기 PDF 유실 — 다시 변환: fileId={}", fileId);
          repo.resetReady(fileId);
          return null;
        }
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
        // PENDING(실행기 거절·PDF 유실 복구) — 선점한다.
        return null;
      }
    }
  }

  /**
   * 선점한 변환 작업 본문(실행기 스레드) — 리스 갱신 → 변환 호출(트랜잭션 밖) → 쓰기 직전 리스 재확인 → PDF 쓰기 → 결과 기록. 예상 밖 예외도 일시 실패로
   * 기록해 CONVERTING 으로 남기지 않는다(리스 만료까지 202 가 이어지지 않게).
   *
   * <p>시작할 때 선점 토큰으로 리스를 새로 잡는다(CAS) — 큐에서 기다린 시간만큼 리스가 줄어 변환 도중 만료되지 않게 하고, 그 사이 리스가 만료돼 다른 쪽이 다시
   * 선점했으면 CAS 가 실패해 헛변환하지 않는다. 이후 모든 기록은 새 토큰으로 한다.
   *
   * @param claimToken 선점({@link FilePreviewRepository#claim}) 때 받은 리스 토큰
   * @param meta 판정 때 읽은 file 메타(null 이면 작업이 다시 읽는다 — 선점만 해 둔 테스트용 진입점)
   */
  void convertClaimed(long tenantId, long fileId, OffsetDateTime claimToken, FileMeta meta) {
    TenantContext.runAs(
        tenantId,
        () -> {
          Optional<OffsetDateTime> refreshed;
          try {
            refreshed =
                tx.execute(s -> repo.refreshLease(fileId, claimToken, props.preview().lease()));
          } catch (RuntimeException e) {
            log.error("미리보기 리스 갱신 실패: fileId={}", fileId, e);
            recordFailure(fileId, claimToken, "UNAVAILABLE", true);
            return;
          }
          if (refreshed == null || refreshed.isEmpty()) {
            log.debug("미리보기 리스를 잃어 변환 건너뜀: fileId={}", fileId);
            return;
          }
          OffsetDateTime token = refreshed.get();
          try {
            convertHoldingLease(fileId, token, meta);
          } catch (RuntimeException e) {
            log.error("미리보기 변환 작업 실패: fileId={}", fileId, e);
            recordFailure(fileId, token, "UNAVAILABLE", true);
          }
        });
  }

  private void convertHoldingLease(long fileId, OffsetDateTime leaseToken, FileMeta given) {
    FileMeta meta =
        given != null
            ? given
            : tx.execute(
                s ->
                    repo.findWithFile(fileId)
                        .map(FileWithPreview::file)
                        .orElseThrow(() -> new FileNotFoundException(fileId)));
    String mime = PreviewTypes.targetMime(meta.mime(), meta.originalName());
    if (mime == null) {
      // 다시 읽은 메타가 대상 형식이 아님(선점 뒤 mime 이 바뀐 드문 경우) — 같은 원본은 다시 해도 같으므로 영구 실패.
      recordFailure(fileId, leaseToken, "UNSUPPORTED", false);
      return;
    }
    ConvertOutcome outcome = converter.convertPdf(fileStore.resolve(meta.storagePath()), mime);
    switch (outcome) {
      case ConvertOutcome.Success success -> storeResult(fileId, meta, leaseToken, success);
      case ConvertOutcome.Failure failure ->
          recordFailure(fileId, leaseToken, failure.code(), failure.transientFailure());
    }
  }

  /**
   * 변환 성공 결과를 preview.pdf 로 쓰고 READY 로 기록한다. 고아 PDF 를 남기지 않는 것이 핵심이다.
   *
   * <ul>
   *   <li>쓰기 직전 리스를 다시 확인한다 — 변환 중 파일이 지워졌거나(행 CASCADE 삭제) 리스를 잃었으면 쓰지 않는다. 파일 삭제가 먼저 끝난 뒤 쓰면 원본·
   *       파생물 정리를 피한 PDF 가 디스크에 영영 남는다.
   *   <li>쓴 뒤 READY 기록(CAS)이 실패하면 방금 쓴 PDF 를 지운다. 단 다른 작업이 이미 READY 로 기록했으면 같은 경로의 그 결과라 지우지 않는다.
   * </ul>
   */
  private void storeResult(
      long fileId, FileMeta meta, OffsetDateTime leaseToken, ConvertOutcome.Success success) {
    String previewPath = PreviewTypes.previewPath(meta.storagePath());
    if (!Boolean.TRUE.equals(tx.execute(s -> repo.isCurrentLease(fileId, leaseToken)))) {
      log.info("미리보기 리스를 잃어(또는 파일 삭제) PDF 저장 생략: fileId={}", fileId);
      return;
    }
    try {
      fileStore.writeAtomically(previewPath, success.pdf());
    } catch (RuntimeException e) {
      log.warn("미리보기 PDF 저장 실패: fileId={} error={}", fileId, e.toString());
      recordFailure(fileId, leaseToken, "STORAGE_ERROR", true);
      return;
    }
    Boolean recorded = tx.execute(s -> repo.markReady(fileId, leaseToken, success.pageCount()));
    if (Boolean.TRUE.equals(recorded)) {
      return;
    }
    // 쓰기와 기록 사이에 리스를 잃음(파일 삭제·재선점) — 행이 READY 가 아니면 방금 쓴 PDF 를 지운다.
    boolean readyByOther =
        Boolean.TRUE.equals(
            tx.execute(s -> repo.find(fileId).map(r -> "READY".equals(r.status())).orElse(false)));
    if (!readyByOther) {
      fileStore.deleteIfExists(previewPath);
    }
    log.info("미리보기 리스를 잃어 완료 기록 생략: fileId={} pdfDeleted={}", fileId, !readyByOther);
  }

  /** 실패 기록(리스 CAS). 기록 자체가 실패해도 던지지 않는다 — 리스가 끝나면 다음 열람이 다시 선점한다. */
  private void recordFailure(
      long fileId, OffsetDateTime leaseToken, String code, boolean transientFailure) {
    try {
      tx.executeWithoutResult(s -> repo.markFailed(fileId, leaseToken, code, transientFailure));
    } catch (RuntimeException e) {
      log.warn("미리보기 실패 기록 실패: fileId={} code={} error={}", fileId, code, e.toString());
    }
  }
}
