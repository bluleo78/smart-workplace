package com.workplace.global.exception;

import com.workplace.global.dto.ErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.method.annotation.ExceptionHandlerMethodResolver;

/**
 * 예외 → (HTTP 상태, 사용자 문구) 변환기. 응답으로 던지지 않고 예외를 "기록"해야 하는 곳(#843 확인카드 승인 실패를 대화 이력에 남기기)이
 * GlobalExceptionHandler 와 똑같은 상태·문구를 얻기 위해 쓴다.
 *
 * <p>매핑 표를 복제하지 않고 {@link GlobalExceptionHandler} 의 {@code @ExceptionHandler} 해석 규칙(가장 구체적인 예외 타입
 * 우선)을 Spring 의 {@link ExceptionHandlerMethodResolver} 로 그대로 재사용한다 — 핸들러가 추가·변경되면 기록 문구도 자동으로 따라간다.
 * 핸들러는 전부 {@code (예외, HttpServletRequest)} 시그니처라 반사 호출이 단순하다.
 */
@Component
@RequiredArgsConstructor
public class ApiErrorDescriber {

  private static final ExceptionHandlerMethodResolver RESOLVER =
      new ExceptionHandlerMethodResolver(GlobalExceptionHandler.class);

  private final GlobalExceptionHandler handler;

  /** 변환 결과 — status 는 HTTP 상태 코드, message 는 클라이언트가 표시할 문구(필드 오류가 있으면 첫 필드 사유). */
  public record ApiError(int status, String message) {}

  /** 예외를 GlobalExceptionHandler 와 같은 규칙으로 (상태, 문구)로 바꾼다. 요청 스레드 안에서 호출해야 한다(핸들러가 요청 URI 를 읽음). */
  public ApiError describe(Exception ex) {
    Method method = RESOLVER.resolveMethodByThrowable(ex);
    HttpServletRequest request =
        ((ServletRequestAttributes) RequestContextHolder.currentRequestAttributes()).getRequest();
    try {
      @SuppressWarnings("unchecked")
      ResponseEntity<ErrorResponse> res =
          (ResponseEntity<ErrorResponse>) method.invoke(handler, ex, request);
      if (res == null) {
        // 캐치올은 클라이언트 연결 종료로 판정하면 응답을 만들지 않는다(null) — 원인 불명 500 으로 취급.
        return new ApiError(500, null);
      }
      ErrorResponse body = res.getBody();
      // 웹 api-error.ts 와 같은 우선순위: 필드 오류 첫 값 → message.
      Map<String, String> errors = body == null ? null : body.errors();
      String message =
          errors != null && !errors.isEmpty()
              ? errors.values().iterator().next()
              : body == null ? null : body.message();
      return new ApiError(res.getStatusCode().value(), message);
    } catch (IllegalAccessException | InvocationTargetException e) {
      // 핸들러 자체가 실패하는 경우는 사실상 없지만, 기록 경로가 원래 예외를 가리지 않도록 500 으로 수렴.
      return new ApiError(500, null);
    }
  }
}
