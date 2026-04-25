import Link from 'next/link';
import { ArrowLeft, Plus, Search, Settings2 } from 'lucide-react';

const SECTION_META: Record<string, { title: string; description: string }> = {
  users: { title: '사용자', description: '계정, 역할, 서명 정보를 관리합니다.' },
  organizations: { title: '조직', description: '조직 트리와 소속 정보를 관리합니다.' },
  groups: { title: '그룹', description: '권한 그룹과 멤버십을 관리합니다.' },
  folders: { title: '폴더 트리', description: '폴더 구조와 권한 매트릭스를 관리합니다.' },
  classes: { title: '자료유형 / 속성', description: '자료 유형과 필수 속성을 관리합니다.' },
  'number-rules': { title: '자동발번 규칙', description: '도면번호 생성 규칙을 관리합니다.' },
  notices: { title: '공지사항', description: '시스템 공지와 팝업 메시지를 관리합니다.' },
  integrations: { title: 'API Key', description: '외부 연계 키를 발급하고 회수합니다.' },
  audit: { title: '감사 로그', description: '시스템 활동 이력을 조회합니다.' },
};

export default function AdminSectionPage({ params }: { params: { section: string } }) {
  const meta = SECTION_META[params.section] ?? {
    title: '관리 메뉴',
    description: '관리 항목을 확인합니다.',
  };

  return (
    <div className="flex-1 overflow-auto bg-bg">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
        <Link href="/admin" className="app-icon-button h-8 w-8" aria-label="관리자로 돌아가기">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="text-fg-muted">관리자</span>
        <span className="text-fg-subtle">/</span>
        <span className="font-medium text-fg">{meta.title}</span>
      </div>

      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div>
          <div className="app-kicker">Admin Console</div>
          <h1 className="mt-1 text-2xl font-semibold text-fg">{meta.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{meta.description}</p>
        </div>
        <button type="button" className="app-action-button-primary h-9">
          <Plus className="h-4 w-4" />
          추가
        </button>
      </div>

      <div className="p-6">
        <div className="app-panel overflow-hidden">
          <div className="app-panel-header">
            <div className="relative w-80">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
              <input
                type="text"
                placeholder={`${meta.title} 검색...`}
                className="h-8 w-full rounded-md border border-border bg-bg px-8 text-sm placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <button type="button" className="app-action-button h-8">
              <Settings2 className="h-4 w-4" />
              보기 설정
            </button>
          </div>
          <div className="px-4 py-10 text-center text-sm text-fg-muted">
            상세 데이터 테이블은 API 연결 후 이 영역에 표시됩니다.
          </div>
        </div>
      </div>
    </div>
  );
}
