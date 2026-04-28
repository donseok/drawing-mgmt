import { test, expect } from '@playwright/test';

/**
 * R44 §2.3 — 트랜스미털(로비함) 라이프사이클.
 *
 * /search 에서 자료 1건 체크박스 선택 → 툴바 [트랜스미털] → 다이얼로그에서
 * 기본값으로 [생성] → /lobby/[id] 자동 이동 → [검토 회신] 다이얼로그에서
 * 코멘트 + decision=COMMENT → 회신 등록 → timeline에 노출 확인.
 *
 * 전제: seed에 admin이 VIEW 가능한 자료가 적어도 1건. partner 조직 picker는
 * 비워두고 진행해도 BE는 본인이 "상신함"에서 보는 형태로 lobby를 생성한다.
 */

test.describe('Lobby transmittal — bundle → create → reply', () => {
  test.slow();

  test('admin can transmittal-bundle a row and post a review reply', async ({
    page,
  }) => {
    // 1) /search 진입.
    await page.goto('/search');
    await expect(page.getByRole('heading', { name: '자료 검색' })).toBeVisible();

    // 2) 첫 번째 데이터 행의 행 선택 체크박스를 누른다.
    const firstRow = page.locator('table.app-table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.getByRole('checkbox', { name: '행 선택' }).check();

    // toolbar의 선택 카운트가 노출되는지 — "1건 선택됨" 텍스트.
    await expect(page.getByText(/\d+건 선택됨/)).toBeVisible({ timeout: 5000 });

    // 3) [트랜스미털] 툴바 액션 클릭.
    //    ToolbarAction은 button + label 텍스트. selected bar 안의 button.
    await page.getByRole('button', { name: '트랜스미털' }).click();

    // 4) TransmittalDialog가 열린다 — title "트랜스미털 생성".
    await expect(
      page.getByRole('heading', { name: '트랜스미털 생성' }),
    ).toBeVisible({ timeout: 10000 });

    // 제목/만료일 default 값이 채워져 있다 — 비워두지 않는다.
    // 협력업체 picker는 비워둔 채 그대로 [생성] 누른다.

    // 5) [N건 트랜스미털] 버튼은 동적 라벨 — 선택 1건이면 "1건 트랜스미털".
    await page.getByRole('button', { name: /\d+건 트랜스미털/ }).click();

    // 6) 성공 → /lobby/[id]로 자동 이동 (router.push).
    await page.waitForURL(/\/lobby\/[^/?#]+/, { timeout: 15000 });

    // 패키지 제목이 헤딩으로 보이는지 확인 (`Partner Package` kicker 아래).
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({
      timeout: 10000,
    });

    // 7) [검토 회신] primary 버튼 클릭.
    await page.getByRole('button', { name: '검토 회신' }).click();

    // 회신 다이얼로그 — role=dialog + aria-label="검토 회신".
    const replyDialog = page.getByRole('dialog', { name: '검토 회신' });
    await expect(replyDialog).toBeVisible({ timeout: 10000 });

    // 8) 코멘트 입력 + decision=COMMENT 유지 (default).
    const commentText = `E2E reply ${Date.now()}`;
    await replyDialog.getByPlaceholder('검토 의견 또는 요청사항…').fill(commentText);

    // decision 선택 — default가 COMMENT라 별도 클릭 불필요.
    // [회신 보내기] 클릭.
    await replyDialog.getByRole('button', { name: '회신 보내기' }).click();

    // 9) toast.success("회신을 등록했습니다…").
    await expect(
      page.getByText('회신을 등록했습니다', { exact: false }),
    ).toBeVisible({ timeout: 15000 });

    // 10) timeline에 방금 작성한 코멘트가 노출되는지 확인.
    await expect(page.getByText(commentText)).toBeVisible({ timeout: 10000 });
  });
});
