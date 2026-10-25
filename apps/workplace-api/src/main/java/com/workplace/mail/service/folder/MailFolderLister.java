package com.workplace.mail.service.folder;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;

/**
 * 공급자별 서버 메일함 목록 조회(WP-960). 네트워크 I/O 만 하고 DB 에는 쓰지 않는다 — 반영은 {@link MailFolderService} 가 한 트랜잭션으로
 * 한다. 호출자는 DB 트랜잭션 밖에서 부른다.
 */
public interface MailFolderLister {

  /** 이 구현이 담당하는 공급자. */
  MailProvider provider();

  /**
   * 서버 메일함 목록을 끝까지 받아 저장 대상(ARCHIVE·USER)만 돌려준다. 목록 일부라도 받지 못하면 {@link
   * com.workplace.mail.exception.MailSyncException} 을 던진다(부분 목록으로 저장된 폴더를 지우지 않게).
   */
  ServerFolderListing list(long userId, long accountId, EmailAccountResponse account);
}
