// Shapes returned by /api/github/* (shared by server and pages).

export interface RepoSummary {
	fullName: string;
	owner: string;
	name: string;
	private: boolean;
	fork: boolean;
	defaultBranch: string;
	description: string | null;
	pushedAt: string | null;
}

export interface PullSummary {
	number: number;
	title: string;
	state: 'open' | 'closed';
	merged: boolean;
	author: string;
	url: string;
	baseRef: string;
	headRef: string;
	baseSha: string;
	headSha: string;
	updatedAt: string;
}

export interface BranchSummary {
	name: string;
	sha: string;
	protected: boolean;
}
