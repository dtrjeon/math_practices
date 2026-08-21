/**
 * ============================================================
 * 사용자 등록/로그인 + 검토 대기열 백엔드 애드온
 * ------------------------------------------------------------
 * gas-github-upload-addon.gs(ghGetFile_/ghPutFile_ 등)가 이미 병합되어
 * 있어야 동작합니다. 이 파일은 그 위에 추가로 병합하는 코드입니다.
 *
 * 필요한 준비물
 *  1) 기존 Google Sheet(오답 로그가 쌓이는 그 시트)에 "Users"라는 이름의
 *     새 탭을 만들고 첫 줄에 헤더를 넣으세요:
 *     studentId | name | school | grade | phone | passwordHash | createdAt
 *  2) 스크립트 속성에 TEACHER_EMAIL 추가 (검토 대기 알림 받을 이메일)
 *  3) doPost() 안 action 분기에 아래 5개 케이스 추가:
 *
 *     if (action === 'registerUser')          return jsonResponse_(handleRegisterUser_(payload));
 *     if (action === 'loginUser')             return jsonResponse_(handleLoginUser_(payload));
 *     if (action === 'changePassword')        return jsonResponse_(handleChangePassword_(payload));
 *     if (action === 'pendingSubmitWorksheet') return jsonResponse_(handlePendingSubmitWorksheet_(payload));
 *     if (action === 'listPending')           return jsonResponse_(handleListPending_());
 *     if (action === 'approveWorksheet')      return jsonResponse_(handleApproveWorksheet_(payload));
 *     if (action === 'rejectWorksheet')       return jsonResponse_(handleRejectWorksheet_(payload));
 *
 *  ※ 기존 submitWorksheet 액션은 그대로 둬도 되고(예: 선생님이 직접 등록할 때),
 *    학생용 upload.html은 이제 pendingSubmitWorksheet를 씁니다.
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
      return { rowIndex: i + 1, studentId: rows[i][0], name: rows[i][1], school: rows[i][2], grade: rows[i][3], phone: rows[i][4], passwordHash: rows[i][5] };
    }
  }
  return null;
}

function findUserById_(studentId) {
  const sheet = getUsersSheet_();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(studentId)) {
      return { rowIndex: i + 1, studentId: rows[i][0], name: rows[i][1], school: rows[i][2], grade: rows[i][3], phone: rows[i][4], passwordHash: rows[i][5] };
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

  return { status: 'ok', studentId: studentId, name: name, school: school, grade: grade };
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
  return { status: 'ok', studentId: user.studentId, name: user.name, school: user.school, grade: user.grade };
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
 * payload: { id }
 * data/_pending/<file> → data/<file>로 옮기고 manifest에 반영, pending에서는 제거.
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
