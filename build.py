"""src/ 를 합쳐 index.html 한 파일로 만든다: python3 build.py
(firebase-config.js 는 합치지 않고 따로 불러온다 — 설정만 바꿀 때 다시 빌드할 필요 없음)"""
import pathlib
d = pathlib.Path(__file__).parent
src = d / 'src'
s = (src / 'shell.html').read_text(encoding='utf-8')
s = (s.replace('/*CSS*/', (src / 'app.css').read_text(encoding='utf-8'))
      .replace('/*ENGINE*/', (src / 'engine.js').read_text(encoding='utf-8'))
      .replace('/*BACKEND*/', (src / 'backend-firebase.js').read_text(encoding='utf-8'))
      .replace('/*APP*/', (src / 'app.js').read_text(encoding='utf-8')))
(d / 'index.html').write_text(s, encoding='utf-8')
print('index.html', len(s), 'bytes')
