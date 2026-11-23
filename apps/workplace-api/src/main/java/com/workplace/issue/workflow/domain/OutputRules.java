package com.workplace.issue.workflow.domain;

import com.workplace.global.json.JsonMappers;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowModel.Outcome;
import com.workplace.issue.workflow.domain.WorkflowModel.OutputSpec;
import com.workplace.issue.workflow.dto.StorableText;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 이동 출력의 형식 판정(설계 §7 「출력」). DB·Spring 없는 순수 함수.
 *
 * <p>왜: 출력은 context 에 남아 decision 이 읽고 화면에 링크로 보인다. 형식이 틀린 값(javascript: 링크, NaN)이나 저장할 수 없는 글을
 * 처음부터 받지 않는다.
 */
public final class OutputRules {

  /** 출력 JSON 전체 상한(UTF-8 바이트). */
  public static final int MAX_JSON_BYTES = 64 * 1024;

  private OutputRules() {}

  /** 질문 결과인지 — 목적 노드의 returnTo 가 지금 노드면 질문이다. 질문은 required 출력을 묻지 않는다(아니면 개발 중 질문을 못 한다). */
  public static boolean isQuestion(WorkflowModel model, Node from, Outcome outcome) {
    if (from == null || outcome == null || outcome.to() == null) {
      return false;
    }
    Node target = model.nodes().get(outcome.to());
    return target != null && from.key().equals(target.returnTo());
  }

  /**
   * 출력 위반 — MISSING(빠진 required) 다음 INVALID(형식·선언 밖·크기) 순서, 각각 한 건에 키를 모은다.
   *
   * @param outputs 요청 출력(null 은 빈 맵). 값이 null 인 키는 보내지 않은 것으로 본다
   */
  public static List<MoveViolation> check(
      WorkflowModel model, Node from, Outcome outcome, Map<String, Object> outputs) {
    Map<String, Object> sent = outputs == null ? Map.of() : outputs;
    List<MoveViolation> violations = new ArrayList<>();
    Set<String> missing = new LinkedHashSet<>();
    Set<String> invalid = new LinkedHashSet<>();

    // 선언 밖·형식 — 선언 밖 키는 저장할 수 있는 글일 때만 되비춘다(깨진 글을 응답에 싣지 않는다).
    for (Map.Entry<String, Object> e : sent.entrySet()) {
      String key = e.getKey();
      if (e.getValue() == null) {
        continue;
      }
      OutputSpec spec = key == null ? null : from.outputs().get(key);
      if (spec == null) {
        if (key != null && StorableText.Validator.isStorable(key)) {
          invalid.add(key);
        } else {
          invalid.add("");
        }
      } else if (!isValid(spec.type(), e.getValue())) {
        invalid.add(key);
      }
    }

    // required — 질문 결과는 묻지 않는다. 빠졌거나 공백이면 MISSING 으로만 알린다(INVALID 와 겹쳐 내지 않는다).
    if (!isQuestion(model, from, outcome)) {
      from.outputs()
          .forEach(
              (key, spec) -> {
                if (spec.required()) {
                  Object v = sent.get(key);
                  if (v == null || (v instanceof String s && s.isBlank())) {
                    missing.add(key);
                    invalid.remove(key);
                  }
                }
              });
    }

    if (!missing.isEmpty()) {
      violations.add(MoveViolation.outputMissing(String.join(",", missing)));
    }
    if (!invalid.isEmpty()) {
      invalid.remove("");
      violations.add(
          MoveViolation.outputInvalid(
              String.join(",", invalid), "내놓은 값의 형식이 맞지 않거나 이 단계에 없는 값입니다."));
    } else if (!sent.isEmpty() && tooLarge(sent)) {
      // 키마다 형식이 맞을 때만 크기를 잰다(형식이 틀린 값은 직렬화할 수 없을 수 있다).
      violations.add(MoveViolation.outputInvalid("", "내놓은 값이 너무 큽니다. 모두 합쳐 64 KiB 까지입니다."));
    }
    return violations;
  }

  /** 출력 JSON 이 상한을 넘는지(직렬화할 수 없으면 넘친 것으로 본다). */
  private static boolean tooLarge(Map<String, Object> sent) {
    try {
      return JsonMappers.JACKSON2.writeValueAsBytes(sent).length > MAX_JSON_BYTES;
    } catch (RuntimeException e) {
      return true;
    }
  }

  /** 선언한 형식에 맞는지 — string=글, url=host 있는 http(s), number=유한 수, boolean=참/거짓. 글은 저장할 수 있어야 한다. */
  static boolean isValid(String type, Object value) {
    if (type == null) {
      return false;
    }
    return switch (type) {
      case "string" -> value instanceof String s && StorableText.Validator.isStorable(s);
      case "url" ->
          value instanceof String s && StorableText.Validator.isStorable(s) && isHttpUrl(s);
      case "number" -> value instanceof Number n && isFinite(n);
      case "boolean" -> value instanceof Boolean;
      default -> false;
    };
  }

  /** host 있는 http(s) 주소인지. 공백·깨진 주소는 URI 해석에서 걸린다. */
  private static boolean isHttpUrl(String s) {
    try {
      URI uri = new URI(s);
      String scheme = uri.getScheme();
      if (scheme == null) {
        return false;
      }
      String lower = scheme.toLowerCase(Locale.ROOT);
      String host = uri.getHost();
      return (lower.equals("http") || lower.equals("https")) && host != null && !host.isBlank();
    } catch (URISyntaxException e) {
      return false;
    }
  }

  /** 유한한 수인지(NaN·무한 거절). */
  private static boolean isFinite(Number n) {
    if (n instanceof BigDecimal || n instanceof BigInteger) {
      return true;
    }
    if (n instanceof Long || n instanceof Integer || n instanceof Short || n instanceof Byte) {
      return true;
    }
    return Double.isFinite(n.doubleValue());
  }
}
