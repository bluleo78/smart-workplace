package com.workplace.mail.service;

import com.workplace.file.storage.FileStore;
import com.workplace.filepreview.PreviewTypes;
import com.workplace.filepreview.outbound.ConverterProperties;
import com.workplace.filepreview.repository.PreviewStateStore;
import com.workplace.filepreview.service.PreviewEngine;
import com.workplace.filepreview.service.PreviewOutcome;
import com.workplace.filepreview.service.PreviewResultFile;
import com.workplace.filepreview.service.PreviewTarget;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.exception.EmailAttachmentNotFoundException;
import com.workplace.mail.repository.ContentAttachmentRepository;
import com.workplace.mail.repository.EmailAttachmentRepository.AttachmentDownloadContext;
import com.workplace.mail.repository.MailAttachmentPreviewRepository;
import com.workplace.mail.repository.MailPreviewKey;
import com.workplace.mail.service.MailAttachmentResolver.Resolved;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileAttribute;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 메일 첨부 문서 미리보기(서버 변환 PDF, WP-432) — HWP·HWPX·PPTX·PPT·DOC 첨부를 첫 열람 때 PDF 로 변환해 보여 준다. 판정·선점·변환·기록은
 * 드라이브와 같은 {@link PreviewEngine} 이 하고, 여기서는 소유 확인·대상 판정·{@code content_hash} 채우기와 대상({@link
 * MailPreviewTarget}) 만들기만 한다.
 *
 * <p>메일은 미리 변환하지 않는다(첫 열람에만). 폴링은 provider(IMAP/Graph)에 닿지 않는다 — 원본을 받는 때는 해시가 없어 요청 스레드에서 한 번 채울
 * 때와, 선점한 변환 작업이 실행기 스레드에서 받을 때뿐이다.
 *
 * <p><b>트랜잭션(R5)</b>: 클래스·메서드에 {@code @Transactional} 을 두지 않는다 — 원본 받기·변환 동안 DB 연결을 잡지 않기 위해서다. 소유
 * 확인은 짧은 읽기 전용, 해시 기록은 짧은 쓰기 {@link TransactionTemplate} 으로 한다(RLS GUC). 원본 받기는 {@link
 * MailAttachmentService#downloadForPreview} 가 provider 호출 동안 트랜잭션을 잡지 않게 나눈다.
 */
@Slf4j
@Service
public class MailAttachmentPreviewService {

  private static final String TOO_LARGE = "TOO_LARGE";
  private static final String SOURCE_MISSING = "SOURCE_MISSING";

  /** 평문 임시 원본의 권한 — 소유자만 읽고 쓴다(0600). */
  private static final String OWNER_ONLY = "rw-------";

  /** 요청자 한정 "원본 없음" 표시의 수명 — 그 사이 [다시 시도]도 영구 실패로 답하고, 지나면 다시 받아 본다(메일이 복원됐을 수 있다). */
  static final Duration SOURCE_MISSING_TTL = Duration.ofMinutes(10);

  /** 표시가 이 수를 넘으면 넣을 때 만료된 것을 쓸어낸다(메모리 상한). */
  private static final int SOURCE_MISSING_SWEEP_THRESHOLD = 1_000;

  /** 요청자(사용자·첨부) 한정 원본 없음 표시. */
  private record Requester(long userId, long attachmentId) {}

  /**
   * 변환 작업이 이 요청자의 원본이 provider 에서 사라진 것을 발견했을 때 남기는 표시(값 = 만료 시각 ms).
   *
   * <p>공유 {@code (tenant, hash)} 행에 SOURCE_MISSING 을 쓰지 않는 이유: 같은 바이트를 가진 다른 사용자의 메일은 남아 있을 수 있다.
   * 요청 스레드에서 매번 provider 에 존재를 묻는 대안은 폴링마다 provider 를 부르게 되므로(폴링은 provider 에 닿지 않는다는 규칙) 택하지 않았다.
   * 변환은 이 인스턴스의 실행기에서 돌아 같은 인스턴스가 표시를 남긴다 — 다른 인스턴스로 간 폴링은 행(PENDING)을 다시 선점해 같은 판정을 한 번 더 한다(시도
   * 횟수는 소모하지 않음).
   */
  private final Map<Requester, Long> sourceMissing = new ConcurrentHashMap<>();

  private final MailAttachmentResolver resolver;
  private final MailAttachmentService attachmentService;
  private final MailAttachmentBlobStore blobStore;
  private final MailAttachmentPreviewRepository repo;
  private final ContentAttachmentRepository contentAttachmentRepo;
  private final ConverterProperties props;
  private final TransactionTemplate readTx;
  private final TransactionTemplate writeTx;
  private final PreviewEngine engine;

  public MailAttachmentPreviewService(
      MailAttachmentResolver resolver,
      MailAttachmentService attachmentService,
      MailAttachmentBlobStore blobStore,
      MailAttachmentPreviewRepository repo,
      ContentAttachmentRepository contentAttachmentRepo,
      ConverterProperties props,
      PlatformTransactionManager txManager,
      PreviewEngine engine) {
    this.resolver = resolver;
    this.attachmentService = attachmentService;
    this.blobStore = blobStore;
    this.repo = repo;
    this.contentAttachmentRepo = contentAttachmentRepo;
    this.props = props;
    this.readTx = new TransactionTemplate(txManager);
    this.readTx.setReadOnly(true);
    this.writeTx = new TransactionTemplate(txManager);
    this.engine = engine;
  }

  /**
   * 미리보기를 연다(웹 {@code GET /mail/attachments/{id}/preview}). 요청 스레드의 활성 테넌트로 동작한다.
   *
   * <p>판정 순서: 소유(아니면 404) → 대상 아님(꺼짐·형식·레거시) → 해시 → 엔진(행 상태 → 받기 전 크기 추정 → 선점).
   *
   * <p>받기 전 크기는 manifest 추정이라 행에 쓰지 않는다 — 같은 해시의 다른 메일이 이미 READY 거나 변환 중이면 그 상태로 답해야 하므로 행 상태를 먼저
   * 본다(엔진). 해시가 없으면 볼 행도 없으니 추정 초과면 받지 않고 바로 TOO_LARGE 로 답한다.
   *
   * @param start 시도의 첫 요청(뷰어 열기·[다시 시도])이면 true — 이때만 FAILED 행을 다시 선점한다. 폴링은 false.
   * @throws EmailAttachmentNotFoundException 없거나 타인 소유일 때(존재 은닉 404), 또는 해시를 채우려 받을 때 원본이 없을 때
   */
  public PreviewOutcome open(long userId, long attachmentId, boolean start) {
    // ① 소유 확인 — 꺼져 있어도 남의 첨부는 NOT_APPLICABLE 이 아니라 404 여야 존재를 드러내지 않는다.
    Resolved r = readTx.execute(s -> resolver.resolve(userId, attachmentId));
    AttachmentDownloadContext ctx = r.ctx();

    // ② 대상 아님 — 꺼짐·형식 밖·manifest 없는 레거시(해시를 기록할 곳이 없어 매 폴링이 원본을 받게 된다).
    String mime = PreviewTypes.targetMime(r.mime(), ctx.filename());
    if (!props.enabled() || mime == null || ctx.contentAttachmentId() == 0L) {
      return new PreviewOutcome.NotApplicable();
    }

    // ②' 변환 작업이 이 요청자의 원본이 provider 에서 사라진 것을 봤다 — 요청자 한정 영구 실패(공유 행은 그대로).
    if (isSourceMissing(userId, attachmentId)) {
      return new PreviewOutcome.Failed(SOURCE_MISSING, false);
    }

    // ③ 받기 전 크기 추정(manifest) — 원본 크기는 바뀌지 않으므로 넘으면 provider 를 부르지 않는다.
    boolean overEstimate = r.exceedsBeforeFetch(props.maxBytes());

    // ④ 해시가 없으면 한 번 받아 채운다 — 이후 폴링·다른 사용자는 해시로 상태를 찾아 원본을 받지 않는다.
    if (ctx.contentHash() == null) {
      if (overEstimate) {
        return new PreviewOutcome.Failed(TOO_LARGE, false);
      }
      Optional<AttachmentDownloadContext> filled = fillContentHash(userId, ctx);
      if (filled.isEmpty()) {
        return new PreviewOutcome.Failed("UNAVAILABLE", true);
      }
      ctx = filled.get();
    }

    // ⑤ 엔진 — 해시가 채워진 컨텍스트를 넘겨 변환 작업이 25MB 이하 첨부를 캐시에서 받게 한다.
    MailPreviewKey key = new MailPreviewKey(TenantContext.require(), ctx.contentHash());
    return engine.open(new MailPreviewTarget(key, userId, ctx, mime, overEstimate), start);
  }

  /** 요청자 한정 원본 없음 표시가 살아 있는지(만료된 표시는 지운다). */
  private boolean isSourceMissing(long userId, long attachmentId) {
    Requester r = new Requester(userId, attachmentId);
    Long expiresAt = sourceMissing.get(r);
    if (expiresAt == null) {
      return false;
    }
    if (expiresAt <= System.currentTimeMillis()) {
      sourceMissing.remove(r, expiresAt);
      return false;
    }
    return true;
  }

  /** 변환 작업(실행기 스레드)이 이 요청자의 원본이 사라진 것을 봤을 때 표시한다. */
  private void markSourceMissing(long userId, long attachmentId) {
    long now = System.currentTimeMillis();
    if (sourceMissing.size() >= SOURCE_MISSING_SWEEP_THRESHOLD) {
      sourceMissing.values().removeIf(expiresAt -> expiresAt <= now);
    }
    sourceMissing.put(new Requester(userId, attachmentId), now + SOURCE_MISSING_TTL.toMillis());
  }

  /**
   * READY 결과를 응답 중 읽지 못함(손상·키 불일치·유실) — 행을 PENDING 으로 되돌려 다음 열람이 다시 변환하게 한다. 응답 쓰기(트랜잭션 밖) 중에 불리므로
   * 테넌트 컨텍스트를 세운 뒤 짧은 트랜잭션을 연다.
   */
  private void resetUnreadable(MailPreviewKey key) {
    log.warn("미리보기 결과를 읽지 못함 — 다시 변환하도록 되돌림: hash={}", key.contentHash());
    TenantContext.runAs(
        key.tenantId(), () -> writeTx.executeWithoutResult(s -> repo.resetReady(key)));
  }

  /**
   * 원본을 받아 sha256 을 계산하고 {@code content_attachment.content_hash} 에 기록한다(이미 있으면 그대로). 바이트는 버린다 — 변환은
   * 선점한 작업이 다시 받는다(25MB 이하는 방금 채운 첨부 캐시에서).
   *
   * @return 해시를 채운 컨텍스트, provider 일시 장애면 empty(행이 없어 기록하지 않는다)
   * @throws EmailAttachmentNotFoundException 원본이 provider 에 없을 때(그대로 404)
   */
  private Optional<AttachmentDownloadContext> fillContentHash(
      long userId, AttachmentDownloadContext ctx) {
    byte[] content;
    try {
      content = attachmentService.downloadForPreview(userId, ctx).content();
    } catch (EmailAttachmentNotFoundException e) {
      throw e;
    } catch (RuntimeException e) {
      log.warn(
          "미리보기 해시 채우기 실패 — 일시 실패로 응답: attachmentId={} error={}", ctx.attachmentId(), e.toString());
      return Optional.empty();
    }
    String hash = MailAttachmentService.sha256Hex(content);
    // 25MB 이하는 download 가 이미 기록했다(NO-OP). 넘는 첨부는 캐시하지 않아 여기서만 기록된다.
    writeTx.executeWithoutResult(
        s -> contentAttachmentRepo.setContentHashIfNull(ctx.contentAttachmentId(), hash));
    return Optional.of(withHash(ctx, hash));
  }

  /** 해시만 채운 컨텍스트 사본. */
  private static AttachmentDownloadContext withHash(AttachmentDownloadContext c, String hash) {
    return new AttachmentDownloadContext(
        c.attachmentId(),
        c.contentAttachmentId(),
        hash,
        c.filename(),
        c.contentType(),
        c.ordinal(),
        c.accountId(),
        c.imapUid(),
        c.folderName(),
        c.provider(),
        c.providerMessageId(),
        c.providerAttachmentId());
  }

  /**
   * 메일 첨부 한 건의 미리보기 대상(WP-432) — 키는 {@code (tenant_id, content_hash)}, 원본은 {@link
   * MailAttachmentService#download(long, AttachmentDownloadContext)}(25MB 이하는 첨부 캐시 복호화, 넘으면
   * provider), 결과는 {@link MailAttachmentBlobStore} 의 암호화 미리보기({@link MailPreviewKey#previewRef()}).
   *
   * <p>원본은 {@link MailAttachmentService#downloadForPreview} 로 받는다 — provider 를 부르는 동안 DB 연결을 잡지
   * 않는다.
   *
   * <p>같은 테넌트에서 같은 바이트의 첨부는 메일·사용자가 달라도 한 키라 한 번만 변환한다. 권한은 대상을 만들기 전에 서비스가 요청자 소유로 확인했다 — 여기서 받는
   * {@code ctx} 는 그 요청자의 컨텍스트다. 서비스 수준 의존(저장소·설정)은 감싼 서비스의 것을 쓴다 — 드라이브의 {@code DriveFileTarget} 과
   * 같은 구성.
   */
  private final class MailPreviewTarget implements PreviewTarget<MailPreviewKey> {

    private final MailPreviewKey key;
    private final long userId;
    private final AttachmentDownloadContext ctx;
    private final String targetMime;
    private final boolean overEstimate;

    /**
     * @param key 상태 행 키 — {@code ctx.contentHash()} 와 같은 해시여야 한다
     * @param ctx 요청자 소유를 확인한 컨텍스트(해시가 채워진 것 — 그래야 변환 작업이 캐시를 탄다)
     * @param targetMime 변환 서비스에 보낼 정규형 mime
     * @param overEstimate manifest 추정 크기가 상한을 넘는지(받기 전 판정 — 행에 쓰지 않는다)
     */
    MailPreviewTarget(
        MailPreviewKey key,
        long userId,
        AttachmentDownloadContext ctx,
        String targetMime,
        boolean overEstimate) {
      this.key = key;
      this.userId = userId;
      this.ctx = ctx;
      this.targetMime = targetMime;
      this.overEstimate = overEstimate;
    }

    @Override
    public MailPreviewKey key() {
      return key;
    }

    @Override
    public long tenantId() {
      return key.tenantId();
    }

    @Override
    public PreviewStateStore<MailPreviewKey> store() {
      return repo;
    }

    @Override
    public String logKey() {
      return "mailAttachmentId=" + ctx.attachmentId() + " hash=" + key.contentHash();
    }

    @Override
    public String targetMime() {
      return targetMime;
    }

    /**
     * IMAP 의 manifest 크기는 base64 기준 추정이라(서비스가 여유를 둔 {@code exceedsBeforeFetch} 로 판정) 넘어도 행에 굳히지 않는다
     * — 같은 해시를 공유하는 다른 메일·사용자의 상태를 추정으로 덮지 않기 위해서다. 실제 초과는 {@link #openSource} 가 받은 바이트로 판정한다.
     */
    @Override
    public SizeCheck sizeCheck(long maxBytes) {
      // 추정 판정은 서비스가 같은 상한(props.maxBytes())으로 미리 해 두었다 — 여기서는 그 결과만 옮긴다.
      return overEstimate ? SizeCheck.OVER_ESTIMATED : SizeCheck.WITHIN;
    }

    /**
     * 저장된 암호화 PDF 를 읽을 때 복호화하는 리소스로 돌려준다 — 판정 트랜잭션·304 응답에서는 복호화하지 않는다. 파일이 없거나 속성을 읽을 수 없으면
     * empty(엔진이 READY 행을 되돌려 다시 변환한다 — 드라이브와 같은 정책).
     *
     * <p>ETag 는 {@code 해시-엔진버전-파일수정시각} — 같은 바이트·같은 엔진이면 메일·사용자가 달라도 같고, 다시 변환하면 바뀐다. 손상된 파일은 본문을 읽을
     * 때에야 드러나 그 응답만 실패한다(복호화 없이 판정하는 대가).
     */
    @Override
    public Optional<PreviewOutcome.Ready> loadResult() {
      return PreviewResultFile.read(
              blobStore.resolve(key.previewRef()),
              key.contentHash(),
              props.preview().engineVersion())
          .map(
              f -> {
                var body =
                    blobStore.previewResource(key, f.sizeBytes(), () -> resetUnreadable(key));
                return new PreviewOutcome.Ready(
                    body, body.contentLength(), f.etag(), f.lastModifiedMillis());
              });
    }

    /**
     * 원본을 받아 평문 임시 파일(0600)에 쓴다(실행기 스레드). 변환 서비스는 경로로 원본을 받기 때문이다. 다 쓰고 나면 엔진이 {@link
     * SourceFile#close} 로 지운다 — 쓰다가 실패해도 여기서 지우고 다시 던진다(평문을 남기지 않게).
     *
     * <p>바이트를 먼저 받고 임시 파일을 만든다 — provider 실패 때 지울 파일이 생기지 않게.
     */
    @Override
    public SourceFile openSource() {
      byte[] content = attachmentService.downloadForPreview(userId, ctx).content();
      if (content.length > props.maxBytes()) {
        // 실제 바이트가 상한을 넘음 — 같은 바이트는 다시 받아도 같으므로 영구 실패로 굳힌다. 평문 임시 파일도 만들지 않는다.
        throw new SourceTooLargeException(content.length);
      }
      Path tmp = null;
      boolean handedOver = false;
      try {
        tmp = Files.createTempFile("mail-preview-src-", ".bin", ownerOnly());
        Files.write(tmp, content);
        Path created = tmp;
        SourceFile source = new SourceFile(created, () -> FileStore.deleteQuietly(created));
        handedOver = true;
        return source;
      } catch (IOException e) {
        throw new UncheckedIOException("미리보기 원본 임시 파일 쓰기 실패", e);
      } finally {
        // 넘기기 전에 실패했으면(IOException·RuntimeException) 평문을 남기지 않게 지운다.
        if (!handedOver && tmp != null) {
          FileStore.deleteQuietly(tmp);
        }
      }
    }

    /**
     * 원본 열기 실패 분류 — 실제 크기 초과면 TOO_LARGE(영구, 같은 바이트면 누구든 같다), 나머지는 일시 장애(UNAVAILABLE).
     *
     * <p>provider 에서 이 요청자의 메일이 사라졌으면(삭제·이동) 공유 {@code (tenant, hash)} 행에 기록하지 않는다(null → 엔진이 선점
     * 반납) — 같은 바이트를 가진 다른 사용자의 메일은 남아 있을 수 있어서다. 대신 요청자 한정 표시를 남겨 그 요청자의 다음 폴링이 SOURCE_MISSING 영구
     * 실패를 보게 한다.
     */
    @Override
    public PreviewOutcome.Failed sourceFailure(RuntimeException e) {
      if (e instanceof SourceTooLargeException) {
        return new PreviewOutcome.Failed("TOO_LARGE", false);
      }
      if (e instanceof EmailAttachmentNotFoundException) {
        markSourceMissing(userId, ctx.attachmentId());
        return null;
      }
      return PreviewTarget.super.sourceFailure(e);
    }

    /** 받은 원본이 크기 상한을 넘음 — {@link #sourceFailure} 가 TOO_LARGE 로 옮긴다. */
    private static final class SourceTooLargeException extends RuntimeException {
      SourceTooLargeException(long size) {
        super("미리보기 원본 크기 상한 초과: " + size + " bytes");
      }
    }

    @Override
    public void storeResult(byte[] pdf) {
      blobStore.storePreview(key, pdf);
    }

    @Override
    public void deleteResult() {
      blobStore.deletePreview(key);
    }

    /** POSIX 파일 시스템이면 0600 속성, 아니면(Windows 등) 속성 없음 — 기본 임시 디렉터리 권한에 맡긴다. */
    private static FileAttribute<?>[] ownerOnly() {
      if (FileSystems.getDefault().supportedFileAttributeViews().contains("posix")) {
        return new FileAttribute<?>[] {
          PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString(OWNER_ONLY))
        };
      }
      return new FileAttribute<?>[0];
    }
  }
}
