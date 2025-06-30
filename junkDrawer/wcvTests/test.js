// test.js
const { app, BrowserWindow, WebContentsView } = require('electron');

// --- SAFETY TIMEOUT ---
// This will automatically terminate the app if it runs for more than 1 minute.
const safetyTimeout = setTimeout(() => {
  console.error('--- SAFETY TIMEOUT REACHED ---');
  console.error('The test took longer than 1 minute and was automatically terminated.');
  app.quit();
}, 60000); // 60 seconds

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Testing setTopWebContentsView'
  });

  console.log(`Running on Electron version: ${process.versions.electron}`);
  console.log('Creating two views. View 2 (Red) will be added last, so it will appear on top.');

  const view1 = new WebContentsView();
  win.addWebContentsView(view1);
  view1.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  view1.webContents.loadURL('data:text/html,<body style="background-color: #0000FF;"><h1>View 1 (Blue)</h1></body>');

  const view2 = new WebContentsView();
  win.addWebContentsView(view2);
  view2.setBounds({ x: 50, y: 50, width: 700, height: 500 });
  view2.webContents.loadURL('data:text/html,<body style="background-color: #FF0000;"><h1>View 2 (Red)</h1></body>');

  console.log('Window is visible. Red view should be on top.');
  console.log('In 5 seconds, I will attempt to call win.setTopWebContentsView(view1)...');

  setTimeout(() => {
    try {
      console.log('Calling win.setTopWebContentsView(view1)...');
      win.setTopWebContentsView(view1);
      console.log('SUCCESS: The method win.setTopWebContentsView(view1) exists and was called without error.');
      console.log('Check the window: The Blue view should now be on top of the Red view.');
    } catch (e) {
      console.error('--- TEST FAILED ---');
      console.error('ERROR: The method win.setTopWebContentsView does not exist on the BrowserWindow instance.');
      console.error(e);
    } finally {
      // Ensure the process exits after the test and clear the safety timeout
      setTimeout(() => {
        clearTimeout(safetyTimeout);
        app.quit();
      }, 2000);
    }
  }, 5000);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});