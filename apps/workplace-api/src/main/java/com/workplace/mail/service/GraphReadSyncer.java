package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.dto.SeenSyncResult;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Graph 계정 읽음 역동기화(WP-187): $batch 로 PATCH /me/messages/{id} {"isRead": seen} 를 20건씩 보낸다. 항목별
 * 2xx·404 는 끝난 것으로 보고, 429·5xx 를 만나면 그 묶음의 성공분만 반영한 뒤 다음 묶음을 보내지 않고 멈춘다.
 */
@Component
@RequiredArgsConstructor
public class GraphReadSyncer implements MailReadSyncer {

  /** Graph JSON batch 상한(한 요청에 최대 20건). */
  static final int BATCH = 20;

  private final GraphTokenService tokenService;
  private final GraphApiClient graphApiClient;

  @Override
  public MailProvider provider() {
    return MailProvider.M365_GRAPH;
  }

  /**
   * account 파라미터는 Graph 구현에서 불필요(토큰+providerMessageId 만 사용)하나 인터페이스 시그니처상 받는다. 최상위 batch 호출 실패는 예외로
   * 전파된다(호출 측이 대기 유지).
   */
  @Override
  public SeenSyncResult syncSeen(
      long userId, EmailAccountResponse account, List<SeenSyncItem> items) {
    Set<Long> done = new HashSet<>();
    List<SeenSyncItem> remote = new ArrayList<>();
    for (SeenSyncItem it : items) {
      if (it.locator().providerMessageId() == null) {
        done.add(it.messageId()); // 서버 식별자 없는 로컬 행 — 반영할 것이 없다
      } else {
        remote.add(it);
      }
    }
    if (remote.isEmpty()) {
      return new SeenSyncResult(done, false);
    }
    String token = tokenService.getAccessToken(userId, remote.get(0).locator().accountId());
    for (int i = 0; i < remote.size(); i += BATCH) {
      List<SeenSyncItem> chunk = remote.subList(i, Math.min(i + BATCH, remote.size()));
      // 배치 요청 id 는 메일 id 문자열 — 응답을 id 로 짝짓는다(순서 보장 없음)
      List<GraphBatchRequest> reqs =
          chunk.stream()
              .map(
                  it ->
                      new GraphBatchRequest(
                          String.valueOf(it.messageId()),
                          "PATCH",
                          "/me/messages/" + it.locator().providerMessageId(),
                          Map.<String, Object>of("isRead", it.seen())))
              .toList();
      boolean stop = false;
      for (GraphBatchResponse r : graphApiClient.batch(token, reqs)) {
        int s = r.status();
        if ((s >= 200 && s < 300) || s == 404) {
          // 404: 서버에서 사라진 메일 — 반영할 대상이 없으므로 끝난 것으로 본다
          done.add(Long.parseLong(r.id()));
        } else if (s == 429 || s >= 500) {
          stop = true; // 이 묶음의 성공분은 반영하고, 다음 묶음은 보내지 않는다
        }
        // 그 밖의 4xx 는 성공으로 보지 않는다 — 대기 표시를 남긴다
      }
      if (stop) {
        return new SeenSyncResult(done, true);
      }
    }
    return new SeenSyncResult(done, false);
  }
}
