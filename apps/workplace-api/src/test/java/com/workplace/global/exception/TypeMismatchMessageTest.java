package com.workplace.global.exception;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.dto.ErrorResponse;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.core.MethodParameter;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * 형식 오류(MethodArgumentTypeMismatchException·바인딩 실패) 안내 문구 매핑 단위 테스트(WP-1394).
 *
 * <p>자바 타입 이름 대신 「무엇이어야 하는지」를 사람이 읽는 말로 돌려주는지, 기본형·박싱형이 같은 문구로 가는지, 타입을 모를 때 기본 문구로 가는지, 컬렉션·배열
 * 파라미터는 원소 타입으로 안내하는지 확인한다. 실제 엔드포인트 경로는 {@link TypeMismatchIntegrationTest} 가 본다.
 */
class TypeMismatchMessageTest {

  /** enum 문구 확인용 — API 가 받는 상수 이름이 그대로 나열돼야 한다. */
  enum Sample {
    OPEN,
    CLOSED,
    ARCHIVED
  }

  /** 바인딩 실패 경로 확인용 폼 객체 — long 필드에 문자를 넣은 상황을 흉내 낸다. */
  public static class Form {
    private long count;
    private String name;

    public long getCount() {
      return count;
    }

    public void setCount(long count) {
      this.count = count;
    }

    public String getName() {
      return name;
    }

    public void setName(String name) {
      this.name = name;
    }
  }

  /** 원소 타입 해석 확인용 핸들러 시그니처 — 파라미터 0: List&lt;Long&gt;, 1: UUID[], 2: List(원소 모름), 3: int. */
  @SuppressWarnings({"unused", "rawtypes"})
  void sample(List<Long> ids, UUID[] keys, List raw, int number) {}

  private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

  @Test
  void 정수_타입은_기본형_박싱형_모두_정수여야_합니다() {
    for (Class<?> type :
        List.<Class<?>>of(
            byte.class,
            short.class,
            int.class,
            long.class,
            Byte.class,
            Short.class,
            Integer.class,
            Long.class,
            BigInteger.class)) {
      assertThat(GlobalExceptionHandler.typeMismatchMessage(type))
          .as(type.getName())
          .isEqualTo("정수여야 합니다.");
    }
  }

  @Test
  void 소수를_받는_타입은_숫자여야_합니다() {
    for (Class<?> type :
        List.<Class<?>>of(float.class, double.class, Float.class, Double.class, BigDecimal.class)) {
      assertThat(GlobalExceptionHandler.typeMismatchMessage(type))
          .as(type.getName())
          .isEqualTo("숫자여야 합니다.");
    }
  }

  @Test
  void 날짜시간_날짜_시간은_각각의_형식을_안내한다() {
    assertThat(GlobalExceptionHandler.typeMismatchMessage(LocalDateTime.class))
        .isEqualTo("날짜·시간 형식(예: 2026-01-31T09:00:00)이어야 합니다.");
    // 시간대가 필요한 타입은 Z 예시 — '+' 오프셋은 쿼리 문자열에서 공백으로 풀려 예시로 쓰지 않는다.
    for (Class<?> type :
        List.<Class<?>>of(OffsetDateTime.class, ZonedDateTime.class, Instant.class)) {
      assertThat(GlobalExceptionHandler.typeMismatchMessage(type))
          .isEqualTo("날짜·시간 형식(예: 2026-01-31T00:00:00Z)이어야 합니다.");
    }
    assertThat(GlobalExceptionHandler.typeMismatchMessage(LocalDate.class))
        .isEqualTo("날짜 형식(YYYY-MM-DD)이어야 합니다.");
    assertThat(GlobalExceptionHandler.typeMismatchMessage(LocalTime.class))
        .isEqualTo("시간 형식(예: 09:00)이어야 합니다.");
  }

  @Test
  void boolean_은_true_또는_false() {
    assertThat(GlobalExceptionHandler.typeMismatchMessage(boolean.class))
        .isEqualTo("true 또는 false 여야 합니다.");
    assertThat(GlobalExceptionHandler.typeMismatchMessage(Boolean.class))
        .isEqualTo("true 또는 false 여야 합니다.");
  }

  @Test
  void UUID_는_UUID_형식() {
    assertThat(GlobalExceptionHandler.typeMismatchMessage(UUID.class)).isEqualTo("UUID 형식이어야 합니다.");
  }

  @Test
  void enum_은_받는_값_목록을_나열한다() {
    assertThat(GlobalExceptionHandler.typeMismatchMessage(Sample.class))
        .isEqualTo("다음 중 하나여야 합니다: OPEN, CLOSED, ARCHIVED");
  }

  @Test
  void 타입을_모르거나_목록에_없으면_올바른_형식이_아닙니다() {
    assertThat(GlobalExceptionHandler.typeMismatchMessage(null)).isEqualTo("올바른 형식이 아닙니다.");
    assertThat(GlobalExceptionHandler.typeMismatchMessage(List.class)).isEqualTo("올바른 형식이 아닙니다.");
    assertThat(GlobalExceptionHandler.typeMismatchMessage(String.class)).isEqualTo("올바른 형식이 아닙니다.");
  }

  @Test
  void 컬렉션_배열_파라미터는_원소_타입으로_안내한다() throws Exception {
    Method m =
        getClass().getDeclaredMethod("sample", List.class, UUID[].class, List.class, int.class);
    // List<Long> → Long, UUID[] → UUID
    assertThat(GlobalExceptionHandler.mismatchTargetType(mismatch(m, 0, List.class)))
        .isEqualTo(Long.class);
    assertThat(GlobalExceptionHandler.mismatchTargetType(mismatch(m, 1, UUID[].class)))
        .isEqualTo(UUID.class);
    // 원소 타입을 모르는 raw List 는 requiredType 으로 돌아간다.
    assertThat(GlobalExceptionHandler.mismatchTargetType(mismatch(m, 2, List.class)))
        .isEqualTo(List.class);
    // 컬렉션이 아닌 파라미터·파라미터 정보 없음은 requiredType 그대로.
    assertThat(GlobalExceptionHandler.mismatchTargetType(mismatch(m, 3, int.class)))
        .isEqualTo(int.class);
    assertThat(
            GlobalExceptionHandler.mismatchTargetType(
                new MethodArgumentTypeMismatchException("x", Long.class, "id", null, null)))
        .isEqualTo(Long.class);
  }

  @Test
  void 바인딩_실패는_필드_타입_안내로_바꾸고_제약_위반은_그대로_둔다() throws Exception {
    BeanPropertyBindingResult result = new BeanPropertyBindingResult(new Form(), "form");
    // bindingFailure=true — Spring 기본 문구는 자바 타입 이름이 든 "Failed to convert…" 다.
    result.addError(
        new FieldError(
            "form",
            "count",
            "abc",
            true,
            null,
            null,
            "Failed to convert property value of type 'java.lang.String' to required type 'long'"));
    result.addError(new FieldError("form", "name", "비어 있을 수 없습니다"));
    Method m =
        getClass().getDeclaredMethod("sample", List.class, UUID[].class, List.class, int.class);
    MethodArgumentNotValidException ex =
        new MethodArgumentNotValidException(new MethodParameter(m, 0), result);

    ResponseEntity<ErrorResponse> res =
        handler.handleValidationExceptions(ex, new MockHttpServletRequest("POST", "/x"));

    assertThat(res.getBody()).isNotNull();
    assertThat(res.getBody().errors())
        .containsEntry("count", "정수여야 합니다.")
        .containsEntry("name", "비어 있을 수 없습니다");
  }

  /** 지정한 파라미터에서 형식 오류가 난 예외를 만든다. */
  private static MethodArgumentTypeMismatchException mismatch(
      Method m, int index, Class<?> requiredType) {
    return new MethodArgumentTypeMismatchException(
        "abc", requiredType, "p" + index, new MethodParameter(m, index), null);
  }
}
