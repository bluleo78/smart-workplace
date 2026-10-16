package com.workplace.filepreview.service;

import com.workplace.file.exception.FileBlobMissingException;
import com.workplace.file.exception.FileNotFoundException;
import com.workplace.file.storage.FileStore;
import com.workplace.filepreview.PreviewTypes;
import com.workplace.filepreview.outbound.ConverterProperties;
import com.workplace.filepreview.repository.FilePreviewRepository;
import com.workplace.filepreview.repository.FilePreviewRepository.FileMeta;
import com.workplace.filepreview.repository.FilePreviewRepository.FileWithPreview;
import com.workplace.filepreview.repository.PreviewStateStore;
import com.workplace.global.tenant.TenantContext;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.io.FileSystemResource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 드라이브 문서 미리보기(서버 변환 PDF) 오케스트레이션(WP-431) — file 행으로 변환 대상({@link DriveFileTarget})을 만들고,
 * 판정·선점·변환·기록은 공용 {@link PreviewEngine}(WP-432)에 맡긴다. 업로드 직후 미리 변환(백그라운드 실행기)만 드라이브 전용이다.
 *
 * <p>클래스·메서드에 {@code @Transactional} 을 두지 않는다: 변환 호출은 트랜잭션 밖에서 해야 하므로 file 행 읽기도 {@link
 * TransactionTemplate} 의 짧은 트랜잭션으로 한다.
 */
@Slf4j
@Service
public class FilePreviewService {

  private final FilePreviewRepository repo;
  private final ConverterProperties props;
  private final FileStore fileStore;
  private final TransactionTemplate tx;
  private final Executor backgroundExecutor;
  private final PreviewEngine engine;

  public FilePreviewService(
      FilePreviewRepository repo,
      ConverterProperties props,
      FileStore fileStore,
      PlatformTransactionManager txManager,
      PreviewEngine engine,
      @Qualifier("filePreviewBackgroundExecutor") Executor backgroundExecutor) {
    this.repo = repo;
    this.props = props;
    this.fileStore = fileStore;
    this.tx = new TransactionTemplate(txManager);
    this.backgroundExecutor = backgroundExecutor;
    this.engine = engine;
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
      // 꺼져 있으면 file 행도 읽지 않는다.
      return new PreviewOutcome.NotApplicable();
    }
    long tenantId = TenantContext.require();
    // file 행·상태 행 조인 읽기와 판정·선점을 한 트랜잭션에서 한다(WP-431 과 같은 왕복 1회).
    return engine.open(() -> prepare(tenantId, fileId), start);
  }

  /**
   * 업로드 직후 미리 변환을 백그라운드 실행기에 맡긴다. 대상 형식이 아니거나 변환 서비스가 꺼져 있으면 무시한다.
   *
   * <p>여기서는 DB 에 쓰지 않고 작업이 <b>시작할 때</b> 선점한다 — 큐에서 기다리는 동안 리스를 쥐고 있으면 그 사이 사용자가 문서를 열어도 리스가 끝날 때까지
   * 변환 중으로만 보이기 때문이다. 큐가 넘치면 경고만 남긴다(첫 열람이 변환한다).
   *
   * <p>여기서의 형식 판정은 큐에 넣을지만 거르는 1차 필터다 — mime 이 범용(octet-stream)이어도 파일명 확장자로 고르도록 이름을 함께 받는다. 실제 변환
   * 대상·mime 은 작업이 시작할 때 file 행(mime_type + original_name)으로 다시 정한다.
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
            engine
                .claimQuietly(() -> prepare(tenantId, fileId))
                .ifPresent(c -> engine.convertClaimed(c.target(), c.leaseToken()));
          } catch (RuntimeException e) {
            // 원본 유실·파일 삭제 등 — 미리 변환은 최선 노력이라 경고만 남긴다(첫 열람이 같은 판정을 다시 한다).
            log.warn("미리보기 백그라운드 변환 건너뜀: fileId={} error={}", fileId, e.toString());
          }
        });
  }

  /**
   * 열람·미리 변환용 대상과 상태 행을 만든다(판정 트랜잭션 안) — 판정 순서의 앞 두 단계: 형식 → 원본 유무. file 행과 상태 행은 한 번의 조인으로 읽는다.
   *
   * @return 대상 형식이 아니면 null(원본 유무와 무관하게 대상 아님 — 엔진이 NotApplicable 로 답한다)
   * @throws FileNotFoundException file 행이 없을 때
   * @throws FileBlobMissingException 대상 형식인데 원본 blob 이 디스크에 없을 때
   */
  private PreviewEngine.Prepared<Long> prepare(long tenantId, long fileId) {
    FileWithPreview found =
        repo.findWithFile(fileId).orElseThrow(() -> new FileNotFoundException(fileId));
    DriveFileTarget target = new DriveFileTarget(tenantId, fileId, found.file());
    if (target.targetMime() == null) {
      return null;
    }
    if (!fileStore.exists(found.file().storagePath())) {
      throw new FileBlobMissingException(fileId);
    }
    return new PreviewEngine.Prepared<>(target, Optional.ofNullable(found.preview()));
  }

  /**
   * 선점한 변환 작업 본문 — 대상을 만들어 엔진에 맡긴다(선점만 해 둔 테스트용 진입점).
   *
   * @param claimToken 선점({@link FilePreviewRepository#claim}) 때 받은 리스 토큰
   * @param meta 판정 때 읽은 file 메타(null 이면 작업이 리스 갱신 뒤 다시 읽는다)
   */
  void convertClaimed(long tenantId, long fileId, OffsetDateTime claimToken, FileMeta meta) {
    engine.convertClaimed(new DriveFileTarget(tenantId, fileId, meta), claimToken);
  }

  /**
   * 드라이브 파일 한 건의 미리보기 대상 — 키는 core {@code file.id}, 원본은 {@link FileStore} 의 blob, 결과는 원본 옆 보기 캐시의
   * {@code preview.pdf}({@link PreviewTypes#previewPath}).
   *
   * <p>판정 때 읽은 file 메타를 그대로 들고 있어 변환 작업이 다시 읽지 않는다. 메타 없이 만들면(테스트 진입점) 처음 쓸 때 실행기 스레드의 테넌트 컨텍스트로
   * 읽는다 — 엔진이 리스를 갱신한 뒤라 리스를 잃은 작업은 읽지 않고, 읽기 실패는 엔진이 일시 실패로 기록한다.
   */
  private final class DriveFileTarget implements PreviewTarget<Long> {

    private final long tenantId;
    private final long fileId;
    private FileMeta meta;
    // 변환 대상 mime — 판정·변환에서 여러 번 묻으므로 메타로 한 번만 정한다.
    private String targetMime;
    private boolean targetMimeResolved;

    DriveFileTarget(long tenantId, long fileId, FileMeta meta) {
      this.tenantId = tenantId;
      this.fileId = fileId;
      this.meta = meta;
    }

    private FileMeta meta() {
      if (meta == null) {
        meta =
            tx.execute(
                s ->
                    repo.findWithFile(fileId)
                        .map(FileWithPreview::file)
                        .orElseThrow(() -> new FileNotFoundException(fileId)));
      }
      return meta;
    }

    private String previewPath() {
      return PreviewTypes.previewPath(meta().storagePath());
    }

    @Override
    public Long key() {
      return fileId;
    }

    @Override
    public long tenantId() {
      return tenantId;
    }

    @Override
    public PreviewStateStore<Long> store() {
      return repo;
    }

    @Override
    public String logKey() {
      return "fileId=" + fileId;
    }

    @Override
    public String targetMime() {
      if (!targetMimeResolved) {
        targetMime = PreviewTypes.targetMime(meta().mime(), meta().originalName());
        targetMimeResolved = true;
      }
      return targetMime;
    }

    /** file.size_bytes 는 정확한 원본 크기라 넘으면 행에 굳힌다. */
    @Override
    public SizeCheck sizeCheck(long maxBytes) {
      return meta().sizeBytes() > maxBytes ? SizeCheck.OVER : SizeCheck.WITHIN;
    }

    @Override
    public Optional<PreviewOutcome.Ready> loadResult() {
      Path pdf = fileStore.resolve(previewPath());
      return PreviewResultFile.read(pdf, String.valueOf(fileId), props.preview().engineVersion())
          .map(
              f ->
                  new PreviewOutcome.Ready(
                      new FileSystemResource(pdf),
                      f.sizeBytes(),
                      f.etag(),
                      f.lastModifiedMillis()));
    }

    @Override
    public SourceFile openSource() {
      // 원본 blob 을 그대로 보낸다 — 정리할 것이 없다.
      return SourceFile.of(fileStore.resolve(meta().storagePath()));
    }

    @Override
    public void storeResult(byte[] pdf) {
      fileStore.writeAtomically(previewPath(), pdf);
    }

    @Override
    public void deleteResult() {
      fileStore.deleteIfExists(previewPath());
    }
  }
}
