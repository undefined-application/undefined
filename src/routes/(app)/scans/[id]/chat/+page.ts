import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Chat lives in the dock at the bottom of every system page (docs/ui-spec.md §4.4).
export const load: PageLoad = ({ params }) => {
	redirect(307, `/scans/${params.id}/overview`);
};
