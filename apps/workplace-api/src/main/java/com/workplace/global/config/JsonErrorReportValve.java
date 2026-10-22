package com.workplace.global.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.dto.ErrorResponse;
import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicBoolean;
import org.apache.catalina.connector.Request;
import org.apache.catalina.connector.Response;
import org.apache.catalina.valves.ErrorReportValve;
import org.apache.coyote.ActionCode;
import org.springframework.http.HttpStatus;

/**
 * Tomcat 이 앱 핸들러에 닿기 전에 거절한 요청(요청 줄·머리글이 너무 김, 경로의 인코딩된 슬래시 등)의 오류 본문을 앱 공통 형식({@link
 * ErrorResponse})의 한국어 JSON 으로 쓴다(WP-732).
 *
 * <p>기본 ErrorReportValve 는 「HTTP Status 400 – Bad Request」 영어 HTML 페이지를 써서, 화면은 원인을 알 수 없는 일반 실패
 * 문구만 보였다(검색칸에 한글 약 880자를 넘게 넣으면 목록이 통째로 실패). 앱이 이미 본문을 쓴 응답은 건드리지 않는다. 예외 내용·서버 정보는 싣지 않는다.
 */
public class JsonErrorReportValve extends ErrorReportValve {

  private static final ObjectMapper JSON = new ObjectMapper();

  @Override
  protected void report(Request request, Response response, Throwable throwable) {
    int status = response.getStatus();
    if (status < 400 || response.getContentWritten() > 0) {
      return;
    }
    // 연결이 이미 닫혔으면(쓸 수 없으면) 기본 밸브처럼 아무것도 쓰지 않는다.
    AtomicBoolean ioAllowed = new AtomicBoolean(true);
    response.getCoyoteResponse().action(ActionCode.IS_IO_ALLOWED, ioAllowed);
    if (!ioAllowed.get()) {
      return;
    }
    HttpStatus http = HttpStatus.resolve(status);
    ErrorResponse body =
        new ErrorResponse(
            status,
            http != null ? http.getReasonPhrase() : String.valueOf(status),
            messageFor(status),
            null,
            Instant.now().toString(),
            request.getRequestURI());
    try {
      response.setContentType("application/json");
      response.setCharacterEncoding(StandardCharsets.UTF_8.name());
      Writer writer = response.getReporter();
      if (writer != null) {
        writer.write(JSON.writeValueAsString(body));
        response.finishResponse();
      }
    } catch (IOException | IllegalStateException e) {
      // 기본 밸브와 같이 오류 본문을 못 써도 상태 코드는 이미 나갔으므로 무시한다.
    }
  }

  /** 상태별 한국어 안내 — 컨테이너 단계 거절은 대부분 400(요청 줄·머리글 한도, 잘못된 경로)이다. */
  static String messageFor(int status) {
    return switch (status) {
      case 400 -> "요청 주소나 머리글이 너무 길거나 형식이 올바르지 않습니다. 검색어 등 입력을 줄여 다시 시도해 주세요.";
      case 404 -> "요청한 주소를 찾을 수 없습니다.";
      case 405 -> "허용되지 않은 요청 방식입니다.";
      case 408 -> "요청 시간이 초과되었습니다. 다시 시도해 주세요.";
      case 413 -> "요청이 너무 큽니다.";
      case 414 -> "요청 주소가 너무 깁니다. 검색어 등 입력을 줄여 다시 시도해 주세요.";
      case 431 -> "요청 머리글이 너무 큽니다.";
      case 503 -> "서버를 잠시 사용할 수 없습니다. 잠시 뒤 다시 시도해 주세요.";
      default -> status >= 500 ? "서버에서 요청을 처리하지 못했습니다." : "요청을 처리할 수 없습니다.";
    };
  }
}
