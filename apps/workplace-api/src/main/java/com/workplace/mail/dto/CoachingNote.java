package com.workplace.mail.dto;

/** 초안 코칭 노트 1건. dimension = TONE | CLARITY | COMPLETENESS. */
public record CoachingNote(String dimension, String message) {}
