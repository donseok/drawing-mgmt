// Server component shell for /login. The actual form is a client component
// (see ./login-form.tsx) so it can use react-hook-form + signIn().

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { LoginForm } from './login-form';

interface PageProps {
  searchParams?: { callbackUrl?: string; error?: string };
}

export default async function LoginPage({ searchParams }: PageProps) {
  // If already authenticated, bounce to home (mirrors middleware behavior in
  // case the user navigates here directly during an in-flight session).
  const session = await auth();
  if (session?.user) {
    redirect(searchParams?.callbackUrl ?? '/');
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">도면관리시스템</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          계정으로 로그인하세요
        </p>
      </header>
      <LoginForm
        callbackUrl={searchParams?.callbackUrl}
        initialError={searchParams?.error}
      />
    </div>
  );
}
