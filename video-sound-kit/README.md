# video-sound-kit · 공모전 영상 효과음 세트

Claude가 코드(Remotion 등)로 만드는 공모전 영상에 **저작권 걱정 없는 효과음**을 붙이기 위한 세트입니다.
영상 한 편마다 이 폴더를 그 영상 프로젝트에 복사해서 씁니다.

| 파일 | 용도 |
|---|---|
| `PROMPT.md` | Claude Code에 붙여넣는 작업 지시문 (효과음 단계 전체) |
| `check_license.py` | 영상에 들어간 모든 소리가 허용 라이선스인지 검사. 하나라도 걸리면 실패(exit 1) |
| `examples/sources.example.json` | 라이브러리 밖에서 가져온 소리·음악·내레이션의 출처 대장 양식 |
| `examples/cues.example.json` | 효과음 큐 시트 예시 (opus-sound-layer `mix.py` 형식) |

## 쓰는 도구 (버전 고정)

| 도구 | 역할 | 고정 커밋 |
|---|---|---|
| [opus-sound-layer](https://github.com/Bodila51/opus-sound-layer) (MIT) | 뼈대. CC0 실제 녹음 1,139개, 타임라인 자동 배치, 내레이션 아래 배경음 낮추기, 음량 맞추기, 완성본 검사 | `52ac266a24b7dfd3cd06a28c34d5af360a8d7586` |
| [earshot](https://github.com/Leonxlnx/earshot) (MIT) | 보조. 코드로 만드는 효과음 252개(녹음 없음, 인터넷 불필요). 알림음·탭·토글 같은 부드러운 UI 소리 | `4ac3d2ac2b151e1c23376f9ce7f3047a17050013` |

**쓰지 않는 도구:** openverse-sfx. 검색 스크립트 하나뿐이고 같은 기능이 opus-sound-layer(`sfx.py search`, CC0만)에 이미 있습니다.
설명서가 CC0에서 결과가 부족하면 다른 CC 라이선스까지 넓히라고 안내하는데, 공모전에서는 위험합니다.

> 두 도구 모두 개인이 만든 초기 단계(alpha) 프로젝트입니다. 커밋을 고정해 두었으니 버전을 올릴 때는 다시 검토하세요.

## 라이선스 원칙

공모전은 수상작 저작권이 주최 측에 넘어가거나 홍보에 2차 활용되는 경우가 많습니다. 그래서 **아래 출처만 허용**합니다.

| 허용 | 근거 |
|---|---|
| `cc0`, `pdm` | 퍼블릭 도메인. 상업 이용·변경·양도 모두 자유 |
| `earshot` | earshot이 코드로 만든 소리. 녹음 원본이 없음 |
| `own` | 팀이 직접 녹음·작곡·녹화한 것 |
| `licensed` | 비용을 내고 산 라이선스(유료 음원, TTS 등). **증빙(`proof`) 필수**, 공모전 2차 활용까지 허용하는지 약관 확인 |

| 금지 | 이유 |
|---|---|
| CC BY-NC | 주최 측이 홍보·상업에 쓰면 위반 |
| CC BY-ND | 자르기·음량 조절도 변경으로 볼 여지 |
| CC BY-SA | 영상 전체를 같은 라이선스로 공개해야 해서 저작권 양도와 충돌 |
| CC BY | 기본 금지. 공고가 출처 표기를 허용하면 `--allow-by`로 풀고 영상 끝에 출처 자막 필수 |
| 출처 불명 | 유튜브·SNS에서 받은 소리, "무료 효과음" 사이트의 라이선스 미표기 파일 |

## 준비물

- `ffmpeg`, [`uv`](https://docs.astral.sh/uv/)
- 네트워크: opus-sound-layer 라이브러리를 처음 받을 때 `kenney.nl`, `cdn.freesound.org`, 추가 검색 시 `api.openverse.org`.
  earshot은 설치 후 인터넷이 필요 없습니다 (효과음 생성 `sfx` / `kit` 명령은 모델도 쓰지 않음).

```bash
# 뼈대
git clone https://github.com/Bodila51/opus-sound-layer sound-layer
git -C sound-layer checkout 52ac266a24b7dfd3cd06a28c34d5af360a8d7586
uv run sound-layer/scripts/sfx.py kit            # 첫 실행은 라이브러리 다운로드 (10분 내외)

# 보조 (설치 시 PyTorch까지 받아서 용량이 큼. 효과음 생성만 쓰면 모델 다운로드는 필요 없음)
uv tool install "earshot @ git+https://github.com/Leonxlnx/earshot@4ac3d2ac2b151e1c23376f9ce7f3047a17050013"
earshot sfx list --kind notify
```

## 영상 한 편 작업 순서

1. **공고 확인**: 아래 체크리스트를 먼저 채웁니다.
2. 영상(그림)을 소리 없이 렌더링합니다.
3. `PROMPT.md`를 Claude Code에 붙여넣어 효과음 단계를 진행합니다.
4. 라이선스 검사를 통과해야 제출합니다.
   ```bash
   python3 video-sound-kit/check_license.py audio/cues.json --kit audio/kit --sources audio/sources.json
   ```
5. 사람이 직접 들어보는 최종 확인. 도구는 소리를 측정할 뿐, 좋은지 판단하지 못합니다.

## 공고 체크리스트 (영상마다)

- [ ] 수상작 저작권·이용권이 주최 측에 귀속되는가? 2차 활용(홍보·상업)을 하는가?
- [ ] 생성형 AI 사용이 허용되는가? 사용 사실을 밝혀야 하는가? (영상 자체를 Claude로 만드는 것도 해당될 수 있음)
- [ ] 타인 저작물 사용 시 출처 표기 의무가 있는가? 표기 위치는? (영상 내 / 제출서류)
- [ ] 분량, 해상도, 파일 형식, 음량 기준이 있는가?
- [ ] 저작권 침해 시 수상 취소·환수 조항이 있는가? (있다면 `check_license.py` 결과와 `CREDITS.md`를 증빙으로 보관)

## 음량 기준

행정·공공 공모전처럼 차분한 영상은 큐 시트에 `"energy": "calm"`(−18 LUFS)을, 홍보·숏폼처럼 힘 있는 영상은
`"punchy"`(−14 LUFS, 유튜브 기준)를 씁니다. 공고에 음량 기준이 있으면 `"lufs"`로 덮어씁니다.
