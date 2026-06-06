import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Codebase — Mission Control | DashClaw',
};

export default function CodebasePage() {
  return (
    <div style={{ height: 'calc(100vh - 4rem)', margin: 0 }}>
      <iframe
        src="/livingcode/index.html"
        title="Livingcode Dashboard"
        style={{ width: '100%', height: '100%', border: 0 }}
      />
    </div>
  );
}
