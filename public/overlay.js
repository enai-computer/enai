"use strict";(()=>{var c=class{constructor(){this.windowId=null;this.contextMenuData=null;this.menuElement=null;this.isShowingNewMenu=!1;this.clickProtection=!1;console.log("[ContextMenuOverlay] Initializing overlay"),this.windowId=null,console.log("[ContextMenuOverlay] Waiting for window ID via IPC..."),this.root=document.getElementById("context-menu-root"),this.setupStyles(),this.setupListeners(),this.notifyReady()}setupStyles(){Object.assign(document.body.style,{backgroundColor:"transparent",pointerEvents:"none",margin:"0",padding:"0",overflow:"hidden",position:"fixed",inset:"0"});let t=document.createElement("style");t.textContent=`
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
    `,this.getMenuItems(t).forEach(n=>{if(n.type==="separator"){let o=document.createElement("div");o.style.cssText=`
          height: 1px;
          background: var(--step-6);
          margin: 4px 8px;
        `,this.menuElement.appendChild(o)}else{let o=document.createElement("div");o.className="menu-item",o.textContent=n.label,o.style.cssText=`
          padding: 8px 16px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 400;
          color: var(--step-11-5);
          white-space: nowrap;
          user-select: none;
          transition: background-color 0.1s ease;
        `,n.enabled===!1?(o.style.opacity="0.4",o.style.cursor="default"):(o.addEventListener("mouseenter",()=>{o.style.backgroundColor="var(--step-3)"}),o.addEventListener("mouseleave",()=>{o.style.backgroundColor="transparent"}),o.addEventListener("click",()=>{this.handleMenuClick(n.action)})),this.menuElement.appendChild(o)}}),this.root.appendChild(this.menuElement),requestAnimationFrame(()=>{if(!this.menuElement)return;let n=this.menuElement.getBoundingClientRect(),o=window.innerWidth,s=window.innerHeight;n.right>o&&(this.menuElement.style.left=`${Math.max(0,t.x-n.width)}px`),n.bottom>s&&(this.menuElement.style.top=`${Math.max(0,t.y-n.height)}px`)})}hideContextMenu(){console.log("[ContextMenuOverlay] hideContextMenu called, isShowingNewMenu:",this.isShowingNewMenu),console.trace("[ContextMenuOverlay] hideContextMenu stack trace"),this.menuElement&&(this.menuElement.remove(),this.menuElement=null),this.contextMenuData=null,!this.isShowingNewMenu&&window.api?.browserContextMenu?.notifyClosed&&window.api.browserContextMenu.notifyClosed(this.windowId)}getMenuItems(t){let e=[];if(t.contextType==="tab"&&t.tabContext){let o=t.tabContext;return t.availableNotebooks&&t.availableNotebooks.length>0&&(e.push({label:"Send to Notebook...",action:"sendToNotebook",enabled:!0}),e.push({type:"separator"})),e.push({label:"Close Tab",action:"close",enabled:o.canClose}),e}if(!t.browserContext)return e;let n=t.browserContext;if(n.linkURL&&e.push({label:"Open Link in New Tab",action:"openInNewTab",enabled:!0},{label:"Open Link in Background",action:"openInBackground",enabled:!0},{type:"separator"},{label:"Copy Link",action:"copyLink",enabled:!0}),n.srcURL&&n.mediaType==="image"&&(e.length>0&&e.push({type:"separator"}),e.push({label:"Open Image in New Tab",action:"openImageInNewTab",enabled:!0},{label:"Copy Image URL",action:"copyImageURL",enabled:!0},{label:"Save Image As...",action:"saveImageAs",enabled:!0})),n.selectionText){e.length>0&&e.push({type:"separator"});let o=n.selectionText.substring(0,20)+(n.selectionText.length>20?"...":"");e.push({label:"Copy",action:"copy",enabled:n.editFlags.canCopy},{label:`Search for "${o}"`,action:"searchSelection",enabled:!0})}if(n.isEditable){e.length>0&&e.push({type:"separator"});let o=[];n.editFlags.canUndo&&o.push({label:"Undo",action:"undo",enabled:!0}),n.editFlags.canRedo&&o.push({label:"Redo",action:"redo",enabled:!0}),o.length>0&&(e.push(...o),e.push({type:"separator"})),n.editFlags.canCut&&e.push({label:"Cut",action:"cut",enabled:!0}),n.editFlags.canCopy&&e.push({label:"Copy",action:"copy",enabled:!0}),n.editFlags.canPaste&&e.push({label:"Paste",action:"paste",enabled:!0}),n.editFlags.canSelectAll&&e.push({label:"Select All",action:"selectAll",enabled:!0})}return e.length===0&&e.push({label:"Back",action:"goBack",enabled:n.canGoBack??!1},{label:"Forward",action:"goForward",enabled:n.canGoForward??!1},{label:"Reload",action:"reload",enabled:!0},{type:"separator"},{label:"Copy Page URL",action:"copyPageURL",enabled:!0},{label:"View Page Source",action:"viewSource",enabled:!0}),e.push({type:"separator"},{label:"Inspect Element",action:"inspect",enabled:!0}),e}handleMenuClick(t){if(!this.windowId||!this.contextMenuData)return;if(this.contextMenuData.contextType==="tab"&&this.contextMenuData.tabContext){this.handleTabAction(t,this.contextMenuData.tabContext.tabId),t!=="sendToNotebook"&&this.hideContextMenu();return}let{mappedAction:e,actionData:n}=this.mapActionAndData(t,this.contextMenuData);if(window.api?.browserContextMenu?.sendAction){let s={...{windowId:this.windowId,action:e,context:this.contextMenuData},...n};window.api.browserContextMenu.sendAction(e,s)}this.hideContextMenu()}async handleTabAction(t,e){if(console.log("[ContextMenuOverlay] handleTabAction called with action:",t,"tabId:",e),!!this.windowId)switch(t){case"close":await window.api?.classicBrowserCloseTab?.(this.windowId,e);break;case"sendToNotebook":console.log("[ContextMenuOverlay] Handling sendToNotebook action"),this.showNotebookSelection(e);return}}showNotebookSelection(t){if(console.log("[ContextMenuOverlay] showNotebookSelection called with tabId:",t),console.log("[ContextMenuOverlay] contextMenuData:",this.contextMenuData),console.log("[ContextMenuOverlay] availableNotebooks:",this.contextMenuData?.availableNotebooks),!this.contextMenuData?.availableNotebooks){console.log("[ContextMenuOverlay] No available notebooks found, exiting");return}let e=this.contextMenuData.x,n=this.contextMenuData.y,o=this.contextMenuData.availableNotebooks;console.log("[ContextMenuOverlay] Hiding current menu to show notebook selection"),this.menuElement&&(this.menuElement.remove(),this.menuElement=null),this.menuElement=document.createElement("div"),this.menuElement.className="browser-context-menu notebook-selection",this.menuElement.style.cssText=`
      position: fixed;
      left: ${e}px;
      top: ${n}px;
      background: var(--step-1);
      border: 1px solid var(--step-3);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      padding: 4px 0;
      min-width: 250px;
      z-index: 10000;
      pointer-events: auto;
      font-family: 'Soehne', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;let s=document.createElement("div");s.textContent="Send to Notebook",s.style.cssText=`
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 500;
      color: var(--step-11-5);
      border-bottom: 1px solid var(--step-6);
      margin-bottom: 4px;
    `,this.menuElement.appendChild(s),o.forEach(a=>{console.log("[ContextMenuOverlay] Processing notebook:",a),console.log("[ContextMenuOverlay] Notebook title:",a.notebookTitle),console.log("[ContextMenuOverlay] Notebook ID:",a.notebookId),console.log("[ContextMenuOverlay] Tab groups:",a.tabGroups);let i=document.createElement("div");i.className="menu-item notebook-item",i.textContent=a.notebookTitle+" >",i.style.cssText=`
        padding: 8px 16px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 400;
        color: var(--step-11-5);
        white-space: nowrap;
        user-select: none;
        transition: background-color 0.1s ease;
        display: flex;
        justify-content: space-between;
        align-items: center;
      `,i.addEventListener("mouseenter",()=>{i.style.backgroundColor="var(--step-3)"}),i.addEventListener("mouseleave",()=>{i.style.backgroundColor="transparent"}),i.addEventListener("click",()=>{this.showTabGroupSelection(t,a)}),this.menuElement.appendChild(i)}),this.root.appendChild(this.menuElement),console.log("[ContextMenuOverlay] Notebook selection menu added to DOM. Menu element:",this.menuElement),console.log("[ContextMenuOverlay] Menu element children count:",this.menuElement.children.length),this.clickProtection=!0,setTimeout(()=>{this.clickProtection=!1,console.log("[ContextMenuOverlay] Click protection timeout cleared - menu can now be closed by clicks")},100)}showTabGroupSelection(t,e){console.log("[ContextMenuOverlay] showTabGroupSelection called with tabId:",t,"notebook:",e);let n=this.contextMenuData.x,o=this.contextMenuData.y;this.menuElement&&(this.menuElement.remove(),this.menuElement=null),this.menuElement=document.createElement("div"),this.menuElement.className="browser-context-menu tab-group-selection",this.menuElement.style.cssText=`
      position: fixed;
      left: ${n}px;
      top: ${o}px;
      background: var(--step-1);
      border: 1px solid var(--step-3);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      padding: 4px 0;
      min-width: 280px;
      z-index: 10000;
      pointer-events: auto;
      font-family: 'Soehne', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;let s=document.createElement("div");s.textContent=`Send to "${e.notebookTitle}"`,s.style.cssText=`
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 500;
      color: var(--step-11-5);
      border-bottom: 1px solid var(--step-6);
      margin-bottom: 4px;
    `,this.menuElement.appendChild(s);let a=document.createElement("div");if(a.className="menu-item create-new-tab-group",a.textContent="+ Create New Tab Group",a.style.cssText=`
      padding: 8px 16px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 400;
      color: var(--step-11-5);
      white-space: nowrap;
      user-select: none;
      transition: background-color 0.1s ease;
    `,a.addEventListener("mouseenter",()=>{a.style.backgroundColor="var(--step-3)"}),a.addEventListener("mouseleave",()=>{a.style.backgroundColor="transparent"}),a.addEventListener("click",()=>{this.handleNotebookTransfer(t,e.notebookId)}),this.menuElement.appendChild(a),e.tabGroups&&e.tabGroups.length>0){let i=document.createElement("div");i.style.cssText=`
        height: 1px;
        background: var(--step-6);
        margin: 4px 8px;
      `,this.menuElement.appendChild(i),e.tabGroups.forEach(d=>{let r=document.createElement("div");r.className="menu-item tab-group-item",r.textContent=`${d.title} (${d.tabCount} tabs)`,r.style.cssText=`
          padding: 8px 16px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 400;
          color: var(--step-11-5);
          white-space: nowrap;
          user-select: none;
          transition: background-color 0.1s ease;
        `,r.addEventListener("mouseenter",()=>{r.style.backgroundColor="var(--step-3)"}),r.addEventListener("mouseleave",()=>{r.style.backgroundColor="transparent"}),r.addEventListener("click",()=>{this.handleNotebookTransfer(t,e.notebookId,d.tabGroupId)}),this.menuElement.appendChild(r)})}this.root.appendChild(this.menuElement),console.log("[ContextMenuOverlay] Tab group selection menu added to DOM. Menu element:",this.menuElement),this.clickProtection=!0,setTimeout(()=>{this.clickProtection=!1,console.log("[ContextMenuOverlay] Click protection timeout cleared for tab group selection")},100)}async handleNotebookTransfer(t,e,n){if(this.windowId){console.log("[ContextMenuOverlay] Transferring tab:",{tabId:t,notebookId:e,tabGroupId:n});try{let o=await window.api?.classicBrowserTabTransfer?.({sourceTabId:t,sourceWindowId:this.windowId,targetNotebookId:e,targetTabGroupId:n});o?.success?console.log("[ContextMenuOverlay] Tab transfer successful"):console.error("Failed to transfer tab:",o?.error)}catch(o){console.error("Error transferring tab:",o)}this.hideContextMenu()}}mapActionAndData(t,e){let n=e.browserContext;switch(t){case"openInNewTab":return{mappedAction:"link:open-new-tab",actionData:{url:n?.linkURL||""}};case"openInBackground":return{mappedAction:"link:open-background",actionData:{url:n?.linkURL||""}};case"copyLink":return{mappedAction:"link:copy",actionData:{url:n?.linkURL||""}};case"openImageInNewTab":return{mappedAction:"image:open-new-tab",actionData:{url:n?.srcURL||""}};case"copyImageURL":return{mappedAction:"image:copy-url",actionData:{url:n?.srcURL||""}};case"saveImageAs":return{mappedAction:"image:save",actionData:{url:n?.srcURL||""}};case"copy":return{mappedAction:"edit:copy",actionData:{}};case"searchSelection":return{mappedAction:"search:enai",actionData:{query:n?.selectionText||""}};case"undo":return{mappedAction:"edit:undo",actionData:{}};case"redo":return{mappedAction:"edit:redo",actionData:{}};case"cut":return{mappedAction:"edit:cut",actionData:{}};case"paste":return{mappedAction:"edit:paste",actionData:{}};case"selectAll":return{mappedAction:"edit:select-all",actionData:{}};case"goBack":return{mappedAction:"navigate:back",actionData:{}};case"goForward":return{mappedAction:"navigate:forward",actionData:{}};case"reload":return{mappedAction:"navigate:reload",actionData:{}};case"copyPageURL":return{mappedAction:"page:copy-url",actionData:{url:n?.pageURL||""}};case"viewSource":return{mappedAction:"dev:view-source",actionData:{}};case"inspect":return{mappedAction:"dev:inspect",actionData:{x:e.x,y:e.y}};default:return{mappedAction:t,actionData:{}}}}},l;document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{l=new c,window.overlayInstance=l}):(l=new c,window.overlayInstance=l);})();
//# sourceMappingURL=overlay.js.map
