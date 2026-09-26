import { expect, test } from '@playwright/test';

test('unauthenticated visit redirects to login', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/login$/);
	await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
});

test('GitHub is the only way in', async ({ page }) => {
	await page.goto('/login');
	await expect(page.getByRole('button')).not.toHaveText([/password|register|sign up/i]);
	await expect(page.locator('input[type="password"]')).toHaveCount(0);
});
