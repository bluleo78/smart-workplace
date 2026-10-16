package com.workplace.filepreview.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Optional;

/**
 * 저장된 변환 결과 파일의 속성과 ETag(WP-432) — 드라이브·메일 대상이 {@link PreviewTarget#loadResult()} 에서 같은 규칙으로 쓴다.
 *
 * @param sizeBytes 결과 파일 크기(메일은 암호문 크기)
 * @param lastModifiedMillis 결과 파일 수정 시각 — 다시 변환하면 바뀐다
 * @param etag {@code <id>-<엔진버전>-<수정시각>} — 원본(id)·엔진·재변환 중 하나라도 바뀌면 다른 값이 된다
 */
public record PreviewResultFile(long sizeBytes, long lastModifiedMillis, String etag) {

  /**
   * 결과 파일 속성을 한 번의 조회로 읽는다. 없거나 읽을 수 없으면(어떤 {@link IOException} 이든) empty — 엔진이 READY 행을 되돌려 다시
   * 변환한다(드라이브·메일 같은 정책).
   *
   * @param id 원본 식별자(드라이브 core file id, 메일 content hash)
   * @param engineVersion 현재 엔진 버전 — READY 로 응답하는 건 현재 엔진 결과뿐이라(바뀐 READY 는 다시 변환) 설정값을 쓴다
   */
  public static Optional<PreviewResultFile> read(Path path, String id, String engineVersion) {
    try {
      BasicFileAttributes attrs = Files.readAttributes(path, BasicFileAttributes.class);
      long modified = attrs.lastModifiedTime().toMillis();
      return Optional.of(
          new PreviewResultFile(attrs.size(), modified, id + "-" + engineVersion + "-" + modified));
    } catch (IOException e) {
      return Optional.empty();
    }
  }
}
