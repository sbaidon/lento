import type {
  Agent,
  ContentItem,
  FeedItem,
  Interaction,
  InteractionKind,
  MoltbookIdentity,
  User,
  Vouch
} from "../domain/types";

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export interface HealthResponse {
  ok: boolean;
}

interface UserResponse {
  user: User;
}

interface AgentResponse {
  agent: Agent;
}

interface ContentResponse {
  content: ContentItem;
}

interface ContentListResponse {
  content: ContentItem[];
}

interface FeedResponse {
  feed: FeedItem[];
}

interface InteractionResponse {
  interaction: Interaction;
}

interface VouchResponse {
  vouch: Vouch;
  trustScore: number;
}

interface AbuseReportResponse {
  report: {
    reporterActorId: string;
    targetActorId: string;
    severity: 1 | 2 | 3 | 4 | 5;
    createdAt: number;
  };
  trustScore: number;
}

interface IdentityResponse {
  identity: MoltbookIdentity;
  agent?: Agent;
}

type FetchLike = typeof fetch;

export interface LentoApiClientOptions {
  fetcher?: FetchLike;
  headers?: Record<string, string>;
  moltbookIdentityToken?: string;
}

export class LentoApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly headers: Record<string, string>;

  constructor(baseUrl: string, fetcherOrOptions: FetchLike | LentoApiClientOptions = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    if (typeof fetcherOrOptions === "function") {
      this.fetcher = fetcherOrOptions;
      this.headers = {};
      return;
    }

    this.fetcher = fetcherOrOptions.fetcher ?? fetch;
    this.headers = {
      ...fetcherOrOptions.headers,
      ...(fetcherOrOptions.moltbookIdentityToken
        ? { "x-moltbook-identity": fetcherOrOptions.moltbookIdentityToken }
        : {})
    };
  }

  withMoltbookIdentityToken(token: string): LentoApiClient {
    return new LentoApiClient(this.baseUrl, {
      fetcher: this.fetcher,
      headers: {
        ...this.headers,
        "x-moltbook-identity": token
      }
    });
  }

  async health(): Promise<HealthResponse> {
    return this.request("GET", "/health");
  }

  async getIdentity(): Promise<MoltbookIdentity> {
    const response = await this.request<IdentityResponse>("GET", "/identity/me");
    return response.identity;
  }

  async registerAgent(handle?: string): Promise<Agent> {
    const response = await this.request<AgentResponse>("POST", "/agents/register", { handle });
    return response.agent;
  }

  async getAuthenticatedAgent(): Promise<Agent> {
    const response = await this.request<AgentResponse>("GET", "/agents/me");
    return response.agent;
  }

  async getAgent(agentId: string): Promise<Agent> {
    const response = await this.request<AgentResponse>(
      "GET",
      `/agents/${encodeURIComponent(agentId)}`
    );
    return response.agent;
  }

  async createUser(handle: string): Promise<User> {
    const response = await this.request<UserResponse>("POST", "/users", { handle });
    return response.user;
  }

  async getUser(userId: string): Promise<User> {
    const response = await this.request<UserResponse>(
      "GET",
      `/users/${encodeURIComponent(userId)}`
    );
    return response.user;
  }

  async createContent(authorId: string, body: string): Promise<ContentItem> {
    const response = await this.request<ContentResponse>("POST", "/content", { authorId, body });
    return response.content;
  }

  async listContent(authorId?: string): Promise<ContentItem[]> {
    const query = authorId ? `?authorId=${encodeURIComponent(authorId)}` : "";
    const response = await this.request<ContentListResponse>("GET", `/content${query}`);
    return response.content;
  }

  async createVouch(fromUserId: string, toUserId: string, stake?: number): Promise<VouchResponse> {
    return this.createActorVouch(fromUserId, toUserId, stake);
  }

  async createActorVouch(
    fromActorId: string,
    toActorId: string,
    stake?: number
  ): Promise<VouchResponse> {
    return this.request<VouchResponse>("POST", "/vouches", {
      fromActorId,
      toActorId,
      stake
    });
  }

  async createAbuseReport(
    reporterUserId: string,
    targetUserId: string,
    severity: 1 | 2 | 3 | 4 | 5
  ): Promise<AbuseReportResponse> {
    return this.createActorAbuseReport(reporterUserId, targetUserId, severity);
  }

  async createActorAbuseReport(
    reporterActorId: string,
    targetActorId: string,
    severity: 1 | 2 | 3 | 4 | 5
  ): Promise<AbuseReportResponse> {
    return this.request<AbuseReportResponse>("POST", "/abuse-reports", {
      reporterActorId,
      targetActorId,
      severity
    });
  }

  async createInteraction(
    actorId: string,
    targetContentId: string,
    kind: InteractionKind,
    clientNonce?: string
  ): Promise<Interaction> {
    const response = await this.request<InteractionResponse>("POST", "/interactions", {
      actorId,
      targetContentId,
      kind,
      clientNonce
    });
    return response.interaction;
  }

  async getFeed(userId: string, limit?: number): Promise<FeedItem[]> {
    const search = new URLSearchParams();
    if (limit !== undefined) {
      search.set("limit", String(limit));
    }
    const query = search.toString();
    const response = await this.request<FeedResponse>(
      "GET",
      `/feed/${encodeURIComponent(userId)}${query.length > 0 ? `?${query}` : ""}`
    );
    return response.feed;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(new URL(path, `${this.baseUrl}/`), {
      method,
      headers: {
        "content-type": "application/json",
        ...this.headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const raw = await response.text();
    const parsed = raw.length > 0 ? this.tryParseJson(raw) : {};

    if (!response.ok) {
      const payload = parsed as ErrorPayload;
      const code = payload.error?.code ?? String(response.status);
      const message = payload.error?.message ?? response.statusText ?? "Request failed.";
      throw new Error(`${code}: ${message}`);
    }

    return parsed as T;
  }

  private tryParseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}
