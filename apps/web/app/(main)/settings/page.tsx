'use client';

import { useQuery } from '@tanstack/react-query';
import { Settings } from 'lucide-react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ProfileSection } from '@/components/settings/ProfileSection';
import { PasswordSection } from '@/components/settings/PasswordSection';
import { SignatureSection } from '@/components/settings/SignatureSection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/queries';

/** Shape returned by GET /api/v1/me */
interface MeResponse {
  id: string;
  username: string;
  fullName: string | null;
  email: string | null;
  role: string;
  securityLevel: number;
  organizationId: string | null;
  signatureFile: string | null;
  /**
   * R35 N-1 — when true, the server enqueues an email on each notification
   * (subject to MAIL_ENABLED). Defaults to true server-side; we fall back to
   * `true` here too so a missing field (e.g. mid-deploy) still renders.
   */
  notifyByEmail?: boolean;
  /**
   * R38 N-2 — SMS / Kakao channel toggles. Both are gated by `phoneNumber`
   * existing on the server side. Optional so a mid-deploy /me response that
   * predates the migration still renders (defaults to false / null).
   */
  notifyBySms?: boolean;
  notifyByKakao?: boolean;
  phoneNumber?: string | null;
  organization: { id: string; name: string; parentId: string | null } | null;
  groups: { id: string; name: string }[];
}

export default function SettingsPage() {
  const { data: me, isLoading } = useQuery<MeResponse>({
    queryKey: queryKeys.me(),
    queryFn: () => api.get<MeResponse>('/api/v1/me'),
  });

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto bg-bg">
        <header className="border-b border-border px-6 py-5">
          <div className="app-kicker">Settings</div>
          <h1 className="mt-1 text-2xl font-semibold text-fg">환경설정</h1>
        </header>
        <div className="flex items-center justify-center p-12">
          <div className="flex items-center gap-2 text-sm text-fg-muted">
            <Settings className="h-4 w-4 animate-spin" />
            <span>불러오는 중...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="flex-1 overflow-auto bg-bg">
        <header className="border-b border-border px-6 py-5">
          <div className="app-kicker">Settings</div>
          <h1 className="mt-1 text-2xl font-semibold text-fg">환경설정</h1>
        </header>
        <div className="p-6 text-sm text-fg-muted">
          사용자 정보를 불러올 수 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-bg">
      <header className="border-b border-border px-6 py-5">
        <div className="app-kicker">Settings</div>
        <h1 className="mt-1 text-2xl font-semibold text-fg">환경설정</h1>
        <p className="mt-1 text-sm text-fg-muted">
          프로필, 비밀번호, 서명 등 개인 설정을 관리합니다.
        </p>
      </header>

      <div className="mx-auto max-w-2xl p-6">
        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile">프로필</TabsTrigger>
            <TabsTrigger value="password">비밀번호</TabsTrigger>
            <TabsTrigger value="signature">서명</TabsTrigger>
            <TabsTrigger value="notifications">알림</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfileSection
              user={{
                username: me.username,
                fullName: me.fullName,
                email: me.email,
                role: me.role,
                organization: me.organization,
              }}
            />
          </TabsContent>

          <TabsContent value="password">
            <PasswordSection />
          </TabsContent>

          <TabsContent value="signature">
            <SignatureSection signatureFile={me.signatureFile} />
          </TabsContent>

          <TabsContent value="notifications">
            <NotificationsSection
              notifyByEmail={me.notifyByEmail ?? true}
              notifyBySms={me.notifyBySms ?? false}
              notifyByKakao={me.notifyByKakao ?? false}
              phoneNumber={me.phoneNumber ?? null}
              hasEmail={!!me.email}
            />
          </TabsContent>
        </Tabs>

        <Separator className="my-8" />

        <p className="text-xs text-fg-muted">
          일부 설정(역할, 소속)은 관리자만 변경할 수 있습니다. 변경이 필요하면 관리자에게 문의하세요.
        </p>
      </div>
    </div>
  );
}
