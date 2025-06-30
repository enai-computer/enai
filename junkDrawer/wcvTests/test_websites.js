// test_websites.js
const { app, BrowserWindow, WebContentsView } = require('electron');

const safetyTimeout = setTimeout(() => {
  console.error('--- SAFETY TIMEOUT REACHED (2 min) ---');
  app.quit();
}, 120000); // 2 minutes for website loading

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Real Websites Z-Order Test',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  console.log(`Running on Electron version: ${process.versions.electron}`);
  console.log('Creating two WebContentsViews with real websites...');

  // Create View 1 - Wikipedia
  const view1 = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });
  win.contentView.addChildView(view1);
  view1.setBounds({ x: 50, y: 50, width: 600, height: 600 });
  
  console.log('Loading Wikipedia in view1...');
  view1.webContents.loadURL('https://en.wikipedia.org/wiki/Main_Page');

  // Create View 2 - GitHub  
  const view2 = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });
  win.contentView.addChildView(view2);
  view2.setBounds({ x: 350, y: 150, width: 600, height: 600 });
  
  console.log('Loading GitHub in view2...');
  view2.webContents.loadURL('https://github.com');

  // Track loading states
  let view1Loaded = false;
  let view2Loaded = false;

  view1.webContents.on('did-finish-load', () => {
    view1Loaded = true;
    console.log('View 1 (Wikipedia) loaded successfully');
    checkBothLoaded();
  });

  view2.webContents.on('did-finish-load', () => {
    view2Loaded = true;
    console.log('View 2 (GitHub) loaded successfully');
    checkBothLoaded();
  });

  // Handle load failures
  view1.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('View 1 failed to load:', errorDescription);
  });

  view2.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('View 2 failed to load:', errorDescription);
  });

  function checkBothLoaded() {
    if (view1Loaded && view2Loaded) {
      console.log('\nBoth websites loaded! You should see:');
      console.log('- Wikipedia on the left (bottom layer)');
      console.log('- GitHub on the right (top layer), partially overlapping Wikipedia');
      console.log('\nStarting z-order test in 5 seconds...');

      setTimeout(() => {
        performZOrderTest();
      }, 5000);
    }
  }

  function performZOrderTest() {
    console.log('\n=== Z-ORDER TEST SEQUENCE ===');
    
    // Step 1: Bring Wikipedia to top
    console.log('1. Bringing Wikipedia to top...');
    win.contentView.removeChildView(view1);
    win.contentView.addChildView(view1);
    console.log('   ✓ Wikipedia should now overlap GitHub');

    // Step 2: After 3 seconds, bring GitHub back to top
    setTimeout(() => {
      console.log('\n2. Bringing GitHub back to top...');
      win.contentView.removeChildView(view2);
      win.contentView.addChildView(view2);
      console.log('   ✓ GitHub should now overlap Wikipedia again');

      // Step 3: Rapid switching test
      setTimeout(() => {
        console.log('\n3. Testing rapid switching (5 switches in 2 seconds)...');
        let count = 0;
        const rapidTest = setInterval(() => {
          if (count >= 5) {
            clearInterval(rapidTest);
            console.log('   ✓ Rapid switching test complete');
            
            // Close after 3 seconds
            setTimeout(() => {
              console.log('\nTest completed successfully. Closing...');
              clearTimeout(safetyTimeout);
              app.quit();
            }, 3000);
            return;
          }
          
          if (count % 2 === 0) {
            win.contentView.removeChildView(view1);
            win.contentView.addChildView(view1);
            console.log(`   Switch ${count + 1}: Wikipedia on top`);
          } else {
            win.contentView.removeChildView(view2);
            win.contentView.addChildView(view2);
            console.log(`   Switch ${count + 1}: GitHub on top`);
          }
          count++;
        }, 400); // Switch every 400ms
      }, 3000);
    }, 3000);
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());