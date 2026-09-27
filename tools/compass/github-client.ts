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
import type { GitHubPublishProvider, GitHubComment, PublicationState } from './publish.js'

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

export const ACTIONS_BOT_LOGIN = 'github-actions[bot]'

export class OctokitPublishProvider implements GitHubPublishProvider {
  private octokit: Octokit

  constructor(token: string, client?: Octokit, private appSlug = '') {
    if (appSlug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appSlug)) throw new Error('Invalid GitHub App slug.')
    // App slug must come from the trusted token-generation step, never PR content.
    // GITHUB_ACTIONS is a setup guardrail, not proof of a token's identity.
    if (!token.trim()) throw new Error('GitHub publication requires GITHUB_TOKEN.')
    if (process.env.GITHUB_ACTIONS !== 'true') {
      throw new Error('Live publication is supported only in GitHub Actions; use dry-run locally.')
    }
    if (/^(ghp_|github_pat_)/.test(token)) {
      throw new Error('Personal access tokens are not supported for publication; use the standard Actions GITHUB_TOKEN.')
    }
    this.octokit = client ?? createOctokit(token)
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

  async getPublicationState(owner: string, repo: string, prNumber: number): Promise<PublicationState> {
    const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber })
    return {
      headSha: data.head.sha,
      baseSha: data.base.sha,
      state: data.state,
      draft: data.draft ?? true,
      baseRepository: data.base.repo.full_name,
      headRepository: data.head.repo?.full_name ?? null,
      isPrivate: data.base.repo.private,
      authorIsBot: !data.user || data.user.type === 'Bot' ||
        data.user.login.endsWith('[bot]') || data.user.login === 'dependabot',
    }
  }

  async getBotLogin(): Promise<string> {
    // Installation tokens do not identify a user via GET /user. Match the
    // documented built-in Actions bot for this explicitly supported setup.
    return this.appSlug ? `${this.appSlug}[bot]` : ACTIONS_BOT_LOGIN
  }
}
