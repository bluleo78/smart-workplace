package com.workplace.mail.service;

import com.workplace.global.security.EncryptionService;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 메일 첨부 캐시 blob 의 암호화 디스크 저장소. 평문 바이너리를 AES-256-GCM 으로 암호화해 {@code
 * {baseDir}/tenant-{tenantId}/{hash 앞2}/{uuid}.enc} 에 쓰고, file_ref(상대 경로)를 반환한다.
 *
 * <p>file 모듈(FileUploadService)은 평문 저장·user 앵커라 재활용 불가 — 캐시 blob 은 테넌트 dedup·암호화·독립 TTL 수명을 가져야 하므로
 * 전용 저장소를 둔다.
 */
@Component
public class MailAttachmentBlobStore {

  private final EncryptionService encryption;
  private final Path baseDir;

  public MailAttachmentBlobStore(
      EncryptionService encryption,
      @Value("${app.mail.attachment-cache.dir:./data/mail-attachment-cache}") String dir) {
    this.encryption = encryption;
    this.baseDir = Path.of(dir).toAbsolutePath().normalize();
  }

  /** 평문 바이너리를 암호화해 저장하고 상대 file_ref 를 반환한다. */
  public String store(long tenantId, String contentHash, byte[] plain) {
    String prefix = contentHash.length() >= 2 ? contentHash.substring(0, 2) : "00";
    String rel = "tenant-" + tenantId + "/" + prefix + "/" + UUID.randomUUID() + ".enc";
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
