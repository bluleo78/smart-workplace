package com.workplace.mail.dto;

/** 읽음 역동기화에 필요한 서버측 식별자. Graph=providerMessageId, IMAP=imapUid+folderName. */
public record ReadSyncLocator(
    long accountId,
    MailProvider provider,
    String providerMessageId,
    Long imapUid,
    String folderName) {}
