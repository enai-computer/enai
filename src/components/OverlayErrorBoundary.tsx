"use client";

import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class OverlayErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Overlay Error Boundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(255, 0, 0, 0.1)',
          color: 'red',
          padding: '20px',
          fontFamily: 'monospace',
          fontSize: '12px',
          overflow: 'auto'
        }}>
          <h2>Overlay Error</h2>
          <pre>{this.state.error?.stack || this.state.error?.message}</pre>
        </div>
      );
    }

    return this.props.children;
  }
}