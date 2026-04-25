import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Plus, Search, Settings2 } from 'lucide-react';
import { AdminSidebar } from '../AdminSidebar';

interface SectionMeta {
  title: string;
  description: string;
  columns: string[];
  rows: (string | number)[][];
}

const SECTION_META: Record<string, SectionMeta> = {
  users: {
    title: '사용자',
    description: '계정, 역할, 서명 정보를 관리합니다.',
    columns: ['ID', '이름', '소속', '역할', '상태'],
    rows: [
      ['u-001', '박영호', '냉연 1팀', 'EDITOR', '활성'],
      ['u-002', '김지원', '냉연 1팀', 'APPROVER', '활성'],
      ['u-003', '최정아', '계장팀', 'EDITOR', '활성'],
      ['u-004', '임도현', '품질팀', 'APPROVER', '비활성'],
      ['u-005', '김철수', '공정팀', 'VIEWER', '활성'],
    ],
  },
  organizations: {
    title: '조직',
    description: '조직 트리와 소속 정보를 관리합니다.',
    columns: ['코드', '조직명', '상위 조직', '구성원'],
    rows: [
      ['DKC', '동국씨엠', '-', 280],
      ['DKC-PROD', '생산본부', '동국씨엠', 142],
      ['DKC-PROD-CGL', '냉연 1팀', '생산본부', 38],
      ['DKC-QA', '품질본부', '동국씨엠', 45],
      ['DKC-ENG', '기술본부', '동국씨엠', 60],
    ],
  },
  groups: {
    title: '그룹',
    description: '권한 그룹과 멤버십을 관리합니다.',
    columns: ['그룹명', '설명', '멤버 수', '권한 범위'],
    rows: [
      ['drawing-editors', '도면 편집 그룹', 24, 'EDIT'],
      ['drawing-approvers', '결재자 그룹', 8, 'APPROVE'],
      ['external-viewers', '외주사 열람', 14, 'VIEW'],
      ['admins', '시스템 관리자', 4, 'ADMIN'],
    ],
  },
  folders: {
    title: '폴더 트리',
    description: '폴더 구조와 권한 매트릭스를 관리합니다.',
    columns: ['경로', '소유 그룹', '읽기', '쓰기'],
    rows: [
      ['/CGL-1', 'drawing-editors', 'all', 'editors'],
      ['/CGL-2/메인라인', 'drawing-editors', 'all', 'editors'],
      ['/BFM/공정', 'drawing-editors', 'editors', 'editors'],
      ['/QA', 'admins', 'admins', 'admins'],
    ],
  },
  classes: {
    title: '자료유형 / 속성',
    description: '자료 유형과 필수 속성을 관리합니다.',
    columns: ['코드', '명칭', '속성 수', '버전'],
    rows: [
      ['MEC', '기계 도면', 12, 'v3'],
      ['ELE', '전기 도면', 10, 'v2'],
      ['INS', '계장 도면', 11, 'v2'],
      ['PRC', '공정 도면', 14, 'v4'],
    ],
  },
  'number-rules': {
    title: '자동발번 규칙',
    description: '도면번호 생성 규칙을 관리합니다.',
    columns: ['규칙명', '패턴', '대상 클래스', '활성'],
    rows: [
      ['CGL-기계', '{LINE}-MEC-{YYYY}-{SEQ:5}', 'MEC', 'Y'],
      ['CGL-전기', '{LINE}-ELE-{YYYY}-{SEQ:5}', 'ELE', 'Y'],
      ['CGL-계장', '{LINE}-INS-{YYYY}-{SEQ:5}', 'INS', 'Y'],
      ['BFM-공정', 'BFM-PRC-{YYYY}-{SEQ:5}', 'PRC', 'Y'],
    ],
  },
  notices: {
    title: '공지사항',
    description: '시스템 공지와 팝업 메시지를 관리합니다.',
    columns: ['제목', '심각도', '게시 시작', '게시 종료'],
    rows: [
      ['4/27 02:00~04:00 시스템 점검', '중요', '2026-04-25', '2026-04-27'],
      ['뷰어 v2 업데이트 안내', '안내', '2026-04-20', '2026-05-10'],
      ['결재선 정책 변경', '안내', '2026-04-12', '2026-05-12'],
    ],
  },
  integrations: {
    title: 'API Key',
    description: '외부 연계 키를 발급하고 회수합니다.',
    columns: ['키 ID', '소유자', '범위', '상태'],
    rows: [
      ['ak_5G9q...', 'erp-bridge', 'objects:read', '활성'],
      ['ak_2Pmf...', 'mes-sync', 'objects:read,write', '활성'],
      ['ak_8Hxe...', 'partner-홍성', 'lobby:read', '회수'],
    ],
  },
  audit: {
    title: '감사 로그',
    description: '시스템 활동 이력을 조회합니다.',
    columns: ['시각', '사용자', '액션', '대상'],
    rows: [
      ['2026-04-26 10:23', '박영호', 'CHECKIN', 'CGL-MEC-2026-00012'],
      ['2026-04-26 09:55', '김지원', 'APPROVE', 'CGL-ELE-2026-00031'],
      ['2026-04-26 09:14', '김철수', 'CREATE', 'BFM-PRC-2026-00008'],
      ['2026-04-26 08:41', '박영호', 'SUBMIT', 'CGL-MEC-2026-00009'],
      ['2026-04-26 08:02', '최정아', 'CHECKOUT', 'CGL-INS-2026-00021'],
    ],
  },
};

export default function AdminSectionPage({
  params,
}: {
  params: { section: string };
}) {
  const meta = SECTION_META[params.section];
  if (!meta) notFound();

  return (
    <div className="flex h-full min-h-0 flex-1">
      <AdminSidebar />
      <section className="flex min-w-0 flex-1 flex-col overflow-auto bg-bg">
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

            <table className="app-table">
              <thead>
                <tr>
                  {meta.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {meta.rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-bg-subtle">
                    {row.map((cell, i) => (
                      <td
                        key={i}
                        className={
                          i === 0
                            ? 'font-mono text-[12px] text-fg'
                            : 'text-sm text-fg-muted'
                        }
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="border-t border-border px-4 py-2 text-xs text-fg-muted">
              샘플 데이터입니다. API 연결 후 실제 데이터가 표시됩니다.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
