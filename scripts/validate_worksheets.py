#!/usr/bin/env python3
"""
validate_worksheets.py
문제지 JSON · worksheets-manifest.json · study-plan.json 의 정합성을 검사한다.
Claude Code 훅(.claude/hooks)과 GitHub Actions, 사람이 직접 실행할 때 모두 이 스크립트를 쓴다.

사용법:
    python scripts/validate_worksheets.py                 # 저장소 전체 검사
    python scripts/validate_worksheets.py data/xxx.json   # 특정 파일만
    python scripts/validate_worksheets.py --strict        # 경고도 실패로 처리

결과:
    ERROR  — player.html이 깨지거나 채점이 틀어지는 문제 (exit 1)
    WARN   — 동작은 하지만 표준 스키마와 다른 것 (구 스키마, id 불일치 등)

문제 단위 규칙은 Code.gs 3부의 aiValidateProblems_()와 같게 유지할 것.
"""
import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
MANIFEST = os.path.join(DATA, "worksheets-manifest.json")
STUDY_PLAN = os.path.join(DATA, "study-plan.json")
TIPS = os.path.join(DATA, "tips.json")
# Code.gs 4부의 TIPS_URL_RE와 같은 규칙
TIP_URL_RE = re.compile(r"^https://www\.instagram\.com/(p|reel)/[A-Za-z0-9_-]+/$")

VALID_DIFF = {"low", "mid", "midhigh", "high", "top"}
LEGACY_DIFF = {"최상", "상", "중상", "중", "하"}
VALID_TYPE = {"mc", "mc_multi", "fillin", "subjective", "essay", "discussion", "game"}
LEGACY_TYPE = {"mcq", "short"}
# data/ 안에 있지만 문제지가 아닌 파일
NON_WORKSHEET = {"exam-ranges.json", "publishers.json", "study-plan.json", "worksheets-manifest.json", "_index.json", "tips.json", "curriculum.json"}


class Report:
    def __init__(self):
        self.errors, self.warns = [], []

    def err(self, where, msg):
        self.errors.append(f"{where}: {msg}")

    def warn(self, where, msg):
        self.warns.append(f"{where}: {msg}")


def rel(path):
    try:
        return os.path.relpath(path, ROOT).replace("\\", "/")
    except ValueError:   # 다른 드라이브(D:\ 등)의 파일은 상대경로를 만들 수 없다 → 절대경로로 표시
        return os.path.abspath(path).replace("\\", "/")


def load_json(path, rep):
    try:
        with open(path, encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception as e:  # noqa: BLE001 — 파싱 실패 원인을 그대로 보여준다
        rep.err(rel(path), f"JSON 파싱 실패 — {e}")
        return None


def latex_balanced(text):
    return text.count("\\(") == text.count("\\)") and text.count("\\[") == text.count("\\]")


def check_problem(p, where, rep):
    if not isinstance(p, dict):
        rep.err(where, "문제 항목이 객체가 아님(null/깨진 항목)")
        return None
    num = p.get("num", p.get("number"))
    if num is None:
        rep.err(where, "num 없음")
    elif "num" not in p:
        rep.warn(where, "구 스키마 number 사용 — num으로 바꾸기 권장")
    # num은 숫자 또는 문자열 둘 다 허용("0398", "V-1" 같은 교재 번호 그대로 쓰는 경우)
    where = f"{where}(#{num})"

    diff = p.get("diff", p.get("difficulty"))
    if diff in LEGACY_DIFF:
        rep.warn(where, f"diff 한글 '{diff}' — normalize_and_register.py로 영문 코드 변환")
    elif diff not in VALID_DIFF:
        rep.warn(where, f"diff 값 '{diff}' 알 수 없음")

    typ = p.get("type")
    if typ in LEGACY_TYPE:
        rep.warn(where, f"구 스키마 type '{typ}'")
        typ = {"mcq": "mc", "short": "fillin"}[typ]
    elif typ not in VALID_TYPE:
        rep.err(where, f"type '{typ}' 알 수 없음")

    q = p.get("question")
    if not isinstance(q, str) or not q.strip():
        rep.err(where, "question 없음")
        q = ""

    sol = p.get("solution", p.get("explanation"))
    if isinstance(sol, str):
        rep.warn(where, "solution이 문자열 — 줄 단위 배열 권장")
        sol = [sol]
    elif not sol:
        rep.warn(where, "solution 비어 있음")
        sol = []

    choices = p.get("choices") or []
    if typ in ("mc", "mc_multi"):
        if len(choices) != 5:
            rep.warn(where, f"choices {len(choices)}개(5개가 표준)")
        correct = p.get("correct")
        if correct is None and isinstance(p.get("answer"), int):
            rep.warn(where, "correct 없이 answer(1-based) 사용 — 구 스키마")
            correct = p["answer"] - 1
        idx = correct if isinstance(correct, list) else [correct]
        if correct is None or correct == []:
            # 아직 정답을 안 넣은 문제(쎈 B단계 등). 채점은 안 되지만 화면은 뜬다.
            rep.warn(where, "객관식 정답(correct) 미입력 — 채점 불가")
        elif not all(isinstance(c, int) and 0 <= c < max(len(choices), 1) for c in idx):
            rep.err(where, f"correct '{p.get('correct')}'가 choices 범위(0-based)를 벗어남")
    elif typ == "fillin":
        if p.get("answer") in (None, ""):
            rep.warn(where, "단답형 정답(answer) 미입력 — 채점 불가")

    # player.html은 solution 줄마다 따로 렌더링한다 — \[ 와 \] 가 다른 줄에 있으면 수식이 글자 그대로 보인다
    split = [k + 1 for k, line in enumerate(sol) if not latex_balanced(str(line))]
    if split:
        rep.err(where, f"solution {split}번째 줄에서 수식이 여러 줄로 쪼개짐 — \\[ … \\] 블록은 한 줄에 써야 함")

    text = " ".join(str(x) for x in [q, *choices, *sol])
    if not latex_balanced(text):
        rep.err(where, "LaTeX \\( \\) 또는 \\[ \\] 짝이 안 맞음")
    if re.search(r"(?<!\\)\$", text):
        rep.warn(where, "$ 수식 구분자 사용 — 앱은 \\( \\)만 렌더링")
    return num


def check_worksheet(path, rep):
    data = load_json(path, rep)
    if data is None:
        return None
    where = rel(path)
    if not isinstance(data, dict) or not isinstance(data.get("problems"), list):
        rep.err(where, "최상위에 problems 배열이 없음")
        return None
    stem = os.path.splitext(os.path.basename(path))[0]
    if "id" not in data:
        rep.warn(where, "id 필드 없음")
    elif data["id"] != stem:
        rep.warn(where, f"id '{data['id']}' ≠ 파일명 '{stem}'")
    if not data.get("title"):
        rep.warn(where, "title 없음")
    seen = set()
    for i, p in enumerate(data["problems"]):
        num = check_problem(p, f"{where} problems[{i}]", rep)
        if num is not None:
            key = str(num)
            if key in seen:
                rep.err(f"{where} problems[{i}]", f"num {num} 중복")
            seen.add(key)
    return data


def worksheet_files():
    files = []
    for f in glob.glob(os.path.join(DATA, "**", "*.json"), recursive=True):
        parts = rel(f).split("/")
        if os.path.basename(f) in NON_WORKSHEET or "materials" in parts:
            continue
        files.append(f)
    return sorted(files)


def check_manifest(rep, worksheets):
    manifest = load_json(MANIFEST, rep)
    if manifest is None:
        return set()
    where = rel(MANIFEST)
    ids, files = set(), set()
    for i, s in enumerate(manifest.get("sets", [])):
        w = f"{where} sets[{i}]({s.get('id')})"
        for k in ("id", "file", "category", "title", "count"):
            if k not in s:
                rep.err(w, f"{k} 없음")
        if s.get("id") in ids:
            rep.err(w, "id 중복")
        ids.add(s.get("id"))
        if s.get("category") not in (manifest.get("categories") or {}):
            rep.warn(w, f"category '{s.get('category')}'가 categories에 없음")
        f = s.get("file")
        if not f:
            continue
        full = os.path.normpath(os.path.join(DATA, f))
        files.add(full)
        if not os.path.exists(full):
            rep.err(w, f"파일 없음: data/{f}")
            continue
        data = worksheets.get(full)
        if data is not None and isinstance(s.get("count"), int) and s["count"] != len(data["problems"]):
            rep.warn(w, f"count {s['count']} ≠ 실제 문제 수 {len(data['problems'])}")
    for full in worksheets:
        if os.path.normpath(full) not in files and "_pending" not in rel(full):
            rep.warn(rel(full), "manifest에 등록 안 됨(학생 목록에 안 보임)")
    return ids


def check_study_plan(rep, manifest_ids):
    if not os.path.exists(STUDY_PLAN):
        return
    plan = load_json(STUDY_PLAN, rep)
    if plan is None:
        return
    for d in plan.get("days", []):
        for t in d.get("tasks", []):
            s = t.get("set")
            if s and s not in manifest_ids:
                rep.err(f"{rel(STUDY_PLAN)} {d.get('date')}", f"set '{s}'가 manifest에 없음")
            if "from" in t and "to" in t and t["from"] > t["to"]:
                rep.err(f"{rel(STUDY_PLAN)} {d.get('date')}", f"from {t['from']} > to {t['to']}")


def check_tips(rep):
    if not os.path.exists(TIPS):
        return
    data = load_json(TIPS, rep)
    if data is None:
        return
    where = rel(TIPS)
    seen = set()
    for i, t in enumerate(data.get("tips", [])):
        w = f"{where} tips[{i}]"
        if not isinstance(t, dict):
            rep.err(w, "객체가 아님")
            continue
        url = t.get("url", "")
        if not TIP_URL_RE.match(url):
            rep.err(w, f"Instagram 게시물 링크 형식이 아님: '{url}' (https://www.instagram.com/p/코드/)")
        if url in seen:
            rep.err(w, "같은 게시물 중복")
        seen.add(url)
        if not str(t.get("title", "")).strip():
            rep.err(w, "title(한 줄 요약) 없음")
        bad = [g for g in t.get("grades", []) if g not in ("m0", "m1", "m2")]
        if bad:
            rep.err(w, f"grades 값 {bad} — m0/m1/m2만")
        if not t.get("units"):
            rep.warn(w, "units 태그 없음 — 풀이 화면 '관련 학습 팁'에 안 나옴")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", help="검사할 파일(없으면 전체)")
    ap.add_argument("--strict", action="store_true", help="경고도 실패로 처리")
    ap.add_argument("--quiet", action="store_true", help="경고는 개수만 출력")
    args = ap.parse_args()

    rep = Report()
    if args.files:
        for f in args.files:
            full = os.path.abspath(f)
            name = os.path.basename(full)
            if name == "worksheets-manifest.json":
                check_manifest(rep, {w: check_worksheet(w, Report()) for w in worksheet_files()})
            elif name == "tips.json":
                check_tips(rep)
            elif name == "study-plan.json":
                ids = {s.get("id") for s in (load_json(MANIFEST, rep) or {}).get("sets", [])}
                check_study_plan(rep, ids)
            elif name in NON_WORKSHEET:
                load_json(full, rep)
            else:
                check_worksheet(full, rep)
    else:
        worksheets = {os.path.normpath(w): check_worksheet(w, rep) for w in worksheet_files()}
        ids = check_manifest(rep, worksheets)
        check_study_plan(rep, ids)
        check_tips(rep)

    for e in rep.errors:
        print("ERROR", e)
    if args.quiet:
        if rep.warns:
            print(f"WARN  {len(rep.warns)}건 (--quiet 없이 실행하면 목록 표시)")
    else:
        for w in rep.warns:
            print("WARN ", w)
    print(f"\n오류 {len(rep.errors)}건, 경고 {len(rep.warns)}건")
    failed = rep.errors or (args.strict and rep.warns)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
