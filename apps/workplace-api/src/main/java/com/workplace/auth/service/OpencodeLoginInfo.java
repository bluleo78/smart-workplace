package com.workplace.auth.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * OpenCode(OpenAI 호환) 로그인 정보의 Pod 원문·runner login version 계산식(WP-1410·1448) — 활성 연결({@link
 * AiAgentCredentialService})과 AI 가 묶인 계정({@link PodAccountSource} 구현)이 똑같은 함수를 쓰게 한 곳에 둔다. desired
 * 의 버전과 {@code /secrets/login} 의 버전이 다르면 runner 가 매 회차 다시 받는다.
 *
 * <p>빈이 아닌 정적 함수 모음인 까닭: 트랜잭션 프록시를 지나지 않아야 한다. 프록시(@Transactional) 메서드를 지나 예외가 나가면 바깥 트랜잭션이
 * rollback-only 로 표시돼, 호출자가 그 AI 하나의 실패를 잡아도 커밋 때 요청 전체가 500 이 된다(runner desired). 여기서 던지는 예외는 호출자가
 * 같은 메서드 본문 안에서 잡는다.
 */
public final class OpencodeLoginInfo {

  private OpencodeLoginInfo() {}

  /**
   * Pod 에 넘길 원문으로 바꾸고 그 version 을 함께 계산한다 — {@link #withDefaultModel} + {@link #version}.
   *
   * @param id 버전 원천 id(활성 연결이면 연결 id, 계정이면 secret_version 또는 이어받은 옛 연결 id)
   * @param plaintext 복호화한 원문(provider config JSON)
   * @param model 그 AI 의 지정 모델(assistant_config.model, 없으면 null)
   */
  public static Payload toPod(ObjectMapper om, long id, String plaintext, String model) {
    String payload = withDefaultModel(om, plaintext, model);
    return new Payload(version(id, payload), payload);
  }

  /**
   * OpenCode login version(WP-1410) — 「버전 원천 id + Pod 에 넘길 원문(연결 JSON + defaultModel)」의 SHA-256 앞
   * 8바이트를 53비트로 줄인 양수. 연결을 다시 하면(id), 비서 설정에서 모델을 바꾸면(defaultModel), 원문을 고치면(이미지 입력 지정) 바뀌어 runner
   * 가 login-info 를 다시 받고 Pod 를 다시 만든다. 암호문이 아니라 원문으로 계산한다 — AES-GCM 은 IV 가 매번 달라, 같은 값을 다시 저장하거나 키를
   * 다시 암호화해도 버전이 바뀌어 일하던 Pod 가 까닭 없이 다시 만들어지지 않게. 생각의 깊이처럼 Pod 에 넘기지 않는 설정은 넣지 않는다. 53비트로 줄이는 까닭:
   * runner(TypeScript)가 JSON 숫자로 읽으므로 2^53 이상이면 정밀도를 잃는다.
   */
  public static long version(long id, String payload) {
    String input = id + "\0" + payload;
    try {
      byte[] h =
          MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8));
      long v = ByteBuffer.wrap(h, 0, Long.BYTES).getLong() & ((1L << 53) - 1);
      return v == 0 ? 1 : v;
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 을 쓸 수 없습니다", e);
    }
  }

  /**
   * OpenAI 호환 원문 JSON 에 {@code defaultModel} 필드를 더한다(원문 키는 그대로). 지정 모델이 이 원문의 「providerId/모델 id」 꼴이
   * 아니면 (옛 Claude 기본값·다른 연결의 값·빈 모델 id) null — Pod 가 엉뚱한 모델로 뜨지 않고 「모델을 정할 수 없음」으로 멈추게. 저장 때 객체
   * JSON 으로 검증된 값이라 읽을 수 없으면 서버 내부 오류로 본다 — 원문이 예외 메시지에 실리지 않게 원인을 싣지 않는다.
   *
   * <p>직렬화는 호출자가 넘긴 앱의 {@link ObjectMapper} 로 한다 — 양쪽이 같은 매퍼를 써야 같은 문자열(=같은 버전)이 나온다.
   */
  public static String withDefaultModel(ObjectMapper om, String plaintext, String model) {
    try {
      ObjectNode node = (ObjectNode) om.readTree(plaintext);
      String prefix = node.path("providerId").asText("") + "/";
      String m = model == null ? "" : model.strip();
      node.put(
          "defaultModel",
          prefix.length() > 1 && m.startsWith(prefix) && m.length() > prefix.length() ? m : null);
      return om.writeValueAsString(node);
    } catch (JsonProcessingException | ClassCastException e) {
      throw new IllegalStateException("저장된 OpenAI 호환 연결을 읽을 수 없습니다");
    }
  }

  /** Pod 에 넘길 원문과 그 login version — 원문은 toString 에 싣지 않는다. */
  public record Payload(long version, String payload) {
    @Override
    public String toString() {
      return "Payload[version=" + version + "]";
    }
  }
}
