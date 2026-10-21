"use client";
import { useState } from "react";
import { z } from "zod";
import {
  ArrowRight,
  Check,
  CircleAlert,
  KeyRound,
  Link2,
  LoaderCircle,
  Plus,
  Radio,
  Send,
  Unplug,
} from "lucide-react";
import {
  AnswerabilitySchema,
  BudgetSchema,
  ProjectSchema,
} from "@deeplake/core/contract";
import type { Project, WorkspaceSnapshot } from "@deeplake/core/contract";
import { normalizeConnection } from "../lib/api";
import type { Connection } from "../lib/api";
import { Badge, Modal, ReadOnlyNote } from "./primitives";
import type { Act } from "./primitives";
const NewProjectSchema = z.object({
  name: ProjectSchema.shape.name,
  description: ProjectSchema.shape.description,
  topic: AnswerabilitySchema.shape.topic,
  questions: AnswerabilitySchema.shape.questions,
  seedUrls: z.array(z.string().url()).max(100),
  mode: z.literal("live"),
  budget: BudgetSchema,
});
export type NewProjectInput = z.infer<typeof NewProjectSchema>;
export function ConnectionForm({
  connection,
  onConnect,
  onDisconnect,
  onClose,
  providers,
}: {
  connection: Connection | null;
  onConnect: (connection: Connection) => Promise<void>;
  onDisconnect: () => void;
  onClose: () => void;
  providers: Record<string, boolean>;
}) {
  const [url, setUrl] = useState(connection?.url ?? "http://127.0.0.1:4310"),
    [token, setToken] = useState(connection?.token ?? ""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await onConnect(normalizeConnection({ url, token }));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal
      title="Connect your workspace"
      eyebrow="Operator API"
      onClose={onClose}
    >
      <form className="form-body" onSubmit={(event) => void submit(event)}>
        <p className="description">
          Connect this workbench to your Deeplake API to start runs, review
          changes and publish releases.
        </p>
        <label className="form-label" htmlFor="api-url">
          API URL
          <div className="input-icon">
            <Link2 size={16} />
            <input
              id="api-url"
              type="url"
              required
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://127.0.0.1:4310"
              spellCheck={false}
            />
          </div>
        </label>
        <label className="form-label" htmlFor="api-token">
          Operator token
          <div className="input-icon">
            <KeyRound size={16} />
            <input
              id="api-token"
              type="password"
              required
              minLength={24}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <span className="field-hint">
            Use DEEPLAKE_API_TOKEN from your server configuration. It stays in
            this browser tab’s session.
          </span>
        </label>
        <div className="notice">
          <Radio size={18} />
          <span>
            Provider credentials remain on the server. Connecting does not start
            a crawl or make paid model calls.
          </span>
        </div>
        {Object.keys(providers).length > 0 && (
          <div className="provider-status">
            <p className="form-label">Server provider configuration</p>
            {Object.entries(providers).map(([name, configured]) => (
              <div key={name}>
                <span>{name}</span>
                <Badge value={configured ? "ready" : "pending"}>
                  {configured ? "Configured" : "Not configured"}
                </Badge>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="notice warning" role="alert">
            <CircleAlert size={17} />
            <span>{error}</span>
          </div>
        )}
        <div className="form-actions">
          <button className="button primary" type="submit" disabled={pending}>
            {pending ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Link2 size={15} />
            )}{" "}
            {pending
              ? "Connecting…"
              : connection
                ? "Reconnect"
                : "Connect workspace"}
          </button>
          {connection && (
            <button type="button" className="button" onClick={onDisconnect}>
              <Unplug size={15} />
              Disconnect
            </button>
          )}
        </div>
        <p className="field-hint">
          For local use, run <code>pnpm cli init</code>, seed with{" "}
          <code>pnpm cli demo --persist</code>, then start <code>pnpm api</code>
          .
        </p>
      </form>
    </Modal>
  );
}
export function NewProjectForm({
  connected,
  onConnect,
  onCreate,
  onClose,
  busy,
}: {
  connected: boolean;
  onConnect: () => void;
  onCreate: (input: NewProjectInput) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState(""),
    [topic, setTopic] = useState(""),
    [description, setDescription] = useState(""),
    [questions, setQuestions] = useState(""),
    [urls, setUrls] = useState(""),
    [maxUsd, setMaxUsd] = useState("5"),
    [maxSources, setMaxSources] = useState("40"),
    [maxQueries, setMaxQueries] = useState("12"),
    [maxIterations, setMaxIterations] = useState("2"),
    [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const input = NewProjectSchema.parse({
        name,
        description,
        topic,
        questions: questions
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        seedUrls: urls
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        mode: "live",
        budget: {
          maxUsd: Number(maxUsd),
          maxSources: Number(maxSources),
          maxSearchQueries: Number(maxQueries),
          maxIterations: Number(maxIterations),
          maxOutputTokens: 4096,
        },
      });
      await onCreate(input);
    } catch (error) {
      setError(
        error instanceof z.ZodError
          ? error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join(" · ")
          : error instanceof Error
            ? error.message
            : "Project creation failed.",
      );
    }
  }
  return (
    <Modal
      title="Start with a question"
      eyebrow="New project"
      onClose={onClose}
    >
      <form className="form-body" onSubmit={(event) => void submit(event)}>
        <p className="description">
          A bounded topic gives discovery and schema audits a clear purpose.
          Creating a project does not start a paid run.
        </p>
        <ReadOnlyNote connected={connected} onConnect={onConnect} />
        <label className="form-label" htmlFor="project-name">
          Project name
          <input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Municipal energy projects"
            required
            maxLength={160}
          />
        </label>
        <label className="form-label" htmlFor="project-topic">
          Topic and scope
          <textarea
            id="project-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What information should this project collect, and where does its scope end?"
            required
            minLength={3}
            maxLength={2000}
            rows={3}
          />
        </label>
        <label className="form-label" htmlFor="project-questions">
          Questions to answer
          <textarea
            id="project-questions"
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            placeholder="One concrete question per line"
            required
            rows={3}
          />
          <span className="field-hint">
            These questions guide relevance, schema design and gap-driven
            search.
          </span>
        </label>
        <label className="form-label" htmlFor="project-urls">
          Seed URLs <span className="optional">Optional</span>
          <textarea
            id="project-urls"
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder="https://… (one URL per line)"
            rows={2}
            spellCheck={false}
          />
        </label>
        <details className="advanced-form">
          <summary>Run budget and description</summary>
          <div className="form-grid">
            <label className="form-label">
              Maximum cost / run (USD)
              <input
                type="number"
                min="0"
                step="0.01"
                value={maxUsd}
                onChange={(e) => setMaxUsd(e.target.value)}
                required
              />
            </label>
            <label className="form-label">
              Maximum sources
              <input
                type="number"
                min="1"
                max="10000"
                value={maxSources}
                onChange={(e) => setMaxSources(e.target.value)}
                required
              />
            </label>
            <label className="form-label">
              Maximum search queries
              <input
                type="number"
                min="0"
                max="1000"
                value={maxQueries}
                onChange={(e) => setMaxQueries(e.target.value)}
                required
              />
            </label>
            <label className="form-label">
              Exploration iterations
              <input
                type="number"
                min="1"
                max="20"
                value={maxIterations}
                onChange={(e) => setMaxIterations(e.target.value)}
                required
              />
            </label>
          </div>
          <label className="form-label">
            Description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </label>
          <p className="field-hint">
            Cost reservations use conservative estimates. Actual provider use is
            recorded with each run.
          </p>
        </details>
        {error && (
          <div className="notice warning" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button
            className="button primary"
            type="submit"
            disabled={!connected || busy}
          >
            {busy ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Plus size={15} />
            )}
            Create project
          </button>
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function PublishForm({
  project,
  data,
  connected,
  onConnect,
  onClose,
  act,
  busy,
}: {
  project: Project;
  data: WorkspaceSnapshot;
  connected: boolean;
  onConnect: () => void;
  onClose: () => void;
  act: Act;
  busy: boolean;
}) {
  const schema = data.schemas.find((s) => s.id === project.currentSchemaId),
    previous = data.publications.find(
      (p) => p.id === project.publishedReleaseId,
    ),
    open = data.findings.filter(
      (f) => f.projectId === project.id && f.status === "open",
    ),
    supported = data.observations.filter(
      (o) =>
        o.projectId === project.id &&
        o.schemaId === schema?.id &&
        o.status === "supported" &&
        o.mode === "explicit",
    );
  async function publish() {
    if (
      await act(
        `/api/projects/${project.id}/publish`,
        {},
        "A new release is now published. Its evidence and schema are pinned.",
      )
    )
      onClose();
  }
  return (
    <Modal
      title="Publish a new release"
      eyebrow={project.name}
      onClose={onClose}
    >
      <div className="form-body">
        <p className="description">
          Publish the current approved schema and eligible evidence as a new
          immutable release.
        </p>
        <ReadOnlyNote connected={connected} onConnect={onConnect} />
        <div className="publish-review">
          <div>
            <span>Approved schema</span>
            <strong>
              {schema ? `Version ${schema.version}` : "Not available"}
            </strong>
          </div>
          <div>
            <span>Current release</span>
            <strong>
              {previous ? `Version ${previous.version}` : "Not yet published"}
            </strong>
          </div>
          <div>
            <span>Supported observations for this schema</span>
            <strong>{supported.length}</strong>
          </div>
          <div>
            <span>Open findings</span>
            <strong>{open.length}</strong>
          </div>
        </div>
        {open.length > 0 && (
          <div className="notice warning">
            <CircleAlert size={18} />
            <span>
              There are {open.length} unresolved findings. The publication gate
              will withhold unsupported or blocked facts and preserve source
              disagreements.
            </span>
          </div>
        )}
        <p className="field-hint">
          The previous release remains in history. Publication does not trigger
          search or extraction.
        </p>
        <div className="form-actions">
          <button
            className="button primary"
            disabled={!connected || busy || !schema}
            onClick={() => void publish()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Send size={15} />
            )}
            Publish release
          </button>
          <button className="button" onClick={onClose}>
            Keep reviewing
          </button>
        </div>
      </div>
    </Modal>
  );
}
