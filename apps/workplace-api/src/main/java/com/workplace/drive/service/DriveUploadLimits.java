package com.workplace.drive.service;

import com.workplace.file.service.FileUploadService;
import com.workplace.file.service.MimeNormalizer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.unit.DataSize;

/**
 * 드라이브에 한 번에 올릴 수 있는 파일 크기 규칙을 한 곳에 둔다 — 이름·MIME 으로 정한 범주 상한(file core 와 같은 규칙)과 멀티파트 상한
 * (spring.servlet.multipart.max-file-size, 100MB) 중 작은 값. 업로드 링크(WP-515)와 메일 첨부 저장(WP-1400)처럼 멀티파트를
 * 거치지 않는 바이트 경로도 같은 상한을 걸게 해, 범주 상한(DATA 256MB 등)이 더 커도 드라이브에 직접 올릴 수 없는 크기는 받지 않는다.
 */
@Component
public class DriveUploadLimits {

  /** 멀티파트 파일 상한(바이트). */
  private final long multipartMaxBytes;

  public DriveUploadLimits(
      @Value("${spring.servlet.multipart.max-file-size:100MB}") String multipartMaxFileSize) {
    this.multipartMaxBytes = DataSize.parse(multipartMaxFileSize).toBytes();
  }

  /**
   * 이 파일에 받을 최대 바이트.
   *
   * @param fileName 파일 이름(확장자로 MIME 보정)
   * @param bareMime 매개변수를 뗀 Content-Type(없으면 null — 확장자로 정한다)
   */
  public long capFor(String fileName, String bareMime) {
    String mime = MimeNormalizer.normalize(fileName, bareMime);
    return Math.min(
        FileUploadService.sizeLimitOf(FileUploadService.categoryOf(mime)), multipartMaxBytes);
  }
}
