import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Markdown from './Markdown.svelte';

describe('Markdown.svelte', () => {
	it('renders a model answer: bold, lists, inline code, evidence markers', async () => {
		const { container } = render(Markdown, {
			text: 'Intro:\n\n1. **FreeRTOS ISR paths**: `QActive::postFromISR` [E1][E4]\n2. Second'
		});

		await expect.element(page.getByText('FreeRTOS ISR paths')).toBeInTheDocument();
		expect(container.querySelector('strong')?.textContent).toBe('FreeRTOS ISR paths');
		expect(container.querySelectorAll('ol > li')).toHaveLength(2);
		expect(container.querySelector('code')?.textContent).toBe('QActive::postFromISR');
		expect([...container.querySelectorAll('sup.evidence')].map((e) => e.textContent)).toEqual([
			'E1',
			'E4'
		]);
		expect(container.textContent).not.toContain('**');
	});

	it('strips HTML the model might emit', async () => {
		const { container } = render(Markdown, {
			text: 'hi <img src=x onerror="window.pwned=1"> <script>window.pwned=1</script>'
		});

		await expect.element(page.getByText('hi')).toBeInTheDocument();
		expect(container.querySelector('script')).toBeNull();
		expect(container.querySelector('img')).toBeNull();
		expect((window as { pwned?: number }).pwned).toBeUndefined();
	});
});
