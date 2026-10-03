package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.dto.SeenSyncResult;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * Graph 계정 읽음 역동기화(WP-187): $batch 로 PATCH /me/messages/{id} {"isRead": seen} 를 20건씩 보낸다. 항목별
 * 2xx·404 는 끝난 것으로 보고, 429·5xx 를 만나면 그 묶음의 성공분만 반영한 뒤 다음 묶음을 보내지 않고 멈춘다. batch 요청 자체가 실패해도 앞 묶음까지의
 * 성공분은 돌려주고 멈춘다. 토큰은 {@link #open} 에서 디스패치당 한 번만 받는다(WP-215).
 */
@Slf4j
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
   * 토큰을 디스패치 1회에 한 번만 받는다(호출 측 트랜잭션 안 — 토큰 조회·갱신 저장이 RLS 스코프). 토큰은 갱신 기준(만료 2분 전) 이상 남은 값이라 한 디스패치
   * 동안 유효하다고 보고, 도중 만료돼 401 이 나면 그 묶음은 성공이 아니므로 대기 표시로 남는다.
   */
  @Override
  public Session open(long userId, EmailAccountResponse account) {
    String token = tokenService.getAccessToken(userId, account.id());
    return items -> push(token, items);
  }

  /** 한 조각을 20건씩 $batch 로 보낸다. batch 최상위 실패도 예외로 올리지 않고 앞 묶음까지의 성공분과 함께 멈춤을 돌려준다. */
  private SeenSyncResult push(String token, List<SeenSyncItem> items) {
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
      List<GraphBatchResponse> responses;
      try {
        responses = graphApiClient.batch(token, reqs);
      } catch (MailSendException e) {
        // 최상위 실패(전체 429·5xx·네트워크) — 앞 묶음에서 서버에 반영된 성공분은 대기 해제가 되도록 돌려주고 여기서 멈춘다.
        // 예외로 올리면 이 조각 전체가 실패로 처리돼 이미 반영된 메일까지 대기로 남고, 그동안 서버 쪽 변경이 로컬로 오지 않는다.
        log.warn(
            "Graph 읽음 반영 batch 실패 — 이번 조각 중단: accountId={} 반영={}",
            remote.get(0).locator().accountId(),
            done.size());
        return new SeenSyncResult(done, true);
      }
      boolean stop = false;
      for (GraphBatchResponse r : responses) {
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
