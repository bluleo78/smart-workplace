package com.workplace.file.exception;

import java.util.Map;

/**
 * 카테고리별 파일 크기 한도 초과 — HTTP 400 매핑.
 *
 * <p>문구는 웹이 그대로 토스트로 보여 주므로 사용자 말로 쓴다(WP-834) — 범주는 영문 enum(OTHER·IMAGE) 대신 한국어 이름, 한도는 MB, 여러 파일을
 * 함께 올려도 어느 파일인지 알게 파일 이름을 붙인다. 예: 「이 형식의 파일은 최대 25MB까지 업로드할 수 있습니다: backup.zip」.
 */
public class FileSizeLimitExceededException extends RuntimeException {

  private static final long MB = 1024L * 1024;

  /** 범주 → 문구에 쓰는 이름. 미분류(OTHER)는 범주 이름이 없어 「이 형식의」로 쓴다. */
  private static final Map<String, String> CATEGORY_LABELS =
      Map.of(
          "IMAGE", "이미지",
          "PDF", "PDF",
          "TEXT", "텍스트",
          "DATA", "데이터",
          "DOCUMENT", "문서",
          "OTHER", "이 형식의");

  /**
   * @param category 파일 범주(FileUploadService 의 IMAGE·PDF·TEXT·DATA·DOCUMENT·OTHER)
   * @param maxBytes 그 범주의 상한(바이트)
   * @param fileName 거절한 파일 이름(없으면 null — 이름을 붙이지 않는다)
   */
  public FileSizeLimitExceededException(String category, long maxBytes, String fileName) {
    super(message(category, maxBytes, fileName));
  }

  /**
   * 크기 초과 안내 문구 — 노트 이미지처럼 다른 예외로 거절하는 곳도 같은 문구를 쓴다.
   *
   * <p>예: 「이미지 파일은 최대 10MB까지 업로드할 수 있습니다: photo.png」.
   */
  public static String message(String category, long maxBytes, String fileName) {
    String label = CATEGORY_LABELS.getOrDefault(category, "이 형식의");
    String text = label + " 파일은 최대 " + formatSize(maxBytes) + "까지 업로드할 수 있습니다";
    return fileName == null || fileName.isBlank() ? text : text + ": " + fileName;
  }

  /**
   * 바이트 → 읽을 수 있는 크기. 1MB 이상은 MB(딱 떨어지면 정수 「25MB」, 아니면 소수 한 자리 「9.5MB」), 그보다 작으면 KB·B — 설정으로 작게 바꾼
   * 한도도 「0MB」로 읽히지 않게.
   */
  private static String formatSize(long bytes) {
    if (bytes >= MB) {
      return (bytes % MB == 0
              ? Long.toString(bytes / MB)
              : String.format("%.1f", bytes / (double) MB))
          + "MB";
    }
    return bytes >= 1024 ? (bytes / 1024) + "KB" : bytes + "B";
  }
}
