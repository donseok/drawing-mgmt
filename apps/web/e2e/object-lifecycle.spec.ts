import { test, expect } from '@playwright/test';

/**
 * R44 §2.1 — 자료(도면) 라이프사이클 핵심 흐름.
 *
 * 등록 → 상세 진입 → 삭제(휴지통) 까지의 happy path 한 사이클을 admin
 * storageState 위에서 돈다. 자료번호는 BE가 자동 발번하므로 selector 단서
 * 로 사용할 수 없어, 자료명에 timestamp suffix를 붙여 유일하게 식별한다.
 */

test.describe('Object lifecycle — create → detail → delete', () => {
  // 등록·상세 진입·삭제·재조회까지 합치면 30초 디폴트로는 빠듯할 수 있다.
  // BE는 자료 생성 + 폴더 카운트 invalidate까지 가는 흐름이라 조금 여유를 둔다.
  test.slow();

  test('admin can register a new object, open its detail, then delete it', async ({
    page,
  }) => {
    // 1) /search 진입 — 헤딩이 보이면 클라이언트 트리가 마운트된 상태.
    await page.goto('/search');
    await expect(page.getByRole('heading', { name: '자료 검색' })).toBeVisible();

    const objectName = `E2E 테스트 자료 ${Date.now()}`;

    // 2) 신규 등록 다이얼로그 트리거. URL 쿼리(`?action=new`)가 단일 진실
    //    소스라 직접 라우팅이 가장 안정적이다 (search 페이지가 `Link
    //    href="/search?action=new"`로 같은 진입점을 사용함).
    await page.goto('/search?action=new');

    // NewObjectDialog는 Radix Dialog 위에 Modal 컴포넌트 — title이 헤딩으로
    // 잡힌다.
    await expect(
      page.getByRole('heading', { name: '새 자료 등록' }),
    ).toBeVisible({ timeout: 10000 });

    // 3) 폼 입력. Select(Radix)는 trigger 클릭 → option 클릭으로 다룬다.
    //    folderId trigger.
    await page.getByRole('combobox', { name: '폴더' }).click();
    await page.getByRole('option', { name: 'CGL / 기계 (MEC)' }).click();

    //    classCode trigger.
    await page.getByRole('combobox', { name: '자료유형' }).click();
    await page.getByRole('option', { name: 'MEC — 기계' }).click();

    //    자료명 — id 기반 로케이터 (form field id="name").
    await page.locator('#name').fill(objectName);

    //    도면번호는 비워둔다(자동 발번 검증).

    //    보안등급은 default("2 — 사내")를 그대로 둔다.

    // 4) [등록] 클릭 → 성공 시 다이얼로그 닫힘 + 토스트.
    await page.getByRole('button', { name: '등록', exact: true }).click();

    // 토스트가 떠야 정상. detail 페이지로 자동 이동하지 않는 흐름이라
    // /search에 그대로 머문다 (closeNewDialog가 ?action을 제거).
    await expect(
      page.getByText('자료가 등록되었습니다.', { exact: false }),
    ).toBeVisible({ timeout: 10000 });

    // 5) 검색창에 자료명 prefix를 넣어 방금 만든 row를 좁힌다. timestamp
    //    suffix가 충분히 커서 다른 row와 충돌하지 않는다.
    const searchInput = page.getByPlaceholder(
      '도면번호, 자료명, PDF 내용 검색...',
    );
    await expect(searchInput).toBeVisible();
    await searchInput.fill(objectName);

    // 결과 행이 그리드에 노출됐는지 확인.
    const row = page.getByRole('row', { name: new RegExp(objectName) });
    await expect(row).toBeVisible({ timeout: 10000 });

    // 6) 행 클릭 → preview panel이 열린다. detail 페이지 진입은 자료번호
    //    링크 클릭으로 한다 (자료명 셀은 selectable cell이며 link는 도면번호
    //    셀 안에 없을 수도 있음 — 안전하게 행을 더블클릭).
    await row.dblclick();

    // detail URL로 이동한 뒤 이름이 헤딩으로 보이는지 확인.
    await page.waitForURL(/\/objects\//, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: objectName })).toBeVisible({
      timeout: 10000,
    });

    // 7) 삭제 — detail 페이지의 헤더 더보기 메뉴에는 NEW 자료 삭제 항목이
    //    아직 disabled (R3c-3 #4 admin-gated하지만 메뉴 자체는 비활성)이라
    //    /search 그리드의 RowMenu 경유로 삭제한다.
    await page.goto('/search');
    await expect(page.getByRole('heading', { name: '자료 검색' })).toBeVisible();
    await searchInput.waitFor();
    await searchInput.fill(objectName);

    const targetRow = page.getByRole('row', { name: new RegExp(objectName) });
    await expect(targetRow).toBeVisible({ timeout: 10000 });

    // 행 메뉴 (⋮) 열기.
    await targetRow.getByRole('button', { name: '행 메뉴' }).click();

    // 드롭다운에서 [삭제] menuitem 클릭.
    await page
      .getByRole('menuitem', { name: '삭제' })
      .click();

    // ConfirmDialog 확인. RowMenu의 onDelete는 ObjectTable의
    // ConfirmDialog를 띄우는데 destructive variant라 confirm button label은
    // "삭제".
    const confirmDialog = page.getByRole('dialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: '삭제', exact: true }).click();

    // 삭제 성공 토스트 (handleBulkDelete의 단건 분기).
    // search/page.tsx delete mutation은 토스트가 따로 없고 row가 list에서
    // 사라지면 OK. 직후 리스트에서 안 보이는지 확인.
    await expect(
      page.getByRole('row', { name: new RegExp(objectName) }),
    ).toHaveCount(0, { timeout: 10000 });
  });
});
