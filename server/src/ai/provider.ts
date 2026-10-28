import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config';
import type { Logger } from '../logger';

export interface MatchExplainInput {
  jobTitle: string;
  company: string;
  jobDescription: string;
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
}

export interface DraftInput {
  jobTitle: string;
  company: string;
  jobDescription: string;
  // The only facts the model may use. Everything comes from the selected CV.
  cvFacts: string;
  allowedSkills: string[];
}

export interface DraftOutput {
  summary: string;
  coverLetter: string;
  recruiterMessage: string;
}

// AI is an enhancement, never a dependency. Every method returns null when AI is unavailable or fails,
// and callers fall back to deterministic output.
export interface AiProvider {
  readonly enabled: boolean;
  explainMatch(input: MatchExplainInput): Promise<string | null>;
  draftApplication(input: DraftInput): Promise<DraftOutput | null>;
}

export class DisabledAiProvider implements AiProvider {
  readonly enabled = false;
  async explainMatch(): Promise<string | null> {
    return null;
  }
  async draftApplication(): Promise<DraftOutput | null> {
    return null;
  }
}

export class AnthropicProvider implements AiProvider {
  readonly enabled = true;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly logger: Logger,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  }

  private async complete(system: string, user: string, maxTokens: number): Promise<string | null> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      });
      const text = response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim();
      return text || null;
    } catch (error) {
      this.logger.warn({ err: (error as Error).message }, 'AI request failed; using deterministic output');
      return null;
    }
  }

  async explainMatch(input: MatchExplainInput): Promise<string | null> {
    const system =
      'You explain job-fit scores to a job seeker in 2-3 plain sentences. Use only the facts provided. Never invent skills or experience.';
    const user = JSON.stringify({
      job: input.jobTitle,
      company: input.company,
      score: input.score,
      matchedSkills: input.matchedSkills,
      missingSkills: input.missingSkills,
      description: input.jobDescription.slice(0, 3000),
    });
    return this.complete(system, user, 300);
  }

  async draftApplication(input: DraftInput): Promise<DraftOutput | null> {
    const system = [
      'You write job application text for a candidate.',
      'Use ONLY the facts in cvFacts. Never claim a skill, tool, employer, certification, degree, metric or years of experience that is not in cvFacts.',
      'Return strict JSON with keys: summary, coverLetter, recruiterMessage. No markdown.',
    ].join(' ');
    const user = JSON.stringify({
      job: input.jobTitle,
      company: input.company,
      jobDescription: input.jobDescription.slice(0, 4000),
      allowedSkills: input.allowedSkills,
      cvFacts: input.cvFacts,
    });
    const raw = await this.complete(system, user, 1200);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) as Partial<DraftOutput>;
      if (typeof parsed.summary !== 'string' || typeof parsed.coverLetter !== 'string' || typeof parsed.recruiterMessage !== 'string') {
        return null;
      }
      return { summary: parsed.summary, coverLetter: parsed.coverLetter, recruiterMessage: parsed.recruiterMessage };
    } catch {
      this.logger.warn('AI draft was not valid JSON; using deterministic output');
      return null;
    }
  }
}

export function createAiProvider(config: AppConfig, logger: Logger): AiProvider {
  if (!config.ANTHROPIC_API_KEY) return new DisabledAiProvider();
  return new AnthropicProvider(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL, logger);
}
