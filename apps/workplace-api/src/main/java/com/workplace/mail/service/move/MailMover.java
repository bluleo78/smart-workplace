package com.workplace.mail.service.move;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailMoveRequest;
import com.workplace.mail.dto.MailProvider;
import java.util.List;

/**
 * 공급자별 서버 메일 옮기기(WP-962). DB 를 쓰지 않고 서버(IMAP·Graph)에서만 옮긴 뒤 메일별 결과를 돌려준다 — 로컬 반영은 {@link
 * MailMoveService} 가 한 트랜잭션으로 한다. 호출자는 DB 트랜잭션 밖에서 부른다(네트워크 I/O).
 */
public interface MailMover {

  /** 이 구현이 담당하는 공급자. */
  MailProvider provider();

  /**
   * 메일들을 서버에서 옮긴다. 로컬 읽음이 아직 서버에 반영되지 않은 메일(seenPushPending)은 옮기기 전에 그 값을 먼저 반영한다 — 옮기면 서버 위치가 바뀌어
   * 대기 중인 반영이 옛 위치를 가리키게 되기 때문이다.
   *
   * @return 요청한 메일마다 결과 한 건(순서 무관)
   * @throws com.workplace.mail.exception.MailSyncException 서버 접속 자체가 실패(이때는 아무것도 옮기지 않았다)
   * @throws com.workplace.mail.exception.MailValidationException 서버에 휴지통이 없음
   */
  List<Outcome> move(long userId, EmailAccountResponse account, List<Item> items, Destination dest);

  /**
   * 옮길 메일 한 통.
   *
   * @param sourceFolderName 지금 메일함 이름(IMAP 폴더를 여는 이름)
   * @param seen 로컬 읽음 상태(반영 대기면 이 값을 서버에 먼저 반영한다)
   * @param hasProviderAttachments Graph 첨부 id 를 저장한 첨부가 있는지 — 옮긴 뒤 새 첨부 id 를 다시 받는다
   * @param sourceUidValidity 지금 메일함에 기록된 IMAP UIDVALIDITY — 서버와 다르면(또는 없으면) 그 메일함 메일은 옮기지 않는다
   */
  record Item(
      long messageId,
      String sourceFolderName,
      Long imapUid,
      String providerMessageId,
      boolean seen,
      boolean seenPushPending,
      boolean hasProviderAttachments,
      Long sourceUidValidity) {}

  /**
   * 옮길 곳.
   *
   * @param kind 종류 — TRASH 면 공급자가 서버 휴지통을 찾는다
   * @param imapName IMAP 폴더 이름(TRASH 면 null)
   * @param graphId Graph 폴더 id 또는 well-known 이름(inbox·deleteditems)
   */
  record Destination(MailMoveRequest.Kind kind, String imapName, String graphId) {}

  /**
   * 메일 한 통 결과.
   *
   * @param newImapUid 옮긴 곳의 UID(IMAP, 서버가 COPYUID 로 알려 줬을 때만)
   * @param newUidValidity 옮긴 곳의 UIDVALIDITY(newImapUid 와 함께)
   * @param newProviderId 옮긴 뒤의 Graph 메시지 id(Graph 는 옮기면 id 가 바뀐다)
   * @param seenPushed 반영 대기 읽음을 서버에 반영했는지(대기가 아니었으면 false)
   * @param newAttachmentIds 옮긴 뒤의 Graph 첨부 id(목록 순서 = ordinal). 다시 받지 않았거나 실패했으면 null
   */
  record Outcome(
      long messageId,
      boolean ok,
      Long newImapUid,
      Long newUidValidity,
      String newProviderId,
      boolean seenPushed,
      String error,
      List<String> newAttachmentIds) {

    static Outcome failed(long messageId, String error) {
      return new Outcome(messageId, false, null, null, null, false, error, null);
    }
  }
}
