"""src/ 를 합쳐 index.html 한 파일로 만든다: python3 build.py
(firebase-config.js 는 합치지 않고 따로 불러온다 — 설정만 바꿀 때 다시 빌드할 필요 없음)"""
import pathlib
d = pathlib.Path(__file__).parent
src = d / 'src'
read = lambda *names: '\n'.join((src / n).read_text(encoding='utf-8') for n in names)
GAMES = ['games/common.js', 'games/blackjack.js', 'games/roulette.js', 'games/baccarat.js', 'games/seotda.js']
s = (src / 'shell.html').read_text(encoding='utf-8')
for mark, text in [
    ('/*CSS*/', read('app.css', 'kit.css')),
    ('/*ENGINE*/', read('engine.js')),
    ('/*BACKEND*/', read('backend-firebase.js')),
    ('/*APP*/', read('app.js')),
    ('/*KIT*/', read(*GAMES, 'kit.js')),
    ('/*MAIN*/', read('main.js')),
]:
    assert s.count(mark) == 1, mark
    s = s.replace(mark, text)
(d / 'index.html').write_text(s, encoding='utf-8')
print('index.html', len(s), 'bytes')
