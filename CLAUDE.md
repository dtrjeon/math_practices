# math_practices — 전주영 학습 기록판

중·고등 수학 문제풀이 웹앱. 빌드 도구 없는 **정적 HTML(GitHub Pages)** + **Google Apps Script(GAS) 백엔드** + **문제지 JSON**.
배포 주소: https://dtrjeon.github.io/math/ (저장소 `dtrjeon/math`, GitHub Pages)
학생은 `worksheets/player.html`에서 문제를 풀고, 풀이 기록은 GAS를 거쳐 Google Sheet에 쌓인다.

## 구조

| 경로 | 역할 |
|---|---|
| `index.html` | `index_mathc1.html`로 리다이렉트만 함 |
| `index_mathc1.html` | 메인 홈(문제지 목록·탭). 맨 위 "오늘 할 일" 카드(`renderHomeHero`: 오늘의 학습 계획 → 오답 복습 → 계획 세우기 순). 폰(760px 이하)은 아래 탭 메뉴(`.bottom-nav`, 더보기 시트), 태블릿·PC는 왼쪽 메뉴. 관리자 계정(`role==="admin"`)은 오른쪽 위에 자물쇠 버튼(`#adminLock`, 누르면 홈의 관리자 바로가기로 이동)이 보임. 새 탭을 만들면 `switchMainTab` 목록·`syncBottomNav`·더보기 시트에 함께 추가. `index_math.html`, `index_old.html`은 이전 버전 — 수정하지 말 것 |
| `data/curriculum.json` | 홈 "교과과정" 탭 데이터 — 과목(공통수학1·2, 대수, 미적분Ⅰ, 기하, 확률과 통계, 미적분Ⅱ)별 대단원 목록(서원고 교재 기준, 미적분Ⅱ는 교육과정 기준)과 단원별 `summary`(줄 단위 문자열 배열, 지금은 비어 있어 "준비 중"). 요약정리는 이 파일에 채운다 |
| `worksheets/player.html` | 문제 풀기(채점·필기 캔버스·손글씨 OCR·오답 유형·AI 튜터). 가장 크고 중요한 파일 |
| `worksheets/compose.html` | 문제지 재구성 |
| `worksheets/upload.html` | 학생 오답 사진 → AI(`visionExtract`) → JSON → 검토 대기열 제출 |
| `worksheets/login.html` | 가입/로그인. 세션은 `localStorage.mathapp_session` |
| `worksheets/mock-analysis.html` | 고1 학력평가 11회분 문항별 범위·난이도 분석(난이도는 공식 정답률이 아닌 추정치). 홈 → 고등학교 → 문제집 모음 → 모의고사 탭 맨 위 카드에서 연결. 회차를 추가하면 표도 함께 고친다. 종합표의 단원 이름은 `player.html?mock=월&subject=과목&chapter=단원`으로 연결되고, 플레이어는 `data/hakpyeong` 문항의 `subject`·`chapter` 값으로 문항을 모은다 |
| `plan.html` | 학습 계획 만들기 — 목표(시험 대비·모의고사 대비·꾸준한 학습)·시험일·하루 문제 수·쉬는 요일·문제집을 고르면 날짜별 계획을 만들어 `localStorage.study_plan_<학생ID>`에 저장(이 기기에만, 서버 저장·자동 완료 체크는 아직 없음). 문제는 manifest `count` 기준으로 1번부터 이어서 배분하고, 시험 대비는 마지막 이틀을 오답 복구 날로 둔다 |
| `today.html`, `worksheets/today.html` | 오늘의 과제 — 저장된 학습 계획(`study_plan_<학생ID>`)을 우선 보여 주고, 없으면 `data/study-plan.json`, 둘 다 없으면 계획 만들기 안내. 완료 체크는 이 기기(`today_done_<학생ID>`)에만 저장. **두 파일은 동일 — 고치면 둘 다** |
| `roadmap.html` | 진학 로드맵 |
| `tools/*.html` | 선생님/관리자 전용(review·admin-users·admin-examrange·json_viewer_edit). 공개 내비에 링크 걸지 않음 |
| `data/*.json` | 문제지 (중학교 `m0` 자료와 `data/seanmath32/`는 2026-11-05에 삭제) |
| `data/hakpyeong/*.json` | 고1 전국연합학력평가 11회분(2024.3~2026.9, `me`·`source: hakpyeong`). 그림은 PDF에서 잘라 `images`에 data URL로 들어 있음 |
| `data/miraen/*.json` | 미래엔 공통수학1 8개 파일(433문항, `tb`·`source: miraen`). 교과서 번호를 문항 앞에 표시, 소문항·복수 답은 문항 분리 |
| `data/materials/seowon/*.pdf` | 서원고 교과서 원본 PDF 29개(약 224MB). `data/publishers.json`의 `materials`로 "학교별 교재출판사" 표에 링크. 저장소 용량이 크게 늘었으니 PDF를 더 넣기 전에 GitHub Pages 한도(사이트 1GB)를 확인 |
| `data/worksheets-manifest.json` | 학생에게 보이는 문제지 목록. **루트 `manifest.json`은 PWA용이라 별개** |
| `data/study-plan.json`, `data/exam-ranges.json`, `data/publishers.json` | 학습 계획, 시험 범위, 출판사. `study-plan.json`은 중3 기말 계획이라 함께 삭제했고 없으면 `today.html`이 안내 문구만 보여 준다(`/study-plan`으로 새로 만든다). `exam-ranges.json`의 `schools`는 지금 빈 배열 |
| `data/tips.json` | Instagram 학습 팁(링크·요약·단원 태그·학년). `tools/admin-tips.html` → GAS `saveTips`로 저장 |
| `data/_pending/` | 승인 전 검토 대기(GAS가 GitHub에 직접 씀) |
| `Code.gs` | GAS 백엔드 전체(이 파일 하나만 Apps Script에 넣는다). 1부: `doGet`/`doPost` 라우터(모든 `action` 목록이 `codeRoute_`에 있음), 풀이 기록(Results·Attempts 탭), GitHub 읽기/쓰기, AI(사진→문제·손글씨·LaTeX), 시험범위, 사용자 관리 / 2부: 가입·로그인·검토 대기열 / 3부: AI 튜터·복습 세트 / 4부: 학습 팁. 예전 주석의 `gas-*.gs`는 2~4부를 뜻한다 |
| `normalize_and_register.py` | 새 문제지 diff 한글→영문, id=파일명, manifest 등록 |
| `scripts/validate_worksheets.py` | 문제지·manifest·study-plan 정합성 검사 |

## 문제지 JSON 스키마 (표준)

```json
{
  "id": "파일명과 동일",
  "title": "제목", "unit": "단원", "source": "출처",
  "problems": [
    { "num": 1, "diff": "low|mid|midhigh|high|top", "type": "mc|mc_multi|fillin|subjective|essay",
      "question": "\\(x^2\\)의 값은?",
      "choices": ["5개, 앞에 ①② 붙이지 않음"], "correct": 0,
      "answer": "단답형 정답(fillin)",
      "solution": ["줄 단위", "배열"],
      "family": "유형 코드(선택, player의 유사문제 생성기 키)",
      "images": ["선택"] }
  ]
}
```

- `correct`는 **0-based**. `mc_multi`면 배열.
- 수식은 **`\\( … \\)`(인라인) / `\\[ … \\]`(블록)만**. `$`는 렌더링 안 됨.
- `num`은 숫자 또는 교재 번호 문자열(`"0398"`, `"V-1"`) 둘 다 허용.
- 구 스키마(`number`/`difficulty`/`mcq`/`short`/1-based `answer`)는 `player.html`의 `normalizeProblem()`이 변환해 주지만, 새 데이터는 표준으로 쓴다.

## 파일명 규칙

`{학년}_{yymm 또는 yy}_{학기}_{분류}_{세부}.json` — 예: `m1_2604_s1_tb_chap01-r1`, `m1_2507_s1_peq_final_banpo`
- 학년: `m0` 중학교, `m1` 고1 / 분류(`category`): `tb` 교재, `peq` 기출(중간·기말), `me` 모의고사
- 재시도·복습판은 `-r01`, `-r1` 접미사

## 작업 규칙

- **HTML 수정 시 파일 맨 위에 버전 주석을 추가**한다: `<!-- vX.Y (YYYY-MM-DD): 무엇을 왜 바꿨는지 -->`. 기존 주석은 지우지 않는다.
- 빌드·번들러·npm 의존성을 들이지 않는다. 외부 라이브러리는 기존처럼 cdnjs(KaTeX 0.16.9)만. 예외: 홈 "학습 팁" 탭의 Instagram 공식 `embed.js`(탭을 열 때만 로드).
- 학습 팁은 **링크만** 저장한다. Instagram 게시물 이미지·본문을 내려받아 저장소에 넣지 않는다(저작권). 링크 형식은 `https://www.instagram.com/(p|reel)/코드/` — `Code.gs`(4부), `index_mathc1.html`, `player.html`, 검증 스크립트가 같은 규칙을 쓴다.
- 문제 텍스트를 `innerHTML`에 넣을 땐 `escapeHtml()`, 속성에는 `attrSafe()`/`escapeAttr()` — LaTeX의 `<`, `>`, `\`가 깨지는 버그가 반복됐다.
- `TEST_MODE_UNLOCK_SOLUTIONS`(player.html)는 테스트 기간 임시 `true`. 함부로 바꾸지 말고 사용자에게 확인.
- GAS 코드 변경은 `Code.gs` 파일로 전달한다(사용자가 Apps Script 편집기에 붙여넣고 "배포 관리 → 새 버전"으로 재배포 — 새 배포를 만들면 URL이 바뀜). 새 `action`은 `codeRoute_`에 한 줄 추가한다. 전역 이름이 겹치지 않도록 상수·함수 이름은 영역별 접두사(`CODE_`/`code`, `ai`, `tips`)를 쓴다.
- `SHEET_WEBHOOK_URL`(GAS 배포 URL)과 `OCR_SPACE_KEY`는 이미 공개 저장소에 있는 값이다. 새 비밀값(GitHub 토큰, Anthropic 키)은 절대 HTML/JSON에 넣지 말고 GAS 스크립트 속성에만.
- 학생 이름·전화번호 등 개인정보를 데이터 파일이나 커밋 메시지에 넣지 않는다.
- 정답을 바꾸는 수정은 반드시 근거(직접 풀이)와 함께 사용자에게 보고하고 확인받는다.

## 검증

```bash
python scripts/validate_worksheets.py           # 전체 (오류 있으면 exit 1)
python scripts/validate_worksheets.py data/x.json
node --check <추출한 스크립트>                   # HTML 인라인 JS 문법 — .claude/hooks가 자동으로 함
```

`data/**/*.json` 또는 HTML을 Edit/Write하면 `.claude/hooks/check_on_edit.py`가 자동으로 검사하고, 오류가 있으면 알려준다.
화면 확인은 프로젝트 루트에서 정적 서버(`python -m http.server 8000`)를 띄우고 `/worksheets/player.html?set=<id>`. 단, 로그인 게이트 때문에 `localStorage.mathapp_session`에 `{"studentId":"test","name":"테스트"}`를 넣어야 열린다.

## 반복 작업은 스킬로

- `/add-worksheet` — PDF·사진·텍스트 → 표준 JSON → 정규화·등록 → 검증 → 정답 교차검증
- `/verify-answers` — 기존 문제지의 정답·풀이를 `math-checker` 서브에이전트로 독립 풀이해 대조
- `/study-plan` — 시험일·범위로 `data/study-plan.json` 생성/갱신

## 오답노트 흐름 (모의고사·교재·중간기말 공통)

1. `player.html`이 문제를 채점하는 즉시 `logAttempt`로 `Attempts` 시트에 한 줄씩 쌓는다. 문제ID = `문제지id#번호`(재구성·단원별 모음에서는 `sourceId#sourceNum`이라 원래 문제로 기록됨).
2. `GET ?action=wrongStats&studentName=이름`이 학생·문제ID별로 시도/오답/연속정답을 계산해, 한 번이라도 틀렸고 연속 3회 정답 전인 문제만 돌려준다. **학생 이름을 꼭 넘긴다**(안 넘기면 모든 학생 것이 섞임).
3. 홈 "오답노트" 탭이 이를 모의고사(`me`)·교재(`tb`)·중간기말(`peq`)로 묶어 보여 주고, `startWrongSet()`이 해당 문제들을 원래 문제지에서 꺼내 `sessionStorage.customProblemSet`으로 `player.html`을 연다. 문제마다 `sourceId`·`sourceNum`·`sourceWorksheetId`를 달아야 푼 결과가 원래 문제 기록으로 쌓인다.
4. `compose.html`의 맞춤 세트도 같은 규칙. 유사문제(변형)는 원래 문제와 다르므로 `sourceId`를 달지 않는다. "오답노트 문제만" 필터와 "오답" 표시도 홈과 같은 `wrongStats`(학생별, 연속 3회 정답 전, 초기화 반영)를 쓴다 — `WRONG_RESET_AT`은 `index_mathc1.html`과 값이 같아야 한다.
5. 문제지 목록(manifest)에 없는 문제ID(삭제된 문제지, 예전 임시 세트)는 오답 탭에서 제외한다.

## 앱 안의 AI 에이전트 (`Code.gs` 3부)

- `aiTutor`: 문제별 힌트/오답 설명/질문 답변. 도구 `find_similar_problems`로 기존 문제 추천.
- `aiMakeReviewSet`: 오답 → 변형 문제 생성 → `validate_problems`로 자체 검사 → `submit_review_set`으로 `data/_pending` 제출. **선생님이 `tools/review.html`에서 승인해야 공개**.
- 문제 검사 규칙을 바꾸면 `aiValidateProblems_()`와 `scripts/validate_worksheets.py`를 함께 고친다.
- 모델은 스크립트 속성 `ANTHROPIC_MODEL`(기본 `claude-opus-5-5`).
