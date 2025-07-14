"use strict";(()=>{var i=class{constructor(){this.windowId=null;this.contextMenuData=null;this.menuElement=null;this.isShowingNewMenu=!1;console.log("[ContextMenuOverlay] Initializing overlay");let e=new URLSearchParams(window.location.search);this.windowId=e.get("windowId"),console.log("[ContextMenuOverlay] Window ID:",this.windowId),this.root=document.getElementById("context-menu-root"),this.setupStyles(),this.setupListeners(),this.notifyReady()}setupStyles(){Object.assign(document.body.style,{backgroundColor:"transparent",pointerEvents:"none",margin:"0",padding:"0",overflow:"hidden",position:"fixed",inset:"0"})}setupListeners(){console.log("[ContextMenuOverlay] Setting up listeners"),console.log("[ContextMenuOverlay] window.api available?",!!window.api),console.log("[ContextMenuOverlay] window.api.browserContextMenu available?",!!window.api?.browserContextMenu),window.api?.browserContextMenu?(window.api.browserContextMenu.onShow(e=>{console.log("[ContextMenuOverlay] Received context menu data:",e),this.contextMenuData=e,this.showContextMenu(e)}),console.log("[ContextMenuOverlay] Subscribed to onShow event")):(console.error("[ContextMenuOverlay] window.api.browserContextMenu not available!"),console.error("[ContextMenuOverlay] window.api:",window.api)),document.addEventListener("click",e=>{this.menuElement&&!this.menuElement.contains(e.target)&&this.hideContextMenu()}),document.addEventListener("keydown",e=>{e.key==="Escape"&&this.hideContextMenu()})}notifyReady(){window.api?.browserContextMenu?.notifyReady&&(window.api.browserContextMenu.notifyReady(),console.log("[Overlay] Notified main process that overlay is ready"))}showContextMenu(e){this.isShowingNewMenu=!0,this.hideContextMenu(),this.isShowingNewMenu=!1,this.menuElement=document.createElement("div"),this.menuElement.className="browser-context-menu",this.menuElement.style.cssText=`
      position: fixed;
      left: ${e.x}px;
      top: ${e.y}px;
      background: #2a2a28;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      padding: 4px 0;
      min-width: 200px;
      z-index: 10000;
      pointer-events: auto;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `,this.getMenuItems(e).forEach(o=>{if(o.type==="separator"){let n=document.createElement("div");n.style.cssText=`
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
          margin: 4px 8px;
        `,this.menuElement.appendChild(n)}else{let n=document.createElement("div");n.className="menu-item",n.textContent=o.label,n.style.cssText=`
          padding: 8px 16px;
          cursor: pointer;
          font-size: 13px;
          color: #e0e0e0;
          white-space: nowrap;
          user-select: none;
          transition: background-color 0.1s ease;
        `,o.enabled===!1?(n.style.opacity="0.4",n.style.cursor="default"):(n.addEventListener("mouseenter",()=>{n.style.backgroundColor="rgba(255, 255, 255, 0.1)"}),n.addEventListener("mouseleave",()=>{n.style.backgroundColor="transparent"}),n.addEventListener("click",()=>{this.handleMenuClick(o.action)})),this.menuElement.appendChild(n)}}),this.root.appendChild(this.menuElement),requestAnimationFrame(()=>{if(!this.menuElement)return;let o=this.menuElement.getBoundingClientRect(),n=window.innerWidth,a=window.innerHeight;o.right>n&&(this.menuElement.style.left=`${Math.max(0,e.x-o.width)}px`),o.bottom>a&&(this.menuElement.style.top=`${Math.max(0,e.y-o.height)}px`)})}hideContextMenu(){this.menuElement&&(this.menuElement.remove(),this.menuElement=null),this.contextMenuData=null,!this.isShowingNewMenu&&window.api?.browserContextMenu?.notifyClosed&&window.api.browserContextMenu.notifyClosed()}getMenuItems(e){let t=[];if(e.linkURL&&t.push({label:"Open Link in New Tab",action:"openInNewTab",enabled:!0},{label:"Open Link in Background",action:"openInBackground",enabled:!0},{type:"separator"},{label:"Copy Link",action:"copyLink",enabled:!0}),e.srcURL&&e.mediaType==="image"&&(t.length>0&&t.push({type:"separator"}),t.push({label:"Open Image in New Tab",action:"openImageInNewTab",enabled:!0},{label:"Copy Image URL",action:"copyImageURL",enabled:!0},{label:"Save Image As...",action:"saveImageAs",enabled:!0})),e.selectionText){t.length>0&&t.push({type:"separator"});let o=e.selectionText.substring(0,20)+(e.selectionText.length>20?"...":"");t.push({label:"Copy",action:"copy",enabled:!0},{label:`Search for "${o}"`,action:"searchSelection",enabled:!0})}return t.length===0&&t.push({label:"Back",action:"goBack",enabled:e.canGoBack??!1},{label:"Forward",action:"goForward",enabled:e.canGoForward??!1},{label:"Reload",action:"reload",enabled:!0},{type:"separator"},{label:"Copy Page URL",action:"copyPageURL",enabled:!0},{label:"View Page Source",action:"viewSource",enabled:!0}),t.push({type:"separator"},{label:"Inspect Element",action:"inspect",enabled:!0}),t}handleMenuClick(e){if(console.log("[Overlay] Menu action clicked:",e),!(!this.windowId||!this.contextMenuData)){if(window.api?.browserContextMenu?.sendAction){let t={windowId:this.windowId,action:e,context:this.contextMenuData};window.api.browserContextMenu.sendAction(e,t)}this.hideContextMenu()}}};document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{new i}):new i;})();
//# sourceMappingURL=overlay.js.map
