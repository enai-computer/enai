"use client";

import React from 'react';

const baseStyle: React.CSSProperties = {
  position: 'fixed',
  width: '4px',
  height: '4px',
  zIndex: 9999,
  pointerEvents: 'none',
};

export function CornerMasks() {
  return (
    <>
      {/* Top Left Corner */}
      <div 
        style={{
          ...baseStyle,
          top: 0,
          left: 0,
          background: 'radial-gradient(circle at bottom right, transparent 4px, black 4px)',
        }}
      />
      
      {/* Top Right Corner */}
      <div 
        style={{
          ...baseStyle,
          top: 0,
          right: 0,
          background: 'radial-gradient(circle at bottom left, transparent 4px, black 4px)',
        }}
      />
      
      {/* Bottom Left Corner */}
      <div 
        style={{
          ...baseStyle,
          bottom: 0,
          left: 0,
          background: 'radial-gradient(circle at top right, transparent 4px, black 4px)',
        }}
      />
      
      {/* Bottom Right Corner */}
      <div 
        style={{
          ...baseStyle,
          bottom: 0,
          right: 0,
          background: 'radial-gradient(circle at top left, transparent 4px, black 4px)',
        }}
      />
    </>
  );
}