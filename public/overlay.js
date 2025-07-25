"use strict";(()=>{var l=class{constructor(){this.windowId=null;this.contextMenuData=null;this.menuElement=null;this.isShowingNewMenu=!1;this.clickProtection=!1;console.log("[ContextMenuOverlay] Initializing overlay"),this.windowId=null,console.log("[ContextMenuOverlay] Waiting for window ID via IPC..."),this.root=document.getElementById("context-menu-root"),this.setupStyles(),this.setupListeners(),this.notifyReady()}setupStyles(){Object.assign(document.body.style,{backgroundColor:"transparent",pointerEvents:"none",margin:"0",padding:"0",overflow:"hidden",position:"fixed",inset:"0"});let t=document.createElement("style");t.textContent=`
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
    `,document.head.appendChild(t)}setupListeners(){console.log("[ContextMenuOverlay] Setting up listeners"),console.log("[ContextMenuOverlay] window.api available?",!!window.api),console.log("[ContextMenuOverlay] window.api.browserContextMenu available?",!!window.api?.browserContextMenu),window.api?.browserContextMenu?(window.api.browserContextMenu.onShow(t=>{console.log("[ContextMenuOverlay] Received context menu data:",t),console.log("[ContextMenuOverlay] availableNotebooks in received data:",t.availableNotebooks),this.showContextMenu(t)}),console.log("[ContextMenuOverlay] Subscribed to onShow event")):(console.error("[ContextMenuOverlay] window.api.browserContextMenu not available!"),console.error("[ContextMenuOverlay] window.api:",window.api)),document.addEventListener("click",t=>{if(this.clickProtection){console.log("[ContextMenuOverlay] Click ignored due to protection");return}this.menuElement&&!this.menuElement.contains(t.target)&&(console.log("[ContextMenuOverlay] Click outside menu detected, hiding menu"),this.hideContextMenu())}),document.addEventListener("keydown",t=>{t.key==="Escape"&&this.hideContextMenu()})}notifyReady(){window.api?.browserContextMenu?.notifyReady&&(window.api.browserContextMenu.notifyReady(),console.log("[Overlay] Notified main process that overlay is ready"))}setWindowId(t){this.windowId=t,console.log("[ContextMenuOverlay] Window ID set to:",t)}showContextMenu(t){this.isShowingNewMenu=!0,this.hideContextMenu(),this.isShowingNewMenu=!1,this.contextMenuData=t,this.menuElement=document.createElement("div"),this.menuElement.className="browser-context-menu",this.menuElement.style.cssText=`
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
    `,this.getMenuItems(t).forEach(e=>{if(e.type==="separator"){let o=document.createElement("div");o.style.cssText=`
          height: 1px;
          background: var(--step-6);
          margin: 4px 8px;
        `,this.menuElement.appendChild(o)}else{let o=document.createElement("div");o.className="menu-item",o.textContent=e.label,o.style.cssText=`
          padding: 8px 16px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 400;
          color: var(--step-11-5);
          white-space: nowrap;
          user-select: none;
          transition: background-color 0.1s ease;
        `,e.enabled===!1?(o.style.opacity="0.4",o.style.cursor="default"):(o.addEventListener("mouseenter",()=>{o.style.backgroundColor="var(--step-3)"}),o.addEventListener("mouseleave",()=>{o.style.backgroundColor="transparent"}),o.addEventListener("click",()=>{this.handleMenuClick(e.action)})),this.menuElement.appendChild(o)}}),this.root.appendChild(this.menuElement),requestAnimationFrame(()=>{if(!this.menuElement)return;let e=this.menuElement.getBoundingClientRect(),o=window.innerWidth,i=window.innerHeight;e.right>o&&(this.menuElement.style.left=`${Math.max(0,t.x-e.width)}px`),e.bottom>i&&(this.menuElement.style.top=`${Math.max(0,t.y-e.height)}px`)})}hideContextMenu(){console.log("[ContextMenuOverlay] hideContextMenu called, isShowingNewMenu:",this.isShowingNewMenu),console.trace("[ContextMenuOverlay] hideContextMenu stack trace"),this.menuElement&&(this.menuElement.remove(),this.menuElement=null),this.contextMenuData=null,!this.isShowingNewMenu&&window.api?.browserContextMenu?.notifyClosed&&window.api.browserContextMenu.notifyClosed(this.windowId)}getMenuItems(t){let n=[];if(t.contextType==="tab"&&t.tabContext){let o=t.tabContext;return t.availableNotebooks&&t.availableNotebooks.length>0&&(n.push({label:"Send to Notebook...",action:"sendToNotebook",enabled:!0}),n.push({type:"separator"})),n.push({label:"Close Tab",action:"close",enabled:o.canClose}),n}if(!t.browserContext)return n;let e=t.browserContext;if(e.linkURL&&n.push({label:"Open Link in New Tab",action:"openInNewTab",enabled:!0},{label:"Open Link in Background",action:"openInBackground",enabled:!0},{type:"separator"},{label:"Copy Link",action:"copyLink",enabled:!0}),e.srcURL&&e.mediaType==="image"&&(n.length>0&&n.push({type:"separator"}),n.push({label:"Open Image in New Tab",action:"openImageInNewTab",enabled:!0},{label:"Copy Image URL",action:"copyImageURL",enabled:!0},{label:"Save Image As...",action:"saveImageAs",enabled:!0})),e.selectionText){n.length>0&&n.push({type:"separator"});let o=e.selectionText.substring(0,20)+(e.selectionText.length>20?"...":"");n.push({label:"Copy",action:"copy",enabled:e.editFlags.canCopy},{label:`Search for "${o}"`,action:"searchSelection",enabled:!0})}if(e.isEditable){n.length>0&&n.push({type:"separator"});let o=[];e.editFlags.canUndo&&o.push({label:"Undo",action:"undo",enabled:!0}),e.editFlags.canRedo&&o.push({label:"Redo",action:"redo",enabled:!0}),o.length>0&&(n.push(...o),n.push({type:"separator"})),e.editFlags.canCut&&n.push({label:"Cut",action:"cut",enabled:!0}),e.editFlags.canCopy&&n.push({label:"Copy",action:"copy",enabled:!0}),e.editFlags.canPaste&&n.push({label:"Paste",action:"paste",enabled:!0}),e.editFlags.canSelectAll&&n.push({label:"Select All",action:"selectAll",enabled:!0})}return n.length===0&&n.push({label:"Back",action:"goBack",enabled:e.canGoBack??!1},{label:"Forward",action:"goForward",enabled:e.canGoForward??!1},{label:"Reload",action:"reload",enabled:!0},{type:"separator"},{label:"Copy Page URL",action:"copyPageURL",enabled:!0},{label:"View Page Source",action:"viewSource",enabled:!0}),n.push({type:"separator"},{label:"Inspect Element",action:"inspect",enabled:!0}),n}handleMenuClick(t){if(!this.windowId||!this.contextMenuData)return;if(this.contextMenuData.contextType==="tab"&&this.contextMenuData.tabContext){this.handleTabAction(t,this.contextMenuData.tabContext.tabId),t!=="sendToNotebook"&&this.hideContextMenu();return}let{mappedAction:n,actionData:e}=this.mapActionAndData(t,this.contextMenuData);if(window.api?.browserContextMenu?.sendAction){let i={...{windowId:this.windowId,action:n,context:this.contextMenuData},...e};window.api.browserContextMenu.sendAction(n,i)}this.hideContextMenu()}async handleTabAction(t,n){if(console.log("[ContextMenuOverlay] handleTabAction called with action:",t,"tabId:",n),!!this.windowId)switch(t){case"close":await window.api?.classicBrowserCloseTab?.(this.windowId,n);break;case"sendToNotebook":console.log("[ContextMenuOverlay] Handling sendToNotebook action"),this.showNotebookSelection(n);return}}showNotebookSelection(t){if(console.log("[ContextMenuOverlay] showNotebookSelection called with tabId:",t),console.log("[ContextMenuOverlay] contextMenuData:",this.contextMenuData),console.log("[ContextMenuOverlay] availableNotebooks:",this.contextMenuData?.availableNotebooks),!this.contextMenuData?.availableNotebooks){console.log("[ContextMenuOverlay] No available notebooks found, exiting");return}let n=this.contextMenuData.x,e=this.contextMenuData.y,o=this.contextMenuData.availableNotebooks;console.log("[ContextMenuOverlay] Hiding current menu to show notebook selection"),this.menuElement&&(this.menuElement.remove(),this.menuElement=null),this.menuElement=document.createElement("div"),this.menuElement.className="browser-context-menu notebook-selection",this.menuElement.style.cssText=`
      position: fixed;
      left: ${n}px;
      top: ${e}px;
      background: var(--step-1);
      border: 1px solid var(--step-3);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      padding: 4px 0;
      min-width: 250px;
      z-index: 10000;
      pointer-events: auto;
      font-family: 'Soehne', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;let i=document.createElement("div");i.textContent="Send to Notebook",i.style.cssText=`
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 500;
      color: var(--step-11-5);
      border-bottom: 1px solid var(--step-6);
      margin-bottom: 4px;
    `,this.menuElement.appendChild(i),o.forEach(s=>{console.log("[ContextMenuOverlay] Processing notebook:",s),console.log("[ContextMenuOverlay] Notebook title:",s.notebookTitle),console.log("[ContextMenuOverlay] Notebook ID:",s.notebookId);let a=document.createElement("div");a.className="menu-item notebook-item",a.textContent=s.notebookTitle,a.style.cssText=`
        padding: 8px 16px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 400;
        color: var(--step-11-5);
        white-space: nowrap;
        user-select: none;
        transition: background-color 0.1s ease;
      `,a.addEventListener("mouseenter",()=>{a.style.backgroundColor="var(--step-3)"}),a.addEventListener("mouseleave",()=>{a.style.backgroundColor="transparent"}),a.addEventListener("click",()=>{this.handleNotebookTransfer(t,s.notebookId)}),this.menuElement.appendChild(a)}),this.root.appendChild(this.menuElement),console.log("[ContextMenuOverlay] Notebook selection menu added to DOM. Menu element:",this.menuElement),console.log("[ContextMenuOverlay] Menu element children count:",this.menuElement.children.length),this.clickProtection=!0,setTimeout(()=>{this.clickProtection=!1,console.log("[ContextMenuOverlay] Click protection timeout cleared - menu can now be closed by clicks")},100)}async handleNotebookTransfer(t,n){if(this.windowId){try{let e=await window.api?.classicBrowserTabTransfer?.({sourceTabId:t,sourceWindowId:this.windowId,targetNotebookId:n});e?.success||console.error("Failed to transfer tab:",e?.error)}catch(e){console.error("Error transferring tab:",e)}this.hideContextMenu()}}mapActionAndData(t,n){let e=n.browserContext;switch(t){case"openInNewTab":return{mappedAction:"link:open-new-tab",actionData:{url:e?.linkURL||""}};case"openInBackground":return{mappedAction:"link:open-background",actionData:{url:e?.linkURL||""}};case"copyLink":return{mappedAction:"link:copy",actionData:{url:e?.linkURL||""}};case"openImageInNewTab":return{mappedAction:"image:open-new-tab",actionData:{url:e?.srcURL||""}};case"copyImageURL":return{mappedAction:"image:copy-url",actionData:{url:e?.srcURL||""}};case"saveImageAs":return{mappedAction:"image:save",actionData:{url:e?.srcURL||""}};case"copy":return{mappedAction:"edit:copy",actionData:{}};case"searchSelection":return{mappedAction:"search:jeffers",actionData:{query:e?.selectionText||""}};case"undo":return{mappedAction:"edit:undo",actionData:{}};case"redo":return{mappedAction:"edit:redo",actionData:{}};case"cut":return{mappedAction:"edit:cut",actionData:{}};case"paste":return{mappedAction:"edit:paste",actionData:{}};case"selectAll":return{mappedAction:"edit:select-all",actionData:{}};case"goBack":return{mappedAction:"navigate:back",actionData:{}};case"goForward":return{mappedAction:"navigate:forward",actionData:{}};case"reload":return{mappedAction:"navigate:reload",actionData:{}};case"copyPageURL":return{mappedAction:"page:copy-url",actionData:{url:e?.pageURL||""}};case"viewSource":return{mappedAction:"dev:view-source",actionData:{}};case"inspect":return{mappedAction:"dev:inspect",actionData:{x:n.x,y:n.y}};default:return{mappedAction:t,actionData:{}}}}},r;document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{r=new l,window.overlayInstance=r}):(r=new l,window.overlayInstance=r);})();
//# sourceMappingURL=overlay.js.map
