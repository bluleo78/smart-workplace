package com.workplace.mail.service;

import com.workplace.mail.dto.EmailMessageDetail;
import com.workplace.mail.dto.EmailMessageSummary;
import com.workplace.mail.exception.EmailAccountNotFoundException;
import com.workplace.mail.exception.EmailMessageNotFoundException;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.repository.EmailMessageRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 받은편지함 읽기(목록·검색·상세). 모든 조회는 본인 소유 계정/메시지로 격리한다. 읽기 전용 — \Seen 등 서버 상태 변경은 하지 않는다(v1). */
@Service
@RequiredArgsConstructor
public class MailMessageService {

  /** 목록 기본/최대 건수. */
  private static final int DEFAULT_LIMIT = 50;

  private static final int MAX_LIMIT = 200;

  private final EmailAccountRepository accountRepo;
  private final EmailMessageRepository messageRepo;

  /** 계정의 메시지 목록(최신순, 선택적 검색어). 계정이 본인 소유가 아니면 404. */
  @Transactional(readOnly = true)
  public List<EmailMessageSummary> list(long userId, long accountId, String query, int limit) {
    accountRepo
        .findByIdAndUser(userId, accountId)
        .orElseThrow(() -> new EmailAccountNotFoundException(accountId));
    int effective = limit <= 0 ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT);
    return messageRepo.listByAccount(accountId, query, effective);
  }

  /** 메시지 단건 상세. 본인 소유가 아니거나 없으면 404. */
  @Transactional(readOnly = true)
  public EmailMessageDetail get(long userId, long messageId) {
    return messageRepo
        .findDetailByIdAndUser(userId, messageId)
        .orElseThrow(() -> new EmailMessageNotFoundException(messageId));
  }
}
