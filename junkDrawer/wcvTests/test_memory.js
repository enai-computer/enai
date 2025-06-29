// test_memory.js
const { app, BrowserWindow, WebContentsView } = require('electron');
const os = require('os');

let memoryInterval;
let views = [];

function formatBytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getMemoryInfo() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const processMemory = process.memoryUsage();
  
  return {
    system: {
      total: formatBytes(totalMem),
      used: formatBytes(usedMem),
      free: formatBytes(freeMem),
      percentUsed: ((usedMem / totalMem) * 100).toFixed(1) + '%'
    },
    process: {
      rss: formatBytes(processMemory.rss), // Resident Set Size
      heapTotal: formatBytes(processMemory.heapTotal),
      heapUsed: formatBytes(processMemory.heapUsed),
      external: formatBytes(processMemory.external)
    }
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Memory Impact Test',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  console.log('=== MEMORY IMPACT TEST FOR MULTI-WEBCONTENTSVIEW ARCHITECTURE ===\n');
  console.log('This test will create multiple WebContentsViews and measure memory usage.');
  console.log('Each view represents a "window" in the proposed architecture.\n');

  // Take baseline measurement
  console.log('BASELINE (No WebContentsViews):');
  console.log(getMemoryInfo());
  console.log('');

  win.loadURL('data:text/html,' + encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { 
          font-family: monospace; 
          padding: 20px; 
          background: #1e1e1e; 
          color: #fff;
        }
        .status { margin-bottom: 20px; }
        pre { background: #2d2d2d; padding: 10px; border-radius: 4px; }
      </style>
    </head>
    <body>
      <h2>Memory Impact Test</h2>
      <div class="status">Creating WebContentsViews...</div>
      <pre id="log">Check the terminal for detailed memory statistics.</pre>
    </body>
    </html>
  `));

  // Start memory monitoring
  memoryInterval = setInterval(() => {
    if (views.length > 0) {
      console.log(`\nCurrent state: ${views.length} WebContentsViews active`);
      console.log(getMemoryInfo());
    }
  }, 5000);

  win.webContents.once('did-finish-load', async () => {
    console.log('Starting test sequence...\n');

    // Test 1: Create a browser tab view
    console.log('TEST 1: Creating 1 browser tab (Wikipedia)...');
    const browserView = new WebContentsView();
    win.contentView.addChildView(browserView);
    browserView.setBounds({ x: 50, y: 50, width: 600, height: 400 });
    browserView.webContents.loadURL('https://en.wikipedia.org/wiki/Main_Page');
    views.push({ type: 'browser', view: browserView });
    
    await new Promise(resolve => {
      browserView.webContents.once('did-finish-load', () => {
        console.log('Browser view loaded.');
        console.log(getMemoryInfo());
        resolve();
      });
    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Test 2: Add a React "note" view
    console.log('\nTEST 2: Adding a React-based note window...');
    const noteView = new WebContentsView();
    win.contentView.addChildView(noteView);
    noteView.setBounds({ x: 400, y: 200, width: 400, height: 300 });
    noteView.webContents.loadURL('data:text/html,' + encodeURIComponent(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
          .note { 
            height: 100vh; 
            background: #fff; 
            border: 2px solid #ddd; 
            padding: 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          }
          .note-header { font-weight: 600; margin-bottom: 10px; }
          .note-content { color: #666; }
        </style>
      </head>
      <body>
        <div class="note">
          <div class="note-header">📝 Note Window</div>
          <div class="note-content">
            This simulates a React-based note component running in its own WebContentsView.
            <br><br>
            In the real implementation, this would host your NoteEditor.tsx component.
          </div>
        </div>
      </body>
      </html>
    `));
    views.push({ type: 'note', view: noteView });
    
    await new Promise(resolve => {
      noteView.webContents.once('did-finish-load', () => {
        console.log('Note view loaded.');
        console.log(getMemoryInfo());
        resolve();
      });
    });

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Test 3: Add multiple browser tabs
    console.log('\nTEST 3: Adding 3 more browser tabs...');
    const sites = [
      'https://github.com',
      'https://news.ycombinator.com',
      'https://developer.mozilla.org'
    ];

    for (let i = 0; i < sites.length; i++) {
      const tabView = new WebContentsView();
      win.contentView.addChildView(tabView);
      tabView.setBounds({ x: 100 + (i * 30), y: 100 + (i * 30), width: 600, height: 400 });
      tabView.webContents.loadURL(sites[i]);
      views.push({ type: 'browser', view: tabView });
      
      await new Promise(resolve => {
        tabView.webContents.once('did-finish-load', () => {
          console.log(`Tab ${i + 2} loaded: ${sites[i]}`);
          resolve();
        });
      });
    }

    console.log('\nAfter adding 3 more browser tabs:');
    console.log(getMemoryInfo());

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Test 4: Add multiple note windows
    console.log('\nTEST 4: Adding 5 more note windows...');
    for (let i = 0; i < 5; i++) {
      const noteView = new WebContentsView();
      win.contentView.addChildView(noteView);
      noteView.setBounds({ x: 200 + (i * 40), y: 150 + (i * 40), width: 300, height: 200 });
      noteView.webContents.loadURL('data:text/html,<html><body style="background:#fff;padding:20px;"><h3>Note ' + (i + 2) + '</h3><p>Simple note content</p></body></html>');
      views.push({ type: 'note', view: noteView });
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('\nFINAL STATE:');
    console.log(`Total WebContentsViews: ${views.length}`);
    console.log(`- Browser tabs: ${views.filter(v => v.type === 'browser').length}`);
    console.log(`- Note windows: ${views.filter(v => v.type === 'note').length}`);
    console.log(getMemoryInfo());

    // Summary
    console.log('\n=== MEMORY IMPACT SUMMARY ===');
    console.log('Each WebContentsView creates a new renderer process.');
    console.log('Typical memory usage per view:');
    console.log('- Complex website (Wikipedia, GitHub): 50-150 MB');
    console.log('- Simple React component: 20-50 MB');
    console.log('- Minimal HTML content: 15-30 MB');
    console.log('\nFor a desktop with 10-20 windows, expect 500MB - 2GB of RAM usage.');

    // Cleanup after 10 seconds
    setTimeout(() => {
      clearInterval(memoryInterval);
      app.quit();
    }, 10000);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());