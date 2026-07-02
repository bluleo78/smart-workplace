package com.workplace.home.service;

/** 배치 1회에서 수집된 후보 한 건 — 사용자·소스 식별자·제목·부연설명·딥링크를 담는다. */
record PriorityCandidate(
    long userId,
    String sourceType,
    String sourceId,
    String title,
    String context,
    String deepLink) {}
