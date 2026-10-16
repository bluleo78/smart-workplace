package com.workplace.global.outbound;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

/**
 * 내부 파이썬 서비스(워커 /render·변환 서비스 /convert) 응답 해석 공용 도우미(WP-431).
 *
 * <p>왜: 두 서비스 모두 FastAPI 라 오류 본문이 {@code {"detail":{"code":..}}} 로 같고, 요청 검증 실패는 detail 이 목록이며, PDF
 * 쪽수를 같은 헤더로 알린다. 클라이언트마다 따로 해석하면 목록형 detail 처리 같은 함정을 한쪽만 고치게 된다.
 */
public final class InternalResponses {

  /** PDF 전체 쪽수 헤더(워커·변환 서비스 응답, API 의 이미지 응답 공통). */
  public static final String PAGE_COUNT_HEADER = "X-Page-Count";

  private static final ObjectMapper MAPPER = new ObjectMapper();

  /** 로그에 남길 본문 최대 길이. */
  private static final int LOG_BODY_MAX = 500;

  private InternalResponses() {}

  /**
   * 오류 본문의 {@code detail} 객체. JSON 이 아니거나 detail 이 객체가 아니면(FastAPI 요청 검증 실패는 목록) null.
   *
   * @param body 응답 본문
   */
  public static JsonNode errorDetail(byte[] body) {
    try {
      JsonNode detail = MAPPER.readTree(body).path("detail");
      return detail.isObject() ? detail : null;
    } catch (IOException e) {
      return null;
    }
  }

  /** 오류 본문 {@code {"detail":{"code":..}}} 의 코드. 형식이 다르면 null. */
  public static String errorCode(byte[] body) {
    JsonNode detail = errorDetail(body);
    return detail == null ? null : detail.path("code").asText(null);
  }

  /** {@link #PAGE_COUNT_HEADER} 값. 없거나 숫자가 아니면 null. */
  public static Integer pageCount(HttpResponse<?> resp) {
    return resp.headers()
        .firstValue(PAGE_COUNT_HEADER)
        .map(InternalResponses::parseIntOrNull)
        .orElse(null);
  }

  /** 로그용 본문 자르기 — 예상 밖 응답이 커도 로그를 덮지 않게. */
  public static String abbreviate(byte[] body) {
    String s = new String(body, StandardCharsets.UTF_8);
    return s.length() <= LOG_BODY_MAX ? s : s.substring(0, LOG_BODY_MAX) + "…";
  }

  private static Integer parseIntOrNull(String s) {
    try {
      return Integer.valueOf(s.trim());
    } catch (NumberFormatException e) {
      return null;
    }
  }
}
