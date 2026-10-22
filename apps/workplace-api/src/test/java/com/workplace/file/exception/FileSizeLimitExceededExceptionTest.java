package com.workplace.file.exception;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 크기 초과 안내 문구(WP-834) — 영문 범주·바이트 수 대신 한국어 범주 이름·읽을 수 있는 한도·파일 이름. */
class FileSizeLimitExceededExceptionTest {

  /** 범주마다 한국어 이름, 미분류(OTHER)는 「이 형식의」. */
  @Test
  void message_usesKoreanCategoryLabels() {
    assertThat(FileSizeLimitExceededException.message("OTHER", 25L << 20, "backup.zip"))
        .isEqualTo("이 형식의 파일은 최대 25MB까지 업로드할 수 있습니다: backup.zip");
    assertThat(FileSizeLimitExceededException.message("PDF", 100L << 20, "scan.pdf"))
        .isEqualTo("PDF 파일은 최대 100MB까지 업로드할 수 있습니다: scan.pdf");
    assertThat(FileSizeLimitExceededException.message("DATA", 256L << 20, "rows.csv"))
        .isEqualTo("데이터 파일은 최대 256MB까지 업로드할 수 있습니다: rows.csv");
  }

  /** 모르는 범주도 영문 이름을 내보내지 않는다. */
  @Test
  void message_unknownCategoryFallsBackToGenericLabel() {
    assertThat(FileSizeLimitExceededException.message("MAIL_EXTRACT", 7L << 20, "a.bin"))
        .isEqualTo("이 형식의 파일은 최대 7MB까지 업로드할 수 있습니다: a.bin");
  }

  /** 딱 떨어지지 않는 한도는 소수 한 자리, 1MB 미만은 KB·B — 「0MB」로 읽히지 않게. */
  @Test
  void message_formatsNonRoundLimits() {
    assertThat(FileSizeLimitExceededException.message("IMAGE", (19L << 20) / 2, null))
        .isEqualTo("이미지 파일은 최대 9.5MB까지 업로드할 수 있습니다");
    assertThat(FileSizeLimitExceededException.message("IMAGE", 512L * 1024, null))
        .isEqualTo("이미지 파일은 최대 512KB까지 업로드할 수 있습니다");
    assertThat(FileSizeLimitExceededException.message("IMAGE", 200, ""))
        .isEqualTo("이미지 파일은 최대 200B까지 업로드할 수 있습니다");
  }
}
