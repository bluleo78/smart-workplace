package com.workplace.mail.service;

import com.workplace.file.storage.FileStore;
import com.workplace.global.security.EncryptionService;
import com.workplace.mail.repository.MailPreviewKey;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.Optional;
import java.util.UUID;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.AbstractResource;
import org.springframework.stereotype.Component;

/**
 * 메일 첨부 캐시 blob 의 암호화 디스크 저장소. 평문 바이너리를 AES-256-GCM 으로 암호화해 {@code
 * {baseDir}/tenant-{tenantId}/mail/{hash 앞2}/{uuid}.enc} 에 쓰고, file_ref(상대 경로)를 반환한다.
 *
 * <p>baseDir 는 통합 스토리지 루트({@code workplace.storage.root-dir}) 를 공유하며, mail 세그먼트로 격리된다.
 * 암호화·dedup·TTL 로직은 파일 모듈과 별도로 유지한다.
 *
 * <p>첨부 변환 미리보기 PDF(WP-432)도 같은 암호화로 {@code tenant-{tid}/mail-preview/...} 에 둔다 — mail 세그먼트 밖이라 고아
 * 파일 스윕 대상이 아니고, 수명은 {@code mail_attachment_preview} 행의 refcount-0 정리가 정한다.
 *
 * <p>file 모듈(FileUploadService)은 평문 저장·user 앵커라 재활용 불가 — 캐시 blob 은 테넌트 dedup·암호화·독립 TTL 수명을 가져야 하므로
 * 전용 저장소를 둔다.
 */
@Slf4j
@Component
public class MailAttachmentBlobStore {

  private final EncryptionService encryption;
  private final FileStore fileStore;
  private final Path baseDir;

  /**
   * @param fileStore 통합 스토리지({@code workplace.storage.root-dir}). 메일 캐시는 그 루트 하위 경로에 격리 저장된다.
   */
  public MailAttachmentBlobStore(EncryptionService encryption, FileStore fileStore) {
    this.encryption = encryption;
    this.fileStore = fileStore;
    // 통합 루트를 baseDir 로 사용 — 루트만 공유하고 암호화/dedup/TTL 로직은 독립 유지
    this.baseDir = fileStore.rootDir();
  }

  /** 평문 바이너리를 암호화해 저장하고 상대 file_ref 를 반환한다. mail 세그먼트로 격리. */
  public String store(long tenantId, String contentHash, byte[] plain) {
    String prefix = contentHash.length() >= 2 ? contentHash.substring(0, 2) : "00";
    // mail 세그먼트 삽입 — 통합 루트 하위에서 메일 캐시 영역을 명시적으로 구분
    String rel = "tenant-" + tenantId + "/mail/" + prefix + "/" + UUID.randomUUID() + ".enc";
    Path target = baseDir.resolve(rel);
    try {
      Files.createDirectories(target.getParent());
      Files.write(target, encryption.encryptBytes(plain));
    } catch (IOException e) {
      throw new UncheckedIOException("첨부 blob 저장 실패: " + rel, e);
    }
    return rel;
  }

  /** 암호화 blob 을 읽어 복호화한 평문을 반환한다. */
  public byte[] load(String fileRef) {
    try {
      return encryption.decryptBytes(Files.readAllBytes(resolve(fileRef)));
    } catch (IOException e) {
      throw new UncheckedIOException("첨부 blob 로드 실패: " + fileRef, e);
    }
  }

  /** blob 파일을 삭제한다(없으면 무시 — best-effort). */
  public void delete(String fileRef) {
    try {
      Files.deleteIfExists(resolve(fileRef));
    } catch (IOException e) {
      throw new UncheckedIOException("첨부 blob 삭제 실패: " + fileRef, e);
    }
  }

  /** 최선 노력 삭제 — 실패는 경고만 남긴다(GC 가 행 삭제 트랜잭션 안에서 부른다, {@link FileStore#deleteQuietly(String)}). */
  public void deleteQuietly(String fileRef) {
    fileStore.deleteQuietly(fileRef);
  }

  /**
   * 변환 미리보기 PDF 를 암호화해 결정적 경로({@link MailPreviewKey#previewRef()})에 저장한다(WP-432).
   *
   * <p>암호화한 뒤 {@link FileStore#writeAtomically} 로 놓는다 — 동시에 읽는 요청은 반쯤 쓴 파일을 보지 않고, 같은 해시를 다시 저장하면
   * 덮어쓴다. 실패는 {@link UncheckedIOException} 으로 던진다(엔진이 STORAGE_ERROR 로 기록).
   */
  public void storePreview(MailPreviewKey key, byte[] pdf) {
    fileStore.writeAtomically(key.previewRef(), encryption.encryptBytes(pdf));
  }

  /**
   * 저장된 미리보기 PDF 를 <b>읽을 때 복호화하는</b> 리소스로 돌려준다 — 판정(트랜잭션 안)·304 응답은 복호화하지 않는다. 길이는 암호문 크기로 계산해
   * Content-Length 를 미리 안다({@link LazyDecryptingResource#contentLength()}). 손상·키 불일치·유실은 본문을 읽을 때
   * {@link IOException} 으로 드러나고, 그때 {@code onUnreadable} 을 불러 다음 열람이 다시 변환하게 한다(이번 응답은 실패).
   *
   * @param encryptedSize 암호화 파일 크기(호출자가 수정 시각과 함께 한 번에 읽은 값)
   * @param onUnreadable 본문을 읽지 못했을 때 할 일(최선 노력 — 던져도 원래 오류를 가리지 않는다)
   */
  LazyDecryptingResource previewResource(
      MailPreviewKey key, long encryptedSize, Runnable onUnreadable) {
    return new LazyDecryptingResource(
        key, EncryptionService.plainLengthOfEncryptedBytes(encryptedSize), onUnreadable);
  }

  /**
   * 열 때({@link #getInputStream}) 처음 복호화하는 미리보기 리소스. 길이는 미리 계산한 값을 돌려 본문을 읽지 않는다 — {@link
   * #contentLength()} 가 검사 예외를 던지지 않게 이 타입으로 돌려준다.
   */
  final class LazyDecryptingResource extends AbstractResource {

    private final MailPreviewKey key;
    private final long plainLength;
    private final Runnable onUnreadable;

    LazyDecryptingResource(MailPreviewKey key, long plainLength, Runnable onUnreadable) {
      this.key = key;
      this.plainLength = plainLength;
      this.onUnreadable = onUnreadable;
    }

    @Override
    public InputStream getInputStream() throws IOException {
      Optional<byte[]> pdf;
      try {
        // 없거나 복호화 실패면 empty, 읽기 오류면 UncheckedIOException — 둘 다 읽지 못한 것으로 본다.
        pdf = loadPreview(key);
      } catch (RuntimeException e) {
        pdf = Optional.empty();
      }
      if (pdf.isEmpty()) {
        unreadable();
        throw new IOException("미리보기를 읽을 수 없다: " + key.previewRef());
      }
      return new ByteArrayInputStream(pdf.get());
    }

    /** 읽지 못한 결과를 다시 변환하게 알린다 — 알리기 실패가 원래 오류(IOException)를 가리지 않게 삼킨다. */
    private void unreadable() {
      try {
        onUnreadable.run();
      } catch (RuntimeException e) {
        log.warn("미리보기 재변환 표시 실패: {} error={}", key.previewRef(), e.toString());
      }
    }

    @Override
    public long contentLength() {
      return plainLength;
    }

    @Override
    public boolean exists() {
      return true;
    }

    @Override
    public String getDescription() {
      return "mail preview [" + key.previewRef() + "]";
    }
  }

  /** 저장된 미리보기 PDF 를 복호화해 돌려준다. 파일이 없거나(정리·유실) 복호화에 실패하면(손상·키 불일치) empty — 호출자는 재변환으로 이어간다. */
  public Optional<byte[]> loadPreview(MailPreviewKey key) {
    String rel = key.previewRef();
    byte[] raw;
    try {
      raw = Files.readAllBytes(resolve(rel));
    } catch (NoSuchFileException e) {
      return Optional.empty();
    } catch (IOException e) {
      throw new UncheckedIOException("미리보기 로드 실패: " + rel, e);
    }
    try {
      return Optional.of(encryption.decryptBytes(raw));
    } catch (RuntimeException e) {
      // 짧은 데이터(IllegalArgumentException)·GCM 태그 불일치(CryptoException) 모두 손상으로 보고 재변환에 맡긴다.
      log.warn("미리보기 복호화 실패 — 재변환 대상: {} error={}", rel, e.toString());
      return Optional.empty();
    }
  }

  /**
   * 미리보기 파일을 지운다(없으면 무시). 변환 작업이 결과를 쓴 뒤 READY 기록(CAS)에 실패했을 때 — 행이 purge·GC 로 지워졌거나 리스를 잃었을 때 — 고아
   * {@code .enc} 를 남기지 않으려고 {@code PreviewTarget.deleteResult()} 가 부른다.
   */
  public void deletePreview(MailPreviewKey key) {
    delete(key.previewRef());
  }

  /** file_ref(상대 경로)를 baseDir 기준 절대 경로로 해석한다. baseDir 탈출 방지. */
  public Path resolve(String fileRef) {
    Path p = baseDir.resolve(fileRef).normalize();
    if (!p.startsWith(baseDir)) {
      throw new IllegalArgumentException("잘못된 file_ref(경로 탈출): " + fileRef);
    }
    return p;
  }

  /** orphan-file 스윕이 walk 할 루트 디렉터리. */
  public Path baseDir() {
    return baseDir;
  }
}
