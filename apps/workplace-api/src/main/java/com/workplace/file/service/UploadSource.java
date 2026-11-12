package com.workplace.file.service;

import com.workplace.file.storage.FileStore;
import java.nio.file.Path;
import org.springframework.web.multipart.MultipartFile;

/**
 * 업로드 바이트 출처(WP-369) — 멀티파트 파일·바이트 배열(텍스트로 만들기)·디스크 파일(업로드 링크 PUT 본문을 받아 둔 임시 파일)을 {@link
 * FileUploadService} 의 같은 저장 경로(이름 정리·MIME 정규화·크기 상한·FILE 행)로 보낸다.
 *
 * @param originalName 원본 파일명(정리 전). 저장 시 {@code SafeFileNames.sanitize} 를 거친다
 * @param contentType 클라이언트가 알려준 MIME(없으면 null — 확장자로 정한다)
 * @param size 바이트 수(크기 상한·할당량 검사용)
 * @param writer 저장 경로에 바이트를 쓰는 방법
 */
public record UploadSource(String originalName, String contentType, long size, Writer writer) {

  /** 저장소의 상대 경로에 바이트를 쓴다. */
  @FunctionalInterface
  public interface Writer {
    void writeTo(FileStore store, String relativePath);
  }

  /**
   * 이미 저장소에 써 둔 바이트(WP-1519) — {@link FileUploadService#stage} 가 트랜잭션·테넌트 잠금 밖에서 blob 을 먼저 쓰고 이 표시로
   * 바꾼다. 저장 핵심은 이 경로를 그대로 FILE 행에 묶어 잠금 아래에서 바이트를 다시 옮기지 않는다(1GB 동영상 복사 동안 테넌트 업로드가 줄 서지 않게). 다른
   * 경로로 써야 할 때만 저장소 안에서 복사한다(지금은 쓰지 않는 안전한 기본 동작).
   *
   * @param relativePath 저장소 루트 기준 상대 경로
   */
  public record Staged(String relativePath) implements Writer {
    @Override
    public void writeTo(FileStore store, String path) {
      store.copy(relativePath, path);
    }
  }

  /** 멀티파트 업로드(기존 경로). */
  public static UploadSource of(MultipartFile file) {
    return new UploadSource(
        file.getOriginalFilename(),
        file.getContentType(),
        file.getSize(),
        (store, path) -> store.store(path, file));
  }

  /** 메모리의 바이트(텍스트로 파일 만들기). */
  public static UploadSource ofBytes(String name, String contentType, byte[] bytes) {
    return new UploadSource(
        name, contentType, bytes.length, (store, path) -> store.storeBytes(path, bytes));
  }

  /** 디스크 파일(업로드 링크 PUT 본문을 받아 둔 임시 파일). 원본 임시 파일 정리는 호출부 몫이다. */
  public static UploadSource ofFile(String name, String contentType, Path file, long size) {
    return new UploadSource(name, contentType, size, (store, path) -> store.storeFrom(path, file));
  }
}
