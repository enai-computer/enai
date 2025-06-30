// test_visual.js
const { app, BrowserWindow, WebContentsView } = require('electron');

const safetyTimeout = setTimeout(() => {
  console.error('--- SAFETY TIMEOUT REACHED (1 min) ---');
  app.quit();
}, 60000);

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Visual Z-Order Test',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  console.log(`Running on Electron version: ${process.versions.electron}`);
  console.log('Creating two overlapping views...');

  // Create View 1 (Blue) - Full window
  const view1 = new WebContentsView();
  win.contentView.addChildView(view1);
  view1.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  
  // Load blue background with text
  view1.webContents.loadURL('data:text/html,' + encodeURIComponent(`
    <html>
      <body style="margin: 0; background-color: #0066CC; color: white; font-family: Arial; display: flex; align-items: center; justify-content: center; height: 100vh;">
        <div style="text-align: center;">
          <h1 style="font-size: 48px;">BLUE VIEW (Bottom)</h1>
          <p style="font-size: 24px;">This is the full-size blue view</p>
        </div>
      </body>
    </html>
  `));

  // Create View 2 (Red) - Smaller, centered
  const view2 = new WebContentsView();
  win.contentView.addChildView(view2);
  view2.setBounds({ x: 100, y: 100, width: 600, height: 400 });
  
  // Load red background with text
  view2.webContents.loadURL('data:text/html,' + encodeURIComponent(`
    <html>
      <body style="margin: 0; background-color: #CC0000; color: white; font-family: Arial; display: flex; align-items: center; justify-content: center; height: 100vh;">
        <div style="text-align: center;">
          <h1 style="font-size: 48px;">RED VIEW (Top)</h1>
          <p style="font-size: 24px;">This should be on top initially</p>
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
    console.log('- A red rectangle in the center');
    console.log('- Blue visible around the edges');
    console.log('');
    console.log('In 5 seconds, blue will be brought to top...');

    setTimeout(() => {
      try {
        console.log('Bringing blue view to top...');
        win.contentView.removeChildView(view1);
        win.contentView.addChildView(view1);
        console.log('SUCCESS: Blue view should now cover the red view completely.');
        
        // After 3 more seconds, bring red back to top
        setTimeout(() => {
          console.log('Bringing red view back to top...');
          win.contentView.removeChildView(view2);
          win.contentView.addChildView(view2);
          console.log('Red view should be visible again.');
          
          // Close after 2 more seconds
          setTimeout(() => {
            clearTimeout(safetyTimeout);
            app.quit();
          }, 2000);
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