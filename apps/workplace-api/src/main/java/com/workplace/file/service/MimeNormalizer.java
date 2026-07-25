package com.workplace.file.service;

import com.workplace.file.storage.FilePathBuilder;
import java.util.Map;

/**
 * 업로드 경계 mime 정규화(#735). 브라우저가 확장자를 모르는 파일(.hwp/.hwpx 등)은 {@code application/octet-stream} 으로 보내는데,
 * 이 값이 그대로 저장되면 {@link com.workplace.fileai.ExtractableTypes} 가 추출 가능 여부를 판정할 수 없어 SKIPPED 로 굳는다.
 * 브라우저가 이미 구체적인 mime 을 알려준 경우는 그대로 신뢰하고, octet-stream(또는 빈 값)일 때만 파일명 확장자로 보정한다.
 *
 * <p>매핑 표는 계획서 Global Constraints "확장자 → mime 정규화 표"와 verbatim 일치해야 한다. V125 마이그레이션의 백필 CASE 문도 동일
 * 표를 미러하므로 한쪽만 고치면 드리프트가 발생한다.
 */
public final class MimeNormalizer {

  private MimeNormalizer() {}

  private static final Map<String, String> EXTENSION_TO_MIME =
      Map.ofEntries(
          Map.entry("html", "text/html"),
          Map.entry("htm", "text/html"),
          Map.entry("md", "text/markdown"),
          Map.entry("txt", "text/plain"),
          Map.entry("log", "text/plain"),
          Map.entry("csv", "text/csv"),
          Map.entry("json", "application/json"),
          Map.entry("xml", "application/xml"),
          Map.entry("yaml", "application/x-yaml"),
          Map.entry("yml", "application/x-yaml"),
          Map.entry("pdf", "application/pdf"),
          Map.entry(
              "docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
          Map.entry("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
          Map.entry(
              "pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
          Map.entry("doc", "application/msword"),
          Map.entry("xls", "application/vnd.ms-excel"),
          Map.entry("ppt", "application/vnd.ms-powerpoint"),
          Map.entry("hwpx", "application/hwp+zip"),
          Map.entry("hwp", "application/x-hwp"));

  /**
   * 파일명·브라우저 mime 으로 정규화된 mime 을 결정한다.
   *
   * @param fileName 원본 파일명(확장자 추출용)
   * @param browserMime 브라우저가 보낸 Content-Type. null/blank/octet-stream 이면 확장자로 폴백한다.
   * @return 정규화된 mime. 확장자를 모르면 browserMime(또는 octet-stream)을 그대로 반환한다.
   */
  public static String normalize(String fileName, String browserMime) {
    boolean needsFallback =
        browserMime == null
            || browserMime.isBlank()
            || browserMime.equals("application/octet-stream");
    if (!needsFallback) {
      return browserMime;
    }
    if (fileName != null) {
      String ext = FilePathBuilder.extensionOf(fileName).toLowerCase();
      String mapped = EXTENSION_TO_MIME.get(ext);
      if (mapped != null) {
        return mapped;
      }
    }
    return browserMime != null ? browserMime : "application/octet-stream";
  }
}
