"use strict";(()=>{var i=class{constructor(){this.windowId=null;this.contextMenuData=null;this.menuElement=null;this.isShowingNewMenu=!1;console.log("[ContextMenuOverlay] Initializing overlay"),this.windowId=null,console.log("[ContextMenuOverlay] Waiting for window ID via IPC..."),this.root=document.getElementById("context-menu-root"),this.setupStyles(),this.setupListeners(),this.notifyReady()}setupStyles(){Object.assign(document.body.style,{backgroundColor:"transparent",pointerEvents:"none",margin:"0",padding:"0",overflow:"hidden",position:"fixed",inset:"0"});let t=document.createElement("style");t.textContent=`
      @font-face {
        font-family: 'Soehne';
        src: url('./fonts/soehne-buch.woff2') format('woff2');
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }
      
      @font-face {
        font-family: 'Soehne';
        src: url('./fonts/soehne-kraftig.woff2') format('woff2');
        font-weight: 500;
        font-style: normal;
        font-display: swap;
      }
      
      :root {
        /* Light mode colors */
        --step-1: #fdfdfc;
        --step-3: #f1f0ef;
        --step-6: #dad9d6;
        --step-11-5: #51504B;
      }
      
      @media (prefers-color-scheme: dark) {
        :root {
          /* Dark mode colors */
          --step-1: #111110;
          --step-3: #222221;
          --step-6: #3b3a37;
          --step-11-5: #D0CFCA;
        }
      }
      
      .dark {
        /* Dark mode colors when explicitly set */
        --step-1: #111110;
        --step-3: #222221;
        --step-6: #3b3a37;
        --step-11-5: #D0CFCA;
      }
    `,document.head.appendChild(t)}setupListeners(){console.log("[ContextMenuOverlay] Setting up listeners"),console.log("[ContextMenuOverlay] window.api available?",!!window.api),console.log("[ContextMenuOverlay] window.api.browserContextMenu available?",!!window.api?.browserContextMenu),window.api?.browserContextMenu?(window.api.browserContextMenu.onShow(t=>{console.log("[ContextMenuOverlay] Received context menu data:",t),this.showContextMenu(t)}),console.log("[ContextMenuOverlay] Subscribed to onShow event")):(console.error("[ContextMenuOverlay] window.api.browserContextMenu not available!"),console.error("[ContextMenuOverlay] window.api:",window.api)),document.addEventListener("click",t=>{this.menuElement&&!this.menuElement.contains(t.target)&&this.hideContextMenu()}),document.addEventListener("keydown",t=>{t.key==="Escape"&&this.hideContextMenu()})}notifyReady(){window.api?.browserContextMenu?.notifyReady&&(window.api.browserContextMenu.notifyReady(),console.log("[Overlay] Notified main process that overlay is ready"))}setWindowId(t){this.windowId=t,console.log("[ContextMenuOverlay] Window ID set to:",t)}showContextMenu(t){this.isShowingNewMenu=!0,this.hideContextMenu(),this.isShowingNewMenu=!1,this.contextMenuData=t,this.menuElement=document.createElement("div"),this.menuElement.className="browser-context-menu",this.menuElement.style.cssText=`
      position: fixed;
      left: ${t.x}px;
      top: ${t.y}px;
      background: var(--step-1);
      border: 1px solid var(--step-3);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      padding: 4px 0;
      min-width: 200px;
      z-index: 10000;
      pointer-events: auto;
      font-family: 'Soehne', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `,this.getMenuItems(t).forEach(e=>{if(e.type==="separator"){let a=document.createElement("div");a.style.cssText=`
          height: 1px;
          background: var(--step-6);
          margin: 4px 8px;
        `,this.menuElement.appendChild(a)}else{let a=document.createElement("div");a.className="menu-item",a.textContent=e.label,a.style.cssText=`
          padding: 8px 16px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 400;
          color: var(--step-11-5);
          white-space: nowrap;
          user-select: none;
          transition: background-color 0.1s ease;
        `,e.enabled===!1?(a.style.opacity="0.4",a.style.cursor="default"):(a.addEventListener("mouseenter",()=>{a.style.backgroundColor="var(--step-3)"}),a.addEventListener("mouseleave",()=>{a.style.backgroundColor="transparent"}),a.addEventListener("click",()=>{this.handleMenuClick(e.action)})),this.menuElement.appendChild(a)}}),this.root.appendChild(this.menuElement),requestAnimationFrame(()=>{if(!this.menuElement)return;let e=this.menuElement.getBoundingClientRect(),a=window.innerWidth,s=window.innerHeight;e.right>a&&(this.menuElement.style.left=`${Math.max(0,t.x-e.width)}px`),e.bottom>s&&(this.menuElement.style.top=`${Math.max(0,t.y-e.height)}px`)})}hideContextMenu(){this.menuElement&&(this.menuElement.remove(),this.menuElement=null),this.contextMenuData=null,!this.isShowingNewMenu&&window.api?.browserContextMenu?.notifyClosed&&window.api.browserContextMenu.notifyClosed(this.windowId)}getMenuItems(t){let n=[];if(t.contextType==="tab"&&t.tabContext){let a=t.tabContext;return n.push({label:"Close Tab",action:"close",enabled:a.canClose}),n}if(!t.browserContext)return n;let e=t.browserContext;if(e.linkURL&&n.push({label:"Open Link in New Tab",action:"openInNewTab",enabled:!0},{label:"Open Link in Background",action:"openInBackground",enabled:!0},{type:"separator"},{label:"Copy Link",action:"copyLink",enabled:!0}),e.srcURL&&e.mediaType==="image"&&(n.length>0&&n.push({type:"separator"}),n.push({label:"Open Image in New Tab",action:"openImageInNewTab",enabled:!0},{label:"Copy Image URL",action:"copyImageURL",enabled:!0},{label:"Save Image As...",action:"saveImageAs",enabled:!0})),e.selectionText){n.length>0&&n.push({type:"separator"});let a=e.selectionText.substring(0,20)+(e.selectionText.length>20?"...":"");n.push({label:"Copy",action:"copy",enabled:e.editFlags.canCopy},{label:`Search for "${a}"`,action:"searchSelection",enabled:!0})}if(e.isEditable){n.length>0&&n.push({type:"separator"});let a=[];e.editFlags.canUndo&&a.push({label:"Undo",action:"undo",enabled:!0}),e.editFlags.canRedo&&a.push({label:"Redo",action:"redo",enabled:!0}),a.length>0&&(n.push(...a),n.push({type:"separator"})),e.editFlags.canCut&&n.push({label:"Cut",action:"cut",enabled:!0}),e.editFlags.canCopy&&n.push({label:"Copy",action:"copy",enabled:!0}),e.editFlags.canPaste&&n.push({label:"Paste",action:"paste",enabled:!0}),e.editFlags.canSelectAll&&n.push({label:"Select All",action:"selectAll",enabled:!0})}return n.length===0&&n.push({label:"Back",action:"goBack",enabled:e.canGoBack??!1},{label:"Forward",action:"goForward",enabled:e.canGoForward??!1},{label:"Reload",action:"reload",enabled:!0},{type:"separator"},{label:"Copy Page URL",action:"copyPageURL",enabled:!0},{label:"View Page Source",action:"viewSource",enabled:!0}),n.push({type:"separator"},{label:"Inspect Element",action:"inspect",enabled:!0}),n}handleMenuClick(t){if(!this.windowId||!this.contextMenuData)return;if(this.contextMenuData.contextType==="tab"&&this.contextMenuData.tabContext){this.handleTabAction(t,this.contextMenuData.tabContext.tabId),this.hideContextMenu();return}let{mappedAction:n,actionData:e}=this.mapActionAndData(t,this.contextMenuData);if(window.api?.browserContextMenu?.sendAction){let s={...{windowId:this.windowId,action:n,context:this.contextMenuData},...e};window.api.browserContextMenu.sendAction(n,s)}this.hideContextMenu()}async handleTabAction(t,n){if(this.windowId)switch(t){case"close":await window.api?.classicBrowserCloseTab?.(this.windowId,n);break}}mapActionAndData(t,n){let e=n.browserContext;switch(t){case"openInNewTab":return{mappedAction:"link:open-new-tab",actionData:{url:e?.linkURL||""}};case"openInBackground":return{mappedAction:"link:open-background",actionData:{url:e?.linkURL||""}};case"copyLink":return{mappedAction:"link:copy",actionData:{url:e?.linkURL||""}};case"openImageInNewTab":return{mappedAction:"image:open-new-tab",actionData:{url:e?.srcURL||""}};case"copyImageURL":return{mappedAction:"image:copy-url",actionData:{url:e?.srcURL||""}};case"saveImageAs":return{mappedAction:"image:save",actionData:{url:e?.srcURL||""}};case"copy":return{mappedAction:"edit:copy",actionData:{}};case"searchSelection":return{mappedAction:"search:jeffers",actionData:{query:e?.selectionText||""}};case"undo":return{mappedAction:"edit:undo",actionData:{}};case"redo":return{mappedAction:"edit:redo",actionData:{}};case"cut":return{mappedAction:"edit:cut",actionData:{}};case"paste":return{mappedAction:"edit:paste",actionData:{}};case"selectAll":return{mappedAction:"edit:select-all",actionData:{}};case"goBack":return{mappedAction:"navigate:back",actionData:{}};case"goForward":return{mappedAction:"navigate:forward",actionData:{}};case"reload":return{mappedAction:"navigate:reload",actionData:{}};case"copyPageURL":return{mappedAction:"page:copy-url",actionData:{url:e?.pageURL||""}};case"viewSource":return{mappedAction:"dev:view-source",actionData:{}};case"inspect":return{mappedAction:"dev:inspect",actionData:{x:n.x,y:n.y}};default:return{mappedAction:t,actionData:{}}}}},o;document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{o=new i,window.overlayInstance=o}):(o=new i,window.overlayInstance=o);})();
//# sourceMappingURL=overlay.js.map
