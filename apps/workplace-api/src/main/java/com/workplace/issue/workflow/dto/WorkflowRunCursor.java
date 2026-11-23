package com.workplace.issue.workflow.dto;

import com.workplace.issue.workflow.exception.WorkflowException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

/**
 * 실행 목록 다음 쪽 cursor(WP-1985) — 앞 쪽 마지막 실행의 id. 목록이 id 내림차순(설계 §11)이라 id 하나로 겹침·빠짐 없이 이어 읽는다(시각과 달리
 * 같은 값이 없다).
 *
 * <p>밖에는 base64url 글(「r」+ id)로만 내보낸다 — 정렬 키를 바꿔도 계약(불투명 글)이 그대로이게. 읽을 수 없는 글은 400 이다.
 *
 * @param lastId 앞 쪽 마지막 실행 id(이보다 작은 것부터 읽는다)
 */
public record WorkflowRunCursor(long lastId) {

  private static final String PREFIX = "r";

  /** 밖으로 내보낼 글. */
  public String encode() {
    return Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString((PREFIX + lastId).getBytes(StandardCharsets.UTF_8));
  }

  /**
   * 받은 글을 읽는다. null 이면 처음 쪽(null).
   *
   * @throws WorkflowException base64url 이 아니거나, 접두가 다르거나, id 가 양의 정수가 아니면 400
   */
  public static WorkflowRunCursor decode(String text) {
    if (text == null) {
      return null;
    }
    try {
      String raw = new String(Base64.getUrlDecoder().decode(text), StandardCharsets.UTF_8);
      if (!raw.startsWith(PREFIX)) {
        throw WorkflowException.invalidCursor();
      }
      String digits = raw.substring(PREFIX.length());
      // 부호·공백을 받지 않는다(Long.parseLong 은 「+1」을 받는다).
      if (digits.isEmpty() || !digits.chars().allMatch(c -> c >= '0' && c <= '9')) {
        throw WorkflowException.invalidCursor();
      }
      long id = Long.parseLong(digits);
      if (id <= 0) {
        throw WorkflowException.invalidCursor();
      }
      return new WorkflowRunCursor(id);
    } catch (IllegalArgumentException e) {
      // base64 아님·수 범위 넘음(NumberFormatException 도 여기)
      throw WorkflowException.invalidCursor();
    }
  }
}
