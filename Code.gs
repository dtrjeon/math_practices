/**
 * ============================================================
 * math_practices — Apps Script 기본 백엔드 (Code.gs)
 * ------------------------------------------------------------
 * 웹앱의 모든 요청이 이 파일의 doGet/doPost로 들어온다. 요청 본문의 action 값으로 처리 함수를 고른다.
 * 백엔드 전체가 이 파일 하나다. Apps Script 프로젝트에 이 파일만 넣으면 앱 전체가 동작한다.
 * (예전에 gas-*.gs 파일을 따로 넣었다면 그 파일들은 삭제할 것 — 남겨 두면 이름이 겹쳐 오류가 난다)
 *
 *   1부  라우터, 풀이 기록, GitHub 연동, AI(사진→문제·손글씨·LaTeX), 시험범위, 사용자 관리, 즉시 등록
 *   2부  가입·로그인·비밀번호, 검토 대기열(승인/반려)   ← 구 gas-review-and-users-addon.gs
 *   3부  AI 튜터, AI 복습 세트                          ← 구 gas-ai-agent-addon.gs
 *   4부  학습 팁                                        ← 구 gas-tips-addon.gs
 *
 * 준비물
 *  1) 이 스크립트가 붙어 있는 Google Sheet에 탭 3개 (없으면 첫 요청 때 헤더와 함께 자동 생성)
 *       Results  : date | studentName | worksheetId | score | timeTaken | wrongNums | startNum | imageLinks
 *       Attempts : date | studentName | worksheetId | problemId | correct | reason
 *       Users    : studentId | name | school | grade | phone | passwordHash | createdAt | role
 *  2) 프로젝트 설정 → 스크립트 속성
 *       GITHUB_TOKEN      (필수) contents 쓰기 권한이 있는 토큰
 *       GITHUB_REPO       (필수) 예: dtrjeon/math
 *       GITHUB_BRANCH     (선택) 기본 main
 *       ANTHROPIC_API_KEY (AI 기능용)
 *       ANTHROPIC_MODEL   (선택) 기본 claude-opus-5-5
 *       TEACHER_EMAIL     (선택) 검토 대기 알림 메일
 *  3) 배포 → 새 배포 → 유형 "웹 앱", 실행: 나, 액세스: 모든 사용자.
 *     이미 배포가 있으면 "배포 관리 → 수정 → 새 버전"으로 올려야 URL(SHEET_WEBHOOK_URL)이 유지된다.
 *
 * 전역 이름이 겹치지 않도록 상수·함수 이름은 영역별 접두사(CODE_/code, ai, tips)를 쓴다.
 * ============================================================
 */

const CODE_RESULTS_SHEET = 'Results';
const CODE_ATTEMPTS_SHEET = 'Attempts';
const CODE_USERS_SHEET = 'Users';
const CODE_DEFAULT_MODEL = 'claude-opus-5-5';
const CODE_MASTER_STREAK = 3;   // 연속 3회 정답이면 오답노트에서 빠진다(index_mathc1.html과 같은 기준)
const CODE_SHEET_HEADERS = {
  Results: ['date', 'studentName', 'worksheetId', 'score', 'timeTaken', 'wrongNums', 'startNum', 'imageLinks'],
  Attempts: ['date', 'studentName', 'worksheetId', 'problemId', 'correct', 'reason'],
  Users: ['studentId', 'name', 'school', 'grade', 'phone', 'passwordHash', 'createdAt', 'role']
};


// ── 진입점 ────────────────────────────────────────────────

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';
  try {
    if (action === 'list') return jsonResponse_(codeListResults_());
    if (action === 'wrongStats') return jsonResponse_(codeWrongStats_(e.parameter.studentName));
    return jsonResponse_({ status: 'ok', message: 'math_practices backend' });
  } catch (err) {
    return jsonResponse_({ status: 'error', message: err.message });
  }
}

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ status: 'error', message: '요청 형식이 잘못됐어요' });
  }
  const action = payload.action || '';
  try {
    return jsonResponse_(codeRoute_(action, payload));
  } catch (err) {
    return jsonResponse_({ status: 'error', message: err.message });
  }
}

/** action → 처리 함수 */
function codeRoute_(action, payload) {
  // 가입·로그인은 Users 탭이 없으면 멈추므로, 처음 쓰는 시트에서도 되도록 먼저 만들어 둔다
  if (action === 'registerUser' || action === 'loginUser' || action === 'changePassword') codeSheet_(CODE_USERS_SHEET);
  switch (action) {
    // 풀이 기록 (Code.gs)
    case '':                 return codeSaveResult_(payload);   // action 없음 = 퀴즈 종료 결과 저장
    case 'logAttempt':       return codeLogAttempts_(payload.studentName, payload.worksheetId, [payload]);
    case 'logAttempts':      return codeLogAttempts_(payload.studentName, payload.worksheetId, payload.attempts || []);
    case 'updateReason':     return codeUpdateReason_(payload);
    // AI (Code.gs)
    case 'ocrAnswer':        return codeOcrAnswer_(payload);
    case 'visionExtract':    return codeVisionExtract_(payload);
    case 'convertToLatex':   return codeConvertToLatex_(payload);
    // 문제지 즉시 등록 (Code.gs) — 학생 업로드는 검토 대기(pendingSubmitWorksheet)를 쓴다
    case 'submitWorksheet':  return codeSubmitWorksheet_(payload);
    // 시험범위 (Code.gs)
    case 'getExamRanges':    return codeGetExamRanges_();
    case 'saveExamRanges':   return codeSaveExamRanges_(payload);
    // 사용자 관리 (Code.gs)
    case 'listUsers':        return codeListUsers_(payload);
    case 'setUserRole':      return codeSetUserRole_(payload);
    case 'findAccountByName':return codeFindAccountByName_(payload);
    // 2부: 가입·로그인·검토 대기열
    case 'registerUser':           return codeAddon_('handleRegisterUser_', payload);
    case 'loginUser':              return codeAddon_('handleLoginUser_', payload);
    case 'changePassword':         return codeAddon_('handleChangePassword_', payload);
    case 'pendingSubmitWorksheet': return codeAddon_('handlePendingSubmitWorksheet_', payload);
    case 'listPending':            return codeAdminOnly_(payload) || codeAddon_('handleListPending_', payload);
    case 'approveWorksheet':       return codeAdminOnly_(payload) || codeAddon_('handleApproveWorksheet_', payload);
    case 'rejectWorksheet':        return codeAdminOnly_(payload) || codeAddon_('handleRejectWorksheet_', payload);
    // 3부: AI 에이전트
    case 'aiTutor':          return codeAddon_('handleAiTutor_', payload);
    case 'aiMakeReviewSet':  return codeAddon_('handleAiMakeReviewSet_', payload);
    // 4부: 학습 팁
    case 'getTips':          return codeAddon_('handleGetTips_', payload);
    case 'saveTips':         return codeAddon_('handleSaveTips_', payload);
    default:
      return { status: 'error', message: '알 수 없는 요청이에요: ' + action };
  }
}

function codeAddon_(fnName, payload) {
  const g = (typeof globalThis !== 'undefined') ? globalThis : (function () { return this; })();
  const fn = g[fnName];
  if (typeof fn !== 'function') {
    return { status: 'error', message: '서버에 ' + fnName + ' 함수가 없어요' };
  }
  return fn(payload);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


// ── 시트 공통 ──────────────────────────────────────────────

/** 시트가 없으면 헤더와 함께 만든다 */
function codeSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(CODE_SHEET_HEADERS[name]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function codeRows_(name) {
  const values = codeSheet_(name).getDataRange().getValues();
  return values.slice(1);   // 헤더 제외
}

function codeIso_(v) {
  return v instanceof Date ? v.toISOString() : String(v || '');
}


// ── 풀이 기록 ──────────────────────────────────────────────

/**
 * action 없음 — player.html saveResultsToSheet()
 * payload: { studentName, worksheetId, timeTaken, correctCount, total, startNum, wrongNums:[], images:[{problemNum,dataUrl}] }
 */
function codeSaveResult_(p) {
  if (!p.worksheetId) return { status: 'error', message: '문제지 id가 없어요' };
  const links = codeSaveImages_(p);
  codeSheet_(CODE_RESULTS_SHEET).appendRow([
    new Date(),
    p.studentName || '학생',
    p.worksheetId,
    (p.correctCount || 0) + '/' + (p.total || 0),
    p.timeTaken || '',
    (p.wrongNums || []).join(','),
    p.startNum || '',
    links.join('\n')
  ]);
  return { status: 'ok' };
}

/** 풀이 필기 이미지를 Drive 폴더에 저장하고 링크를 돌려준다. 실패해도 기록 저장은 계속한다. */
function codeSaveImages_(p) {
  const images = (p.images || []).slice(0, 60);
  if (images.length === 0) return [];
  try {
    const folderName = 'math_practices 풀이 이미지';
    const it = DriveApp.getFoldersByName(folderName);
    const folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
    const stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd-HHmmss');
    return images.map(img => {
      const m = String(img.dataUrl || '').match(/^data:(image\/\w+);base64,(.+)$/);
      if (!m) return '';
      const name = [stamp, p.studentName || '학생', p.worksheetId, img.problemNum].join('_') + '.png';
      const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name));
      return img.problemNum + ': ' + file.getUrl();
    }).filter(Boolean);
  } catch (err) {
    return ['이미지 저장 실패: ' + err.message];
  }
}

/** logAttempt / logAttempts — 문제 하나 단위 채점 로그 */
function codeLogAttempts_(studentName, worksheetId, attempts) {
  const sheet = codeSheet_(CODE_ATTEMPTS_SHEET);
  const now = new Date();
  const rows = attempts.filter(a => a && a.problemId).map(a => [
    now, studentName || '학생', a.worksheetId || worksheetId || '', a.problemId, a.correct ? true : false, a.reason || ''
  ]);
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return { status: 'ok', count: rows.length };
}

/** updateReason — 같은 학생·같은 문제의 가장 최근 오답 행에 오답 유형만 채운다(새 행 안 만듦) */
function codeUpdateReason_(p) {
  const sheet = codeSheet_(CODE_ATTEMPTS_SHEET);
  const rows = codeRows_(CODE_ATTEMPTS_SHEET);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][1]) === String(p.studentName || '학생') && String(rows[i][3]) === String(p.problemId) && rows[i][4] !== true) {
      sheet.getRange(i + 2, 6).setValue(p.reason || '');
      return { status: 'ok' };
    }
  }
  return { status: 'ok', updated: false };
}

/** GET ?action=list — 홈 학습 기록판·이어서 풀기·재구성 화면 */
function codeListResults_() {
  return codeRows_(CODE_RESULTS_SHEET).map(r => ({
    date: codeIso_(r[0]),
    studentName: String(r[1] || ''),
    worksheetId: String(r[2] || ''),
    score: String(r[3] || ''),
    timeTaken: String(r[4] || ''),
    wrongNums: String(r[5] || ''),
    startNum: String(r[6] || '')
  }));
}

/**
 * GET ?action=wrongStats — 오답노트. 문제(problemId)마다 시도 횟수·오답 수·현재 연속 정답 수를 계산해서,
 * 한 번이라도 틀렸고 아직 연속 3회 정답이 안 된 문제만 돌려준다. studentName을 주면 그 학생 것만.
 */
function codeWrongStats_(studentName) {
  const byKey = {};
  codeRows_(CODE_ATTEMPTS_SHEET).forEach(r => {
    if (studentName && String(r[1]) !== String(studentName)) return;
    const problemId = String(r[3] || '');
    if (!problemId) return;
    const key = r[1] + '|' + problemId;
    const s = byKey[key] || (byKey[key] = {
      studentName: String(r[1] || ''), worksheetId: String(r[2] || ''), problemId: problemId,
      totalAttempts: 0, totalWrong: 0, currentStreak: 0, lastDate: '', lastReason: ''
    });
    const correct = r[4] === true || String(r[4]).toUpperCase() === 'TRUE';
    s.totalAttempts++;
    if (correct) s.currentStreak++;
    else { s.totalWrong++; s.currentStreak = 0; if (r[5]) s.lastReason = String(r[5]); }
    s.lastDate = codeIso_(r[0]);
  });
  return Object.keys(byKey).map(k => byKey[k])
    .filter(s => s.totalWrong > 0 && s.currentStreak < CODE_MASTER_STREAK)
    .sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1));
}


// ── GitHub 연동 ────────────────────────────────────────────

function codeRepo_() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('GITHUB_TOKEN');
  const repo = props.getProperty('GITHUB_REPO');
  if (!token || !repo) throw new Error('GitHub 연동 설정(GITHUB_TOKEN, GITHUB_REPO)이 안 되어있어요');
  return { token: token, repo: repo, branch: props.getProperty('GITHUB_BRANCH') || 'main' };
}

function codeGhUrl_(repo, path) {
  return 'https://api.github.com/repos/' + repo + '/contents/' + encodeURIComponent(path).replace(/%2F/g, '/');
}

/** 저장소 파일 읽기. 없으면 null, 있으면 { content(UTF-8 문자열), sha } */
function ghGetFile_(token, repo, branch, path) {
  const res = UrlFetchApp.fetch(codeGhUrl_(repo, path) + '?ref=' + encodeURIComponent(branch), {
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) throw new Error('GitHub 읽기 실패(' + code + '): ' + res.getContentText().slice(0, 200));
  const json = JSON.parse(res.getContentText());
  let content;
  if (json.content) {
    content = Utilities.newBlob(Utilities.base64Decode(json.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
  } else {
    // 1MB 넘는 파일은 contents API가 본문을 안 준다 → raw로 다시 받는다
    const raw = UrlFetchApp.fetch(codeGhUrl_(repo, path) + '?ref=' + encodeURIComponent(branch), {
      headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github.raw' },
      muteHttpExceptions: true
    });
    content = raw.getContentText('UTF-8');
  }
  return { content: content, sha: json.sha };
}

/** 저장소 파일 쓰기(커밋). sha를 안 주면 현재 sha를 찾아서 덮어쓴다. */
function ghPutFile_(token, repo, branch, path, content, message, sha) {
  if (!sha) {
    const existing = ghGetFile_(token, repo, branch, path);
    if (existing) sha = existing.sha;
  }
  const body = {
    message: message,
    content: Utilities.base64Encode(Utilities.newBlob(content, 'text/plain').getBytes()),
    branch: branch
  };
  if (sha) body.sha = sha;
  const res = UrlFetchApp.fetch(codeGhUrl_(repo, path), {
    method: 'put',
    contentType: 'application/json',
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200 && code !== 201) throw new Error('GitHub 저장 실패(' + code + '): ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText());
}

/**
 * submitWorksheet — 관리자가 바로 등록(검토 대기 없이). 문제지 파일 저장 + manifest 등록.
 * payload: { requesterId, id, file, category, grade, title, unit, group, source, problems }
 */
function codeSubmitWorksheet_(p) {
  const denied = codeAdminOnly_(p);
  if (denied) return denied;
  if (!p.id || !p.file || !Array.isArray(p.problems) || p.problems.length === 0) {
    return { status: 'error', message: '문제지 id/파일명/문제가 필요해요' };
  }
  const r = codeRepo_();
  const data = { id: p.id, title: p.title || p.id, unit: p.unit || '', source: p.source || '', problems: p.problems };
  ghPutFile_(r.token, r.repo, r.branch, 'data/' + p.file, JSON.stringify(data, null, 2) + '\n', '문제지 등록: ' + p.id);
  codeUpsertManifest_(r, {
    id: p.id, file: p.file, category: p.category || 'tb', title: p.title || p.id, unit: p.unit || '',
    count: p.problems.length, group: p.group || p.title || p.id, grade: p.grade || '', source: p.source || ''
  }, '목록 반영: ' + p.id);
  return { status: 'ok' };
}

function codeUpsertManifest_(r, entry, message) {
  const path = 'data/worksheets-manifest.json';
  const f = ghGetFile_(r.token, r.repo, r.branch, path);
  const manifest = f ? JSON.parse(f.content) : { sets: [], categories: {} };
  const idx = manifest.sets.findIndex(s => s.id === entry.id);
  if (idx >= 0) manifest.sets[idx] = Object.assign({}, manifest.sets[idx], entry);
  else manifest.sets.push(entry);
  ghPutFile_(r.token, r.repo, r.branch, path, JSON.stringify(manifest, null, 2) + '\n', message, f ? f.sha : null);
}


// ── 시험범위 공지 ──────────────────────────────────────────

function codeGetExamRanges_() {
  const r = codeRepo_();
  const f = ghGetFile_(r.token, r.repo, r.branch, 'data/exam-ranges.json');
  return { status: 'ok', schools: f ? (JSON.parse(f.content).schools || []) : [] };
}

/** payload: { requesterId, schools:[...] } — 목록 전체를 덮어쓴다 */
function codeSaveExamRanges_(p) {
  const denied = codeAdminOnly_(p);
  if (denied) return denied;
  if (!Array.isArray(p.schools)) return { status: 'error', message: 'schools 배열이 필요해요' };
  const r = codeRepo_();
  ghPutFile_(r.token, r.repo, r.branch, 'data/exam-ranges.json',
    JSON.stringify({ schools: p.schools }, null, 2) + '\n', '시험범위 공지 갱신 (' + p.schools.length + '개 학교)');
  return { status: 'ok' };
}


// ── 사용자 관리 ────────────────────────────────────────────

function codeUsers_() {
  return codeRows_(CODE_USERS_SHEET).map((r, i) => ({
    rowIndex: i + 2, studentId: String(r[0]), name: String(r[1] || ''), school: String(r[2] || ''),
    grade: String(r[3] || ''), phone: String(r[4] || ''), role: String(r[7] || '') === 'admin' ? 'admin' : 'student'
  }));
}

/** 관리자가 아니면 오류 응답, 관리자면 null */
function codeAdminOnly_(p) {
  const me = codeUsers_().find(u => u.studentId === String(p.requesterId || ''));
  if (!me || me.role !== 'admin') return { status: 'error', message: '관리자만 할 수 있어요' };
  return null;
}

/** listUsers — 관리자 화면. 전화번호·비밀번호는 내보내지 않는다 */
function codeListUsers_(p) {
  const denied = codeAdminOnly_(p);
  if (denied) return denied;
  return {
    status: 'ok',
    users: codeUsers_().map(u => ({ studentId: u.studentId, name: u.name, school: u.school, grade: u.grade, role: u.role }))
  };
}

/** setUserRole — payload: { requesterId, targetId, role:'admin'|'student' } */
function codeSetUserRole_(p) {
  const denied = codeAdminOnly_(p);
  if (denied) return denied;
  if (p.role !== 'admin' && p.role !== 'student') return { status: 'error', message: 'role은 admin 또는 student' };
  if (String(p.targetId) === String(p.requesterId) && p.role !== 'admin') {
    return { status: 'error', message: '내 관리자 권한은 직접 해제할 수 없어요' };
  }
  const target = codeUsers_().find(u => u.studentId === String(p.targetId));
  if (!target) return { status: 'error', message: '사용자를 찾을 수 없어요' };
  codeSheet_(CODE_USERS_SHEET).getRange(target.rowIndex, 8).setValue(p.role === 'admin' ? 'admin' : '');
  return { status: 'ok' };
}

/** findAccountByName — 이름·학교·학년이 맞는 계정의 전화번호를 가려서(010-****-5678) 보여준다 */
function codeFindAccountByName_(p) {
  const name = String(p.name || '').trim();
  if (!name) return { status: 'error', message: '이름을 입력해주세요' };
  const school = String(p.school || '').trim();
  const grade = String(p.grade || '').trim();
  const candidates = codeUsers_()
    .filter(u => u.name === name && (!school || u.school === school) && (!grade || u.grade === grade))
    .map(u => {
      const d = u.phone.replace(/\D/g, '');
      return { maskedPhone: d.length >= 8 ? d.slice(0, 3) + '-****-' + d.slice(-4) : '****' };
    });
  if (candidates.length === 0) return { status: 'error', message: '일치하는 계정이 없어요' };
  return { status: 'ok', candidates: candidates };
}


// ── AI (Claude) ────────────────────────────────────────────

/** 텍스트 응답 한 번. content는 문자열 또는 content 블록 배열 */
function codeClaude_(system, content, maxTokens, effort) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY 스크립트 속성이 없어요');
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    payload: JSON.stringify({
      model: props.getProperty('ANTHROPIC_MODEL') || CODE_DEFAULT_MODEL,
      max_tokens: maxTokens || 8000,
      system: system,
      output_config: { effort: effort || 'low' },
      fallbacks: 'default',
      messages: [{ role: 'user', content: content }]
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Claude API 오류(' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  const json = JSON.parse(res.getContentText());
  if (json.stop_reason === 'refusal') throw new Error('AI가 이 요청을 처리하지 않았어요');
  return json.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

function codeImageBlock_(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/);
  if (!m) throw new Error('이미지 형식을 읽을 수 없어요');
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
}

/** 응답 텍스트에서 JSON 부분만 꺼낸다(``` 코드블록으로 감싸 오는 경우 대비) */
function codeParseJson_(text) {
  const t = String(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const start = t.search(/[\[{]/);
  if (start < 0) throw new Error('AI 응답에서 JSON을 찾지 못했어요');
  return JSON.parse(t.slice(start, Math.max(t.lastIndexOf(']'), t.lastIndexOf('}')) + 1));
}

/** ocrAnswer — 손글씨 정답 한 줄 인식. 반환 { status, recognized, text } */
function codeOcrAnswer_(p) {
  const text = codeClaude_(
    '학생이 손글씨로 쓴 수학 답 하나를 읽는다. 답만 한 줄로 출력한다(설명 금지). ' +
    '분수는 3/4, 근호는 √, 거듭제곱은 ^ 로 쓴다. 읽을 수 없거나 비어 있으면 정확히 NONE 이라고만 출력한다.',
    [codeImageBlock_(p.imageDataUrl), { type: 'text', text: '이 답을 읽어줘.' }], 200, 'low');
  const clean = text.split('\n')[0].trim();
  if (!clean || clean === 'NONE') return { status: 'ok', recognized: false, text: '' };
  return { status: 'ok', recognized: true, text: clean };
}

/**
 * visionExtract — 문제 사진(여러 장) → 문제 배열. upload.html normalizeIncomingProblem()이 받는 형태로 돌려준다.
 * payload: { images:[dataUrl], meta:{ grade, category, unit, title } }
 */
function codeVisionExtract_(p) {
  const images = (p.images || []).slice(0, 8);
  if (images.length === 0) return { status: 'error', message: '사진이 없어요' };
  const meta = p.meta || {};
  const content = images.map(codeImageBlock_);
  content.push({ type: 'text', text: '단원: ' + (meta.unit || '') + ' / 제목: ' + (meta.title || '') + '\n사진 속 문제를 모두 JSON 배열로 옮겨줘.' });
  const text = codeClaude_([
    '수학 문제 사진을 앱용 JSON으로 옮긴다. 원문을 그대로 옮기고 문장·숫자를 바꾸지 않는다.',
    'JSON 배열만 출력한다. 각 원소: {"num":문제번호(숫자), "diff":"low|mid|midhigh|high|top", "type":"mc|fillin",',
    '"question":"…", "choices":["보기5개, 앞의 ①② 번호 제거"](mc만), "correct":0~4 정답 인덱스(0-based, 사진에 정답 표시가 있을 때만),',
    '"answer":"단답형 정답"(fillin이고 사진에 있을 때만), "solution":["풀이 줄"](사진에 있을 때만)}',
    '수식은 \\( … \\) LaTeX로 쓴다. $는 쓰지 않는다. 그림이 필요한 문제는 question 끝에 [그림 필요]를 붙인다.'
  ].join('\n'), content, 16000, 'medium');
  const problems = codeParseJson_(text);
  if (!Array.isArray(problems)) throw new Error('문제 배열이 아니에요');
  return { status: 'ok', problems: problems };
}

/** convertToLatex — 평문 수식("x^2+2x+1=0, 루트3")을 앱 표기(\( … \))로 바꾼다 */
function codeConvertToLatex_(p) {
  const raw = String(p.text || '');
  if (!raw.trim()) return { status: 'error', message: '변환할 내용이 없어요' };
  const text = codeClaude_(
    '수학 문장의 수식 부분만 \\( … \\) LaTeX로 감싸 바꾼다. 한글 문장·줄바꿈·내용은 그대로 둔다. ' +
    '$는 쓰지 않는다. 변환된 텍스트만 출력한다(설명 금지).', raw, 4000, 'low');
  return { status: 'ok', text: text };
}


/**
 * ============================================================
 * 2부. 사용자 등록/로그인 + 검토 대기열 (구 gas-review-and-users-addon.gs)
 * ------------------------------------------------------------
 * 학생용 upload.html은 pendingSubmitWorksheet를 쓴다. 선생님이 tools/review.html에서 승인해야 공개된다.
 * 스크립트 속성 TEACHER_EMAIL이 있으면 검토 대기 알림 메일을 보낸다.
 * ============================================================
 */

const USERS_SHEET_NAME = 'Users';
const PENDING_INDEX_PATH = 'data/_pending/_index.json';

// ── 사용자 등록/로그인 ──────────────────────────────────────

function getUsersSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET_NAME);
  if (!sheet) throw new Error('Users 시트가 없어요. 먼저 "Users" 탭을 만들어주세요.');
  return sheet;
}

function normalizePhone_(phone) {
  return String(phone || '').replace(/\D/g, ''); // 숫자만 남김
}

function hashPassword_(str) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function findUserByPhone_(phone) {
  const sheet = getUsersSheet_();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (normalizePhone_(rows[i][4]) === phone) {
      return { rowIndex: i + 1, studentId: rows[i][0], name: rows[i][1], school: rows[i][2], grade: rows[i][3], phone: rows[i][4], passwordHash: rows[i][5], role: String(rows[i][7] || '') === 'admin' ? 'admin' : 'student' };
    }
  }
  return null;
}

function findUserById_(studentId) {
  const sheet = getUsersSheet_();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(studentId)) {
      return { rowIndex: i + 1, studentId: rows[i][0], name: rows[i][1], school: rows[i][2], grade: rows[i][3], phone: rows[i][4], passwordHash: rows[i][5], role: String(rows[i][7] || '') === 'admin' ? 'admin' : 'student' };
    }
  }
  return null;
}

/**
 * action: 'registerUser'
 * payload: { name, school, grade, phone }
 * 비밀번호는 전화번호 뒤 4자리로 자동 생성됨(학생에게 별도 안내 필요 없음 — 본인 번호라 이미 앎)
 */
function handleRegisterUser_(payload) {
  const name = (payload.name || '').trim();
  const school = (payload.school || '').trim();
  const grade = (payload.grade || '').trim();
  const phone = normalizePhone_(payload.phone);

  if (!name || !school || !grade) return { status: 'error', message: '이름·학교·학년을 모두 입력해주세요.' };
  if (phone.length < 9 || phone.length > 11) return { status: 'error', message: '전화번호를 다시 확인해주세요.' };

  if (findUserByPhone_(phone)) {
    return { status: 'error', message: '이미 등록된 번호예요. 로그인해주세요.' };
  }

  const password = phone.slice(-4);
  const passwordHash = hashPassword_(password);
  const studentId = 'u' + new Date().getTime();

  const sheet = getUsersSheet_();
  sheet.appendRow([studentId, name, school, grade, phone, passwordHash, new Date()]);

  return { status: 'ok', studentId: studentId, name: name, school: school, grade: grade, role: 'student' };
}

/**
 * action: 'loginUser'
 * payload: { phone, password }
 */
function handleLoginUser_(payload) {
  const phone = normalizePhone_(payload.phone);
  const password = String(payload.password || '');
  if (!phone || !password) return { status: 'error', message: '전화번호와 비밀번호를 입력해주세요.' };

  const user = findUserByPhone_(phone);
  if (!user) return { status: 'error', message: '가입되지 않은 번호예요. 먼저 회원가입해주세요.' };

  if (hashPassword_(password) !== user.passwordHash) {
    return { status: 'error', message: '비밀번호가 틀렸어요.' };
  }
  // role을 돌려줘야 관리자 화면(review/admin-*)이 열린다(Users 시트 H열)
  return { status: 'ok', studentId: user.studentId, name: user.name, school: user.school, grade: user.grade, role: user.role };
}

/**
 * action: 'changePassword'
 * payload: { studentId, currentPassword, newPassword }
 * 로그인된 상태(studentId를 클라이언트가 세션에서 들고 있음)에서 현재 비밀번호 확인 후 변경.
 * newPassword는 숫자 4자리 이상 아무 값이나 가능(더 이상 전화번호 뒷자리로 고정되지 않음).
 */
function handleChangePassword_(payload) {
  const studentId = String(payload.studentId || '');
  const currentPassword = String(payload.currentPassword || '');
  const newPassword = String(payload.newPassword || '');

  if (!studentId) return { status: 'error', message: '로그인 정보가 없어요. 다시 로그인해주세요.' };
  if (!/^\d{4,}$/.test(newPassword)) return { status: 'error', message: '새 비밀번호는 숫자 4자리 이상으로 입력해주세요.' };

  const user = findUserById_(studentId);
  if (!user) return { status: 'error', message: '사용자를 찾을 수 없어요.' };
  if (hashPassword_(currentPassword) !== user.passwordHash) {
    return { status: 'error', message: '현재 비밀번호가 맞지 않아요.' };
  }

  const sheet = getUsersSheet_();
  sheet.getRange(user.rowIndex, 6).setValue(hashPassword_(newPassword)); // 6번째 열 = passwordHash
  return { status: 'ok' };
}


// ── 검토 대기열 (승인 전까지 GitHub 실제 반영 안 함) ────────────

/**
 * action: 'pendingSubmitWorksheet'
 * payload: {
 *   isUpdate, id, file, category, grade, title, unit, group, source, count, problems,
 *   studentId, studentName, school
 * }
 * data/_pending/<file> 에만 저장하고, _index.json에 요약을 추가한 뒤 선생님에게 메일 알림.
 * 아직 worksheets-manifest.json에는 반영 안 됨(학생들에게 안 보임).
 */
function handlePendingSubmitWorksheet_(payload) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const repo = PropertiesService.getScriptProperties().getProperty('GITHUB_REPO');
  const branch = PropertiesService.getScriptProperties().getProperty('GITHUB_BRANCH') || 'main';
  if (!token || !repo) return { status: 'error', message: 'GitHub 연동 설정이 안 되어있어요' };

  if (!payload.id || !payload.file) return { status: 'error', message: '문제지 id/파일명이 없어요' };
  if (!Array.isArray(payload.problems) || payload.problems.length === 0) {
    return { status: 'error', message: '등록할 문제가 없어요' };
  }

  const worksheetData = {
    id: payload.id,
    title: payload.title || payload.id,
    unit: payload.unit || '',
    problems: payload.problems
  };
  const pendingPath = 'data/_pending/' + payload.file;

  try {
    ghPutFile_(token, repo, branch, pendingPath, JSON.stringify(worksheetData, null, 2),
      '검토대기 등록: ' + payload.id);

    const indexFile = ghGetFile_(token, repo, branch, PENDING_INDEX_PATH);
    const index = indexFile ? JSON.parse(indexFile.content) : { items: [] };
    const entry = {
      id: payload.id,
      file: payload.file,
      category: payload.category,
      grade: payload.grade,
      title: payload.title || payload.id,
      unit: payload.unit || '',
      group: payload.group || payload.title || payload.id,
      source: payload.source || '학생 오답 등록',
      count: payload.count || payload.problems.length,
      isUpdate: !!payload.isUpdate,
      studentId: payload.studentId || '',
      studentName: payload.studentName || '',
      school: payload.school || '',
      submittedAt: new Date().toISOString()
    };
    const existingIdx = index.items.findIndex(it => it.id === payload.id);
    if (existingIdx >= 0) index.items[existingIdx] = entry;
    else index.items.push(entry);

    ghPutFile_(token, repo, branch, PENDING_INDEX_PATH, JSON.stringify(index, null, 2),
      '검토대기 목록 갱신: ' + payload.id, indexFile ? indexFile.sha : null);

    notifyTeacherOfPending_(entry);

    return { status: 'ok' };
  } catch (e) {
    return { status: 'error', message: '저장 중 오류: ' + e.message };
  }
}

function notifyTeacherOfPending_(entry) {
  const teacherEmail = PropertiesService.getScriptProperties().getProperty('TEACHER_EMAIL');
  if (!teacherEmail) return; // 설정 안 했으면 조용히 건너뜀
  const subject = '[math_practices] 검토 대기 등록: ' + (entry.studentName || '학생') + ' - ' + entry.title;
  const body = [
    entry.studentName + '(' + entry.school + ') 학생이 문제지를 등록 요청했어요.',
    '제목: ' + entry.title,
    '문제 수: ' + entry.count + '개',
    entry.isUpdate ? '(기존 문제지 수정 요청)' : '(신규 등록)',
    '',
    'review.html에서 확인 후 승인/반려해주세요.'
  ].join('\n');
  try { MailApp.sendEmail(teacherEmail, subject, body); } catch (e) { /* 메일 실패는 무시 */ }
}

/**
 * action: 'listPending'
 * 반환: { status:'ok', items:[...] }
 */
function handleListPending_() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const repo = PropertiesService.getScriptProperties().getProperty('GITHUB_REPO');
  const branch = PropertiesService.getScriptProperties().getProperty('GITHUB_BRANCH') || 'main';
  if (!token || !repo) return { status: 'error', message: 'GitHub 연동 설정이 안 되어있어요' };

  const indexFile = ghGetFile_(token, repo, branch, PENDING_INDEX_PATH);
  if (!indexFile) return { status: 'ok', items: [] };
  const index = JSON.parse(indexFile.content);
  return { status: 'ok', items: index.items || [] };
}

/**
 * action: 'approveWorksheet'
 * payload: { id, visibility:'all'|'owner' }
 * data/_pending/<file> → data/<file>로 옮기고 manifest에 반영, pending에서는 제거.
 * visibility가 'owner'면 manifest에 visibility/studentId를 넣어 등록한 학생에게만 보이게 한다(index·compose가 걸러냄).
 */
function handleApproveWorksheet_(payload) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const repo = PropertiesService.getScriptProperties().getProperty('GITHUB_REPO');
  const branch = PropertiesService.getScriptProperties().getProperty('GITHUB_BRANCH') || 'main';
  if (!token || !repo) return { status: 'error', message: 'GitHub 연동 설정이 안 되어있어요' };

  const indexFile = ghGetFile_(token, repo, branch, PENDING_INDEX_PATH);
  if (!indexFile) return { status: 'error', message: '대기 중인 항목이 없어요' };
  const index = JSON.parse(indexFile.content);
  const entry = index.items.find(it => it.id === payload.id);
  if (!entry) return { status: 'error', message: '해당 항목을 찾을 수 없어요' };

  const pendingPath = 'data/_pending/' + entry.file;
  const pendingFile = ghGetFile_(token, repo, branch, pendingPath);
  if (!pendingFile) return { status: 'error', message: '대기 파일을 찾을 수 없어요' };

  try {
    // 1) 실제 문제지 파일로 저장
    ghPutFile_(token, repo, branch, 'data/' + entry.file, pendingFile.content, '오답 승인: ' + entry.id);

    // 2) manifest 갱신
    const manifestPath = 'data/worksheets-manifest.json';
    const manifestFile = ghGetFile_(token, repo, branch, manifestPath);
    const manifest = JSON.parse(manifestFile.content);
    const newEntry = {
      id: entry.id, file: entry.file, category: entry.category, title: entry.title,
      unit: entry.unit, count: entry.count, group: entry.group, grade: entry.grade, source: entry.source
    };
    if (payload.visibility === 'owner') {
      newEntry.visibility = 'owner';
      newEntry.studentId = entry.studentId;
    }
    const idx = manifest.sets.findIndex(s => s.id === entry.id);
    if (idx >= 0) manifest.sets[idx] = newEntry;
    else manifest.sets.push(newEntry);
    ghPutFile_(token, repo, branch, manifestPath, JSON.stringify(manifest, null, 2),
      '목록 반영(승인): ' + entry.id, manifestFile.sha);

    // 3) pending에서 제거
    ghDeleteFile_(token, repo, branch, pendingPath, pendingFile.sha, '검토대기 삭제(승인됨): ' + entry.id);
    index.items = index.items.filter(it => it.id !== entry.id);
    ghPutFile_(token, repo, branch, PENDING_INDEX_PATH, JSON.stringify(index, null, 2),
      '검토대기 목록 갱신(승인): ' + entry.id, indexFile.sha);

    return { status: 'ok' };
  } catch (e) {
    return { status: 'error', message: '승인 처리 중 오류: ' + e.message };
  }
}

/**
 * action: 'rejectWorksheet'
 * payload: { id, reason }
 */
function handleRejectWorksheet_(payload) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  const repo = PropertiesService.getScriptProperties().getProperty('GITHUB_REPO');
  const branch = PropertiesService.getScriptProperties().getProperty('GITHUB_BRANCH') || 'main';
  if (!token || !repo) return { status: 'error', message: 'GitHub 연동 설정이 안 되어있어요' };

  const indexFile = ghGetFile_(token, repo, branch, PENDING_INDEX_PATH);
  if (!indexFile) return { status: 'error', message: '대기 중인 항목이 없어요' };
  const index = JSON.parse(indexFile.content);
  const entry = index.items.find(it => it.id === payload.id);
  if (!entry) return { status: 'error', message: '해당 항목을 찾을 수 없어요' };

  const pendingPath = 'data/_pending/' + entry.file;
  const pendingFile = ghGetFile_(token, repo, branch, pendingPath);

  try {
    if (pendingFile) {
      ghDeleteFile_(token, repo, branch, pendingPath, pendingFile.sha, '검토대기 반려 삭제: ' + entry.id);
    }
    index.items = index.items.filter(it => it.id !== entry.id);
    ghPutFile_(token, repo, branch, PENDING_INDEX_PATH, JSON.stringify(index, null, 2),
      '검토대기 목록 갱신(반려): ' + entry.id, indexFile.sha);
    return { status: 'ok' };
  } catch (e) {
    return { status: 'error', message: '반려 처리 중 오류: ' + e.message };
  }
}

/** GitHub 저장소에서 파일을 삭제한다 (gas-github-upload-addon.gs의 ghGetFile_/ghPutFile_와 짝) */
function ghDeleteFile_(token, repo, branch, path, sha, message) {
  const url = 'https://api.github.com/repos/' + repo + '/contents/' + encodeURIComponent(path).replace(/%2F/g, '/');
  const res = UrlFetchApp.fetch(url, {
    method: 'delete',
    contentType: 'application/json',
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' },
    payload: JSON.stringify({ message: message, sha: sha, branch: branch }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('GitHub 삭제 실패(' + code + '): ' + res.getContentText().slice(0, 300));
}


/**
 * ============================================================
 * 3부. AI 에이전트 — Claude API 수동 tool-use 루프 (구 gas-ai-agent-addon.gs)
 * ------------------------------------------------------------
 * aiTutor         — 문제 카드의 "🤖 AI 튜터". 학생 답과 풀이를 보고 소크라테스식으로 힌트/설명을 주고,
 *                   필요하면 도구로 같은 유형(family/단원)의 기존 문제를 찾아 추천한다.
 * aiMakeReviewSet — 채점 결과의 "🤖 AI 복습 세트". 틀린 문제의 변형 문제를 만들어 validate_problems로
 *                   스스로 검사·수정한 뒤 submit_review_set으로 검토 대기열(data/_pending)에 올린다.
 *                   선생님이 tools/review.html에서 승인해야 학생들에게 보인다(사람 검토 필수).
 * 스크립트 속성 ANTHROPIC_API_KEY(필수), ANTHROPIC_MODEL(선택, 기본 claude-opus-5-5)
 * ============================================================
 */

const AI_DEFAULT_MODEL = 'claude-opus-5-5';
const AI_MANIFEST_PATH = 'data/worksheets-manifest.json';
const AI_MAX_AGENT_TURNS = 8;
const AI_VALID_DIFF = ['low', 'mid', 'midhigh', 'high', 'top'];
const AI_VALID_TYPE = ['mc', 'mc_multi', 'fillin', 'subjective', 'essay'];


// ── Claude API 호출 ─────────────────────────────────────────

function aiConfig_() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY 스크립트 속성이 없어요');
  return { key: key, model: props.getProperty('ANTHROPIC_MODEL') || AI_DEFAULT_MODEL };
}

/** POST /v1/messages 한 번. 응답 JSON을 그대로 돌려준다. */
function callClaude_(body) {
  const cfg = aiConfig_();
  body.model = body.model || cfg.model;
  // 안전 분류기가 거절하면 서버가 다른 모델로 자동 재시도 (Opus 5.5 권장 설정)
  body.fallbacks = 'default';
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code !== 200) throw new Error('Claude API 오류(' + code + '): ' + text.slice(0, 300));
  return JSON.parse(text);
}

/**
 * 수동 에이전트 루프. stop_reason이 tool_use인 동안 도구를 실행하고 결과를 돌려준다.
 * opts: { system, messages, tools, handlers:{name: fn(input)→object}, effort, maxTokens }
 * 반환: { text, toolLog, stopReason }
 */
function runAgent_(opts) {
  const messages = opts.messages.slice();
  const toolLog = [];
  for (let turn = 0; turn < AI_MAX_AGENT_TURNS; turn++) {
    const resp = callClaude_({
      max_tokens: opts.maxTokens || 16000,
      system: opts.system,
      tools: opts.tools,
      output_config: { effort: opts.effort || 'medium' },
      messages: messages
    });
    if (resp.stop_reason === 'refusal') {
      return { text: '이 질문에는 답하기 어려워요. 선생님께 여쭤봐 주세요.', toolLog: toolLog, stopReason: 'refusal' };
    }
    // thinking 블록 포함 content 전체를 그대로 이어 붙여야 다음 턴이 유효하다
    messages.push({ role: 'assistant', content: resp.content });

    if (resp.stop_reason !== 'tool_use') {
      const text = resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      return { text: text, toolLog: toolLog, stopReason: resp.stop_reason };
    }

    // 한 응답에 여러 tool_use가 올 수 있음 → 결과를 하나의 user 메시지로 모아서 돌려준다
    const results = resp.content.filter(b => b.type === 'tool_use').map(b => {
      const handler = opts.handlers[b.name];
      try {
        if (!handler) throw new Error('알 수 없는 도구: ' + b.name);
        const out = handler(b.input || {});
        toolLog.push({ tool: b.name, ok: true });
        return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(out) };
      } catch (e) {
        toolLog.push({ tool: b.name, ok: false, error: e.message });
        return { type: 'tool_result', tool_use_id: b.id, content: e.message, is_error: true };
      }
    });
    messages.push({ role: 'user', content: results });
  }
  return { text: '', toolLog: toolLog, stopReason: 'max_turns' };
}


// ── 저장소 읽기 (GitHub) ────────────────────────────────────

function aiRepo_() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('GITHUB_TOKEN');
  const repo = props.getProperty('GITHUB_REPO');
  const branch = props.getProperty('GITHUB_BRANCH') || 'main';
  if (!token || !repo) throw new Error('GitHub 연동 설정이 안 되어있어요');
  return { token: token, repo: repo, branch: branch };
}

function aiReadJson_(path) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('ai:' + path);
  if (cached) return JSON.parse(cached);
  const r = aiRepo_();
  const f = ghGetFile_(r.token, r.repo, r.branch, path);
  if (!f) throw new Error('파일이 없어요: ' + path);
  if (f.content.length < 90000) cache.put('ai:' + path, f.content, 600); // CacheService 값 한도(100KB) 이내만
  return JSON.parse(f.content);
}

function aiManifest_() {
  return aiReadJson_(AI_MANIFEST_PATH).sets.filter(s => !s.hidden);
}

function aiCompactProblem_(setId, p) {
  return {
    set: setId,
    num: p.num !== undefined ? p.num : p.number,
    diff: p.diff, type: p.type, family: p.family || null,
    question: String(p.question || '').slice(0, 400)
  };
}


// ── 도구 정의 ──────────────────────────────────────────────

const AI_TOOL_FIND_SIMILAR = {
  name: 'find_similar_problems',
  description: '문제은행에서 같은 유형의 기존 문제를 찾는다. family가 있으면 family로, 없으면 단원 키워드로 찾는다. ' +
    '학생에게 추가 연습 문제를 추천할 때 사용. 최대 limit개 반환.',
  input_schema: {
    type: 'object',
    properties: {
      family: { type: 'string', description: '문제 유형 코드(예: symmetricThreeVar). 모르면 생략' },
      unit_keyword: { type: 'string', description: '단원/그룹 이름에 포함될 키워드(예: 복소수, 인수분해)' },
      exclude_set: { type: 'string', description: '제외할 문제지 id(지금 풀고 있는 문제지)' },
      limit: { type: 'integer', description: '최대 개수(기본 3, 최대 8)' }
    },
    required: []
  }
};

function aiFindSimilar_(input) {
  const limit = Math.min(Math.max(input.limit || 3, 1), 8);
  const kw = (input.unit_keyword || '').trim();
  const sets = aiManifest_().filter(s => s.id !== input.exclude_set &&
    (!kw || String(s.unit || '').indexOf(kw) >= 0 || String(s.group || '').indexOf(kw) >= 0 || String(s.title || '').indexOf(kw) >= 0));
  const found = [];
  for (let i = 0; i < sets.length && found.length < limit; i++) {
    let data;
    try { data = aiReadJson_('data/' + sets[i].file); } catch (e) { continue; }
    (data.problems || []).forEach(p => {
      if (found.length >= limit || !p) return;
      if (input.family && p.family !== input.family) return;
      const c = aiCompactProblem_(sets[i].id, p);
      c.setTitle = sets[i].title;
      c.link = 'player.html?set=' + encodeURIComponent(sets[i].id) + '&start=' + encodeURIComponent(c.num);
      found.push(c);
    });
  }
  return { count: found.length, problems: found };
}

const AI_TOOL_VALIDATE = {
  name: 'validate_problems',
  description: '만든 문제 배열이 앱 스키마에 맞는지 검사한다. submit_review_set 전에 반드시 호출해서 errors가 빈 배열인지 확인할 것.',
  input_schema: {
    type: 'object',
    properties: { problems: { type: 'array', items: { type: 'object' } } },
    required: ['problems']
  }
};

/** 스키마 검사 — scripts/validate_worksheets.py의 문제 단위 규칙과 같게 유지할 것 */
function aiValidateProblems_(problems) {
  const errors = [];
  if (!Array.isArray(problems) || problems.length === 0) return { errors: ['problems가 비어 있어요'] };
  const seen = {};
  problems.forEach((p, i) => {
    const at = '문제[' + i + '] ';
    if (!p || typeof p !== 'object') { errors.push(at + '객체가 아님'); return; }
    if (typeof p.num !== 'number') errors.push(at + 'num은 숫자여야 함');
    else if (seen[p.num]) errors.push(at + 'num 중복: ' + p.num);
    seen[p.num] = true;
    if (AI_VALID_DIFF.indexOf(p.diff) < 0) errors.push(at + 'diff는 ' + AI_VALID_DIFF.join('/') + ' 중 하나');
    if (AI_VALID_TYPE.indexOf(p.type) < 0) errors.push(at + 'type은 ' + AI_VALID_TYPE.join('/') + ' 중 하나');
    if (!p.question || typeof p.question !== 'string') errors.push(at + 'question 필요');
    if (!Array.isArray(p.solution) || p.solution.length === 0) errors.push(at + 'solution은 비어있지 않은 문자열 배열');
    if (p.type === 'mc' || p.type === 'mc_multi') {
      if (!Array.isArray(p.choices) || p.choices.length !== 5) errors.push(at + 'choices는 5개');
      const ok = c => Number.isInteger(c) && c >= 0 && c < 5;
      if (p.type === 'mc' && !ok(p.correct)) errors.push(at + 'correct는 0~4 정수(0-based)');
      if (p.type === 'mc_multi' && !(Array.isArray(p.correct) && p.correct.length && p.correct.every(ok))) errors.push(at + 'correct는 0~4 정수 배열');
    } else if (p.type === 'fillin' && (p.answer === undefined || p.answer === '')) {
      errors.push(at + 'fillin은 answer 필요');
    }
    const text = [p.question].concat(p.choices || [], p.solution || []).join(' ');
    if ((text.match(/\\\(/g) || []).length !== (text.match(/\\\)/g) || []).length) errors.push(at + '\\( \\) 짝이 안 맞음');
    // player.html은 solution 줄마다 따로 렌더링 — \[ … \] 블록이 여러 줄로 쪼개지면 글자 그대로 보인다
    const count = (s, re) => (String(s).match(re) || []).length;
    (Array.isArray(p.solution) ? p.solution : []).forEach((line, k) => {
      if (count(line, /\\\[/g) !== count(line, /\\\]/g) || count(line, /\\\(/g) !== count(line, /\\\)/g)) {
        errors.push(at + 'solution ' + (k + 1) + '번째 줄: 수식 \\[ \\] 또는 \\( \\)가 줄을 넘어감 — 한 줄에 써야 함');
      }
    });
  });
  return { errors: errors };
}


// ── action: aiTutor ────────────────────────────────────────

const AI_TUTOR_SYSTEM = [
  '너는 한국 중·고등학생의 수학 튜터다. 학생은 방금 앱에서 문제를 풀었다.',
  '규칙:',
  '- 한국어, 반말 아닌 부드러운 존댓말("~해요"). 3~8문장으로 짧게.',
  '- 수식은 반드시 \\( ... \\) 로 감싼 LaTeX로 쓴다(앱이 KaTeX로 렌더링). $ 기호는 쓰지 않는다.',
  '- mode가 hint이면 정답이나 최종 값을 절대 말하지 말고, 다음 한 걸음만 질문/힌트로 준다.',
  '- mode가 explain이면 학생 답이 어디서 틀렸는지 먼저 짚고, 핵심 개념과 올바른 풀이 흐름을 설명한다.',
  '- mode가 chat이면 학생 질문에 답하되, 아직 정답을 모르는 상태(answerRevealed=false)면 정답은 말하지 않는다.',
  '- 제공된 정답/풀이가 틀려 보이면 학생에게 단정하지 말고 "선생님께 확인해 보세요"라고 덧붙인다.',
  '- 비슷한 문제 연습이 도움이 될 것 같으면 find_similar_problems로 찾아 1~3개를 "<문제지 제목> N번" 형식으로 추천한다.',
  '  추천할 때만 도구를 쓰고, 찾은 결과가 없으면 언급하지 않는다.'
].join('\n');

/**
 * payload: {
 *   mode: 'hint'|'explain'|'chat',
 *   worksheetId, problem:{num,question,choices,answer,correct,solution,family,diff,type},
 *   studentAnswer, answerRevealed, question(학생 질문, chat일 때), history:[{role,text}]
 * }
 * 반환: { status:'ok', reply, recommendations:[...] }
 */
function handleAiTutor_(payload) {
  try {
    const p = payload.problem || {};
    const mode = ['hint', 'explain', 'chat'].indexOf(payload.mode) >= 0 ? payload.mode : 'hint';
    const revealed = !!payload.answerRevealed && mode !== 'hint';
    const problemForModel = {
      num: p.num, type: p.type, diff: p.diff, family: p.family || null,
      question: p.question, choices: p.choices || undefined,
      // 힌트 모드에서도 정답은 모델에게 준다(틀린 방향 힌트 방지). 출력 규칙으로 노출을 막는다.
      answer: p.answer, correct: p.correct, solution: p.solution
    };
    const intro = [
      'mode: ' + mode,
      'answerRevealed: ' + revealed,
      'worksheetId: ' + (payload.worksheetId || ''),
      '문제(JSON): ' + JSON.stringify(problemForModel),
      '학생 답: ' + (payload.studentAnswer || '(아직 없음)')
    ].join('\n');

    const messages = [{ role: 'user', content: intro }];
    (payload.history || []).slice(-6).forEach(h => {
      messages.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.text || '') });
    });
    const ask = payload.question || (mode === 'hint' ? '힌트 하나만 주세요.' : '제가 어디서 틀렸는지 설명해 주세요.');
    if (messages[messages.length - 1].role === 'user') messages[messages.length - 1].content += '\n\n' + ask;
    else messages.push({ role: 'user', content: ask });

    const recommendations = [];
    const result = runAgent_({
      system: AI_TUTOR_SYSTEM,
      messages: messages,
      tools: [AI_TOOL_FIND_SIMILAR],
      effort: 'medium',
      maxTokens: 8000,
      handlers: {
        find_similar_problems: function (input) {
          input.exclude_set = input.exclude_set || payload.worksheetId;
          const out = aiFindSimilar_(input);
          out.problems.forEach(x => recommendations.push({ set: x.set, setTitle: x.setTitle, num: x.num, link: x.link }));
          return out;
        }
      }
    });
    return { status: 'ok', reply: result.text, recommendations: recommendations };
  } catch (e) {
    return { status: 'error', message: 'AI 튜터 오류: ' + e.message };
  }
}


// ── action: aiMakeReviewSet ────────────────────────────────

const AI_REVIEW_SYSTEM = [
  '너는 수학 문제 출제 에이전트다. 학생이 틀린 문제들을 받아, 같은 개념을 다시 연습할 변형 문제 세트를 만든다.',
  '절차:',
  '1. 틀린 문제마다 핵심 개념과 오답 유형(reason)을 파악한다.',
  '2. 문제마다 변형 문제 2개씩 만든다: 하나는 같은 난이도, 하나는 한 단계 쉬운 난이도. 숫자·조건을 바꾸고 원문을 베끼지 않는다.',
  '3. 각 문제를 직접 끝까지 풀어서 정답을 확정하고, 객관식이면 오답 선지도 그럴듯하게 만든다. 정답은 한 개만 맞아야 한다.',
  '4. validate_problems를 호출해 errors가 빌 때까지 고친다.',
  '5. submit_review_set을 한 번 호출해 제출한다. 제출 후 학생에게 보여줄 한두 문장 요약을 쓴다.',
  '스키마(문제 하나): {num:1부터 연번, diff:"low|mid|midhigh|high|top", type:"mc|fillin", question, choices:[5개](mc만), ',
  'correct:0~4 정수(mc만, 0-based), answer:문자열(fillin만), solution:[줄 단위 문자열 배열], family:원문제 family가 있으면 그대로}',
  '수식은 \\( ... \\) LaTeX로 쓴다. 선택지 앞에 ①② 같은 번호를 붙이지 않는다.'
].join('\n');

const AI_TOOL_SUBMIT = {
  name: 'submit_review_set',
  description: '완성된 복습 세트를 선생님 검토 대기열에 제출한다. validate_problems가 통과한 뒤 한 번만 호출.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '세트 제목(예: "복소수 오답 복습")' },
      unit: { type: 'string', description: '단원 이름' },
      problems: { type: 'array', items: { type: 'object' } }
    },
    required: ['title', 'problems']
  }
};

/**
 * payload: {
 *   worksheetId, grade, unit,
 *   wrong: [{ problem:{...}, studentAnswer, reason }],
 *   studentId, studentName, school
 * }
 * 반환: { status:'ok', summary, id, count } — 실제 공개는 선생님 승인 후
 */
function handleAiMakeReviewSet_(payload) {
  try {
    const wrong = (payload.wrong || []).slice(0, 6); // 비용·시간 제한: 한 번에 6문제까지
    if (wrong.length === 0) return { status: 'error', message: '오답 문제가 없어요' };

    const stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMdd-HHmm');
    const base = String(payload.worksheetId || 'set').replace(/[^A-Za-z0-9_\-]/g, '');
    const id = base + '-ai-review-' + stamp;
    let submitted = null;

    const result = runAgent_({
      system: AI_REVIEW_SYSTEM,
      messages: [{ role: 'user', content: '원래 문제지: ' + (payload.worksheetId || '') + '\n단원: ' + (payload.unit || '') +
        '\n틀린 문제들(JSON):\n' + JSON.stringify(wrong) }],
      tools: [AI_TOOL_VALIDATE, AI_TOOL_SUBMIT],
      effort: 'high',
      handlers: {
        validate_problems: function (input) { return aiValidateProblems_(input.problems); },
        submit_review_set: function (input) {
          if (submitted) throw new Error('이미 제출했어요');
          const check = aiValidateProblems_(input.problems);
          if (check.errors.length) throw new Error('검사 실패: ' + check.errors.join('; '));
          const res = handlePendingSubmitWorksheet_({
            isUpdate: false, id: id, file: id + '.json',
            category: 'tb', grade: payload.grade || '',
            title: '🤖 ' + (input.title || 'AI 오답 복습'),
            unit: input.unit || payload.unit || '',
            group: 'AI 오답 복습',
            source: 'AI 생성(검토 필요) · ' + (payload.worksheetId || ''),
            count: input.problems.length,
            problems: input.problems,
            studentId: payload.studentId, studentName: payload.studentName, school: payload.school
          });
          if (res.status !== 'ok') throw new Error(res.message || '제출 실패');
          submitted = { id: id, count: input.problems.length };
          return { status: 'ok', id: id };
        }
      }
    });

    if (!submitted) return { status: 'error', message: 'AI가 세트를 완성하지 못했어요. 다시 시도해 주세요.' };
    return { status: 'ok', summary: result.text, id: submitted.id, count: submitted.count };
  } catch (e) {
    return { status: 'error', message: 'AI 복습 세트 오류: ' + e.message };
  }
}


/**
 * ============================================================
 * 4부. 학습 팁 — Instagram 큐레이션 (구 gas-tips-addon.gs)
 * ------------------------------------------------------------
 * 선생님이 tools/admin-tips.html에서 게시물 링크 + 요약 + 단원 태그를 저장하면 data/tips.json에 바로 커밋한다
 * (관리자 직접 등록이라 검토 대기 없음). 학생 화면(홈 "💡 학습 팁", player.html 관련 팁)은 tips.json을 정적으로 읽는다.
 * Users 탭 H열(role)이 admin인 사용자만 저장할 수 있다.
 * ============================================================
 */

const TIPS_PATH = 'data/tips.json';
// 게시물(p) / 릴스(reel)만 허용. 계정 페이지·외부 링크는 거절한다.
const TIPS_URL_RE = /^https:\/\/www\.instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+\/$/;
const TIPS_MAX = 200;

function tipsRepo_() {
  const props = PropertiesService.getScriptProperties();
  return {
    token: props.getProperty('GITHUB_TOKEN'),
    repo: props.getProperty('GITHUB_REPO'),
    branch: props.getProperty('GITHUB_BRANCH') || 'main'
  };
}

/** Users 시트에서 requesterId의 role(H열)이 admin인지 확인 */
function tipsIsAdmin_(requesterId) {
  if (!requesterId) return false;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
  if (!sheet) return false;
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(requesterId)) return String(rows[i][7] || '') === 'admin';
  }
  return false;
}

/** 링크를 표준형(https://www.instagram.com/p/코드/)으로 맞춘다. 맞출 수 없으면 null */
function tipsNormalizeUrl_(url) {
  const m = String(url || '').trim().match(/^https?:\/\/(?:www\.)?instagram\.com\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  return 'https://www.instagram.com/' + (m[1] === 'reels' ? 'reel' : m[1]) + '/' + m[2] + '/';
}

/** 저장 전 정리·검사 — scripts/validate_worksheets.py의 check_tips()와 같은 규칙 */
function tipsClean_(tips) {
  if (!Array.isArray(tips)) throw new Error('tips 배열이 필요해요');
  if (tips.length > TIPS_MAX) throw new Error('팁은 최대 ' + TIPS_MAX + '개까지예요');
  const seen = {};
  return tips.map((t, i) => {
    const url = tipsNormalizeUrl_(t.url);
    if (!url) throw new Error((i + 1) + '번째 팁: Instagram 게시물 링크(instagram.com/p/… 또는 /reel/…)가 아니에요');
    if (seen[url]) throw new Error((i + 1) + '번째 팁: 같은 게시물이 이미 있어요');
    seen[url] = true;
    const title = String(t.title || '').trim();
    if (!title) throw new Error((i + 1) + '번째 팁: 한 줄 요약(제목)이 필요해요');
    const clip = (s, n) => String(s || '').trim().slice(0, n);
    const list = a => (Array.isArray(a) ? a : []).map(x => clip(x, 30)).filter(Boolean).slice(0, 10);
    return {
      id: clip(t.id, 40) || ('t' + new Date().getTime() + '_' + i),
      url: url,
      account: clip(t.account, 40),
      title: clip(title, 80),
      summary: clip(t.summary, 400),
      units: list(t.units),
      grades: list(t.grades).filter(g => g === 'm0' || g === 'm1' || g === 'm2'),
      addedAt: clip(t.addedAt, 10) || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd')
    };
  });
}

/** action: 'getTips' — GitHub에서 최신 파일을 읽는다(Pages 배포 지연 없이 관리자 화면에 바로 반영) */
function handleGetTips_() {
  const r = tipsRepo_();
  if (!r.token || !r.repo) return { status: 'error', message: 'GitHub 연동 설정이 안 되어있어요' };
  const f = ghGetFile_(r.token, r.repo, r.branch, TIPS_PATH);
  if (!f) return { status: 'ok', tips: [] };
  return { status: 'ok', tips: JSON.parse(f.content).tips || [] };
}

/**
 * action: 'saveTips'
 * payload: { requesterId, tips:[{ id, url, account, title, summary, units:[], grades:[] }] }
 * 목록 전체를 받아서 덮어쓴다(admin-examrange의 saveExamRanges와 같은 방식).
 */
function handleSaveTips_(payload) {
  if (!tipsIsAdmin_(payload.requesterId)) return { status: 'error', message: '관리자만 저장할 수 있어요' };
  const r = tipsRepo_();
  if (!r.token || !r.repo) return { status: 'error', message: 'GitHub 연동 설정이 안 되어있어요' };
  try {
    const tips = tipsClean_(payload.tips);
    const f = ghGetFile_(r.token, r.repo, r.branch, TIPS_PATH);
    ghPutFile_(r.token, r.repo, r.branch, TIPS_PATH, JSON.stringify({ tips: tips }, null, 2) + '\n',
      '학습 팁 갱신 (' + tips.length + '개)', f ? f.sha : null);
    return { status: 'ok', tips: tips };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}
