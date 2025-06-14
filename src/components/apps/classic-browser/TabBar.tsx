"use client";

import React, { useCallback } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TabState } from '../../../../shared/types';

interface TabProps {
  tab: TabState;
  isActive: boolean;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  isFocused: boolean; // Add prop to pass window focus state
}

const Tab: React.FC<TabProps> = ({ tab, isActive, onTabClick, onTabClose, isFocused }) => {
  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onTabClose(tab.id);
  }, [tab.id, onTabClose]);

  const handleClick = useCallback(() => {
    if (!isActive) {
      onTabClick(tab.id);
    }
  }, [tab.id, isActive, onTabClick]);

  // Get domain from URL for favicon fallback
  const getDomain = (url: string) => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return '';
    }
  };

  return (
    <div
      className={cn(
        "relative flex items-start pl-2 h-9 cursor-pointer transition-all duration-200 group pt-1.5",
        "max-w-[200px]",
        // Always match title bar color
        isFocused ? "bg-step-4" : "bg-step-3"
      )}
      onClick={handleClick}
    >
      {/* Pill container for content */}
      <div className={cn(
        "flex items-center gap-1.5 px-1 h-6 rounded transition-all duration-200",
        // Pill background colors
        isActive ? "bg-step-2" : 
        isFocused ? "bg-step-5 group-hover:bg-step-4" : "bg-step-4 group-hover:bg-step-3"
      )}
      style={{ borderRadius: '4px' }}>
        {/* Favicon */}
        {tab.faviconUrl ? (
          <img 
            src={tab.faviconUrl} 
            alt="" 
            className="w-3.5 h-3.5 flex-shrink-0"
            onError={(e) => {
              // Hide broken favicon
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-3.5 h-3.5 flex-shrink-0 bg-step-7 rounded-sm" />
        )}

        {/* Title */}
        <span className={cn(
          "text-xs truncate select-none min-w-0 max-w-[200px]",
          isActive ? "text-step-12" : "text-step-11"
        )}>
          {tab.title || getDomain(tab.url) || 'New Tab'}
        </span>

        {/* Close button */}
        <button
          onClick={handleClose}
          className={cn(
            "flex items-center justify-center w-3.5 h-3.5 rounded-sm transition-all ml-1",
            "opacity-0 group-hover:opacity-100",
            "hover:bg-step-8 text-step-11 hover:text-birkin"
          )}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

export interface TabBarProps {
  tabs: TabState[];
  activeTabId: string;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
  isFocused?: boolean; // Add prop to receive window focus state
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab,
  isFocused = true
}) => {
  // Only show tab bar when there are multiple tabs
  if (tabs.length <= 1) {
    return null;
  }

  return (
    <div className={cn(
      "overflow-hidden h-9",
      isFocused ? 'bg-step-4' : 'bg-step-3',
      isFocused ? 'opacity-100' : 'opacity-90'
    )}>
      <div className="inline-flex items-start overflow-x-auto scrollbar-hide h-full">
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onTabClick={onTabClick}
            onTabClose={onTabClose}
            isFocused={isFocused}
          />
        ))}
        
        {/* New Tab button - now inside the scrollable area */}
        <div className="relative inline-flex items-start pl-2 h-9 pt-1.5">
          <button
            onClick={onNewTab}
            className={cn(
              "flex items-center justify-center w-6 h-6 rounded transition-colors",
              "hover:bg-step-2 hover:text-birkin",
              isFocused ? "text-step-11" : "text-step-9"
            )}
            style={{ borderRadius: '4px' }}
            title="New Tab"
          >
            <span className="text-sm leading-none">+</span>
          </button>
        </div>
      </div>
    </div>
  );
};