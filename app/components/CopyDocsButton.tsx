'use client';

import CopyMarkdownButton from './CopyMarkdownButton';

export default function CopyDocsButton() {
  return (
    <CopyMarkdownButton
      href="/api/docs/raw"
      legacyHref="/api/docs/raw?legacy=true"
      className="mt-4"
    />
  );
}
