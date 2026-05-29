package com.workplace.chat.service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * chat 메시지 본문에서 <@{userId}> 멘션 토큰을 추출한다. 중복은 첫 등장 순서를 유지한 채 제거. 표시이름/username 자유텍스트는 파싱하지
 * 않으며, 토큰의 유효성(존재하는 user)은 서비스 단(ChatUserHydrator)에서 검증한다.
 */
public final class ChatMentionParser {
  private ChatMentionParser() {}

  private static final Pattern P = Pattern.compile("<@(\\d+)>");

  public static List<Long> parse(String body) {
    if (body == null || body.isEmpty()) return List.of();
    Matcher m = P.matcher(body);
    LinkedHashSet<Long> seen = new LinkedHashSet<>();
    while (m.find()) {
      seen.add(Long.parseLong(m.group(1)));
    }
    return new ArrayList<>(seen);
  }
}
