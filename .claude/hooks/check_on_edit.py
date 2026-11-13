#!/usr/bin/env python3
"""
PostToolUse 훅 (Edit|Write|MultiEdit) — Claude가 파일을 고친 직후 자동 검사.
  - data/**/*.json        → scripts/validate_worksheets.py 로 스키마 검사
  - *.html                → 인라인 <script> 를 node --check 로 문법 검사(node 없으면 건너뜀)
오류가 있으면 exit 2 + stderr 로 Claude에게 돌려줘서 바로 고치게 한다. 경고는 막지 않는다.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def check_json(path):
    r = subprocess.run(
        [sys.executable, "-I", os.path.join(ROOT, "scripts", "validate_worksheets.py"), "--quiet", path],
        capture_output=True, text=True, encoding="utf-8",
    )
    if r.returncode != 0:
        return [line for line in r.stdout.splitlines() if line.startswith("ERROR")] or [r.stdout + r.stderr]
    return []


def check_html(path):
    node = shutil.which("node")
    if not node:
        return []
    with open(path, encoding="utf-8") as f:
        html = f.read()
    errors = []
    # src 없는 인라인 스크립트만 (type이 JSON 등인 건 제외)
    for i, m in enumerate(re.finditer(r"<script(?![^>]*\bsrc=)(?![^>]*type=\"application/)[^>]*>(.*?)</script>", html, re.S)):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as t:
            t.write(m.group(1))
            tmp = t.name
        try:
            r = subprocess.run([node, "--check", tmp], capture_output=True, text=True, encoding="utf-8")
            if r.returncode != 0:
                line_offset = html[: m.start(1)].count("\n")
                msg = r.stderr.strip().splitlines()
                errors.append(f"<script> #{i} (HTML {line_offset}행 이후): " + " | ".join(msg[:4]))
        finally:
            os.unlink(tmp)
    return errors


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    path = (payload.get("tool_input") or {}).get("file_path") or ""
    if not path or not os.path.exists(path):
        return 0
    relp = os.path.relpath(os.path.abspath(path), ROOT).replace("\\", "/")
    if relp.startswith(".."):
        return 0

    errors = []
    if relp.startswith("data/") and relp.endswith(".json") and "/materials/" not in relp:
        errors = check_json(path)
    elif relp.endswith(".html"):
        errors = check_html(path)

    if errors:
        sys.stderr.write(f"[check_on_edit] {relp} 검사 실패:\n" + "\n".join(errors[:30]) + "\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
