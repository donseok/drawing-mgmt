import { test, expect } from '@playwright/test';

/**
 * R44 §2.2 — 결재 라이프사이클.
 *
 * CHECKED_IN 자료 → 결재 상신 (admin 셀프) → /approval?box=waiting 에서
 * row 선택 → 승인 → 상태 전이 + 토스트 확인.
 *
 * 전제: seed 데이터에 적어도 하나의 CHECKED_IN 자료가 있어야 한다
 * (api_contract.md §2.2 메모). 부족하면 첫 번째 단계의 expect에서 명확히
 * 실패한다.
 */

test.describe('Approval lifecycle — submit → approve → state transition', () => {
  test.slow();

  test('admin can submit a CHECKED_IN object for approval, then self-approve it', async ({
    page,
  }) => {
    // 1) /search?state=CHECKED_IN — toolbar 필터를 URL 쿼리로 미리 적용해
    //    상신 가능한 row만 좁힌다.
    await page.goto('/search?state=CHECKED_IN');
    await expect(page.getByRole('heading', { name: '자료 검색' })).toBeVisible();

    // 결과 그리드의 첫 번째 데이터 행(헤더 다음). selector 안정성: tbody
    // 안의 첫 번째 row.
    const firstRow = page.locator('table.app-table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });

    // 행에서 자료명을 읽어둔다 (detail에서 toast 흐름 확인용).
    const rowName = await firstRow.locator('td').nth(3).innerText();
    expect(rowName.length).toBeGreaterThan(0);

    // 2) 행 메뉴 → [결재 상신].
    await firstRow.getByRole('button', { name: '행 메뉴' }).click();
    await page.getByRole('menuitem', { name: '결재 상신' }).click();

    // 3) NewApprovalDialog가 뜬다.
    await expect(page.getByRole('heading', { name: '결재 상신' })).toBeVisible({
      timeout: 10000,
    });

    // 결재 제목 — default가 들어있지만 빈 입력이 아닌지 확인 후 그대로 유지.
    const titleField = page.getByLabel('결재 제목');
    await expect(titleField).toBeVisible();
    await expect(titleField).not.toHaveValue('');

    // 4) 결재자 picker — admin 자기 자신을 검색해 line에 추가 (셀프 승인 흐름).
    const picker = page.getByRole('textbox', { name: '결재자 검색' });
    await picker.fill('admin');

    // 검색 결과 dropdown — 첫 번째 매치 항목 (button) 클릭.
    // dropdown의 항목은 button 안에 fullName + @username 노출. button text가
    // "admin" 포함이면 OK. timeout을 길게 잡아 250ms debounce 통과까지 대기.
    const candidate = page
      .getByRole('button', { name: /admin/i })
      .filter({ hasText: '@' })
      .first();
    await expect(candidate).toBeVisible({ timeout: 10000 });
    await candidate.click();

    // 추가됐는지 — 결재자 line에 admin이 1번 step으로 노출되어야 한다.
    // step 인덱스 1 (원형 배지 안의 숫자) 안에 위치한 li.
    const approverItem = page.locator('ol > li').filter({ hasText: 'admin' }).first();
    await expect(approverItem).toBeVisible();

    // 5) [상신] 클릭 → mutation → toast.
    await page.getByRole('button', { name: '상신', exact: true }).click();

    // toast.success(`결재상신 완료`) — search 페이지의 rowMutation은
    // ACTION_LABEL.release === '결재 상신'을 사용한다.
    await expect(
      page.getByText(/결재.?상신 완료|상신/, { exact: false }).first(),
    ).toBeVisible({ timeout: 15000 });

    // 6) /approval?box=waiting 로 이동.
    await page.goto('/approval?box=waiting');
    await expect(
      page.getByRole('heading', { name: /대기 결재/ }),
    ).toBeVisible({ timeout: 10000 });

    // 결재 행이 list에 있어야 한다 — admin이 결재자고 셀프 상신했으므로
    // waiting box에 노출된다. 첫 번째 row 클릭.
    const approvalRow = page.locator('table.app-table tbody tr').first();
    await expect(approvalRow).toBeVisible({ timeout: 10000 });
    await approvalRow.click();

    // 7) 측면 결재 상세 패널이 열린다 — '결재 상세' aside.
    const detailPanel = page.getByLabel('결재 상세');
    await expect(detailPanel).toBeVisible({ timeout: 10000 });

    // 8) [승인] 버튼 (footer의 큰 버튼) 클릭.
    //    footer 영역의 "승인" semantic button. 페이지 안에 같은 라벨이 두 군데
    //    (action bar + footer)에 있을 수 있어 detail panel scope로 한정한다.
    await detailPanel.getByRole('button', { name: '승인' }).first().click();

    // 9) toast.success(`승인 완료`).
    await expect(
      page.getByText(/승인.?완료/, { exact: false }).first(),
    ).toBeVisible({ timeout: 15000 });

    // 승인 후 selectedId가 null로 reset되어 상세 패널이 닫힌다.
    await expect(detailPanel).toBeHidden({ timeout: 10000 });
  });
});
