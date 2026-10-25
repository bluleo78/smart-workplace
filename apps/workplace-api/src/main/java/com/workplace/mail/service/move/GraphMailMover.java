package com.workplace.mail.service.move;

import com.fasterxml.jackson.databind.JsonNode;
import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.exception.MailSendException;
import com.workplace.mail.outbound.GraphApiClient;
import com.workplace.mail.outbound.GraphBatchRequest;
import com.workplace.mail.outbound.GraphBatchResponse;
import com.workplace.mail.service.GraphBodyLoader;
import com.workplace.mail.service.GraphTokenService;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * Graph 메일 옮기기(WP-962) — {@code POST /me/messages/{id}/move {"destinationId": …}} 를 $batch 로 20건씩
 * 보낸다. 옮긴 메일은 새 id 로 돌아온다(ImmutableId 를 쓰지 않으므로 id 가 바뀐다) — 응답 본문의 id 를 결과에 싣는다. 휴지통은 well-known 이름
 * {@code deleteditems}.
 *
 * <p>반영 대기 읽음은 옮기기 전에 옛 id 로 {@code PATCH isRead} 를 먼저 보낸다. 그 반영이 실패해도 옮기기는 하고, 결과의
 * seenPushed=false 로 알려 로컬 대기 표시를 남긴다 — 재시도 배치가 새 id 로 다시 반영한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GraphMailMover implements MailMover {

  /** Graph JSON batch 상한(한 요청에 최대 20건). */
  static final int BATCH = 20;

  private final GraphTokenService tokenService;
  private final GraphApiClient graphApiClient;

  @Override
  public MailProvider provider() {
    return MailProvider.M365_GRAPH;
  }

  @Override
  public List<Outcome> move(
      long userId, EmailAccountResponse account, List<Item> items, Destination dest) {
    String token = tokenService.getAccessToken(userId, account.id());
    List<Outcome> out = new ArrayList<>();
    List<Item> remote = new ArrayList<>();
    for (Item it : items) {
      if (it.providerMessageId() == null) {
        out.add(Outcome.failed(it.messageId(), "메일 서버에서 메일을 찾을 수 없습니다"));
      } else {
        remote.add(it);
      }
    }
    Set<Long> seenPushed = pushPendingSeen(token, remote);
    for (int i = 0; i < remote.size(); i += BATCH) {
      List<Item> chunk = remote.subList(i, Math.min(i + BATCH, remote.size()));
      Map<String, Item> byReqId = new HashMap<>();
      List<GraphBatchRequest> reqs = new ArrayList<>();
      for (Item it : chunk) {
        String id = String.valueOf(it.messageId());
        byReqId.put(id, it);
        reqs.add(
            new GraphBatchRequest(
                id,
                "POST",
                "/me/messages/" + it.providerMessageId() + "/move",
                Map.<String, Object>of("destinationId", dest.graphId())));
      }
      List<GraphBatchResponse> responses;
      try {
        responses = graphApiClient.batch(token, reqs);
      } catch (MailSendException e) {
        // 최상위 실패(429·5xx·네트워크) — 이 묶음과 뒤 묶음은 옮기지 않았다고 알린다(앞 묶음 결과는 유지).
        log.warn("Graph 메일 옮기기 batch 실패: accountId={} {}", account.id(), e.toString());
        for (Item it : remote.subList(i, remote.size())) {
          out.add(Outcome.failed(it.messageId(), "메일 서버에서 옮기지 못했습니다"));
        }
        return out;
      }
      for (GraphBatchResponse r : responses) {
        Item it = byReqId.remove(r.id());
        if (it == null) {
          continue;
        }
        String newId = newId(r.body());
        if (r.status() >= 200 && r.status() < 300 && newId != null) {
          out.add(
              new Outcome(
                  it.messageId(),
                  true,
                  null,
                  null,
                  newId,
                  seenPushed.contains(it.messageId()),
                  null,
                  it.hasProviderAttachments() ? attachmentIds(token, newId) : null));
        } else if (r.status() == 404) {
          out.add(Outcome.failed(it.messageId(), "메일 서버에서 메일을 찾을 수 없습니다"));
        } else {
          out.add(Outcome.failed(it.messageId(), "메일 서버에서 옮기지 못했습니다"));
        }
      }
      // 응답에 빠진 항목은 결과를 모른다 — 실패로 둔다(로컬은 그대로, 다음 동기화가 실제 상태를 맞춘다).
      byReqId.values().forEach(it -> out.add(Outcome.failed(it.messageId(), "메일 서버에서 옮기지 못했습니다")));
    }
    return out;
  }

  /** 옮긴 메일의 새 첨부 id(목록 순서). 실패하면 null — 옮기기 자체는 성공으로 두고, 그 메일 첨부 다운로드만 옛 id 로 남아 실패할 수 있다. */
  private List<String> attachmentIds(String token, String newMessageId) {
    try {
      GraphBodyLoader.GraphAttachmentList list =
          graphApiClient.get(
              token,
              "/me/messages/" + newMessageId + "/attachments?$select=id",
              GraphBodyLoader.GraphAttachmentList.class);
      if (list == null || list.value() == null) {
        return null;
      }
      return list.value().stream().map(GraphBodyLoader.GraphAttachmentItem::id).toList();
    } catch (RuntimeException e) {
      log.warn("Graph 옮긴 메일 첨부 id 다시 받기 실패: {}", e.toString());
      return null;
    }
  }

  /** 옮기기 응답 본문의 새 메시지 id. 없으면 null. */
  private static String newId(JsonNode body) {
    if (body == null) {
      return null;
    }
    JsonNode id = body.get("id");
    return id == null || id.isNull() || id.asText().isBlank() ? null : id.asText();
  }

  /** 반영 대기 읽음을 옛 id 로 먼저 PATCH 한다. 성공(2xx)한 메일 id 집합을 돌려준다 — 실패는 옮기기를 막지 않고 대기를 남긴다(클래스 주석). */
  private Set<Long> pushPendingSeen(String token, List<Item> items) {
    Set<Long> done = new HashSet<>();
    List<Item> pending = items.stream().filter(Item::seenPushPending).toList();
    for (int i = 0; i < pending.size(); i += BATCH) {
      List<GraphBatchRequest> reqs =
          pending.subList(i, Math.min(i + BATCH, pending.size())).stream()
              .map(
                  it ->
                      new GraphBatchRequest(
                          String.valueOf(it.messageId()),
                          "PATCH",
                          "/me/messages/" + it.providerMessageId(),
                          Map.<String, Object>of("isRead", it.seen())))
              .toList();
      try {
        for (GraphBatchResponse r : graphApiClient.batch(token, reqs)) {
          if (r.status() >= 200 && r.status() < 300) {
            done.add(Long.parseLong(r.id()));
          }
        }
      } catch (MailSendException e) {
        log.warn("Graph 옮기기 전 읽음 반영 실패(옮기기는 계속): {}", e.toString());
      }
    }
    return done;
  }
}
