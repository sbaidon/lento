import type { ProtocolConfig } from "./config";
import { DEFAULT_PROTOCOL_CONFIG } from "./config";
import { ProtocolError } from "./errors";

export class ContentPolicy {
  constructor(private readonly config: ProtocolConfig = DEFAULT_PROTOCOL_CONFIG) {}

  validateBody(body: string): string {
    const normalized = body.trim();

    if (normalized.length === 0) {
      throw new ProtocolError("invalid_content", 400, "Content body cannot be empty.");
    }

    if (normalized.length > this.config.maxContentLength) {
      throw new ProtocolError(
        "content_too_long",
        400,
        `Content body exceeds ${this.config.maxContentLength} characters.`
      );
    }

    return normalized;
  }
}
