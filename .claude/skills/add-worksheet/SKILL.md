---
name: add-worksheet
description: PDF·사진·붙여넣은 텍스트에서 수학 문제를 뽑아 표준 문제지 JSON(data/)으로 만들고, 정규화·manifest 등록·스키마 검증·정답 교차검증까지 끝낸다. "문제지 추가", "이 PDF 문제 넣어줘", "새 시험지 등록" 같은 요청에 사용.
---

# 문제지 추가

입력: 원본(PDF 경로·이미지·텍스트), 그리고 아래 메타데이터. 모르는 건 원본에서 추론하고, 추론이 안 되는 것만 한 번에 묶어서 사용자에게 묻는다.

- 학년(`m0` 중학교 / `m1` 고1), 학기(`s1`/`s2`), 분류(`tb` 교재 / `peq` 기출 / `me` 모의고사)
- 제목, 단원, 출처(학교·교재명)

## 1. 파일명 정하기

`{학년}_{yymm}_{학기}_{분류}_{세부}.json` (CLAUDE.md 규칙). 같은 이름이 `data/`에 이미 있으면 덮어쓰지 말고 사용자에게 확인.
100문제가 넘으면 범위별로 나눈다(예: `..._q261-396.json`), 쎈수학 계열은 `data/seanmath32/`.

## 2. 문제 추출

- PDF는 Read의 `pages`로 20쪽씩 읽는다. 문제·보기·정답·해설 페이지가 따로 있으면 번호로 짝을 맞춘다.
- CLAUDE.md의 표준 스키마로 쓴다. 특히:
  - 수식은 전부 `\\( \\)` LaTeX, `$` 금지. 보기 앞 ①② 제거.
  - 객관식 `correct`는 **0-based**(③ → 2).
  - 원본에 정답이 없으면 지어내지 말고 비워 둔다(`correct` 생략 / `answer: ""`) — 검증기가 "정답 미입력" 경고로 표시한다.
  - `diff`는 원본 표기를 따른다(한글이면 그대로 두고 다음 단계 스크립트가 변환).
  - 그림이 필요한 문제는 `question` 끝에 `[그림 필요]`를 붙이고 사용자에게 목록으로 알린다(이미지 첨부는 사람이 `upload.html`/`json_viewer_edit.html`로).
- 원문 그대로 옮기는 것이 원칙. 문장을 다듬거나 숫자를 바꾸지 않는다.

## 3. 정규화·등록

```bash
python -I normalize_and_register.py data/<파일>.json --category <tb|peq|me> --grade <m0|m1> --group "<그룹>" --title "<제목>"
```

`--dry-run`으로 먼저 보고, 문제가 없으면 실제 실행. 스크립트는 `data/worksheets-manifest.json`에 `id/file/category/title/unit/count/group/grade`를 추가한다. 필요하면 `source`, `pages`도 직접 채운다.

## 4. 검증

```bash
python -I scripts/validate_worksheets.py data/<파일>.json
python -I scripts/validate_worksheets.py data/worksheets-manifest.json
```

ERROR는 모두 고친다. WARN 중 "정답 미입력"은 보고만 한다.

## 5. 정답 교차검증

정답이 들어 있는 문제들을 10문제씩 묶어 `math-checker` 서브에이전트를 **병렬로** 호출한다(한 메시지에 여러 Agent 호출).
- 프롬프트: 파일 경로 + 문제 번호 목록.
- 결과 중 `불일치`/`풀이 오류`는 **파일을 고치지 말고** 표로 사용자에게 보여준 뒤 확인받고 고친다(원본 정답지가 틀렸을 수도, 추출을 잘못했을 수도 있다 — 원본을 다시 확인해서 어느 쪽인지 적는다).

## 6. 보고

- 만든 파일, 문제 수, manifest 등록 여부
- `[그림 필요]` 문제 번호, 정답 미입력 번호, 교차검증 불일치 표
- 화면 확인 방법: `python -m http.server 8000` → `http://localhost:8000/worksheets/player.html?set=<id>`
- 커밋은 사용자가 요청할 때만.
