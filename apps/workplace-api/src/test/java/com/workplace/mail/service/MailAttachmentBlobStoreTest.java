package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.file.storage.FileStore;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.security.TestEncryptionFactory;
import com.workplace.mail.repository.MailPreviewKey;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 디스크 blob 저장이 암호화되고(평문 디스크 미존재) 왕복·삭제가 동작하는지 검증. Spring 컨텍스트 없이 임시 디렉터리.
 *
 * <p>ref 형식: {@code tenant-{id}/mail/{prefix}/{uuid}.enc} — mail 세그먼트 포함.
 */
class MailAttachmentBlobStoreTest {

  private final EncryptionService enc = TestEncryptionFactory.withDevKey();

  @Test
  void store_load_왕복하고_디스크는_암호화됨(@TempDir Path dir) throws Exception {
    // rootDir(통합 스토리지 루트)를 생성자에 전달
    var store = new MailAttachmentBlobStore(enc, new FileStore(dir.toString()));
    byte[] plain = "secret attachment 본문".getBytes(StandardCharsets.UTF_8);

    String ref = store.store(7L, "abc123hash", plain);

    // ref 형식: tenant-{id}/mail/{prefix}/{uuid}.enc
    assertThat(ref).startsWith("tenant-7/mail/");
    assertThat(ref).endsWith(".enc");
    // 디스크 파일은 평문을 포함하지 않는다(암호화).
    byte[] onDisk = Files.readAllBytes(store.resolve(ref));
    assertThat(onDisk).isNotEqualTo(plain);
    assertThat(new String(onDisk, StandardCharsets.UTF_8)).doesNotContain("secret attachment");
    // load 는 평문 복원.
    assertThat(store.load(ref)).isEqualTo(plain);
  }

  @Test
  void delete_파일제거(@TempDir Path dir) throws Exception {
    var store = new MailAttachmentBlobStore(enc, new FileStore(dir.toString()));
    String ref = store.store(7L, "h", "x".getBytes(StandardCharsets.UTF_8));
    // mail 세그먼트 포함 경로로 파일이 존재해야 함
    assertThat(ref).contains("/mail/");
    assertThat(Files.exists(store.resolve(ref))).isTrue();
    store.delete(ref);
    assertThat(Files.exists(store.resolve(ref))).isFalse();
  }

  // ── 미리보기 PDF(WP-432) ──

  /** 64자 hex 해시 — previewRef 가 앞 2자를 디렉터리로 쓴다. */
  private static final String HASH = "ab" + "0".repeat(62);

  private static byte[] pdf(String body) {
    return ("%PDF-1.7\n" + body + "\n%%EOF").getBytes(StandardCharsets.UTF_8);
  }

  @Test
  void 미리보기는_암호화돼_저장되고_복호화하면_원본_PDF(@TempDir Path dir) throws Exception {
    var store = new MailAttachmentBlobStore(enc, new FileStore(dir.toString()));
    byte[] input = pdf("변환된 한글 문서");

    store.storePreview(new MailPreviewKey(7L, HASH), input);

    // 경로는 MailPreviewKey.previewRef() 의 결정적 경로와 일치한다.
    Path file = store.resolve(new MailPreviewKey(7L, HASH).previewRef());
    assertThat(file).exists();
    // 디스크 원시 바이트는 평문 PDF 가 아니다(%PDF 헤더 없음).
    byte[] onDisk = Files.readAllBytes(file);
    assertThat(new String(onDisk, 0, 4, StandardCharsets.ISO_8859_1)).isNotEqualTo("%PDF");
    assertThat(onDisk).isNotEqualTo(input);
    // 복호화하면 원본 그대로.
    assertThat(store.loadPreview(new MailPreviewKey(7L, HASH))).contains(input);
  }

  @Test
  void 같은_해시로_다시_저장하면_덮어쓴다(@TempDir Path dir) throws Exception {
    var store = new MailAttachmentBlobStore(enc, new FileStore(dir.toString()));
    byte[] second = pdf("두 번째");

    store.storePreview(new MailPreviewKey(7L, HASH), pdf("첫 번째"));
    store.storePreview(new MailPreviewKey(7L, HASH), second);

    // 임시 파일 찌꺼기 없이 결정적 경로 파일 하나만 남는다.
    Path parent = store.resolve(new MailPreviewKey(7L, HASH).previewRef()).getParent();
    try (Stream<Path> files = Files.list(parent)) {
      assertThat(files.filter(Files::isRegularFile).count()).isEqualTo(1);
    }
    assertThat(store.loadPreview(new MailPreviewKey(7L, HASH))).contains(second);
  }

  @Test
  void 없으면_empty(@TempDir Path dir) {
    var store = new MailAttachmentBlobStore(enc, new FileStore(dir.toString()));

    assertThat(store.loadPreview(new MailPreviewKey(7L, HASH))).isEmpty();
  }

  @Test
  void 복호화_실패면_empty(@TempDir Path dir) throws Exception {
    var store = new MailAttachmentBlobStore(enc, new FileStore(dir.toString()));
    Path file = store.resolve(new MailPreviewKey(7L, HASH).previewRef());
    Files.createDirectories(file.getParent());
    // IV 길이(12)보다 긴 쓰레기 — GCM 태그 검증에서 실패해야 한다.
    Files.write(file, "garbage-bytes-not-encrypted-at-all".getBytes(StandardCharsets.UTF_8));

    assertThat(store.loadPreview(new MailPreviewKey(7L, HASH))).isEmpty();
  }

  @Test
  void 미리보기_삭제는_파일을_지우고_없어도_던지지_않는다(@TempDir Path dir) {
    var store = new MailAttachmentBlobStore(enc, new FileStore(dir.toString()));
    store.storePreview(new MailPreviewKey(7L, HASH), pdf("x"));

    store.deletePreview(new MailPreviewKey(7L, HASH));
    store.deletePreview(new MailPreviewKey(7L, HASH)); // 이미 없음 — 변환 작업의 CAS 실패 정리가 경합해도 안전

    assertThat(store.resolve(new MailPreviewKey(7L, HASH).previewRef())).doesNotExist();
    assertThat(store.loadPreview(new MailPreviewKey(7L, HASH))).isEmpty();
  }
}
