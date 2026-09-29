package com.workplace.messaging.service;

import com.workplace.global.dto.MentionResponse;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** 푸시 알림 본문 미리보기. 멘션 토큰(<@id>)을 @이름으로 바꾸고 공백을 접어 120자로 자른다. 알 수 없는 멘션은 @사용자. */
public final class MessagePushPreview {

  static final int MAX = 120;
  private static final Pattern MENTION = Pattern.compile("<@(\\d{1,18})>");

  private MessagePushPreview() {}

  public static String of(String body, List<MentionResponse> mentions, boolean hasAttachments) {
    if (body == null || body.isBlank()) return hasAttachments ? "파일을 보냈습니다" : "";
    Map<Long, String> names =
        mentions.stream()
            .collect(Collectors.toMap(MentionResponse::id, MentionResponse::name, (a, b) -> a));
    Matcher m = MENTION.matcher(body);
    StringBuilder sb = new StringBuilder();
    while (m.find()) {
      String name = names.getOrDefault(Long.parseLong(m.group(1)), "사용자");
      m.appendReplacement(sb, Matcher.quoteReplacement("@" + name));
    }
    m.appendTail(sb);
    String flat = sb.toString().replaceAll("\\s+", " ").trim();
    if (flat.codePointCount(0, flat.length()) <= MAX) return flat;
    return flat.substring(0, flat.offsetByCodePoints(0, MAX)) + "…";
  }
}
