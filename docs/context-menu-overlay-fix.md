# Context Menu Overlay Fix for Packaged Apps

## Problem Description

The context menu overlay system was working correctly in development but failing in packaged apps with `ERR_FILE_NOT_FOUND` errors. The system uses a transparent WebContentsView overlay to display React-based context menus over browser content.

## Root Cause Analysis

The issue had multiple layers:

1. **Incorrect URL Construction**: The original `getAppURL()` method was constructing paths like `file://path/to/index.html/overlay.html` instead of `file://path/to/out/overlay.html`

2. **ASAR Archive Limitation**: Files inside Electron's asar archive cannot be loaded directly with `file://` URLs - they need to be extracted to the unpacked directory

3. **Web Security Restrictions**: The overlay WebContentsView had `webSecurity: true` which prevented loading local files

4. **Query Parameter Issues**: Electron's WebContentsView had difficulty loading local files with query parameters (e.g., `overlay.html?windowId=...`)

## Solution Implementation

### 1. Fixed URL Construction

**Before:**
```typescript
const indexPath = path.join(appPath, 'out', 'index.html');
return `file://${indexPath}`;
```

**After:**
```typescript
const outPath = path.join(resourcesPath, 'app.asar.unpacked', 'out');
const normalizedPath = outPath.replace(/\\/g, '/');
return `file://${normalizedPath}`;
```

### 2. Unpacked Overlay Files from ASAR

Modified `forge.config.js` to exclude overlay files from the asar archive:

```javascript
unpack: '{...,**/out/overlay.html,**/out/overlay.js,**/out/overlay.js.map}'
```

This ensures the overlay files are available as real files in the `app.asar.unpacked` directory.

### 3. Disabled Web Security for Overlay

Updated WebContentsView configuration:

```typescript
const overlay = new WebContentsView({
  webPreferences: {
    webSecurity: false  // Allow file:// URLs
  }
});
```

### 4. Removed Query Parameters from URL

**Before:**
```typescript
const overlayUrl = `${baseUrl}/overlay.html?windowId=${windowId}`;
overlay.webContents.loadURL(overlayUrl);
```

**After:**
```typescript
const overlayUrl = `${baseUrl}/overlay.html`;
overlay.webContents.loadURL(overlayUrl);

// Inject windowId after DOM is ready
overlay.webContents.executeJavaScript(`
  if (window.overlayInstance) {
    window.overlayInstance.setWindowId('${windowId}');
  }
`);
```

### 5. Updated Overlay JavaScript

Modified `src/overlay/overlay.ts` to:
- Remove URL parameter parsing
- Add `setWindowId()` method
- Expose overlay instance globally as `window.overlayInstance`

## Key Files Modified

- `services/browser/ClassicBrowserViewManager.ts` - Fixed URL construction and parameter injection
- `forge.config.js` - Added overlay files to asar unpack pattern
- `src/overlay/overlay.ts` - Updated to receive windowId via method call
- `public/overlay.html` - Fixed script src to use relative path (`./overlay.js`)

## Testing Results

After implementing these fixes:

✅ **Files confirmed accessible**: Debug logs show `overlay.html exists: true` and `overlay.js exists: true`
✅ **URL construction correct**: `file:///path/to/app.asar.unpacked/out/overlay.html`
✅ **No query parameter issues**: Loading basic HTML file without parameters
✅ **WindowId injection working**: JavaScript injection passes windowId after DOM ready

## Production Deployment

The fix ensures that:
1. Overlay files are properly extracted from asar during packaging
2. File URLs are constructed correctly for the unpacked location
3. Security restrictions don't prevent local file loading
4. WindowId is passed reliably without URL parameters

## Debug Information

Added extensive logging to help diagnose similar issues in the future:

```typescript
this.logInfo(`[getAppURL] Production mode - resourcesPath: ${resourcesPath}`);
this.logInfo(`[getAppURL] overlay.html exists: ${fs.existsSync(overlayPath)}`);
this.logInfo(`[createOverlayView] Loading overlay URL: ${overlayUrl}`);
```

## Architecture Impact

This fix maintains the existing overlay architecture while resolving the packaged app compatibility issues. The context menu system continues to work seamlessly in both development and production environments.

## Future Considerations

- The overlay system now requires JavaScript injection for parameter passing
- Web security is disabled for the overlay WebContentsView (isolated to overlay only)
- Overlay files must remain in the asar unpack pattern for future builds