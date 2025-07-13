import { app, BrowserWindow, WebContentsView } from 'electron';

app.whenReady().then(() => {
  console.log('Testing WebContentsView features in Electron', process.versions.electron);
  
  // Create a test window
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Create a test WebContentsView
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Test for the new APIs
  console.log('\n=== API Availability ===');
  console.log('setZOrderLevel available?', typeof view.setZOrderLevel === 'function');
  console.log('setBackgroundColor available?', typeof view.setBackgroundColor === 'function');
  
  // Try to use the APIs
  console.log('\n=== Testing APIs ===');
  
  try {
    // Test setBackgroundColor with alpha
    view.setBackgroundColor('#00000000'); // Fully transparent
    console.log('✓ setBackgroundColor with alpha works');
  } catch (error) {
    console.log('✗ setBackgroundColor error:', error.message);
  }

  try {
    // Test setZOrderLevel if it exists
    if (typeof view.setZOrderLevel === 'function') {
      view.setZOrderLevel('normal');
      console.log('✓ setZOrderLevel works');
      
      // Test different levels
      view.setZOrderLevel('floating');
      view.setZOrderLevel('torn-off-menu');
      view.setZOrderLevel('modal-panel');
      view.setZOrderLevel('main-menu');
      view.setZOrderLevel('status');
      view.setZOrderLevel('pop-up-menu');
      view.setZOrderLevel('screen-saver');
      console.log('✓ All z-order levels accepted');
    } else {
      console.log('✗ setZOrderLevel not available');
    }
  } catch (error) {
    console.log('✗ setZOrderLevel error:', error.message);
  }

  // Check for occlusion events
  console.log('\n=== Event Support ===');
  console.log('contents.on available?', typeof view.webContents.on === 'function');
  
  // List all available methods on view
  console.log('\n=== All WebContentsView Methods ===');
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(view))
    .filter(name => typeof view[name] === 'function')
    .sort();
  methods.forEach(method => console.log(`- ${method}`));

  // Cleanup and exit
  setTimeout(() => {
    app.quit();
  }, 2000);
});

app.on('window-all-closed', () => {
  app.quit();
});