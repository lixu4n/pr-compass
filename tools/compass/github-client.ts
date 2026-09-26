/**
 * github-client.ts — real GitHub API implementations of the provider interfaces.
 *
 * Uses the @octokit/rest client. This module is the ONLY place that makes
 * live GitHub API calls. All other modules depend on the provider interfaces,
 * enabling offline test injection.
 *
 * NOTE: @octokit/rest is not yet in package.json. Add it before running live:
 *   npm install @octokit/rest
 * It is intentionally omitted from devDependencies to keep the frontend
 * build unaffected. The Action build step will install it separately.
 */

import type {
  GitHubProvider,
  PullRequest,
  PrFile,
  RepoContent,
  MergeBase,
} from './collect.js'
import type { GitHubPublishProvider, GitHubComment } from './publish.js'

// ---------------------------------------------------------------------------
// Type-only Octokit shape (avoids requiring the package at typecheck time)
// ---------------------------------------------------------------------------

interface OctokitInstance {
  pulls: {
    get(params: { owner: string; repo: string; pull_number: number }): Promise<{ data: PullRequest }>
    listFiles(params: { owner: string; repo: string; pull_number: number; per_page: number }): Promise<{ data: PrFile[] }>
  }
  repos: {
    getContent(params: { owner: string; repo: string; path: string; ref: string }): Promise<{ data: RepoContent }>
    compareCommitsWithBasehead(params: { owner: string; repo: string; basehead: string }): Promise<{ data: MergeBase }>
  }
  issues: {
    listComments(params: {
      owner: string; repo: string; issue_number: number;
      page: number; per_page: number
    }): Promise<{ data: GitHubComment[] }>
    createComment(params: { owner: string; repo: string; issue_number: number; body: string }): Promise<void>
    updateComment(params: { owner: string; repo: string; comment_id: number; body: string }): Promise<void>
  }
  users: {
    getAuthenticated(): Promise<{ data: { login: string } }>
  }
}

function createOctokit(token: string): OctokitInstance {
  // Dynamic import at runtime so the frontend build never requires @octokit/rest
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Octokit } = require('@octokit/rest')
  return new Octokit({ auth: token }) as OctokitInstance
}

// ---------------------------------------------------------------------------
// Collection provider
// ---------------------------------------------------------------------------

export class OctokitGitHubProvider implements GitHubProvider {
  private octokit: OctokitInstance

  constructor(token: string) {
    this.octokit = createOctokit(token)
  }

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest> {
    const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber })
    return data
  }

  async listPrFiles(owner: string, repo: string, prNumber: number): Promise<PrFile[]> {
    const { data } = await this.octokit.pulls.listFiles({
      owner, repo, pull_number: prNumber, per_page: 100,
    })
    return data
  }

  async getContent(owner: string, repo: string, filePath: string, ref: string): Promise<RepoContent | null> {
    try {
      const { data } = await this.octokit.repos.getContent({ owner, repo, path: filePath, ref })
      return data
    } catch {
      return null
    }
  }

  async compareCommits(owner: string, repo: string, base: string, head: string): Promise<MergeBase> {
    const { data } = await this.octokit.repos.compareCommitsWithBasehead({
      owner, repo, basehead: `${base}...${head}`,
    })
    return data
  }
}

// ---------------------------------------------------------------------------
// Publish provider
// ---------------------------------------------------------------------------

export class OctokitPublishProvider implements GitHubPublishProvider {
  private octokit: OctokitInstance

  constructor(token: string) {
    this.octokit = createOctokit(token)
  }

  async listComments(owner: string, repo: string, prNumber: number, page: number, perPage: number): Promise<GitHubComment[]> {
    const { data } = await this.octokit.issues.listComments({
      owner, repo, issue_number: prNumber, page, per_page: perPage,
    })
    return data
  }

  async createComment(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({ owner, repo, issue_number: prNumber, body })
  }

  async updateComment(owner: string, repo: string, commentId: number, body: string): Promise<void> {
    await this.octokit.issues.updateComment({ owner, repo, comment_id: commentId, body })
  }

  async getPrHeadSha(owner: string, repo: string, prNumber: number): Promise<string> {
    const pr = await this.getPullRequest(owner, repo, prNumber)
    return pr.head.sha
  }

  async getBotLogin(): Promise<string> {
    const { data } = await this.octokit.users.getAuthenticated()
    return data.login
  }

  private async getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest> {
    const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber })
    return data
  }
}
