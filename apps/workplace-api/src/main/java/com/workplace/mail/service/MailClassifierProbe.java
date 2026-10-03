package com.workplace.mail.service;

import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.AssistantSpec;
import java.util.Optional;

/**
 * 메일 분류를 맡는 비서 판정 — 공통 비서가 있으면 그것, 없으면 계정이 개인 비서 사용일 때 개인 비서. 둘 다 없으면 분류가 채워질 일이 없다.
 *
 * <p>메일 화면 안 읽은 수·탭 배지·홈 요약(WP-186·WP-210)과 일괄 분류(WP-185)가 이 한 규칙을 쓴다 — 화면은 "분류 중"이라 보이는데 분류는 돌지
 * 않는(또는 그 반대) 어긋남을 막는다. 한 요청(사용자 1명) 안에서 비서 조회(트랜잭션+자격 조회)를 줄이려고 공통 비서는 1회, 개인 비서는 처음 필요할 때 1회만 조회해
 * 재사용한다 — 탭 배지는 모든 페이지에서 폴링되므로 계정 수만큼 반복 조회하지 않게 한다. 요청마다 새로 만들어 쓰고 공유하지 않는다.
 */
final class MailClassifierProbe {
  private final AssistantResolver assistantResolver;
  private final long userId;
  private Optional<AssistantSpec> workspace;
  private Optional<AssistantSpec> personal;

  MailClassifierProbe(AssistantResolver assistantResolver, long userId) {
    this.assistantResolver = assistantResolver;
    this.userId = userId;
  }

  /** 이 사용자의 계정(개인 비서 사용 여부 {@code aiEnabled})을 분류할 비서. 없으면 빈 값. */
  Optional<AssistantSpec> classifier(boolean aiEnabled) {
    if (workspace == null) {
      workspace = assistantResolver.resolveWorkspaceOrEmpty();
    }
    if (workspace.isPresent() || !aiEnabled) {
      return workspace;
    }
    if (personal == null) {
      personal = assistantResolver.resolvePersonalOrEmpty(userId);
    }
    return personal;
  }

  /** 분류가 도는 계정인지. */
  boolean active(boolean aiEnabled) {
    return classifier(aiEnabled).isPresent();
  }
}
