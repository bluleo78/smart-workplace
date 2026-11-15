package com.workplace.global.json;

import java.io.IOException;
import java.io.Writer;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamWriteConstraints;
import tools.jackson.core.exc.JacksonIOException;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.json.JsonMapper;

/**
 * Spring 빈이 아닌 곳(정적 필드·필터·외부 호출 클라이언트 등)에서 쓰는 Jackson 2 호환 Jackson 3 매퍼를 한 곳에서 만든다(WP-1609).
 *
 * <p>왜: {@code JsonMapper.builderWithJackson2Defaults()} 는 직렬화·역직렬화 기본값만 Jackson 2 로 되돌리고 읽기·쓰기 크기
 * 한도(StreamRead/WriteConstraints)는 Jackson 3 기본(문자열 100,000,000자·중첩 500 단계)으로 둔다. Boot 매퍼는 {@code
 * application.yml} 의 {@code spring.jackson.factory.constraints} 로 Jackson 2 때 값(문자열
 * 20,000,000자·읽기/쓰기 중첩 1000 단계)을 쓰므로, 직접 만든 매퍼도 같은 값을 써야 Jackson 2 때처럼 깊은 JSON 을 읽고 쓰며 메모리 보호 한도도
 * 그대로 유지된다. 값을 바꾸면 {@code application.yml} 도 함께 바꾼다. {@code JacksonArchTest} 가 다른 클래스의 {@code
 * builderWithJackson2Defaults()} 직접 호출을 막는다.
 */
public final class JsonMappers {

  /** 읽기 문자열 최대 길이 — Jackson 2 기본값(application.yml max-string-length 와 같다). */
  private static final int MAX_STRING_LENGTH = 20_000_000;

  /** 읽기 중첩 최대 깊이 — Jackson 2 기본값(application.yml read.max-nesting-depth 와 같다). */
  public static final int MAX_READ_NESTING_DEPTH = 1000;

  /** 쓰기 중첩 최대 깊이 — Jackson 2 기본값(application.yml write.max-nesting-depth 와 같다). */
  private static final int MAX_WRITE_NESTING_DEPTH = 1000;

  /**
   * 기본 설정 그대로 쓰는 공유 매퍼 — 설정이 끝난 JsonMapper 는 불변이고 스레드 안전하므로 클래스마다 따로 만들지 않고 이것을 쓴다. 설정을 더해야 하면
   * {@link #jackson2Builder()} 로 시작한다.
   */
  public static final JsonMapper JACKSON2 = jackson2Builder().build();

  private JsonMappers() {}

  /**
   * Jackson 2 기본값({@code configureForJackson2})과 Jackson 2 크기 한도를 적용한 새 매퍼 빌더. {@code
   * JsonMapper.builderWithJackson2Defaults()} 와 같되 팩토리의 읽기·쓰기 한도만 Jackson 2 값으로 바꾼다.
   */
  public static JsonMapper.Builder jackson2Builder() {
    JsonFactory factory =
        JsonFactory.builderWithJackson2Defaults()
            .streamReadConstraints(
                StreamReadConstraints.builder()
                    .maxStringLength(MAX_STRING_LENGTH)
                    .maxNestingDepth(MAX_READ_NESTING_DEPTH)
                    .build())
            .streamWriteConstraints(
                StreamWriteConstraints.builder().maxNestingDepth(MAX_WRITE_NESTING_DEPTH).build())
            .build();
    return JsonMapper.builder(factory).configureForJackson2();
  }

  /**
   * 공유 매퍼({@link #JACKSON2})로 응답 Writer 에 JSON 을 쓰고, 쓰기 중 입출력 오류는 Jackson 2 때처럼 {@link IOException}
   * 으로 던진다.
   *
   * <p>왜: Jackson 2 의 writeValue 는 클라이언트 연결 끊김 등을 IOException 으로 던져 서블릿 컨테이너가 일반 연결 오류로 처리했다.
   * Jackson 3 은 이를 unchecked {@link JacksonIOException} 으로 감싸므로, 그대로 두면 필터·진입점의 {@code throws
   * IOException} 계약을 벗어난 런타임 예외가 돼 다른 경로(오류 로그·오류 페이지)로 흐른다. 원래 IOException 을 꺼내 다시 던진다.
   */
  public static void writeTo(Writer writer, Object value) throws IOException {
    try {
      JACKSON2.writeValue(writer, value);
    } catch (JacksonIOException e) {
      throw e.getCause();
    }
  }
}
