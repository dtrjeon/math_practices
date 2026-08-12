#!/usr/bin/env python3
"""
normalize_and_register.py
새 문제지 JSON을 표준 스키마로 정규화하고 manifest.json에 자동 등록하는 스크립트.

사용법:
    python3 normalize_and_register.py <문제지.json> [--category exam|pastexam|textbook] [--group "그룹명"] [--title "제목"] [--dry-run]

동작:
1. diff 필드: 한글(최상/상/중상/중/하) → 영문 코드(top/high/midhigh/mid/low) 자동 변환
2. 내부 id 필드: 파일명(확장자 제외)과 강제로 동일하게 맞춤
3. manifest.json에 신규 항목이면 추가, 이미 있으면 스킵(경고만)
4. --dry-run이면 실제 파일 수정 없이 변경사항만 리포트
"""
import json, sys, argparse, os

DIFF_KO2EN = {"최상": "top", "상": "high", "중상": "midhigh", "중": "mid", "하": "low"}
VALID_DIFF = set(DIFF_KO2EN.values())

def normalize_worksheet(path, dry_run=False):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    changes = []
    fname_id = os.path.splitext(os.path.basename(path))[0]

    # 1. diff 필드 한글→영문 변환
    diff_fixed = 0
    for p in data.get("problems", []):
        d = p.get("diff")
        if d in DIFF_KO2EN:
            p["diff"] = DIFF_KO2EN[d]
            diff_fixed += 1
        elif d not in VALID_DIFF:
            changes.append(f"  ⚠ 문제 {p.get('num')}: 알 수 없는 diff 값 '{d}' — 수동 확인 필요")
    if diff_fixed:
        changes.append(f"  - diff 필드 한글→영문 변환: {diff_fixed}문제")

    # 2. 내부 id 필드를 파일명과 일치시킴
    if data.get("id") != fname_id:
        changes.append(f"  - 내부 id 필드 수정: '{data.get('id')}' → '{fname_id}'")
        data["id"] = fname_id

    if changes:
        print(f"[{os.path.basename(path)}]")
        for c in changes:
            print(c)
    else:
        print(f"[{os.path.basename(path)}] 변경사항 없음 (이미 표준 스키마)")

    if not dry_run and changes:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    return data, fname_id

def make_manifest_entry(data, fname_id, category, group, title):
    problems = data.get("problems", [])
    return {
        "id": fname_id,
        "file": fname_id + ".json",
        "category": category,
        "title": title or data.get("title", fname_id),
        "unit": data.get("unit", ""),
        "count": len(problems),
        "group": group or category,
    }

def register_to_manifest(manifest_path, entry, dry_run=False):
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)

    existing_ids = {s["id"] for s in manifest["sets"]}
    if entry["id"] in existing_ids:
        print(f"  ⚠ manifest.json에 이미 '{entry['id']}' 존재 — 스킵 (직접 확인 필요)")
        return manifest

    manifest["sets"].append(entry)
    print(f"  + manifest.json에 신규 세트 등록: {entry['id']} (총 {len(manifest['sets'])}세트)")

    if not dry_run:
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

    return manifest

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("worksheet_json")
    ap.add_argument("--manifest", default="worksheets-manifest.json")
    ap.add_argument("--category", default="exam", choices=["exam", "pastexam", "textbook"])
    ap.add_argument("--group", default=None)
    ap.add_argument("--title", default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    data, fname_id = normalize_worksheet(args.worksheet_json, dry_run=args.dry_run)
    if os.path.exists(args.manifest):
        entry = make_manifest_entry(data, fname_id, args.category, args.group, args.title)
        register_to_manifest(args.manifest, entry, dry_run=args.dry_run)
    else:
        print(f"  ⚠ manifest.json 없음 — 등록 스킵: {args.manifest}")
