package com.workplace.fileai.dto;

import com.workplace.global.outbound.InternalResponses;

/**
 * 모델 입력용으로 그린 첨부 이미지(WP-250) — 워커 렌더 응답과 보기 서비스 결과가 같은 모양이라 이 하나를 같이 쓴다.
 *
 * @param data 이미지 바이트(PNG 또는 JPEG)
 * @param contentType "image/png" 또는 "image/jpeg"
 * @param pageCount PDF 전체 쪽수 — 이미지이거나 아직 모르면 null
 */
public record ViewImage(byte[] data, String contentType, Integer pageCount) {

  /** 쪽수 헤더 이름 — 워커 응답에서 읽고, /view 응답으로 웹·ai-agent 에 같은 이름으로 내보낸다. */
  public static final String PAGE_COUNT_HEADER = InternalResponses.PAGE_COUNT_HEADER;

  /**
   * 보기 이미지 형식 — 워커 계약은 PNG·JPEG 둘뿐이다. 캐시 파일 확장자와 Content-Type 을 이 표 하나로 오가게 해, 새로 그린 응답과 캐시 적중이 같은
   * Content-Type 을 돌려주게 한다.
   */
  public enum Format {
    PNG("png", "image/png"),
    JPEG("jpg", "image/jpeg");

    private final String extension;
    private final String contentType;

    Format(String extension, String contentType) {
      this.extension = extension;
      this.contentType = contentType;
    }

    /** 캐시 파일 확장자(점 없음). */
    public String extension() {
      return extension;
    }

    /** 정확한 Content-Type("image/png"·"image/jpeg"). */
    public String contentType() {
      return contentType;
    }

    /** 파라미터를 뗀 소문자 mime → 형식. JPEG 별칭(image/jpg·image/pjpeg)도 받는다. 둘 다 아니면 null. */
    public static Format ofMime(String baseMime) {
      return switch (baseMime) {
        case "image/png" -> PNG;
        case "image/jpeg", "image/jpg", "image/pjpeg" -> JPEG;
        default -> null;
      };
    }
  }
}
