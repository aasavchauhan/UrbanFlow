from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    
    errors = []
    page.on("pageerror", lambda err: errors.append(err.message))
    page.on("console", lambda msg: print(f"CONSOLE [{msg.type}]: {msg.text}") if msg.type in ['error', 'warning'] else None)

    print("Navigating to http://localhost:3000...")
    page.goto('http://localhost:3000')
    page.wait_for_load_state('networkidle')
    
    print("Taking initial screenshot...")
    page.screenshot(path='c:/Users/Aasav/Documents/WORKPLACE/UrbanFlow/screenshot_initial.png', full_page=True)
    
    print("Clicking 'Simulate'...")
    simulate_btn = page.locator('.mode-btn[data-mode="SIMULATION"]')
    if simulate_btn.count() > 0:
        simulate_btn.click()
        page.wait_for_timeout(2000)
        
        print("Taking simulation screenshot...")
        page.screenshot(path='c:/Users/Aasav/Documents/WORKPLACE/UrbanFlow/screenshot_sim.png', full_page=True)
        
        print("Clicking 'Run AI' to test AI Mode...")
        ai_btn = page.locator('#btn-run-ai')
        if ai_btn.count() > 0:
            ai_btn.click()
            print("Waiting for AI Benchmark to complete (max 35 seconds)...")
            # Wait for the status badge to say "AI Complete" or pause
            page.locator('#sim-status-text', has_text='AI Complete').wait_for(timeout=40000)
            print("AI benchmark completed.")
        else:
            print("Could not find 'Run AI' button.")
    else:
        print("Could not find 'Simulate' button.")
    
    if len(errors) > 0:
        print("\nJavaScript Errors found:")
        for err in errors:
            print(f"- {err}")
    else:
        print("\nNo JavaScript errors detected.")
        
    browser.close()
