"use client";

import React from 'react';

interface HumanComputerIconProps {
  onClick?: () => void;
  isActive?: boolean;
}

export function HumanComputerIcon({ onClick, isActive = false }: HumanComputerIconProps) {
  return (
    <button
      onClick={onClick}
      className={`w-8 h-8 ${isActive ? 'bg-birkin' : 'bg-step-3'} rounded-full flex items-center justify-center hover:bg-birkin transition-all duration-200 cursor-pointer`}
    >
      <svg 
        width="16" 
        height="16" 
        viewBox="0 0 24 24" 
        fill="currentColor"
        className={`${isActive ? 'text-white' : 'text-step-11'} group-hover:text-white transition-colors`}
      >
        <path d="M0 0H10V10H0V0Z" />
        <path d="M0 14H10V24H0V14Z" />
        <path d="M14 14H24V24H14V14Z" />
        <path d="M24 5C24 7.76142 21.7614 10 19 10C16.2386 10 14 7.76142 14 5C14 2.23858 16.2386 0 19 0C21.7614 0 24 2.23858 24 5Z" />
      </svg>
    </button>
  );
}