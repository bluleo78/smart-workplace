package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.security.TestEncryptionFactory;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
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
    var store = new MailAttachmentBlobStore(enc, dir.toString());
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
    var store = new MailAttachmentBlobStore(enc, dir.toString());
    String ref = store.store(7L, "h", "x".getBytes(StandardCharsets.UTF_8));
    // mail 세그먼트 포함 경로로 파일이 존재해야 함
    assertThat(ref).contains("/mail/");
    assertThat(Files.exists(store.resolve(ref))).isTrue();
    store.delete(ref);
    assertThat(Files.exists(store.resolve(ref))).isFalse();
  }
}
