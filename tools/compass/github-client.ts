/**
 * github-client.ts — real GitHub API implementations of the provider interfaces.
 *
 * Uses the @octokit/rest client. This module is the ONLY place that makes
 * live GitHub API calls. All other modules depend on the provider interfaces,
 * enabling offline test injection.
 *
 * Octokit is a declared automation dependency bundled into the Action.
 * The React app does not import this module, so its bundle is unaffected.
 */

import { Octokit } from '@octokit/rest'
import type {
  GitHubProvider,
  PullRequest,
  PrFile,
  RepoContent,
  MergeBase,
} from './collect.js'
import type { GitHubPublishProvider, GitHubComment } from './publish.js'

function createOctokit(token: string): Octokit {
  return new Octokit({ auth: token })
}

// ---------------------------------------------------------------------------
// Collection provider
// ---------------------------------------------------------------------------

export class OctokitGitHubProvider implements GitHubProvider {
  private octokit: Octokit

  constructor(token: string) {
    this.octokit = createOctokit(token)
  }

  async getPullRequest(owner: string, repo: string, prNumber: number): Promise<PullRequest> {
    const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber })
    // The API type permits a missing draft flag; skip conservatively if unknown.
    return { ...data, draft: data.draft ?? true }
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
      // The real API may return a directory, symlink or submodule. Only regular
      // files are usable by the existing collector.
      if (Array.isArray(data) || data.type !== 'file') return null
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
  private octokit: Octokit

  constructor(token: string) {
    this.octokit = createOctokit(token)
  }

  async listComments(owner: string, repo: string, prNumber: number, page: number, perPage: number): Promise<GitHubComment[]> {
    const { data } = await this.octokit.issues.listComments({
      owner, repo, issue_number: prNumber, page, per_page: perPage,
    })
    return data.map((comment) => ({
      id: comment.id,
      body: comment.body ?? '',
      user: comment.user ? { login: comment.user.login } : null,
    }))
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
    return { ...data, draft: data.draft ?? true }
  }
}
