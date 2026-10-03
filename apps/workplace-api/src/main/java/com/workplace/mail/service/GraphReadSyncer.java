package com.workplace.mail.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.dto.SeenSyncItem;
import com.workplace.mail.dto.SeenSyncResult;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Graph 계정 읽음 역동기화(WP-187): $batch 로 PATCH /me/messages/{id} {"isRead": seen} 를 20건씩 보낸다. 항목별
 * 2xx·404 는 끝난 것으로 보고, 429·5xx 를 만나면 그 묶음의 성공분만 반영한 뒤 다음 묶음을 보내지 않고 멈춘다. batch 요청 자체가 실패해도 앞 묶음까지의
 * 성공분은 돌려주고 멈춘다. 토큰은 세션이 처음 필요할 때 받아 {@link #TOKEN_REUSE} 동안 조각끼리 재사용한다(WP-215).
 */
@Slf4j
@Component
public class GraphReadSyncer implements MailReadSyncer {

  /** Graph JSON batch 상한(한 요청에 최대 20건). */
  static final int BATCH = 20;

  private final GraphTokenService tokenService;
  private final GraphApiClient graphApiClient;
  private final TransactionTemplate txTemplate;

  public GraphReadSyncer(
      GraphTokenService tokenService,
      GraphApiClient graphApiClient,
      PlatformTransactionManager txManager) {
    this.tokenService = tokenService;
    this.graphApiClient = graphApiClient;
    this.txTemplate = new TransactionTemplate(txManager);
  }

  @Override
  public MailProvider provider() {
    return MailProvider.M365_GRAPH;
  }

  /**
   * 세션이 같은 토큰을 쓰는 최대 시간. 토큰은 받을 때 만료까지 2분 이상 남아 있으므로({@link GraphTokenService} 갱신 기준) 그보다 짧게 잡아, 큰
   * 모두 읽음 디스패치가 도중 만료(401)로 멈추지 않게 한다.
   */
  static final Duration TOKEN_REUSE = Duration.ofSeconds(60);

  /** 세션만 만들고 토큰은 서버로 보낼 항목이 처음 생길 때 받는다 — 로컬 행뿐인 조각은 토큰 없이 끝난다. */
  @Override
  public Session open(long userId, EmailAccountResponse account) {
    return new GraphSession(userId, account.id());
  }

  /** 토큰을 {@link #TOKEN_REUSE} 동안 조각끼리 재사용하는 세션. 디스패처가 한 스레드에서 순서대로 부르므로 동기화는 필요 없다. */
  private final class GraphSession implements Session {

    private final long userId;
    private final long accountId;
    private String token;
    private Instant fetchedAt;

    GraphSession(long userId, long accountId) {
      this.userId = userId;
      this.accountId = accountId;
    }

    @Override
    public SeenSyncResult push(List<SeenSyncItem> items) {
      return GraphReadSyncer.this.push(this::token, items);
    }

    /**
     * 토큰이 없거나 오래됐으면 새로 받는다. push 는 트랜잭션 밖에서 불리므로 토큰 조회·갱신 저장(RLS 스코프)만 짧은 트랜잭션으로 감싼다 — 테넌트 GUC 는
     * 리스너가 세팅한 TenantContext 로 주입된다.
     */
    private String token() {
      if (token == null || Duration.between(fetchedAt, Instant.now()).compareTo(TOKEN_REUSE) > 0) {
        token = txTemplate.execute(s -> tokenService.getAccessToken(userId, accountId));
        fetchedAt = Instant.now();
      }
      return token;
    }
  }

  /** 한 조각을 20건씩 $batch 로 보낸다. batch 최상위 실패도 예외로 올리지 않고 앞 묶음까지의 성공분과 함께 멈춤을 돌려준다. */
  private SeenSyncResult push(Supplier<String> token, List<SeenSyncItem> items) {
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
        responses = graphApiClient.batch(token.get(), reqs);
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
