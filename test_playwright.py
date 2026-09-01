import asyncio
from playwright.async_api import async_playwright

async def run_tests():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            args=['--no-sandbox']
        )
        context = await browser.new_context()
        page = await context.new_page()
        
        url = 'http://127.0.0.1:8765/index.html'
        
        # Test 1: Fresh load with sessionStorage cleared
        print('=== Test 1: Fresh Load (no role) ===')
        await page.goto(url)
        await page.evaluate('() => sessionStorage.clear()')
        await page.reload()
        
        visible_links_1 = await page.evaluate('''() => {
            const links = document.querySelectorAll('.menu__link');
            const visible = [];
            links.forEach(link => {
                const computed = window.getComputedStyle(link);
                const isHidden = computed.display === 'none' || 
                                 computed.visibility === 'hidden' || 
                                 computed.opacity === '0';
                if (!isHidden) {
                    visible.push(link.textContent.trim());
                }
            });
            return visible;
        }''')
        print('Visible menu links:', visible_links_1)
        
        # Test 2: Set site-auth-role=nv194
        print('\n=== Test 2: With site-auth-role=nv194 ===')
        await page.evaluate('''() => {
            sessionStorage.clear();
            sessionStorage.setItem('site-auth-role', 'nv194');
        }''')
        await page.reload()
        
        visible_links_2 = await page.evaluate('''() => {
            const links = document.querySelectorAll('.menu__link');
            const visible = [];
            links.forEach(link => {
                const computed = window.getComputedStyle(link);
                const isHidden = computed.display === 'none' || 
                                 computed.visibility === 'hidden' || 
                                 computed.opacity === '0';
                if (!isHidden) {
                    visible.push(link.textContent.trim());
                }
            });
            return visible;
        }''')
        print('Visible menu links:', visible_links_2)
        
        # Test 3: Set site-auth-role=full
        print('\n=== Test 3: With site-auth-role=full ===')
        await page.evaluate('''() => {
            sessionStorage.clear();
            sessionStorage.setItem('site-auth-role', 'full');
        }''')
        await page.reload()
        
        visible_links_3 = await page.evaluate('''() => {
            const links = document.querySelectorAll('.menu__link');
            const visible = [];
            links.forEach(link => {
                const computed = window.getComputedStyle(link);
                const isHidden = computed.display === 'none' || 
                                 computed.visibility === 'hidden' || 
                                 computed.opacity === '0';
                if (!isHidden) {
                    visible.push(link.textContent.trim());
                }
            });
            return visible;
        }''')
        print('Visible menu links:', visible_links_3)
        
        # Test 4: Check for lock icons and locked class on visible links
        print('\n=== Test 4: Lock icon/class check ===')
        lock_status = await page.evaluate('''() => {
            const links = document.querySelectorAll('.menu__link');
            const hasIssues = [];
            links.forEach(link => {
                const computed = window.getComputedStyle(link);
                const isHidden = computed.display === 'none' || 
                                 computed.visibility === 'hidden' || 
                                 computed.opacity === '0';
                if (!isHidden) {
                    const hasLockedClass = link.classList.contains('menu__link--locked');
                    const hasLockIcon = link.querySelector('[class*="lock"]') !== null || 
                                       link.textContent.includes('🔒');
                    if (hasLockedClass || hasLockIcon) {
                        hasIssues.push({
                            text: link.textContent.trim(),
                            hasLockedClass,
                            hasLockIcon
                        });
                    }
                }
            });
            return hasIssues;
        }''')
        if len(lock_status) == 0:
            print('Result: NONE (OK) - No visible links have lock icons or locked classes')
        else:
            print('Result: ISSUES FOUND:', lock_status)
        
        # Test 5: Check NV 194 link text is exactly "NV 194"
        print('\n=== Test 5: NV 194 text verification ===')
        nv194_check = await page.evaluate('''() => {
            const links = document.querySelectorAll('.menu__link');
            const results = [];
            links.forEach(link => {
                const text = link.textContent.trim();
                if (text.includes('NV') && text.includes('194')) {
                    results.push({
                        text: text,
                        isExact: text === 'NV 194'
                    });
                }
            });
            return results;
        }''')
        if len(nv194_check) == 0:
            print('Result: No NV 194 link found in full role')
        else:
            for item in nv194_check:
                print(f'  Text: "{item["text"]}" | Exact match "NV 194": {item["isExact"]}')
        
        await browser.close()

asyncio.run(run_tests())
