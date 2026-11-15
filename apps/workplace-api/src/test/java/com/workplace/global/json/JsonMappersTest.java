package com.workplace.global.json;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.StringWriter;
import java.io.Writer;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamWriteConstraints;
import tools.jackson.core.exc.StreamConstraintsException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.exc.UnrecognizedPropertyException;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;

/**
 * 직접 만드는 Jackson 2 호환 매퍼({@link JsonMappers})가 Jackson 2 때 크기 한도와 쓰기 오류 동작을 지키는지 고정한다(WP-1609).
 *
 * <p>왜: {@code JsonMapper.builderWithJackson2Defaults()} 만 쓰면 한도가 Jackson 3 기본(문자열 100,000,000자·중첩
 * 500 단계)이라, Jackson 2 때 읽히던 501~1000 단계 JSON 이 실패하고 문자열 한도는 다섯 배로 느슨해진다. Boot 매퍼의 {@code
 * application.yml} 값과도 같아야 한다.
 */
class JsonMappersTest {

  /** 원하는 깊이만큼 배열을 겹친 JSON 문자열. */
  private static String nestedArrays(int depth) {
    return "[".repeat(depth) + "]".repeat(depth);
  }

  @Test
  void 공유_매퍼의_읽기_쓰기_한도는_Jackson2_값이다() {
    StreamReadConstraints read = JsonMappers.JACKSON2.tokenStreamFactory().streamReadConstraints();
    StreamWriteConstraints write =
        JsonMappers.JACKSON2.tokenStreamFactory().streamWriteConstraints();

    assertThat(read.getMaxStringLength()).isEqualTo(20_000_000);
    assertThat(read.getMaxNestingDepth()).isEqualTo(1000);
    assertThat(write.getMaxNestingDepth()).isEqualTo(1000);
    // 나머지 한도는 Jackson 2·3 기본이 같다 — 건드리지 않았는지 확인한다.
    assertThat(read.getMaxNumberLength())
        .isEqualTo(StreamReadConstraints.defaults().getMaxNumberLength());
    assertThat(read.getMaxNameLength())
        .isEqualTo(StreamReadConstraints.defaults().getMaxNameLength());
  }

  @Test
  void 공유_매퍼는_1000_단계_중첩을_읽고_1001_단계는_거절한다() {
    JsonNode node = JsonMappers.JACKSON2.readTree(nestedArrays(1000));
    assertThat(node.isArray()).isTrue();

    assertThatThrownBy(() -> JsonMappers.JACKSON2.readTree(nestedArrays(1001)))
        .isInstanceOf(StreamConstraintsException.class);
  }

  /** 전제: Jackson 2 기본값 빌더만으로는 501 단계부터 실패한다 — 이 테스트가 깨지면 JsonMappers 의 한도 고정이 아직 필요한지 재검토한다. */
  @Test
  void 기본값_빌더만으로는_501_단계_중첩을_읽지_못한다() {
    JsonMapper plain = JsonMapper.builderWithJackson2Defaults().build();
    assertThatThrownBy(() -> plain.readTree(nestedArrays(501)))
        .isInstanceOf(StreamConstraintsException.class);
  }

  @Test
  void 공유_매퍼는_1000_단계_중첩을_쓴다() {
    ArrayNode root = JsonMappers.JACKSON2.createArrayNode();
    ArrayNode cur = root;
    for (int i = 1; i < 1000; i++) {
      cur = cur.addArray();
    }

    assertThat(JsonMappers.JACKSON2.writeValueAsString(root)).isEqualTo(nestedArrays(1000));
  }

  @Test
  void 빌더는_Jackson2_기본값을_유지한다() {
    // Jackson 2 기본: null → 기본형 0, 모르는 속성은 실패(FAIL_ON_UNKNOWN_PROPERTIES 켜짐).
    record Score(int value) {}
    JsonMapper mapper = JsonMappers.jackson2Builder().build();

    assertThat(mapper.readValue("{\"value\":null}", Score.class).value()).isZero();
    assertThatThrownBy(() -> mapper.readValue("{\"value\":1,\"other\":2}", Score.class))
        .isInstanceOf(UnrecognizedPropertyException.class);
  }

  @Test
  void writeTo_는_쓰기_입출력_오류를_IOException_으로_던진다() {
    // 클라이언트가 연결을 끊은 응답 Writer 흉내 — Jackson 3 은 이를 unchecked JacksonIOException 으로 감싼다.
    Writer broken =
        new Writer() {
          @Override
          public void write(char[] cbuf, int off, int len) throws IOException {
            throw new IOException("Broken pipe");
          }

          @Override
          public void flush() throws IOException {
            throw new IOException("Broken pipe");
          }

          @Override
          public void close() {}
        };

    assertThatThrownBy(() -> JsonMappers.writeTo(broken, Map.of("a", 1)))
        .isExactlyInstanceOf(IOException.class)
        .hasMessage("Broken pipe");
  }

  @Test
  void writeTo_는_정상이면_JSON_을_쓴다() throws IOException {
    StringWriter out = new StringWriter();
    JsonMappers.writeTo(out, Map.of("a", 1));
    assertThat(out).hasToString("{\"a\":1}");
  }
}
