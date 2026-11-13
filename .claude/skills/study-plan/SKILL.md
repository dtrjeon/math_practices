---
name: study-plan
description: 시험일·시험 범위(data/exam-ranges.json)·문제지 목록(manifest)을 바탕으로 data/study-plan.json(오늘의 과제)을 새로 만들거나 갱신한다. "시험 계획 짜줘", "오늘의 과제 업데이트", "기말 대비 일정" 요청에 사용.
---

# 학습 계획(오늘의 과제) 만들기

`today.html`과 `worksheets/today.html`이 읽는 `data/study-plan.json`을 만든다.

## 형식

```json
{
  "examDate": "YYYY-MM-DD",
  "title": "3-2 기말고사 대비",
  "note": "범위 요약",
  "days": [
    { "date": "YYYY-MM-DD", "title": "그날 주제",
      "tasks": [
        { "type": "solve", "label": "B단계 유형", "set": "<manifest id>", "from": 289, "to": 311 },
        { "type": "review", "label": "오답 복구", "detail": "설명", "optional": true }
      ] }
  ]
}
```

`from`/`to`는 문제 번호(num) 기준. 기존 파일의 `_memo` 등 다른 필드는 보존한다.

## 절차

1. 시험일, 범위, 하루 가능 시간(문제 수)을 확인한다. `data/exam-ranges.json`과 기존 `study-plan.json`을 먼저 읽어 이미 알 수 있는 건 묻지 않는다.
2. manifest에서 범위에 해당하는 세트를 고르고, 각 세트 JSON을 읽어 실제 번호 범위·난이도 분포를 확인한다.
3. 배분 원칙: 쉬운 단계(A/개념) → 유형(B) → 심화(C) 순서, 시험 3~4일 전부터는 기출(`peq`) 실전, 마지막 1~2일은 오답 복구(review). 주말 분량은 사용자 의견 따름.
4. 기존 계획을 갱신할 때는 오늘 이전 날짜는 건드리지 않는다.
5. 저장 후 `python -I scripts/validate_worksheets.py data/study-plan.json` — `set`이 manifest에 없거나 `from > to`면 오류.
6. 날짜별 요약 표(날짜·과제·문제 수)로 보고.
