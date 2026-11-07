import asyncio, json, random, sys
from playwright.async_api import async_playwright

URL = 'http://localhost:8765/test/harness.html?names=A,B,C'
errors = []

async def table(page):
    return await page.evaluate("JSON.stringify(MOCK.store.get('tables/main')||null)")

def check(t, tag):
    if not t: return
    seats = [s for s in t['seats'] if s]
    stacks = sum(s['stack'] for s in seats)
    buy = sum(s['buyin'] for s in seats)
    h = t.get('hand')
    inpot = 0
    if h and h['phase'] != 'done':
        inpot = sum(p['total'] for p in h['ps'] if p)
    if stacks + inpot != buy:
        errors.append(f'{tag}: chip mismatch stacks={stacks} inpot={inpot} buyin={buy}')

async def click_if(frame, sel):
    loc = frame.locator(sel)
    if await loc.count() and await loc.first.is_enabled():
        await loc.first.click(timeout=2000)
        return True
    return False

async def play_turn(frame):
    if await frame.locator('.raise-panel').count():
        presets = frame.locator('.presets button')
        n = await presets.count()
        await presets.nth(random.randrange(n)).click()
        await frame.locator('.raise-panel .btn.raise').click()
        return 'raise'
    call = frame.locator('.actions .btn.call')
    if not await call.count():
        if await click_if(frame, '.actions .btn.primary:has-text("리바이")'): return 'rebuy'
        if await click_if(frame, '.actions .btn.primary:has-text("복귀")'): return 'back'
        return None
    r = random.random()
    if r < 0.15: await frame.locator('.actions .btn.fold').click(); return 'fold'
    if r < 0.35 and await frame.locator('.actions .btn.raise:not([disabled])').count():
        await frame.locator('.actions .btn.raise').click(); return 'open-raise'
    await call.click(); return 'call'

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        page = await b.new_page(viewport={'width': 1200, 'height': 800})
        page.on('console', lambda m: errors.append('console:' + m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append('pageerror:' + str(e)))
        await page.goto(URL)
        await page.wait_for_timeout(1800)
        frames = [page.frame_locator(f'#f{k}') for k in range(3)]
        await frames[0].locator('#app').screenshot(path='shots/00-empty.png')
        # join
        for k, f in enumerate(frames):
            await f.locator('.seat.tap .plate').first.click()
            await f.locator('#nameInput').fill(['민수', '지영', '도우너'][k])
            await f.locator('.modal .btn.primary').click()
            await page.wait_for_timeout(900)
        await page.wait_for_timeout(800)
        t = json.loads(await table(page))
        print('seated:', [s and s['name'] for s in t['seats']], 'host', t['hostId'])
        await frames[0].locator('.btn:has-text("봇 추가")').first.click()
        await page.wait_for_timeout(500)
        await frames[0].locator('.btn.primary:has-text("게임 시작")').click()
        await page.wait_for_timeout(1500)
        await frames[2].locator('#app').screenshot(path='shots/01-preflop.png')
        shots = 0; acts = 0; hands_seen = set(); last_shot = 0
        import time
        t0 = time.time()
        while time.time() - t0 < 35:
            for k, f in enumerate(frames):
                try:
                    a = await play_turn(f)
                    if a: acts += 1
                except Exception as e:
                    pass
            t = json.loads(await table(page))
            check(t, 'loop')
            if t and t.get('hand'): hands_seen.add(t['hand']['no'])
            if t and t.get('hand') and t['hand']['phase'] == 'done' and t['hand']['results']['showdown'] and shots < 2 and time.time() - last_shot > 8:
                await frames[2].locator('#app').screenshot(path=f'shots/02-showdown{shots}.png'); shots += 1; last_shot = time.time()
            await page.wait_for_timeout(350)
        print('hands', len(hands_seen), 'actions', acts)
        # raise panel screenshot
        for _ in range(60):
            if await frames[2].locator('.actions .btn.raise:not([disabled])').count():
                await frames[2].locator('.actions .btn.raise').click(); break
            for f in frames[:2]:
                try: await play_turn(f)
                except Exception: pass
            await page.wait_for_timeout(300)
        await page.wait_for_timeout(300)
        await frames[2].locator('#app').screenshot(path='shots/03-raise.png')
        await frames[2].locator('.raise-panel .btn.ghost').click() if await frames[2].locator('.raise-panel').count() else None
        # menu sheet
        await frames[0].locator('#menuBtn').click(); await page.wait_for_timeout(300)
        await page.locator('#f0').screenshot(path='shots/04-menu.png')
        await frames[0].locator('.sheet .btn.ghost:has-text("닫기")').click()
        # host leaves -> takeover
        before = json.loads(await table(page))
        await page.evaluate("document.getElementById('f0').contentWindow.claude._room.leave(); document.getElementById('f0').remove()")
        print('host removed; hand active:', before['hand'] and before['hand']['phase'])
        t1 = time.time(); took = None
        while time.time() - t1 < 45:
            for f in frames[1:]:
                try: await play_turn(f)
                except Exception: pass
            t = json.loads(await table(page)); check(t, 'after-takeover')
            if t['hostTab'] != before['hostTab'] and took is None:
                took = round(time.time() - t1, 1); print('takeover after', took, 's by', t['hostId'], 'epoch', t['epoch'])
            await page.wait_for_timeout(400)
        t = json.loads(await table(page))
        print('final hand no', t['handNo'], 'phase', t['hand'] and t['hand']['phase'], 'log tail', t['log'][-4:])
        await frames[1].locator('#app').screenshot(path='shots/05-after.png')
        # check encryption: no plaintext hole cards in shared doc during active hand
        enc = t['hand'] and t['hand'].get('enc') or {}
        print('enc sample', {k: list(v.keys()) for k, v in enc.items()})
        print('writes', await page.evaluate('MOCK.stats()'))
        await b.close()
    print('ERRORS:' if errors else 'no errors', *errors[:20], sep='\n')

asyncio.run(main())
