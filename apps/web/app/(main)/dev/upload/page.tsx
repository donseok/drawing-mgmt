// Dev-only DWG upload page.
//
// Drop a .dwg/.dxf file on this page and we POST it to /api/v1/dev/ingest-dwg.
// On success we redirect to /viewer/<id>. No DB persistence, no queue —
// strictly a developer-facing convenience that exercises the conversion
// pipeline end-to-end without seeded data.
//
// TODO(remove-before-prod): replace with the real registration form + chunked
// upload to /api/v1/objects/[id]/attachments.

import { UploadForm } from './upload-form';

export default function DevUploadPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">
          도면 업로드 <span className="text-fg-muted text-sm font-normal">(개발용)</span>
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          DWG 또는 DXF 파일을 드롭하면 즉시 변환 후 미리보기로 이동합니다.
          정식 등록 화면이 아니며, DB에 객체를 생성하지 않습니다.
        </p>
      </header>

      <UploadForm />
    </div>
  );
}
