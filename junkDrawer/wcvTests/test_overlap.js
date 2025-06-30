// test_overlap.js
const { app, BrowserWindow, WebContentsView } = require('electron');

const safetyTimeout = setTimeout(() => {
  console.error('--- SAFETY TIMEOUT REACHED (1 min) ---');
  app.quit();
}, 60000);

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Overlapping Windows Test',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  console.log(`Running on Electron version: ${process.versions.electron}`);
  console.log('Creating two partially overlapping views...');

  // Create View 1 (Blue) - Positioned to the left
  const view1 = new WebContentsView();
  win.contentView.addChildView(view1);
  view1.setBounds({ x: 50, y: 50, width: 400, height: 400 });
  
  // Load blue background with window-like UI
  view1.webContents.loadURL('data:text/html,' + encodeURIComponent(`
    <html>
      <body style="margin: 0; background-color: #f0f0f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="height: 100vh; display: flex; flex-direction: column; border: 2px solid #0066CC; box-sizing: border-box;">
          <div style="background: #0066CC; color: white; padding: 10px; display: flex; align-items: center; justify-content: space-between;">
            <span style="font-weight: 500;">Blue Window</span>
            <div style="display: flex; gap: 8px;">
              <div style="width: 12px; height: 12px; background: #4d94ff; border-radius: 50%;"></div>
              <div style="width: 12px; height: 12px; background: #4d94ff; border-radius: 50%;"></div>
              <div style="width: 12px; height: 12px; background: #4d94ff; border-radius: 50%;"></div>
            </div>
          </div>
          <div style="flex: 1; background: white; padding: 20px;">
            <h2 style="margin: 0 0 10px 0; color: #0066CC;">Blue Window Content</h2>
            <p style="color: #333;">This is the blue window. It should start below the red window.</p>
            <div style="margin-top: 20px; padding: 10px; background: #e6f0ff; border-radius: 4px;">
              <p style="margin: 0; color: #0066CC;">Status: Bottom layer initially</p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `));

  // Create View 2 (Red) - Positioned to the right, overlapping
  const view2 = new WebContentsView();
  win.contentView.addChildView(view2);
  view2.setBounds({ x: 250, y: 150, width: 400, height: 400 });
  
  // Load red background with window-like UI
  view2.webContents.loadURL('data:text/html,' + encodeURIComponent(`
    <html>
      <body style="margin: 0; background-color: #f0f0f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="height: 100vh; display: flex; flex-direction: column; border: 2px solid #CC0000; box-sizing: border-box;">
          <div style="background: #CC0000; color: white; padding: 10px; display: flex; align-items: center; justify-content: space-between;">
            <span style="font-weight: 500;">Red Window</span>
            <div style="display: flex; gap: 8px;">
              <div style="width: 12px; height: 12px; background: #ff4d4d; border-radius: 50%;"></div>
              <div style="width: 12px; height: 12px; background: #ff4d4d; border-radius: 50%;"></div>
              <div style="width: 12px; height: 12px; background: #ff4d4d; border-radius: 50%;"></div>
            </div>
          </div>
          <div style="flex: 1; background: white; padding: 20px;">
            <h2 style="margin: 0 0 10px 0; color: #CC0000;">Red Window Content</h2>
            <p style="color: #333;">This is the red window. It should start on top of the blue window.</p>
            <div style="margin-top: 20px; padding: 10px; background: #ffe6e6; border-radius: 4px;">
              <p style="margin: 0; color: #CC0000;">Status: Top layer initially</p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `));

  // Wait for both views to load
  Promise.all([
    new Promise(resolve => view1.webContents.once('did-finish-load', resolve)),
    new Promise(resolve => view2.webContents.once('did-finish-load', resolve))
  ]).then(() => {
    console.log('Both views loaded. You should see:');
    console.log('- Blue window on the left');
    console.log('- Red window on the right, overlapping the blue window');
    console.log('- Red window should be on top (covering part of blue)');
    console.log('');
    console.log('In 5 seconds, blue window will be brought to top...');

    setTimeout(() => {
      try {
        console.log('Bringing blue window to top...');
        win.contentView.removeChildView(view1);
        win.contentView.addChildView(view1);
        console.log('SUCCESS: Blue window should now be on top of red window.');
        console.log('You should see the blue window overlapping the red window.');
        
        // After 3 more seconds, bring red back to top
        setTimeout(() => {
          console.log('Bringing red window back to top...');
          win.contentView.removeChildView(view2);
          win.contentView.addChildView(view2);
          console.log('Red window should be back on top.');
          
          // Close after 3 more seconds
          setTimeout(() => {
            clearTimeout(safetyTimeout);
            app.quit();
          }, 3000);
        }, 3000);
      } catch (e) {
        console.error('--- TEST FAILED ---');
        console.error(e);
        clearTimeout(safetyTimeout);
        app.quit();
      }
    }, 5000);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());