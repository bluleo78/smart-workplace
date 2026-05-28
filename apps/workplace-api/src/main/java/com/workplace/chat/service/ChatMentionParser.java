package com.workplace.chat.service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * chat 메시지 본문에서 @username 을 추출한다. 허용 문자: 영숫자, '.', '_', '-'. 중복은 첫 등장 순서를 유지한 채 제거. 매칭 정책은 단순 정규식
 * 기반이며, 이메일 같은 텍스트에서도 골뱅이 뒤 토큰이 매칭될 수 있다 (서비스 단에서 active USER 해소를 통해 차단).
 */
public final class ChatMentionParser {
  private ChatMentionParser() {}

  private static final Pattern P = Pattern.compile("@([a-zA-Z0-9._-]+)");

  public static List<String> parse(String body) {
    if (body == null || body.isEmpty()) return List.of();
    Matcher m = P.matcher(body);
    LinkedHashSet<String> seen = new LinkedHashSet<>();
    while (m.find()) {
      seen.add(m.group(1));
    }
    return new ArrayList<>(seen);
  }
}
