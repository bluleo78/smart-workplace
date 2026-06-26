package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.ReadSyncLocator;
import com.workplace.mail.outbound.GraphApiClient;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/** Graph 계정 읽음 역동기화: PATCH /me/messages/{providerMessageId} {"isRead":true}. */
@Component
@RequiredArgsConstructor
public class GraphReadSyncer implements MailReadSyncer {

  private final GraphTokenService tokenService;
  private final GraphApiClient graphApiClient;

  @Override
  public MailProvider provider() {
    return MailProvider.M365_GRAPH;
  }

  /**
   * Graph API PATCH 로 메시지를 읽음으로 표시한다.
   *
   * <p>account 파라미터는 Graph 구현에서 불필요(토큰+providerMessageId 만 사용)하나 인터페이스 시그니처 상 받는다.
   */
  @Override
  public void markReadOnServer(long userId, EmailAccountResponse account, ReadSyncLocator loc) {
    String token = tokenService.getAccessToken(userId, loc.accountId());
    graphApiClient.patch(token, "/me/messages/" + loc.providerMessageId(), "{\"isRead\":true}");
  }
}
