"use client";

import { OpenInNotebookButton } from '@/components/ui/open-in-notebook-button';

export default function TestOpenInNotebookPage() {
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Test Open in Notebook Button</h1>
      
      <div className="space-y-6">
        <div className="p-4 border rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Basic Example</h2>
          <p className="mb-3">Click the button below to open a URL in a notebook:</p>
          <OpenInNotebookButton url="https://example.com" />
        </div>

        <div className="p-4 border rounded-lg">
          <h2 className="text-lg font-semibold mb-2">With Different URLs</h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">GitHub:</span>
              <OpenInNotebookButton url="https://github.com" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Stack Overflow:</span>
              <OpenInNotebookButton url="https://stackoverflow.com" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">MDN Web Docs:</span>
              <OpenInNotebookButton url="https://developer.mozilla.org" />
            </div>
          </div>
        </div>

        <div className="p-4 border rounded-lg">
          <h2 className="text-lg font-semibold mb-2">Inline Usage</h2>
          <p className="text-sm">
            You can check out this interesting article about web development 
            <OpenInNotebookButton url="https://web.dev" className="ml-1 inline-flex" /> 
            and take notes on it in your notebook.
          </p>
        </div>
      </div>
    </div>
  );
}