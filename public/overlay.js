"use strict";(()=>{var i=class{constructor(){this.windowId=null;this.contextMenuData=null;this.menuElement=null;this.isShowingNewMenu=!1;console.log("[ContextMenuOverlay] Initializing overlay"),this.windowId=null,console.log("[ContextMenuOverlay] Waiting for window ID via IPC..."),this.root=document.getElementById("context-menu-root"),this.setupStyles(),this.setupListeners(),this.notifyReady()}setupStyles(){Object.assign(document.body.style,{backgroundColor:"transparent",pointerEvents:"none",margin:"0",padding:"0",overflow:"hidden",position:"fixed",inset:"0"});let e=document.createElement("style");e.textContent=`
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
    `,document.head.appendChild(e)}setupListeners(){console.log("[ContextMenuOverlay] Setting up listeners"),console.log("[ContextMenuOverlay] window.api available?",!!window.api),console.log("[ContextMenuOverlay] window.api.browserContextMenu available?",!!window.api?.browserContextMenu),window.api?.browserContextMenu?(window.api.browserContextMenu.onShow(e=>{console.log("[ContextMenuOverlay] Received context menu data:",e),this.showContextMenu(e)}),console.log("[ContextMenuOverlay] Subscribed to onShow event")):(console.error("[ContextMenuOverlay] window.api.browserContextMenu not available!"),console.error("[ContextMenuOverlay] window.api:",window.api)),document.addEventListener("click",e=>{this.menuElement&&!this.menuElement.contains(e.target)&&this.hideContextMenu()}),document.addEventListener("keydown",e=>{e.key==="Escape"&&this.hideContextMenu()})}notifyReady(){window.api?.browserContextMenu?.notifyReady&&(window.api.browserContextMenu.notifyReady(),console.log("[Overlay] Notified main process that overlay is ready"))}setWindowId(e){this.windowId=e,console.log("[ContextMenuOverlay] Window ID set to:",e)}showContextMenu(e){this.isShowingNewMenu=!0,this.hideContextMenu(),this.isShowingNewMenu=!1,this.contextMenuData=e,this.menuElement=document.createElement("div"),this.menuElement.className="browser-context-menu",this.menuElement.style.cssText=`
      position: fixed;
      left: ${e.x}px;
      top: ${e.y}px;
      background: var(--step-1);
      border: 1px solid var(--step-3);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      padding: 4px 0;
      min-width: 200px;
      z-index: 10000;
      pointer-events: auto;
      font-family: 'Soehne', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `,this.getMenuItems(e).forEach(t=>{if(t.type==="separator"){let o=document.createElement("div");o.style.cssText=`
          height: 1px;
          background: var(--step-6);
          margin: 4px 8px;
        `,this.menuElement.appendChild(o)}else{let o=document.createElement("div");o.className="menu-item",o.textContent=t.label,o.style.cssText=`
          padding: 8px 16px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 400;
          color: var(--step-11-5);
          white-space: nowrap;
          user-select: none;
          transition: background-color 0.1s ease;
        `,t.enabled===!1?(o.style.opacity="0.4",o.style.cursor="default"):(o.addEventListener("mouseenter",()=>{o.style.backgroundColor="var(--step-3)"}),o.addEventListener("mouseleave",()=>{o.style.backgroundColor="transparent"}),o.addEventListener("click",()=>{this.handleMenuClick(t.action)})),this.menuElement.appendChild(o)}}),this.root.appendChild(this.menuElement),requestAnimationFrame(()=>{if(!this.menuElement)return;let t=this.menuElement.getBoundingClientRect(),o=window.innerWidth,r=window.innerHeight;t.right>o&&(this.menuElement.style.left=`${Math.max(0,e.x-t.width)}px`),t.bottom>r&&(this.menuElement.style.top=`${Math.max(0,e.y-t.height)}px`)})}hideContextMenu(){this.menuElement&&(this.menuElement.remove(),this.menuElement=null),this.contextMenuData=null,!this.isShowingNewMenu&&window.api?.browserContextMenu?.notifyClosed&&window.api.browserContextMenu.notifyClosed(this.windowId)}getMenuItems(e){let n=[];if(e.browserContext.linkURL&&n.push({label:"Open Link in New Tab",action:"openInNewTab",enabled:!0},{label:"Open Link in Background",action:"openInBackground",enabled:!0},{type:"separator"},{label:"Copy Link",action:"copyLink",enabled:!0}),e.browserContext.srcURL&&e.browserContext.mediaType==="image"&&(n.length>0&&n.push({type:"separator"}),n.push({label:"Open Image in New Tab",action:"openImageInNewTab",enabled:!0},{label:"Copy Image URL",action:"copyImageURL",enabled:!0},{label:"Save Image As...",action:"saveImageAs",enabled:!0})),e.browserContext.selectionText){n.length>0&&n.push({type:"separator"});let t=e.browserContext.selectionText.substring(0,20)+(e.browserContext.selectionText.length>20?"...":"");n.push({label:"Copy",action:"copy",enabled:!0},{label:`Search for "${t}"`,action:"searchSelection",enabled:!0})}return n.length===0&&n.push({label:"Back",action:"goBack",enabled:e.browserContext.canGoBack??!1},{label:"Forward",action:"goForward",enabled:e.browserContext.canGoForward??!1},{label:"Reload",action:"reload",enabled:!0},{type:"separator"},{label:"Copy Page URL",action:"copyPageURL",enabled:!0},{label:"View Page Source",action:"viewSource",enabled:!0}),n.push({type:"separator"},{label:"Inspect Element",action:"inspect",enabled:!0}),n}handleMenuClick(e){if(!this.windowId||!this.contextMenuData)return;let{mappedAction:n,actionData:t}=this.mapActionAndData(e,this.contextMenuData);if(window.api?.browserContextMenu?.sendAction){let r={...{windowId:this.windowId,action:n,context:this.contextMenuData},...t};window.api.browserContextMenu.sendAction(n,r)}this.hideContextMenu()}mapActionAndData(e,n){let{browserContext:t}=n;switch(e){case"openInNewTab":return{mappedAction:"link:open-new-tab",actionData:{url:t.linkURL}};case"openInBackground":return{mappedAction:"link:open-background",actionData:{url:t.linkURL}};case"copyLink":return{mappedAction:"link:copy",actionData:{url:t.linkURL}};case"openImageInNewTab":return{mappedAction:"image:open-new-tab",actionData:{url:t.srcURL}};case"copyImageURL":return{mappedAction:"image:copy-url",actionData:{url:t.srcURL}};case"saveImageAs":return{mappedAction:"image:save",actionData:{url:t.srcURL}};case"copy":return{mappedAction:"edit:copy",actionData:{}};case"searchSelection":return{mappedAction:"search:jeffers",actionData:{query:t.selectionText}};case"goBack":return{mappedAction:"navigate:back",actionData:{}};case"goForward":return{mappedAction:"navigate:forward",actionData:{}};case"reload":return{mappedAction:"navigate:reload",actionData:{}};case"copyPageURL":return{mappedAction:"page:copy-url",actionData:{url:t.pageURL}};case"viewSource":return{mappedAction:"dev:view-source",actionData:{}};case"inspect":return{mappedAction:"dev:inspect",actionData:{x:n.x,y:n.y}};default:return{mappedAction:e,actionData:{}}}}},a;document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{a=new i,window.overlayInstance=a}):(a=new i,window.overlayInstance=a);})();
//# sourceMappingURL=overlay.js.map
