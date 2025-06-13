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
}

const Tab: React.FC<TabProps> = ({ tab, isActive, onTabClick, onTabClose }) => {
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
        "relative flex items-center gap-2 px-3 h-8 cursor-pointer transition-all duration-200 group",
        "border-r border-step-6",
        isActive ? "bg-step-2" : "bg-step-3 hover:bg-step-2"
      )}
      onClick={handleClick}
    >
      {/* Favicon */}
      {tab.faviconUrl ? (
        <img 
          src={tab.faviconUrl} 
          alt="" 
          className="w-4 h-4 flex-shrink-0"
          onError={(e) => {
            // Hide broken favicon
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div className="w-4 h-4 flex-shrink-0 bg-step-6 rounded-sm" />
      )}

      {/* Title */}
      <span className={cn(
        "flex-1 text-sm truncate select-none",
        isActive ? "text-step-12" : "text-step-11"
      )}>
        {tab.title || getDomain(tab.url) || 'New Tab'}
      </span>

      {/* Close button */}
      <button
        onClick={handleClose}
        className={cn(
          "flex items-center justify-center w-4 h-4 rounded-sm transition-opacity",
          "opacity-0 group-hover:opacity-100",
          "hover:bg-step-6"
        )}
      >
        <X className="w-3 h-3 text-step-11" />
      </button>
    </div>
  );
};

export interface TabBarProps {
  tabs: TabState[];
  activeTabId: string;
  onTabClick: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onNewTab: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab
}) => {
  // Only show tab bar when there are multiple tabs
  if (tabs.length <= 1) {
    return null;
  }

  return (
    <div className="flex items-center bg-step-3 border-b border-step-6 overflow-hidden">
      <div className="flex-1 flex items-center overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onTabClick={onTabClick}
            onTabClose={onTabClose}
          />
        ))}
      </div>
      
      {/* New Tab button */}
      <button
        onClick={onNewTab}
        className="flex items-center justify-center w-8 h-8 hover:bg-step-2 transition-colors"
        title="New Tab"
      >
        <span className="text-xl leading-none text-step-11">+</span>
      </button>
    </div>
  );
};