#!/usr/bin/env python3
"""
문제지 JSON에서 쓰인 LaTeX 명령·환경을 세어 출력한다.
json_viewer(오프라인 자체 렌더러)가 지원하지 않는 명령을 찾을 때 쓴다.

사용법:
    python scripts/latex_commands.py data/hakpyeong/*.json
"""
import json
import re
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
cmds, envs = Counter(), Counter()
for path in sys.argv[1:]:
    data = json.load(open(path, encoding="utf-8"))
    for p in data.get("problems", []):
        text = json.dumps({k: v for k, v in p.items() if k != "images"}, ensure_ascii=False)
        text = text.replace("\\\\", "\\")   # JSON 이스케이프 해제
        for env in re.findall(r"\\begin\{(\w+)\}", text):
            envs[env] += 1
        for c in re.findall(r"\\([A-Za-z]+|[^A-Za-z\s])", text):
            cmds[c] += 1
print("환경:", dict(envs))
print("명령:", ", ".join(f"{c}({n})" for c, n in cmds.most_common()))
