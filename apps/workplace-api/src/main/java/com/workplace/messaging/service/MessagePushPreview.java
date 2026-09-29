package com.workplace.messaging.service;

import com.workplace.global.dto.MentionResponse;
import com.workplace.global.util.MentionParser;
import com.workplace.global.util.Texts;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/** 푸시 알림 본문 미리보기. 멘션 토큰(<@id>)을 @이름으로 바꾸고 공백을 접어 120자로 자른다. 알 수 없는 멘션은 @사용자. */
public final class MessagePushPreview {

  static final int MAX = 120;

  private MessagePushPreview() {}

  public static String of(String body, List<MentionResponse> mentions, boolean hasAttachments) {
    if (body == null || body.isBlank()) return hasAttachments ? "파일을 보냈습니다" : "";
    Map<Long, String> names =
        mentions.stream()
            .collect(Collectors.toMap(MentionResponse::id, MentionResponse::name, (a, b) -> a));
    // 멘션 토큰 패턴은 MentionParser 한 곳에서 관리한다(파싱·치환이 같은 규칙을 쓰도록).
    String replaced = MentionParser.replace(body, id -> "@" + names.getOrDefault(id, "사용자"));
    return Texts.truncateCodePoints(replaced.replaceAll("\\s+", " ").trim(), MAX);
  }
}
