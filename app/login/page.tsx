import LoginClient from './LoginClient';

export default async function LoginPage() {
  const localAuthEnabled = !!process.env.DASHCLAW_LOCAL_ADMIN_PASSWORD;

  return <LoginClient localAuthEnabled={localAuthEnabled} />;
}
