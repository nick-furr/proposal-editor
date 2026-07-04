"use client";

import { Component, type ReactNode } from "react";

// One bad block must never take down the app.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-lg border border-edge p-6 text-sm text-muted">
          This document could not be rendered. Try uploading it again.
        </div>
      );
    }
    return this.props.children;
  }
}
