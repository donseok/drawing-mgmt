// Plain (server-safe) module so the admin RSC and the AdminSidebar client
// component can both consume the same nav definition without crossing the
// "use client" boundary mid-iteration. Importing this list directly from a
// "use client" file caused BUG-02: Next.js turned `ADMIN_GROUPS` into a client
// reference and the server crashed when it called `.map()` on it.

import {
  Building2,
  FolderTree as FolderTreeIcon,
  Hash,
  Layers,
  Megaphone,
  Plug,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Users,
  Users2,
} from 'lucide-react';

export interface AdminGroupItem {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface AdminGroup {
  title: string;
  items: AdminGroupItem[];
}

export const ADMIN_GROUPS: AdminGroup[] = [
  {
    title: '사용자 / 조직',
    items: [
      { href: '/admin/users', label: '사용자', description: '계정·역할·서명 관리', icon: Users },
      { href: '/admin/organizations', label: '조직', description: '조직 트리 관리', icon: Building2 },
      { href: '/admin/groups', label: '그룹', description: '권한 그룹 관리', icon: Users2 },
    ],
  },
  {
    title: '폴더 / 권한',
    items: [
      {
        href: '/admin/folders',
        label: '폴더 트리',
        description: '폴더 구조 및 정렬 관리',
        icon: FolderTreeIcon,
      },
      // R28 — folder-permission matrix lives next to the folder-tree menu so
      // both "폴더 모양 편집" and "권한 비트 편집" are one click away. They are
      // separate routes because the tree edits names/sort/parent while the
      // matrix edits 8 boolean bits per principal — different mental model.
      {
        href: '/admin/folder-permissions',
        label: '권한 매트릭스',
        description: '폴더별 사용자/조직/그룹 권한 비트 편집',
        icon: ShieldCheck,
      },
    ],
  },
  {
    title: '자료 유형',
    items: [
      { href: '/admin/classes', label: '자료유형 / 속성', description: 'Class 정의 및 속성 매핑', icon: Layers },
      { href: '/admin/number-rules', label: '자동발번 규칙', description: '도면번호 규칙 빌더', icon: Hash },
    ],
  },
  {
    title: '규칙 / 공지',
    items: [
      { href: '/admin/notices', label: '공지사항', description: '메인/팝업 공지 관리', icon: Megaphone },
    ],
  },
  {
    title: '통합 / 로그',
    items: [
      // R28 — variant of the conversion queue surface. PROCESSING/PENDING/FAILED
      // counts feed BullMQ ops; this menu is the entry point for retry +
      // diagnostic message inspection.
      {
        href: '/admin/conversions',
        label: '변환 작업',
        description: 'DWG/DXF 변환 큐 모니터링 및 재시도',
        icon: RefreshCw,
      },
      { href: '/admin/integrations', label: 'API Key', description: '외부 연계 키 발급/취소', icon: Plug },
      { href: '/admin/audit', label: '감사 로그', description: '시스템 활동 이력', icon: ScrollText },
    ],
  },
];
