// test_correct.js
const { app, BrowserWindow, WebContentsView } = require('electron');

const safetyTimeout = setTimeout(() => {
  console.error('--- SAFETY TIMEOUT REACHED (1 min) ---');
  app.quit();
}, 60000);

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Correct Test: Using contentView API'
  });

  console.log(`Running on Electron version: ${process.versions.electron}`);
  console.log('Using win.contentView.addChildView()');

  const view1 = new WebContentsView();
  win.contentView.addChildView(view1);
  view1.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  view1.webContents.loadURL('data:text/html,<body style="background-color: #0000FF;"><h1>View 1 (Blue)</h1></body>');

  const view2 = new WebContentsView();
  win.contentView.addChildView(view2);
  view2.setBounds({ x: 50, y: 50, width: 700, height: 500 });
  view2.webContents.loadURL('data:text/html,<body style="background-color: #FF0000;"><h1>View 2 (Red)</h1></body>');

  console.log('Window is visible. Red view should be on top.');
  console.log('In 5 seconds, I will re-add View 1 to bring it to the top...');

  setTimeout(() => {
    try {
      console.log('Calling removeChildView and addChildView on view1...');
      win.contentView.removeChildView(view1);
      win.contentView.addChildView(view1);
      console.log('SUCCESS: The contentView API works.');
      console.log('Check the window: The Blue view should now be on top.');
    } catch (e) {
      console.error('--- TEST FAILED ---');
      console.error(e);
    } finally {
      setTimeout(() => {
        clearTimeout(safetyTimeout);
        app.quit();
      }, 2000);
    }
  }, 5000);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
