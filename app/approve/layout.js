// Standalone mobile approval surface. Root layout (app/layout.js) already wraps
// the tree in SessionWrapper, so nested components can call useSession()
// directly. Intentionally no PageLayout/Sidebar/breadcrumbs — this is an
// installable PWA start surface for on-the-go approvals.

export const metadata = {
  title: 'DashClaw Approvals',
  description: 'Approve agent actions from your phone',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
};

export default function ApproveLayout({ children }) {
  return (
    <div className="min-h-screen bg-surface-primary text-white">
      {children}
    </div>
  );
}
