package com.workplace.global.util;

import java.util.Locale;

/**
 * 바이트 수를 사람이 읽기 쉬운 단위(B/KB/MB/GB)로 변환한다.
 *
 * <p>프론트엔드 {@code apps/workplace-web/src/lib/formatters.ts} 의 {@code formatFileSize()} 와 동일한
 * 임계값·소수점 규칙을 사용한다 — 백엔드가 생성하는 에러 메시지(예: 드라이브 쿼터 초과, #821)에서도 원시 정수를 그대로 노출하지 않기 위함.
 */
public final class FileSizeFormatter {

  private static final long KB = 1024L;
  private static final long MB = KB * 1024L;
  private static final long GB = MB * 1024L;

  private FileSizeFormatter() {}

  /**
   * 바이트 수를 "12.3 MB" 형태의 문자열로 변환.
   *
   * @param bytes 변환할 바이트 수 (음수는 절대값 기준으로 단위만 선택, 부호는 그대로 유지)
   * @return 사람이 읽기 쉬운 크기 문자열
   */
  public static String format(long bytes) {
    long abs = Math.abs(bytes);
    if (abs < KB) {
      return bytes + " B";
    }
    if (abs < MB) {
      return String.format(Locale.ROOT, "%.1f KB", bytes / (double) KB);
    }
    if (abs < GB) {
      return String.format(Locale.ROOT, "%.1f MB", bytes / (double) MB);
    }
    return String.format(Locale.ROOT, "%.1f GB", bytes / (double) GB);
  }
}
