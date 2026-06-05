package com.workplace.mail.dto;

import java.time.Instant;

/** 본문 적재 대상. imapUid 로 IMAP 재조회, folderName 으로 폴더 오픈. bodyFetchedAt!=null 이면 이미 적재됨. */
public record BodyTarget(
    long messageId, long accountId, long imapUid, String folderName, Instant bodyFetchedAt) {}
