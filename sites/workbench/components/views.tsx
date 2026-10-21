"use client";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Braces,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  FileCheck2,
  FileText,
  GitBranch,
  Layers,
  Play,
  Plus,
  Radar,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { Project, WorkspaceSnapshot } from "@deeplake/core/contract";
import {
  currentRecords,
  date,
  displayValue,
  host,
  inProject,
  label,
  matches,
  money,
  projectName,
  schemaDifferences,
  shownProjects,
  sortFindings,
} from "../lib/model";
import type { LocationState } from "../lib/model";
import {
  Badge,
  Empty,
  PanelHeading,
  ReadOnlyNote,
  Timestamp,
} from "./primitives";
import type { Act, Navigate } from "./primitives";
export interface ViewProps {
  data: WorkspaceSnapshot;
  state: LocationState;
  go: Navigate;
  connected: boolean;
  act: Act;
  onConnect: () => void;
  onNew: () => void;
  onPublish: (project: Project) => void;
  busy: boolean;
}
export function Overview({
  data,
  state,
  go,
  onNew,
  onPublish,
  connected,
  act,
  busy,
  onConnect,
}: ViewProps) {
  const projects = shownProjects(data, state.project),
    sources = inProject(data.sources, state.project),
    observations = inProject(data.observations, state.project),
    findings = sortFindings(
      inProject(data.findings, state.project).filter(
        (f) => f.status === "open",
      ),
    ),
    records = currentRecords(data, state.project),
    runs = inProject(data.runs, state.project),
    events = inProject(data.events, state.project)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5);
  const familyCounts = sources.reduce<Record<string, number>>(
    (map, s) => ({ ...map, [s.family]: (map[s.family] ?? 0) + 1 }),
    {},
  );
  const metrics = [
    {
      label: "Sources collected",
      value: sources.filter((s) => s.latestVersionId).length,
      sub: `${Object.keys(familyCounts).length} source families`,
      icon: FileText,
      view: "sources" as const,
    },
    {
      label: "Supported observations",
      value: observations.filter((o) => o.status === "supported").length,
      sub: "Across all evidence versions",
      icon: ShieldCheck,
      view: "explore" as const,
    },
    {
      label: "Open findings",
      value: findings.length,
      sub: `${findings.filter((f) => f.severity === "critical").length} require critical review`,
      icon: CircleAlert,
      view: "audit" as const,
    },
    {
      label: "Published records",
      value: records.length,
      sub: `${projects.filter((p) => p.publishedReleaseId).length} published collections`,
      icon: Layers,
      view: "explore" as const,
    },
  ];
  return (
    <div className="view-content">
      <div className="metrics">
        {metrics.map((item) => (
          <button
            key={item.label}
            className="metric"
            onClick={() => go({ view: item.view })}
          >
            <div className="metric-label">
              <span>{item.label}</span>
              <item.icon size={17} />
            </div>
            <strong>{item.value.toLocaleString()}</strong>
            <span className="metric-caption">{item.sub}</span>
          </button>
        ))}
      </div>
      {state.project !== "all" && projects[0] && (
        <section className="panel project-contract">
          <div>
            <p className="eyebrow">Answerability contract</p>
            <h2>{projects[0].contract.topic}</h2>
            <ul>
              {projects[0].contract.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </div>
          <div className="project-controls">
            <div className="budget-summary">
              <span>Per-run ceiling</span>
              <strong>{money(projects[0].budget.maxUsd)}</strong>
              <span>
                {projects[0].budget.maxSources} sources ·{" "}
                {projects[0].budget.maxSearchQueries} searches
              </span>
            </div>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                connected
                  ? void act(
                      `/api/projects/${projects[0]?.id}/run`,
                      { kind: "cycle" },
                      "Discovery run queued.",
                    )
                  : onConnect()
              }
            >
              <Play size={14} />
              Run discovery
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                connected
                  ? void act(
                      `/api/projects/${projects[0]?.id}/run`,
                      { kind: "maintenance" },
                      "Source refresh queued.",
                    )
                  : onConnect()
              }
            >
              <Radar size={15} />
              Check for changes
            </button>
          </div>
        </section>
      )}
      <div className="overview-grid">
        <section className="panel attention-panel">
          <PanelHeading
            title="Next to review"
            caption="Evidence that needs a decision."
            aside={
              <button
                className="text-button"
                onClick={() => go({ view: "audit" })}
              >
                All findings <ArrowRight size={14} />
              </button>
            }
          />
          {findings.length ? (
            <div className="attention-list">
              {findings.slice(0, 3).map((finding, index) => (
                <button
                  className={`attention-item ${index === 0 ? "attention-first" : ""}`}
                  key={finding.id}
                  onClick={() => go({ view: "audit", detail: finding.id })}
                >
                  <span className={`severity-marker ${finding.severity}`}>
                    <CircleAlert size={17} />
                  </span>
                  <span className="attention-copy">
                    <span className="attention-label">
                      {label(finding.kind)}
                      <span>·</span>
                      {projectName(data, finding.projectId)}
                    </span>
                    <strong>{finding.title}</strong>
                    <span className="attention-excerpt">
                      {finding.evidence[0]?.quote ?? finding.description}
                    </span>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))}
            </div>
          ) : (
            <Empty title="No open findings">
              Every recorded finding in this view has a decision. New sources
              and audits may introduce more.
            </Empty>
          )}
        </section>
        <section className="panel families-panel">
          <PanelHeading
            title="Source coverage"
            caption="Discovered documents by family."
          />
          <div className="family-bars">
            {Object.entries(familyCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([family, count]) => (
                <div className="family-row" key={family}>
                  <div>
                    <span>{label(family)}</span>
                    <strong>{count}</strong>
                  </div>
                  <span className="bar-track">
                    <span
                      style={{
                        width: `${sources.length ? (count / sources.length) * 100 : 0}%`,
                      }}
                    />
                  </span>
                </div>
              ))}
            {sources.length === 0 && (
              <p className="muted">
                Source families will appear after discovery.
              </p>
            )}
          </div>
          <div className="coverage-note">
            <Radar size={17} />
            <span>
              Coverage describes collected evidence, not everything that exists.
            </span>
          </div>
        </section>
      </div>
      <section className="section">
        <PanelHeading
          title={state.project === "all" ? "Your projects" : "Project"}
          caption="Each topic keeps its own questions, schema and published release."
          aside={
            <button className="text-button" onClick={onNew}>
              <Plus size={15} />
              New project
            </button>
          }
        />
        <div className="project-grid">
          {projects.map((project) => {
            const schema = data.schemas.find(
                (s) => s.id === project.currentSchemaId,
              ),
              release = data.publications.find(
                (p) => p.id === project.publishedReleaseId,
              ),
              open = data.findings.filter(
                (f) => f.projectId === project.id && f.status === "open",
              ).length;
            return (
              <article className="project-card" key={project.id}>
                <div className="project-card-top">
                  <span className="project-symbol">
                    <BookOpen size={20} />
                  </span>
                  <Badge value={project.status} />
                </div>
                <button
                  className="project-title"
                  onClick={() => go({ view: "overview", project: project.id })}
                >
                  {project.name}
                  <ArrowUpRight size={17} />
                </button>
                <p>{project.description}</p>
                <div className="project-facts">
                  <span>
                    <FileText size={13} />
                    {
                      data.sources.filter((s) => s.projectId === project.id)
                        .length
                    }{" "}
                    sources
                  </span>
                  <span>
                    <GitBranch size={13} />
                    {schema ? `Schema v${schema.version}` : "No schema yet"}
                  </span>
                  <span>
                    <CircleAlert size={13} />
                    {open} open
                  </span>
                </div>
                <div className="project-card-bottom">
                  <span>
                    {release
                      ? `Release ${release.version} · ${release.records.length} records`
                      : "No release published"}
                  </span>
                  <button
                    className="text-button"
                    onClick={() =>
                      release
                        ? go({ view: "explore", project: project.id })
                        : onPublish(project)
                    }
                  >
                    {release ? "Explore" : "Publish"}
                    <ArrowRight size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {!projects.length && (
          <Empty
            title="Start with a question"
            action={
              <button className="button primary" onClick={onNew}>
                <Plus size={16} />
                Create project
              </button>
            }
          >
            Define a topic and what you want to answer. Deeplake will keep its
            sources, observations and schema changes together.
          </Empty>
        )}
      </section>
      <div className="overview-grid">
        <section className="panel">
          <PanelHeading
            title="Recent activity"
            caption="Events recorded by the engine."
            aside={
              <button
                className="text-button"
                onClick={() => go({ view: "runs" })}
              >
                Run history <ArrowRight size={14} />
              </button>
            }
          />
          <div className="activity-list">
            {events.map((event) => (
              <button
                key={event.id}
                onClick={() => go({ view: "runs", detail: event.runId })}
                className="activity-item"
              >
                <span className={`event-dot ${event.level}`} />
                <span>
                  <strong>{event.message}</strong>
                  <small>
                    {projectName(data, event.projectId)} · {label(event.phase)}
                  </small>
                </span>
                <time>
                  {new Intl.DateTimeFormat("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "UTC",
                  }).format(new Date(event.createdAt))}
                </time>
              </button>
            ))}
            {!events.length && (
              <Empty title="No activity yet">
                Engine events will appear when the first run starts.
              </Empty>
            )}
          </div>
        </section>
        <section className="panel release-panel">
          <div className="release-icon">
            <FileCheck2 size={23} />
          </div>
          <h2>
            Research can keep moving.
            <br />
            Published data stays pinned.
          </h2>
          <p>
            Review schema changes, replay the evidence, then choose when a new
            release becomes public.
          </p>
          <div className="release-summary">
            <span>
              <strong>
                {runs.filter((r) => r.status === "completed").length}
              </strong>{" "}
              completed runs
            </span>
            <span>
              <strong>
                {inProject(data.publications, state.project).length}
              </strong>{" "}
              saved releases
            </span>
          </div>
          <button
            className="text-button"
            onClick={() => go({ view: "schemas" })}
          >
            Review schema history <ArrowRight size={14} />
          </button>
        </section>
      </div>
    </div>
  );
}
export function Sources({ data, state, go }: ViewProps) {
  const sources = inProject(data.sources, state.project),
    families = [...new Set(sources.map((s) => s.family))].sort(),
    filtered = sources.filter(
      (s) =>
        matches(state.q, s.title, s.url, s.family) &&
        (!state.status ||
          state.status === "all" ||
          s.status === state.status) &&
        (!state.kind || s.family === state.kind),
    );
  return (
    <div className="view-content">
      <div className="filter-row">
        <label>
          Source status
          <select
            aria-label="Source status"
            value={state.status}
            onChange={(e) => go({ status: e.target.value }, true)}
          >
            <option value="">All statuses</option>
            {["pending", "fetched", "unchanged", "failed", "blocked"].map(
              (status) => (
                <option key={status} value={status}>
                  {label(status)}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Source family
          <select
            aria-label="Source family"
            value={state.kind}
            onChange={(e) => go({ kind: e.target.value }, true)}
          >
            <option value="">All families</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {label(f)}
              </option>
            ))}
          </select>
        </label>
        <span className="result-count" aria-live="polite">
          {filtered.length} of {sources.length} sources
        </span>
      </div>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Family</th>
                <th>Status</th>
                <th>Versions</th>
                <th>Last checked</th>
                <th>
                  <span className="sr-only">Inspect</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((source) => (
                <tr key={source.id}>
                  <td>
                    <button
                      className="row-title"
                      onClick={() => go({ detail: source.id })}
                    >
                      {source.title}
                      <span>
                        {host(source.url)}
                        {state.project === "all"
                          ? ` · ${projectName(data, source.projectId)}`
                          : ""}
                      </span>
                    </button>
                  </td>
                  <td>
                    <span className="quiet-tag">{label(source.family)}</span>
                  </td>
                  <td>
                    <Badge value={source.status} />
                  </td>
                  <td className="mono">
                    {
                      data.sourceVersions.filter(
                        (v) => v.sourceId === source.id,
                      ).length
                    }
                  </td>
                  <td className="table-time">{date(source.lastCheckedAt)}</td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Inspect ${source.title}`}
                      onClick={() => go({ detail: source.id })}
                    >
                      <ArrowUpRight size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <Empty
            title="No matching sources"
            action={
              <button
                className="text-button"
                onClick={() => go({ q: "", status: "", kind: "" }, true)}
              >
                Clear filters
              </button>
            }
          >
            Try a different query or collect sources for this project.
          </Empty>
        )}
      </section>
      <p className="footnote">
        <ShieldCheck size={14} />
        Source versions are immutable. A failed refresh does not erase earlier
        evidence.
      </p>
    </div>
  );
}
export function Audits({ data, state, go }: ViewProps) {
  const all = inProject(data.findings, state.project),
    status = state.status || "open",
    filtered = sortFindings(
      all.filter(
        (f) =>
          matches(state.q, f.title, f.description, f.field) &&
          (status === "all" || f.status === status) &&
          (!state.kind || f.kind === state.kind),
      ),
    );
  return (
    <div className="view-content">
      <div className="filter-row">
        <div className="segmented" aria-label="Finding status">
          {["open", "resolved", "dismissed", "all"].map((value) => (
            <button
              className={status === value ? "selected" : ""}
              aria-pressed={status === value}
              key={value}
              onClick={() => go({ status: value }, true)}
            >
              {label(value)}
              {value === "open" && (
                <span>{all.filter((f) => f.status === "open").length}</span>
              )}
            </button>
          ))}
        </div>
        <label>
          Finding type
          <select
            aria-label="Finding type"
            value={state.kind}
            onChange={(e) => go({ kind: e.target.value }, true)}
          >
            <option value="">All types</option>
            {[
              "schema_gap",
              "extraction",
              "acquisition",
              "identity_scope",
              "disagreement",
            ].map((kind) => (
              <option key={kind} value={kind}>
                {label(kind)}
              </option>
            ))}
          </select>
        </label>
        <span className="result-count" aria-live="polite">
          {filtered.length} findings
        </span>
      </div>
      <section className="panel audit-list">
        {filtered.map((finding) => (
          <button
            className="audit-row"
            key={finding.id}
            onClick={() => go({ detail: finding.id })}
          >
            <span className={`severity-marker ${finding.severity}`}>
              <CircleAlert size={18} />
            </span>
            <span className="audit-copy">
              <span className="eyebrow">
                {label(finding.kind)} · {projectName(data, finding.projectId)}
              </span>
              <strong>{finding.title}</strong>
              <span>{finding.description}</span>
              <span className="audit-row-meta">
                <span>
                  {finding.evidence.length} evidence{" "}
                  {finding.evidence.length === 1 ? "passage" : "passages"}
                </span>
                <span>{date(finding.createdAt)}</span>
              </span>
            </span>
            <span className="audit-row-end">
              <Badge value={finding.severity} />
              <ChevronRight size={18} />
            </span>
          </button>
        ))}
        {!filtered.length && (
          <Empty
            title={
              status === "open"
                ? "No open findings match this view"
                : "No matching findings"
            }
            action={
              <button
                className="text-button"
                onClick={() => go({ q: "", status: "all", kind: "" }, true)}
              >
                View all findings
              </button>
            }
          >
            Findings keep acquisition problems, extraction mistakes, scope
            errors and schema gaps separate.
          </Empty>
        )}
      </section>
    </div>
  );
}
export function Schemas({ data, state, go }: ViewProps) {
  const proposals = inProject(data.proposals, state.project)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter(
        (p) =>
          matches(
            state.q,
            p.rationale,
            p.changes,
            projectName(data, p.projectId),
          ) &&
          (!state.status ||
            state.status === "all" ||
            p.status === state.status),
      ),
    schemas = inProject(data.schemas, state.project)
      .slice()
      .sort((a, b) => b.version - a.version);
  return (
    <div className="view-content">
      <div className="filter-row">
        <label>
          Proposal status
          <select
            aria-label="Proposal status"
            value={state.status}
            onChange={(e) => go({ status: e.target.value }, true)}
          >
            <option value="">All proposals</option>
            {["pending", "approved", "rejected", "stale"].map((value) => (
              <option value={value} key={value}>
                {label(value)}
              </option>
            ))}
          </select>
        </label>
        <span className="result-count">
          {proposals.filter((p) => p.status === "pending").length} pending
          decisions
        </span>
      </div>
      <section className="section">
        <PanelHeading
          title="Schema proposals"
          caption="A proposal describes a change. It cannot change the live schema by itself."
        />
        <div className="proposal-grid">
          {proposals.map((proposal) => {
            const base = data.schemas.find(
                (s) => s.id === proposal.baseSchemaId,
              ),
              changes = schemaDifferences(base, proposal.candidate).filter(
                (d) => d.change !== "unchanged",
              );
            return (
              <article className="panel proposal-card" key={proposal.id}>
                <div className="proposal-card-top">
                  <span className="eyebrow">
                    {projectName(data, proposal.projectId)}
                  </span>
                  <Badge value={proposal.status} />
                </div>
                <h3>
                  <button onClick={() => go({ detail: proposal.id })}>
                    Schema v{base?.version ?? "?"} <ArrowRight size={17} /> v
                    {proposal.candidate.version}
                  </button>
                </h3>
                <p>{proposal.rationale}</p>
                <div className="change-chips">
                  {changes.slice(0, 4).map((change) => (
                    <span
                      key={`${change.type}.${change.field}`}
                      className={`change-tag ${change.change}`}
                    >
                      {change.change === "added"
                        ? "+"
                        : change.change === "removed"
                          ? "−"
                          : "~"}{" "}
                      {change.field}
                    </span>
                  ))}
                </div>
                <div className="proposal-card-bottom">
                  <span>
                    {proposal.affectedSourceVersionIds.length} source versions
                    to replay{proposal.breaking ? " · Breaking change" : ""}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => go({ detail: proposal.id })}
                  >
                    Review diff <ArrowRight size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {!proposals.length && (
          <Empty title="No schema proposals">
            The representation auditor will raise a proposal when evidence needs
            structure the current schema cannot express.
          </Empty>
        )}
      </section>
      <section className="panel table-panel">
        <PanelHeading
          title="Version registry"
          caption="Approved schemas remain available for historical replay."
        />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Schema</th>
                <th>Version</th>
                <th>Entity types</th>
                <th>Fields</th>
                <th>Created</th>
                <th>Use</th>
              </tr>
            </thead>
            <tbody>
              {schemas
                .filter((s) =>
                  matches(state.q, s.name, s.rationale, s.entityTypes),
                )
                .map((schema) => (
                  <tr key={schema.id}>
                    <td>
                      <button
                        className="row-title"
                        onClick={() => go({ detail: schema.id })}
                      >
                        {schema.name}
                        <span>{projectName(data, schema.projectId)}</span>
                      </button>
                    </td>
                    <td className="mono">v{schema.version}</td>
                    <td>{schema.entityTypes.length}</td>
                    <td>
                      {schema.entityTypes.reduce(
                        (n, t) => n + t.fields.length,
                        0,
                      )}
                    </td>
                    <td className="table-time">{date(schema.createdAt)}</td>
                    <td>
                      {data.projects.some(
                        (p) => p.currentSchemaId === schema.id,
                      ) ? (
                        <Badge value="ready">Current</Badge>
                      ) : (
                        <Badge value="archived">Historical</Badge>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!schemas.length && (
          <Empty title="No schema yet">
            A bootstrap run will propose a representation from a diverse source
            sample.
          </Empty>
        )}
      </section>
    </div>
  );
}
export function Runs({
  data,
  state,
  go,
  connected,
  act,
  onConnect,
  busy,
}: ViewProps) {
  const runs = inProject(data.runs, state.project)
      .slice()
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .filter(
        (r) =>
          matches(
            state.q,
            r.kind,
            r.phase,
            r.error,
            projectName(data, r.projectId),
          ) &&
          (!state.status || r.status === state.status),
      ),
    jobs = inProject(data.jobs, state.project),
    usage = inProject(data.usage, state.project),
    cost = usage.reduce(
      (sum, item) => sum + (item.reportedCostUsd ?? item.estimatedCostUsd),
      0,
    );
  return (
    <div className="view-content">
      <div className="run-summary">
        <div>
          <Activity size={19} />
          <span>
            <strong>{runs.length}</strong> recorded runs
          </span>
        </div>
        <div>
          <Clock3 size={19} />
          <span>
            <strong>
              {
                jobs.filter((j) => ["queued", "running"].includes(j.status))
                  .length
              }
            </strong>{" "}
            active jobs
          </span>
        </div>
        <div>
          <Database size={19} />
          <span>
            <strong>{usage.length}</strong> provider operations
          </span>
        </div>
        <div>
          <span>
            <strong>{money(cost)}</strong> reported or estimated use
          </span>
        </div>
      </div>
      <div className="filter-row">
        <label>
          Run status
          <select
            aria-label="Run status"
            value={state.status}
            onChange={(e) => go({ status: e.target.value }, true)}
          >
            <option value="">All statuses</option>
            {[
              "completed",
              "running",
              "queued",
              "failed",
              "budget_exhausted",
              "cancelled",
            ].map((status) => (
              <option key={status} value={status}>
                {label(status)}
              </option>
            ))}
          </select>
        </label>
        <span className="result-count">{runs.length} runs</span>
      </div>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Run / project</th>
                <th>Status</th>
                <th>Last phase</th>
                <th>Sources</th>
                <th>Observations</th>
                <th>Estimated cost</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <button
                      className="row-title"
                      onClick={() => go({ detail: run.id })}
                    >
                      {label(run.kind)}
                      <span>{projectName(data, run.projectId)}</span>
                    </button>
                  </td>
                  <td>
                    <Badge value={run.status} />
                  </td>
                  <td>{label(run.phase)}</td>
                  <td className="mono">{run.stats.sources}</td>
                  <td className="mono">{run.stats.observations}</td>
                  <td className="mono">{money(run.stats.estimatedCostUsd)}</td>
                  <td className="table-time">{date(run.startedAt, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!runs.length && (
          <Empty title="No matching runs">
            Discovery, maintenance and replay jobs will leave a history here.
          </Empty>
        )}
      </section>
      <section className="panel">
        <PanelHeading
          title="Durable jobs"
          caption="Leased work survives restarts. Cancellation prevents later work from continuing."
        />
        <div className="job-list">
          {jobs
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((job) => (
              <div className="job-row" key={job.id}>
                <div>
                  <strong>{label(job.kind)}</strong>
                  <span>
                    {projectName(data, job.projectId)} · Attempt {job.attempt} /{" "}
                    {job.maxAttempts}
                  </span>
                  {job.lastError && (
                    <p className="warning-text">{job.lastError}</p>
                  )}
                </div>
                <Badge value={job.status} />
                {["queued", "running"].includes(job.status) && (
                  <button
                    className="button small"
                    disabled={busy}
                    onClick={() =>
                      connected
                        ? void act(
                            `/api/jobs/${job.id}/cancel`,
                            {},
                            "Job cancellation recorded.",
                          )
                        : onConnect()
                    }
                  >
                    Cancel job
                  </button>
                )}
              </div>
            ))}
          {!jobs.length && (
            <p className="panel-empty">No queued work has been recorded.</p>
          )}
        </div>
      </section>
      <section className="panel table-panel">
        <PanelHeading
          title="Provider usage"
          caption="Reported costs are retained separately from estimates."
        />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Operation</th>
                <th>Provider / model</th>
                <th>Input tokens</th>
                <th>Output tokens</th>
                <th>Estimated</th>
                <th>Reported</th>
              </tr>
            </thead>
            <tbody>
              {usage
                .slice()
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((item) => (
                  <tr key={item.id}>
                    <td>{label(item.operation)}</td>
                    <td>
                      <span className="provider-name">{item.provider}</span>
                      <span className="small-mono">{item.model}</span>
                    </td>
                    <td className="mono">
                      {item.inputTokens.toLocaleString()}
                    </td>
                    <td className="mono">
                      {item.outputTokens.toLocaleString()}
                    </td>
                    <td className="mono">{money(item.estimatedCostUsd)}</td>
                    <td className="mono">
                      {item.reportedCostUsd === null
                        ? "Not supplied"
                        : money(item.reportedCostUsd)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!usage.length && (
          <p className="panel-empty">No provider usage recorded.</p>
        )}
      </section>
    </div>
  );
}
export function Explorer({ data, state, go, onPublish }: ViewProps) {
  const all = currentRecords(data, state.project, state.version),
    types = [...new Set(all.map((item) => item.record.entityType))],
    filtered = all.filter(
      (item) =>
        matches(
          state.q,
          item.record.label,
          item.record.scope,
          item.record.fields,
        ) &&
        (!state.kind || item.record.entityType === state.kind) &&
        (!state.status ||
          state.status !== "conflicts" ||
          Object.values(item.record.fields).some((f) => f.conflict)),
    ),
    project =
      state.project !== "all"
        ? data.projects.find((p) => p.id === state.project)
        : undefined;
  function download() {
    const releaseIds = new Set(all.map((item) => item.releaseId));
    const releases = data.publications.filter((p) => releaseIds.has(p.id));
    const blob = new Blob(
      [JSON.stringify({ publications: releases }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "deeplake-published-data.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="view-content">
      <div className="published-note">
        <ShieldCheck size={19} />
        <span>
          <strong>Published evidence only.</strong> These records come from
          pinned releases. Experimental schemas and unsupported observations
          stay out.
        </span>
        {project && (
          <button className="button small" onClick={() => onPublish(project)}>
            Publish new release
          </button>
        )}
      </div>
      <div className="filter-row">
        <label>
          Entity type
          <select
            aria-label="Entity type"
            value={state.kind}
            onChange={(e) => go({ kind: e.target.value }, true)}
          >
            <option value="">All types</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {label(type)}
              </option>
            ))}
          </select>
        </label>
        {project && (
          <label>
            Published version
            <select
              aria-label="Published version"
              value={state.version}
              onChange={(e) => go({ version: e.target.value }, true)}
            >
              <option value="">Current release</option>
              {data.publications
                .filter((p) => p.projectId === project.id)
                .sort((a, b) => b.version - a.version)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    Release {p.version} · {date(p.createdAt)}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={state.status === "conflicts"}
            onChange={(e) =>
              go({ status: e.target.checked ? "conflicts" : "" }, true)
            }
          />
          With disagreements
        </label>
        <span className="result-count" aria-live="polite">
          {filtered.length} records
        </span>
        <button
          className="button small export-button"
          onClick={download}
          disabled={!all.length}
        >
          <ArrowDownToLine size={14} />
          Export JSON
        </button>
      </div>
      <section className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Published record</th>
                <th>Type</th>
                <th>Scope</th>
                <th>Sources</th>
                <th>Evidence</th>
                <th>Release</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={`${item.project.id}:${item.record.id}`}>
                  <td>
                    <button
                      className="row-title"
                      onClick={() => go({ detail: item.record.id })}
                    >
                      {item.record.label}
                      <span>{item.project.name}</span>
                    </button>
                  </td>
                  <td>
                    <span className="quiet-tag">
                      {label(item.record.entityType)}
                    </span>
                  </td>
                  <td>
                    <span className="scope-tags">
                      {Object.entries(item.record.scope).map(([key, value]) => (
                        <span key={key} title={key}>
                          {value}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="mono">{item.record.sourceCount}</td>
                  <td>
                    {Object.values(item.record.fields).some(
                      (f) => f.conflict,
                    ) ? (
                      <Badge value="warning">Disagreement</Badge>
                    ) : (
                      <Badge value="supported">Source-backed</Badge>
                    )}
                  </td>
                  <td className="mono">v{item.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <Empty
            title="No published records match"
            action={
              state.q || state.kind || state.status ? (
                <button
                  className="text-button"
                  onClick={() => go({ q: "", kind: "", status: "" }, true)}
                >
                  Clear filters
                </button>
              ) : undefined
            }
          >
            Try a broader query, or explicitly publish a project after reviewing
            its evidence.
          </Empty>
        )}
      </section>
      <p className="footnote">
        <Braces size={14} />
        Open a record to inspect every field, its applicability and the exact
        supporting passage.
      </p>
    </div>
  );
}
