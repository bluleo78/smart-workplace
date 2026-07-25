package com.workplace.fileai;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 추출 가능 판정 단일 소스 단위 테스트 — 워커 extract.py::_dispatch 와 목록이 일치해야 한다. */
class ExtractableTypesTest {

  @Test
  @DisplayName("텍스트 계열은 모두 지원 — html 포함(#735 진범)")
  void supportsTextFamily() {
    assertThat(ExtractableTypes.supports("text/html")).isTrue();
    assertThat(ExtractableTypes.supports("text/plain")).isTrue();
    assertThat(ExtractableTypes.supports("text/x-python")).isTrue();
    assertThat(ExtractableTypes.supports("application/json")).isTrue();
    assertThat(ExtractableTypes.supports("application/x-yaml")).isTrue();
  }

  @Test
  @DisplayName("오피스·한글·레거시 OLE 지원")
  void supportsDocuments() {
    assertThat(ExtractableTypes.supports("application/pdf")).isTrue();
    assertThat(
            ExtractableTypes.supports(
                "application/vnd.openxmlformats-officedocument.presentationml.presentation"))
        .isTrue();
    assertThat(ExtractableTypes.supports("application/x-hwp")).isTrue();
    assertThat(ExtractableTypes.supports("application/hwp+zip")).isTrue();
    assertThat(ExtractableTypes.supports("application/msword")).isTrue();
    assertThat(ExtractableTypes.supports("application/vnd.ms-powerpoint")).isTrue();
  }

  @Test
  @DisplayName("이미지·미지원은 각각 다른 사유 문자열")
  void skipReasons() {
    assertThat(ExtractableTypes.supports("image/png")).isFalse();
    assertThat(ExtractableTypes.skipReason("image/png")).isEqualTo("image:image/png");
    assertThat(ExtractableTypes.supports("application/zip")).isFalse();
    assertThat(ExtractableTypes.skipReason("application/zip"))
        .isEqualTo("unsupported-mime:application/zip");
  }

  @Test
  @DisplayName("null·빈 mime 은 미지원으로 처리(NPE 없음)")
  void nullSafe() {
    assertThat(ExtractableTypes.supports(null)).isFalse();
    assertThat(ExtractableTypes.supports("")).isFalse();
  }
}
