SOUND LAYER · 공모전 영상

너는 소리를 들을 수 없다. 실제 CC0 녹음과 코드로 만든 소리만 쓰고, 소리는 하나하나
직접 고르고, 타임라인에서 배치하고, 모든 소리를 그림(파형·스펙트로그램)으로 확인하고,
판단은 검사 스크립트에 맡긴다. 최종 청취 확인은 사람이 한다.

0 준비  video-sound-kit/README.md의 "준비물"대로 sound-layer(opus-sound-layer, 고정
커밋)와 earshot(고정 커밋)을 설치한다. 두 도구의 스크립트를 고쳐 쓰거나 검사 기준을
느슨하게 바꾸지 않는다. 공고 체크리스트가 비어 있으면 먼저 사용자에게 묻는다.

1 큐  그림의 실제 타이밍(spring, easing, data-start)에서 audio/cues.json을 뽑는다.
프레임 번호를 손으로 치지 않는다. 형식: uv run sound-layer/scripts/mix.py --schema.
실제 동작에만 소리를 단다: cut(화면 전체 전환) · move(가장 빠른 프레임) ·
land(멈추는 프레임) · appear(요소 등장). 공모전 영상은 과하지 않게: 히어로 큐(로고,
핵심 메시지 공개)는 영상 전체에서 2~3개 이하. 차분한 영상이면 "energy": "calm".
내레이션이 있으면 voice에 넣어 배경음이 자동으로 내려가게 한다.

2 소리  기본은 sound-layer 라이브러리(전부 CC0):
  uv run sound-layer/scripts/sfx.py browse --type <type> --like "<재질, 무게, 분위기>"
  audio/browse.png를 보고 고른 id를 큐에 넣는다. 종류 이름만("click") 쓰지 말고 id를 쓴다:
  기본음이 없는 종류는 나중에 추가한 소리까지 돌아가며 섞이기 때문이다.
영화 예고편 같은 충격음(hit, boom, glitch, riser)은 영상 성격에 맞을 때만 쓴다.
알림음·탭·토글·차임처럼 부드러운 UI 소리가 필요하거나 라이브러리에 맞는 게 없으면 earshot:
  earshot sfx list --kind <kind>
  earshot sfx render <id> -o audio/own/<이름>.wav [--dur S] [--apex S] [--pitch NOTE]
  earshot sfx check audio/own/<이름>.wav
  uv run sound-layer/scripts/sfx.py add audio/own/<이름>.wav --type <type> \
      --credit "earshot <id>, code-generated (no recording), earshot MIT"
그래도 없으면 sfx.py search "<재질 동작>" --type <type> (CC0만 검색됨).
CC0가 아닌 소리는 쓰지 않는다. 밈 소리 금지. 영상 한 편은 한 가지 소리 계열로 통일하고,
반복되는 소리는 변화를 준다.
라이브러리 밖에서 들인 모든 파일(음악, 내레이션, 직접 만든 소리)은 audio/sources.json에
출처와 라이선스를 적는다 (양식: video-sound-kit/examples/sources.example.json).
음악은 사용자가 준 곡이나 CC0 루프만 쓴다.

3 빌드  그림을 무음으로 렌더링한 뒤:
  uv run sound-layer/scripts/mix.py audio/cues.json
  ffmpeg -i video.mp4 -i audio/mix.wav -map 0:v -map 1:a -c:v copy -c:a aac \
      -b:a 256k -shortest out/final.mp4
  uv run sound-layer/scripts/qa.py out/final.mp4
  python3 video-sound-kit/check_license.py audio/cues.json --kit audio/kit \
      --sources audio/sources.json

4 검증  qa.py와 check_license.py의 모든 FAIL은 큐나 소리를 바꿔서 고친다(최대 2회).
라이선스 FAIL은 그 소리를 빼거나 CC0/earshot 소리로 바꾸는 것 말고는 고칠 방법이 없다.
audio/qa.png를 열고 히어로 큐마다 보이는 것을 설명한다.

5 전달  out/final.mp4 · audio/kit/CREDITS.md · audio/sources.json ·
check_license.py 출력 · LISTEN.md(사람이 귀로 확인할 타임코드 5개).
소리가 좋다고 말하지 말고 검사 결과만 보고한다.
