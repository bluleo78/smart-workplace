package com.workplace.global.realtime.relay;

import com.workplace.global.json.JsonMappers;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 파드 사이 SSE 중계 메시지(WP-1973) — target·event·payloadJson·keysJson·publisher 를 하나에 담고, PostgreSQL
 * NOTIFY 페이로드로 실어 낼 encode/decode 는 여기서만 맡는다.
 *
 * <p>payloadJson·keysJson 은 이미 만든 JSON 문자열이라 Jackson 으로 감싸 문자열 필드로 보낸다(org.json 없음). 닫힘 신호({@link
 * #closeUser}·{@link #closeRunner})는 event·payload 없이 keysJson 만 가고, 인코딩 결과가 {@link
 * #MAX_NOTIFY_BYTES} 를 넘으면 발행 쪽이 아웃박스 표를 거쳐 NOTIFY 8000 바이트 상한을 회피한다.
 *
 * @param target 수신 쪽에서 어디로 보낼지 가르는 대상( {@link #TARGET_USER} 등)
 * @param event SSE 이벤트 이름 — 닫힘 신호에서는 null
 * @param payloadJson 직렬화를 끝낸 이벤트 payload — 닫힘 신호에서는 null
 * @param keysJson 키 배열 문자열 — user 계열은 userId 배열({@code [7]}), runner 계열은 {@code [tenantId,
 *     locationId]}
 * @param publisher 보낸 파드의 식별자 — 닫힘 신호에만 싣는다({@link #withPublisher}). 자기 파드로 돌아온 닫힘 신호를 그 파드가 제외해,
 *     발행 직후 재연결한 스트림이 다시 닫히지 않게 한다(WP-1973 리뷰 3차 선택). 중계({@code PostgresSseEventRelay}) 안에서만 쓰고
 *     수신자에게는 넘기지 않는다 — 받는 쪽의 메시지는 언제나 null 이다. <b>닫힘 신호만 pub 를 싣는다 — 이벤트이거나 옛 버전이면 null</b>
 */
public record RelayMessage(
    String target, String event, String payloadJson, String keysJson, String publisher) {

  /** publisher 없이 쓰는 생성자 — 이벤트 발행과 옛 버전 호환(파드 id 가 없는 값은 null 로 받는다). */
  public RelayMessage(String target, String event, String payloadJson, String keysJson) {
    this(target, event, payloadJson, keysJson, null);
  }

  /** payload 를 나눠 주는 대상 — 유저 연결에 이벤트를 전달한다. */
  public static final String TARGET_USER = "user";

  /** 키를 다 닫는 대상 — 유저의 모든 스트림을 서버 쪽에서 닫는다. */
  public static final String TARGET_USER_CLOSE = "user.close";

  /** runner 변경 스트림 대상 — (테넌트, 실행 위치) 연결에 이벤트를 전달한다. */
  public static final String TARGET_RUNNER = "runner";

  /** runner 스트림을 닫는 대상 — (테넌트, 실행 위치) 연결을 닫는다. */
  public static final String TARGET_RUNNER_CLOSE = "runner.close";

  /**
   * 닫힘 신호 대상 뒤에 붙는 접미사 — 전달 줄을 고를 때는 닫힘 신호에 한해 이 접미사를 떼어 낸 뒤를 쓴다. {@code user} 와 {@code user.close}
   * 가 같은 줄에 가야 닫힘이 앞선 이벤트를 앞지르지 않는다(WP-1973 리뷰 3차). <b>새 닫힘 타깃을 만들 땐 반드시 이 접미사로 짓고 {@link
   * #isCloseTarget(String)} 에 등록해야 한다</b> — 한쪽만 바꾸면 발행 재시도와 줄 분리가 갈려 같은 하자가 그대로 재발한다.
   */
  public static final String CLOSE_SUFFIX = ".close";

  /** 닫힘 신호(유저·runner 스트림 닫기)인지 — 발행 재시도·파드 id 제외·전달 줄 계산이 여기로 가른다. */
  public static boolean isCloseTarget(String target) {
    return TARGET_USER_CLOSE.equals(target) || TARGET_RUNNER_CLOSE.equals(target);
  }

  /** PostgreSQL NOTIFY 상한(8000 바이트) 아래 여유분 — 인코딩 결과가 이 값(바이트) 을 넘으면 아웃박스 행으로. */
  public static final int MAX_NOTIFY_BYTES = 7000;

  /** publisher 필드 이름 — 인코딩 결과의 키. 값이 없는 옛 버전 메시지에는 아예 쓰지 않는다. */
  private static final String FIELD_PUBLISHER = "pub";

  /** 직렬화 전용 공유 매퍼 — 설정이 끝난 매퍼는 불변·스레드 안전이라 클래스마다 만들지 않는다(WP-1609). */
  private static final ObjectMapper MAPPER = JsonMappers.JACKSON2;

  /** {@code {"t":..,"e":..,"p":..,"k":..}} 형태의 JSON 문자열 — 중계 채널에 실을 페이로드. */
  public String encode() {
    // 필드를 넣은 순서 그대로 쓰게 LinkedHashMap — t·e·p·k 순은 계약 문서와 같은 읽기 쉬운 형태.
    Map<String, String> fields = new LinkedHashMap<>();
    fields.put("t", target);
    fields.put("e", event);
    fields.put("p", payloadJson);
    fields.put("k", keysJson);
    // publisher 는 닫힘 신호에만 실으므로, 없는 메시지에는 키 자체를 쓰지 않는다(옛 파드가 읽을 수 있게 형식을 늘리지 않는다).
    if (publisher != null) fields.put(FIELD_PUBLISHER, publisher);
    return MAPPER.writeValueAsString(fields);
  }

  /**
   * encode 의 역변환 — 값이 없는 필드(닫힘 신호의 e·p) 는 null 로 돌아온다. 중계 채널에 우리 발행분만 오므로 잘못된 입력이면 Jackson 예외를 그대로
   * 던진다(수신한 중계 구현이 잡아 경고로 남긴다). {@code pub} 이 없는 옛 버전 메시지는 publisher 가 null 이다.
   */
  public static RelayMessage decode(String raw) {
    JsonNode node = MAPPER.readTree(raw);
    return new RelayMessage(
        textOrNull(node, "t"),
        textOrNull(node, "e"),
        textOrNull(node, "p"),
        textOrNull(node, "k"),
        textOrNull(node, FIELD_PUBLISHER));
  }

  /**
   * 보낸 파드 식별자를 싣는 새 메시지 — 발행할 때({@code PostgresSseEventRelay.enqueue}) 닫힘 신호에만 부른다. 같은 파드로 돌아온 닫힘을
   * 그 파드가 제외하는 데 쓴다(WP-1973 리뷰 3차 선택 — 발행 직후 재연결한 스트림을 유선 닫힘이 다시 닫지 않게).
   */
  public RelayMessage withPublisher(String publisherId) {
    return new RelayMessage(target, event, payloadJson, keysJson, publisherId);
  }

  /**
   * 인코딩 결과(UTF-8 바이트) 가 NOTIFY 상한 아래 여유분보다 크면 아웃박스 표를 거쳐 발행해야 한다.
   *
   * <p>이미 만든 인코딩 결과를 넘기는 쪽({@link #needsOutbox(String)})을 쓰면 발행 중 encode 가 한 번만 일어난다(WP-1973 리뷰 — 두
   * 번 encode).
   */
  public boolean needsOutbox() {
    return needsOutbox(encode());
  }

  /** 이미 만든 인코딩 결과 기준 아웃박스 판정 — 발행 경로는 이 쪽으로 인코딩 한 번만 쓴다. */
  public static boolean needsOutbox(String encoded) {
    return encoded.getBytes(StandardCharsets.UTF_8).length > MAX_NOTIFY_BYTES;
  }

  /**
   * 스트라이프(전달 줄) 계산용 정규 키(WP-1973 리뷰) — 같은 대상이라도 키 순서가 다르면 문자열이 달라져 다른 줄로 갈 수 있다(멤버 목록 조회가 ORDER BY
   * 를 못 걸어 순서가 매번 다를 수 있다). 원소를 정렬해 키 「집합」이 같으면 늘 같은 줄에 가게 하고, 해석에 실패하면 원본을 쓴다(중계 best-effort — 계산
   * 실패로 전달이 멈추지 않는다).
   */
  static String canonicalKeys(String keysJson) {
    if (keysJson == null || keysJson.isEmpty()) return "";
    try {
      JsonNode array = MAPPER.readTree(keysJson);
      if (!array.isArray()) return keysJson;
      List<String> elements = new ArrayList<>();
      for (JsonNode element : array) elements.add(element.toString());
      Collections.sort(elements);
      return String.join(",", elements);
    } catch (RuntimeException e) {
      return keysJson;
    }
  }

  /** 유저 스트림 닫힘 신호 — event·payload 없이 keysJson(대상 userId 배열) 만 간다. */
  public static RelayMessage closeUser(long userId) {
    return new RelayMessage(TARGET_USER_CLOSE, null, null, "[" + userId + "]");
  }

  /**
   * 받는 사람 하나짜리 부분집합들(WP-1973 리뷰) — 한 메시지가 여러 받는 사람을 담으면 전달 줄도 하나만 골라지는데, 그 기준이 「집합」이라 집합이 다른 두 메시지가
   * 다른 줄로 가면 같은 사용자에게도 순서가 뒤바뀐다(예: {@code [1,2]} 다음 {@code [1]}). user 계열은 userId 배열을 한 원소씩 나눠 각
   * 부분집합이 그 사용자의 줄로 가게 하고, runner 는 (테넌트, 위치) 한 쌍이 곧 받는 사람이라 그대로다. 해석에 실패하면 원본을 그대로 두어 전달이 멈추지
   * 않는다(중계 best-effort).
   */
  public List<RelayMessage> perRecipient() {
    if (!TARGET_USER.equals(target) && !TARGET_USER_CLOSE.equals(target)) return List.of(this);
    if (keysJson == null || keysJson.isEmpty()) return List.of(this);
    try {
      JsonNode array = MAPPER.readTree(keysJson);
      if (!array.isArray() || array.size() < 2) return List.of(this); // 한 사람분은 그대로 — 새 객체를 만들지 않는다
      List<RelayMessage> parts = new ArrayList<>(array.size());
      for (JsonNode element : array) {
        // publisher 도 부분집합에 그대로 이어 간다 — 나뉜 닫힘 신호도 발행 파드가 알아볼 수 있어야 한다.
        parts.add(new RelayMessage(target, event, payloadJson, "[" + element + "]", publisher));
      }
      return parts;
    } catch (RuntimeException e) {
      return List.of(this);
    }
  }

  /** runner 스트림 닫힘 신호 — keysJson 은 {@code [tenantId, locationId]}. */
  public static RelayMessage closeRunner(long tenantId, long locationId) {
    return new RelayMessage(
        TARGET_RUNNER_CLOSE, null, null, "[" + tenantId + "," + locationId + "]");
  }

  /** 필드 값 읽기 — 없는 필드·JSON null 은 null (닫힘 신호의 event·payloadJson). */
  private static String textOrNull(JsonNode node, String field) {
    JsonNode value = node.path(field);
    return value.isMissingNode() || value.isNull() ? null : value.asString();
  }
}
