// test_process_memory.js
const { app, BrowserWindow, WebContentsView } = require('electron');
const { exec } = require('child_process');
const os = require('os');

function formatBytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getProcessMemory() {
  return new Promise((resolve) => {
    exec(`ps aux | grep -E "${process.pid}|Electron Helper \\(Renderer\\)" | grep -v grep`, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      
      const lines = stdout.trim().split('\n').filter(line => line);
      const processes = lines.map(line => {
        const parts = line.split(/\s+/);
        const pid = parts[1];
        const cpu = parts[2];
        const mem = parts[3];
        const vsz = parseInt(parts[4]) * 1024; // Convert KB to bytes
        const rss = parseInt(parts[5]) * 1024; // Convert KB to bytes
        const command = parts.slice(10).join(' ');
        
        return {
          pid,
          cpu: cpu + '%',
          mem: mem + '%',
          vsz: formatBytes(vsz),
          rss: formatBytes(rss),
          type: command.includes('(Renderer)') ? 'Renderer' : 'Main',
          command: command.substring(0, 50) + '...'
        };
      });
      
      resolve(processes);
    });
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Process Memory Test',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  console.log('=== PROCESS-LEVEL MEMORY ANALYSIS ===\n');

  // Load UI
  win.loadURL('data:text/html,' + encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: monospace; padding: 20px; background: #1e1e1e; color: #fff; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #444; }
        th { background: #2d2d2d; }
        .renderer { color: #4CAF50; }
        .main { color: #2196F3; }
      </style>
    </head>
    <body>
      <h2>Process Memory Analysis</h2>
      <div id="content">Loading...</div>
    </body>
    </html>
  `));

  await new Promise(resolve => win.webContents.once('did-finish-load', resolve));

  // Baseline
  console.log('BASELINE - Just main window:');
  let processes = await getProcessMemory();
  console.table(processes);
  let totalRSS = processes.reduce((sum, p) => sum + parseFloat(p.rss), 0);
  console.log(`Total RSS: ${totalRSS.toFixed(2)} MB\n`);

  // Add browser view
  console.log('Adding Wikipedia browser view...');
  const view1 = new WebContentsView();
  win.contentView.addChildView(view1);
  view1.setBounds({ x: 50, y: 50, width: 600, height: 400 });
  view1.webContents.loadURL('https://en.wikipedia.org/wiki/Main_Page');
  
  await new Promise(resolve => view1.webContents.once('did-finish-load', resolve));
  await new Promise(resolve => setTimeout(resolve, 2000)); // Let it stabilize

  processes = await getProcessMemory();
  console.table(processes);
  totalRSS = processes.reduce((sum, p) => sum + parseFloat(p.rss), 0);
  console.log(`Total RSS: ${totalRSS.toFixed(2)} MB\n`);

  // Add note view
  console.log('Adding React note view...');
  const view2 = new WebContentsView();
  win.contentView.addChildView(view2);
  view2.setBounds({ x: 400, y: 200, width: 400, height: 300 });
  view2.webContents.loadURL('data:text/html,<html><body style="background:white;padding:20px;"><h2>Note Window</h2><p>React component would go here</p></body></html>');
  
  await new Promise(resolve => view2.webContents.once('did-finish-load', resolve));
  await new Promise(resolve => setTimeout(resolve, 2000));

  processes = await getProcessMemory();
  console.table(processes);
  totalRSS = processes.reduce((sum, p) => sum + parseFloat(p.rss), 0);
  console.log(`Total RSS: ${totalRSS.toFixed(2)} MB\n`);

  // Add more views
  console.log('Adding 3 more browser tabs...');
  for (let i = 0; i < 3; i++) {
    const view = new WebContentsView();
    win.contentView.addChildView(view);
    view.setBounds({ x: 100 + i*50, y: 100 + i*50, width: 600, height: 400 });
    view.webContents.loadURL(['https://github.com', 'https://stackoverflow.com', 'https://developer.mozilla.org'][i]);
    await new Promise(resolve => view.webContents.once('did-finish-load', resolve));
  }
  
  await new Promise(resolve => setTimeout(resolve, 3000));

  processes = await getProcessMemory();
  console.table(processes);
  totalRSS = processes.reduce((sum, p) => sum + parseFloat(p.rss), 0);
  console.log(`Total RSS: ${totalRSS.toFixed(2)} MB\n`);

  console.log('=== SUMMARY ===');
  console.log(`Number of processes: ${processes.length}`);
  console.log(`Main process: 1`);
  console.log(`Renderer processes: ${processes.filter(p => p.type === 'Renderer').length}`);
  console.log(`Total memory (RSS): ${totalRSS.toFixed(2)} MB`);
  console.log(`Average per renderer: ${(totalRSS / processes.filter(p => p.type === 'Renderer').length).toFixed(2)} MB`);

  setTimeout(() => app.quit(), 10000);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());