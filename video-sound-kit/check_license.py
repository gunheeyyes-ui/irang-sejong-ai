#!/usr/bin/env python3
"""공모전 영상 라이선스 검사: 영상에 들어간 모든 소리가 허용 라이선스인지 확인한다.

  python3 check_license.py audio/cues.json [--kit audio/kit] [--sources audio/sources.json] [--allow-by]

읽는 것
  cues.json     opus-sound-layer mix.py 큐 시트 (cues[].sound, music.file, voice[].file)
  --kit         sfx.py kit 이 만든 라이브러리 (catalog.json, CREDITS.md)
  --sources     라이브러리 밖에서 들인 파일의 출처 대장 (examples/sources.example.json)

허용   cc0, pdm, earshot(코드로 만든 소리), own(직접 제작), licensed(유료 구매, proof 필수)
조건부 by (--allow-by 를 줄 때만; 출처 자막 문구를 출력)
금지   by-nc*, by-nd, by-sa, 출처 불명

하나라도 FAIL 이면 exit 1. 표준 라이브러리만 쓴다.
"""
import argparse
import json
import os
import re
import sys

ALLOWED = {"cc0", "pdm", "earshot", "own"}
AUDIO_EXT = (".wav", ".mp3", ".ogg", ".flac", ".m4a", ".aac")
LICENSE_FIELD = re.compile(r"^(?:CC[ -]?)?(CC0|PDM|BY(?:-NC)?(?:-SA|-ND)?)(?:[ -]\d\.\d)?$")


def norm_path(p):
    return os.path.normpath(p).replace(os.sep, "/")


def license_from_text(text):
    """'"Title" by Creator, CC0, https://…' 형식의 출처 문구에서 라이선스를 뽑는다."""
    for field in (f.strip().upper() for f in text.split(",")):
        m = LICENSE_FIELD.match(field)
        if m:
            return m.group(1).lower()
        if field in ("PUBLIC DOMAIN", "CC0 1.0"):
            return "cc0" if "CC0" in field else "pdm"
    low = text.lower()
    if "earshot" in low and "code-generated" in low:
        return "earshot"
    return None


def verdict(lic, entry, allow_by):
    """(PASS|WARN|FAIL, 이유)"""
    if lic in ALLOWED:
        return "PASS", ""
    if lic == "licensed":
        if entry and entry.get("proof"):
            return "PASS", "유료 라이선스: 공모전 2차 활용 허용 여부는 약관으로 직접 확인"
        return "FAIL", "licensed 인데 proof(구매 증빙) 없음"
    if lic == "by":
        if allow_by:
            return "WARN", "CC BY: 영상 끝 출처 자막 필수"
        return "FAIL", "CC BY 는 기본 금지 (공고가 출처 표기를 허용하면 --allow-by)"
    if lic in ("by-nc", "by-nc-sa", "by-nc-nd"):
        return "FAIL", "비영리 조건: 주최 측 홍보·상업 활용 시 위반"
    if lic in ("by-nd",):
        return "FAIL", "변경 금지: 자르기·음량 조절도 변경으로 볼 여지"
    if lic in ("by-sa",):
        return "FAIL", "동일조건 공개: 저작권 양도와 충돌"
    return "FAIL", "라이선스를 확인할 수 없음 (sources.json 에 출처를 적을 것)"


class Library:
    def __init__(self, root):
        self.root = root
        cat_path = os.path.join(root, "catalog.json")
        self.catalog = json.load(open(cat_path, encoding="utf-8")) if os.path.exists(cat_path) else None
        self.by_id = {e["id"]: e for e in (self.catalog or {}).get("sounds", [])}
        self.credit_lines = {}
        self.pack_lines = []
        cred = os.path.join(root, "CREDITS.md")
        if os.path.exists(cred):
            for line in open(cred, encoding="utf-8"):
                line = line.strip()
                if not line.startswith("- "):
                    continue
                body = line[2:]
                head, sep, rest = body.partition(": ")
                if sep and "/" in head and " " not in head:
                    self.credit_lines[head] = rest
                else:
                    self.pack_lines.append(body)

    def ids_for(self, token):
        """mix.py Kit.resolve 와 같은 규칙으로 토큰을 라이브러리 id 목록으로 푼다."""
        if "/" in token:
            return [token[:-4] if token.endswith(".wav") else token]
        if self.catalog and self.catalog["types"].get(token, {}).get("defaults"):
            return list(self.catalog["types"][token]["defaults"])
        d = os.path.join(self.root, token)
        if os.path.isdir(d):
            return sorted(f"{token}/{f[:-4]}" for f in os.listdir(d) if f.endswith(".wav"))
        return []

    def license_of(self, sid, sources_by_kit_id):
        if sid in sources_by_kit_id:
            e = sources_by_kit_id[sid]
            return e.get("license", "").lower() or None, e, "sources.json"
        name = sid.split("/", 1)[-1]
        entry = self.by_id.get(sid)
        if name.startswith("kenney-"):
            credit = (entry or {}).get("credit", "")
            for line in self.pack_lines:
                if credit and line.startswith(credit + ","):
                    return license_from_text(line), None, "CREDITS.md (Kenney)"
            return None, None, "CREDITS.md 에 Kenney 묶음 줄 없음"
        if sid in self.credit_lines:
            return license_from_text(self.credit_lines[sid]), None, "CREDITS.md"
        if entry:
            return license_from_text(entry.get("credit", "")), None, "catalog.json credit"
        return None, None, "라이브러리에 없는 id"


def load_sources(path):
    if not path or not os.path.exists(path):
        return {}, {}
    data = json.load(open(path, encoding="utf-8"))
    by_path, by_kit = {}, {}
    for e in data.get("files", []):
        if e.get("path"):
            by_path[norm_path(e["path"])] = e
        if e.get("kit_id"):
            by_kit[e["kit_id"]] = e
    return by_path, by_kit


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cues")
    ap.add_argument("--kit")
    ap.add_argument("--sources", default="audio/sources.json")
    ap.add_argument("--allow-by", action="store_true")
    a = ap.parse_args()

    cues = json.load(open(a.cues, encoding="utf-8"))
    lib = Library(a.kit or cues.get("kit", "audio/kit"))
    by_path, by_kit = load_sources(a.sources)
    rows, attributions = [], []

    def check_file(where, path):
        e = by_path.get(norm_path(path))
        lic = (e or {}).get("license", "").lower() or None
        v, why = verdict(lic, e, a.allow_by)
        rows.append((v, where, path, lic or "?", why or "sources.json"))
        if lic == "by" and e:
            attributions.append(f'"{e.get("title", path)}" by {e.get("creator", "?")}, CC BY, {e.get("url", "")}')

    for c in cues.get("cues", []):
        where = f'cue {c.get("id", "?")}'
        for token in str(c.get("sound", "")).split("+"):
            token = token.strip()
            if not token:
                continue
            if token.startswith("synth:"):
                rows.append(("PASS", where, token, "code", "mix.py 내장 합성음"))
            elif os.path.isfile(token) or (token.lower().endswith(AUDIO_EXT) and token[:-4] not in lib.by_id):
                check_file(where, token)   # mix.py 와 같은 순서: 실제 파일 경로가 라이브러리 id 보다 먼저
            else:
                ids = lib.ids_for(token)
                if not ids:
                    rows.append(("FAIL", where, token, "?", "라이브러리에서 찾을 수 없음 (sfx.py kit 을 먼저 실행했는지 확인)"))
                for sid in ids:
                    lic, e, src = lib.license_of(sid, by_kit)
                    v, why = verdict(lic, e, a.allow_by)
                    rows.append((v, where, sid, lic or "?", why or src))
                    if lic == "by":
                        attributions.append(lib.credit_lines.get(sid) or (lib.by_id.get(sid) or {}).get("credit", sid))
    if cues.get("music"):
        check_file("music", cues["music"]["file"])
    for i, v in enumerate(cues.get("voice", [])):
        check_file(f"voice {i + 1}", v["file"])

    w = max([len(r[2]) for r in rows] + [10])
    for v, where, what, lic, why in rows:
        print(f"{v:4}  {where:14} {what:{w}}  {lic:9} {why}")
    fails = sum(r[0] == "FAIL" for r in rows)
    warns = sum(r[0] == "WARN" for r in rows)
    if attributions and a.allow_by:
        print("\n영상 끝 출처 자막에 넣을 문구:")
        for line in sorted(set(attributions)):
            print("  " + line)
    print(f"\n{len(rows)}개 소리 검사: PASS {len(rows) - fails - warns}, WARN {warns}, FAIL {fails}")
    if fails:
        print("FAIL 인 소리를 빼거나 CC0 / earshot 소리로 바꾸기 전에는 제출하지 마세요.")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
