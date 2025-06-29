// test_with_chrome.js
const { app, BrowserWindow, WebContentsView } = require('electron');
const path = require('path');

const safetyTimeout = setTimeout(() => {
  console.error('--- SAFETY TIMEOUT REACHED (2 min) ---');
  app.quit();
}, 120000);

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'WebContentsView with UI Chrome Test',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'test_chrome_preload.js')
    }
  });

  console.log(`Running on Electron version: ${process.versions.electron}`);
  console.log('Loading main window with React-like UI chrome...');

  // Load the main window HTML that will have our UI chrome
  win.loadURL('data:text/html,' + encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>UI Chrome Test</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #f5f5f5;
          overflow: hidden;
        }
        
        /* Top bar with tabs */
        .top-bar {
          background: #2c3e50;
          height: 48px;
          display: flex;
          align-items: center;
          padding: 0 16px;
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 1000;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .tabs {
          display: flex;
          gap: 8px;
          flex: 1;
        }
        
        .tab {
          background: #34495e;
          color: white;
          padding: 8px 16px;
          border-radius: 6px 6px 0 0;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .tab.active {
          background: #3498db;
        }
        
        .tab:hover {
          background: #4a5f7a;
        }
        
        .tab.active:hover {
          background: #2980b9;
        }
        
        /* Floating note/panel */
        .floating-panel {
          position: fixed;
          top: 80px;
          right: 30px;
          width: 300px;
          height: 400px;
          background: white;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          z-index: 999;
          padding: 20px;
          display: flex;
          flex-direction: column;
        }
        
        .panel-header {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 12px;
          padding-bottom: 12px;
          border-bottom: 1px solid #e0e0e0;
        }
        
        .panel-content {
          flex: 1;
          overflow-y: auto;
        }
        
        .note-editor {
          width: 100%;
          height: 200px;
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 12px;
          font-size: 14px;
          resize: none;
        }
        
        /* Area where WebContentsView should render */
        .browser-container {
          position: fixed;
          top: 48px;
          left: 0;
          right: 0;
          bottom: 0;
          background: #ddd;
        }
        
        /* Floating action button */
        .fab {
          position: fixed;
          bottom: 30px;
          right: 30px;
          width: 56px;
          height: 56px;
          background: #e74c3c;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 24px;
          cursor: pointer;
          box-shadow: 0 4px 8px rgba(0,0,0,0.2);
          z-index: 998;
          transition: transform 0.2s;
        }
        
        .fab:hover {
          transform: scale(1.1);
        }
        
        .status {
          position: fixed;
          bottom: 10px;
          left: 10px;
          background: rgba(0,0,0,0.8);
          color: white;
          padding: 8px 12px;
          border-radius: 4px;
          font-size: 12px;
          z-index: 1001;
        }
      </style>
    </head>
    <body>
      <!-- Top navigation bar -->
      <div class="top-bar">
        <div class="tabs">
          <div class="tab active" onclick="switchTab(1)">
            <span>📄</span>
            <span>Wikipedia</span>
          </div>
          <div class="tab" onclick="switchTab(2)">
            <span>🐙</span>
            <span>GitHub</span>
          </div>
        </div>
      </div>
      
      <!-- Browser container (WebContentsView will render here) -->
      <div class="browser-container" id="browserContainer">
        <div style="padding: 20px; color: #666;">
          WebContentsView will render here...
        </div>
      </div>
      
      <!-- Floating note panel -->
      <div class="floating-panel">
        <div class="panel-header">📝 Quick Note</div>
        <div class="panel-content">
          <p style="margin-bottom: 12px; color: #666;">
            This panel should appear ABOVE the WebContentsView if layering works correctly.
          </p>
          <textarea class="note-editor" placeholder="Type your note here..."></textarea>
          <div style="margin-top: 12px;">
            <button onclick="togglePanel()" style="background: #3498db; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
              Toggle Z-Index Test
            </button>
          </div>
        </div>
      </div>
      
      <!-- Floating action button -->
      <div class="fab" onclick="showAlert()">+</div>
      
      <!-- Status indicator -->
      <div class="status" id="status">Ready</div>
      
      <script>
        let currentTab = 1;
        
        function switchTab(tabNum) {
          currentTab = tabNum;
          document.querySelectorAll('.tab').forEach((tab, i) => {
            tab.classList.toggle('active', i === tabNum - 1);
          });
          updateStatus('Switched to tab ' + tabNum);
          
          // Send message to main process
          if (window.electronAPI) {
            window.electronAPI.switchTab(tabNum);
          }
        }
        
        function togglePanel() {
          const panel = document.querySelector('.floating-panel');
          const currentZ = panel.style.zIndex || '999';
          panel.style.zIndex = currentZ === '999' ? '1' : '999';
          updateStatus('Panel z-index: ' + panel.style.zIndex);
        }
        
        function showAlert() {
          updateStatus('FAB clicked - this should be above WebContentsView');
        }
        
        function updateStatus(text) {
          document.getElementById('status').textContent = text;
        }
        
        // Log initial state
        console.log('UI Chrome loaded. Testing z-index layering with WebContentsView...');
      </script>
    </body>
    </html>
  `));

  // Wait for the main window to load before adding WebContentsViews
  win.webContents.once('did-finish-load', () => {
    console.log('Main window loaded. Adding WebContentsViews...');
    
    // Create WebContentsView 1 - Wikipedia
    const view1 = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    win.contentView.addChildView(view1);
    
    // Position it to fill the browser container area (below top bar)
    view1.setBounds({ x: 0, y: 48, width: 1200, height: 752 });
    view1.webContents.loadURL('https://en.wikipedia.org/wiki/Main_Page');
    
    // Create WebContentsView 2 - GitHub (hidden initially)
    const view2 = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    win.contentView.addChildView(view2);
    view2.setBounds({ x: 0, y: 48, width: 1200, height: 752 });
    view2.webContents.loadURL('https://github.com');
    
    // Remove view2 initially so view1 is visible
    win.contentView.removeChildView(view2);
    
    console.log('\n=== CRITICAL TEST POINTS ===');
    console.log('1. Can you see the tabs at the top?');
    console.log('2. Can you see the floating note panel on the right?');
    console.log('3. Can you see the red FAB button at bottom right?');
    console.log('4. Are these UI elements ABOVE or BELOW the Wikipedia page?');
    console.log('\nThe answer to #4 reveals whether WebContentsView can work with UI chrome.');
    
    // Set up tab switching via IPC (simulated here)
    let currentView = view1;
    global.switchTab = (tabNum) => {
      if (tabNum === 1 && currentView !== view1) {
        win.contentView.removeChildView(view2);
        win.contentView.addChildView(view1);
        currentView = view1;
        console.log('Switched to Wikipedia (tab 1)');
      } else if (tabNum === 2 && currentView !== view2) {
        win.contentView.removeChildView(view1);
        win.contentView.addChildView(view2);
        currentView = view2;
        console.log('Switched to GitHub (tab 2)');
      }
    };
    
    // Auto-close after 30 seconds
    setTimeout(() => {
      console.log('\nTest completed. Closing...');
      clearTimeout(safetyTimeout);
      app.quit();
    }, 30000);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());