"use client";

import { useState } from "react";

interface FaviconProps {
  url: string;
  fallback: React.ReactNode;
  className?: string;
  alt?: string;
}

export function Favicon({ url, fallback, className = "h-4 w-4 object-contain", alt = "" }: FaviconProps) {
  const [hasError, setHasError] = useState(false);
  
  if (hasError) {
    return <>{fallback}</>;
  }
  
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img 
      src={url} 
      alt={alt} 
      className={className}
      onError={() => setHasError(true)}
    />
  );
}