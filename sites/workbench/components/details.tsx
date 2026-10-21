"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  ExternalLink,
  FileCode2,
  FileText,
  GitBranch,
  ShieldCheck,
} from "lucide-react";
import type {
  DomainSchema,
  Finding,
  Project,
  Proposal,
  Run,
  Source,
  WorkspaceSnapshot,
} from "@deeplake/core/contract";
import {
  currentRecords,
  date,
  displayValue,
  label,
  money,
  projectName,
  schemaDifferences,
  shortId,
} from "../lib/model";
import type { LocationState } from "../lib/model";
import {
  Badge,
  Empty,
  EvidenceCard,
  Modal,
  ReadOnlyNote,
  SourceLink,
  Value,
} from "./primitives";
import type { Act, Navigate } from "./primitives";
interface DetailProps {
  data: WorkspaceSnapshot;
  state: LocationState;
  go: Navigate;
  connected: boolean;
  act: Act;
  onConnect: () => void;
  busy: boolean;
  apiUrl?: string;
  apiToken?: string;
}
export function Detail({ data, state, go, ...rest }: DetailProps) {
  const close = () => go({ detail: "", observation: "" });
  if (!state.detail) return null;
  if (state.view === "sources") {
    const source = data.sources.find((s) => s.id === state.detail);
    if (source)
      return (
        <Modal
          key={state.detail}
          title={source.title}
          eyebrow="Source evidence"
          onClose={close}
          drawer
        >
          <SourceDetail
            source={source}
            data={data}
            state={state}
            go={go}
            {...rest}
          />
        </Modal>
      );
  }
  if (state.view === "audit") {
    const finding = data.findings.find((f) => f.id === state.detail);
    if (finding)
      return (
        <Modal
          key={state.detail}
          title={finding.title}
          eyebrow="Audit finding"
          onClose={close}
          drawer
        >
          <FindingDetail
            finding={finding}
            data={data}
            state={state}
            go={go}
            {...rest}
          />
        </Modal>
      );
  }
  if (state.view === "schemas") {
    const proposal = data.proposals.find((p) => p.id === state.detail);
    if (proposal)
      return (
        <Modal
          key={state.detail}
          title={`Review schema v${proposal.candidate.version}`}
          eyebrow={projectName(data, proposal.projectId)}
          onClose={close}
          drawer
        >
          <ProposalDetail
            proposal={proposal}
            data={data}
            state={state}
            go={go}
            {...rest}
          />
        </Modal>
      );
    const schema = data.schemas.find((s) => s.id === state.detail);
    if (schema)
      return (
        <Modal
          key={state.detail}
          title={`${schema.name} · v${schema.version}`}
          eyebrow="Schema registry"
          onClose={close}
          drawer
        >
          <SchemaDetail schema={schema} data={data} />
        </Modal>
      );
  }
  if (state.view === "runs") {
    const run = data.runs.find((r) => r.id === state.detail);
    if (run)
      return (
        <Modal
          key={state.detail}
          title={`${label(run.kind)} run`}
          eyebrow={projectName(data, run.projectId)}
          onClose={close}
          drawer
        >
          <RunDetail run={run} data={data} />
        </Modal>
      );
  }
  if (state.view === "explore") {
    const item = currentRecords(data, state.project, state.version).find(
      (p) => p.record.id === state.detail,
    );
    if (item)
      return (
        <Modal
          key={state.detail}
          title={item.record.label}
          eyebrow="Published record"
          onClose={close}
          drawer
        >
          <RecordDetail item={item} data={data} go={go} />
        </Modal>
      );
  }
  return (
    <Modal key={state.detail} title="Record unavailable" onClose={close} drawer>
      <Empty title="This record is not in the current snapshot">
        It may belong to a different connection or release. Close this panel to
        inspect the available records.
      </Empty>
    </Modal>
  );
}
function SourceDetail({
  source,
  data,
  state,
  go,
  connected,
  act,
  onConnect,
  busy,
  apiUrl,
  apiToken,
}: DetailProps & { source: Source }) {
  const versions = data.sourceVersions
      .filter((v) => v.sourceId === source.id)
      .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt)),
    version =
      versions.find((v) => v.id === state.version) ??
      versions.find((v) => v.id === source.latestVersionId) ??
      versions[0],
    segments = data.segments
      .filter((s) => s.sourceVersionId === version?.id)
      .sort((a, b) => a.index - b.index),
    observations = data.observations.filter(
      (o) => o.evidence.sourceVersionId === version?.id,
    ),
    selected = data.observations.find(
      (o) =>
        o.id === state.observation &&
        o.evidence.sourceVersionId === version?.id,
    );
  const [downloadError, setDownloadError] = useState("");
  const selectedRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected?.id]);
  async function download() {
    if (!apiUrl || !apiToken || !version) return;
    try {
      const response = await fetch(
        `${apiUrl}/api/sources/${version.id}/original`,
        {
          headers: { Authorization: `Bearer ${apiToken}` },
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!response.ok)
        throw new Error(`Download failed (${response.status}).`);
      const url = URL.createObjectURL(await response.blob()),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `source-${version.contentHash.slice(0, 16)}.bin`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "Download failed.",
      );
    }
  }
  return (
    <div className="detail-body">
      <div className="detail-status-row">
        <Badge value={source.status} />
        <SourceLink
          url={source.url}
          synthetic={
            version?.acquisition === "fixture" ||
            data.projects.find((p) => p.id === source.projectId)?.mode ===
              "demo"
          }
        />
      </div>
      <p className="description">{source.relevance}</p>
      {source.error && (
        <div className="notice warning">
          <strong>Acquisition needs attention</strong>
          <p>{source.error}</p>
        </div>
      )}
      <div className="detail-meta">
        <div>
          <span>Project</span>
          <strong>{projectName(data, source.projectId)}</strong>
        </div>
        <div>
          <span>Family</span>
          <strong>{label(source.family)}</strong>
        </div>
        <div>
          <span>Last checked</span>
          <strong>{date(source.lastCheckedAt, true)}</strong>
        </div>
        <div>
          <span>Stored versions</span>
          <strong>{versions.length}</strong>
        </div>
      </div>
      {version && (
        <>
          <div className="detail-section-heading">
            <h3>Source version</h3>
            <label className="sr-only" htmlFor="source-version">
              Source version
            </label>
            <select
              id="source-version"
              value={version.id}
              onChange={(event) =>
                go({ version: event.target.value, observation: "" }, true)
              }
            >
              {versions.map((v, index) => (
                <option key={v.id} value={v.id}>
                  {index === 0 ? "Latest · " : ""}
                  {date(v.fetchedAt, true)}
                </option>
              ))}
            </select>
          </div>
          <div className="version-card">
            <div>
              <FileCode2 size={18} />
              <strong>{version.mediaType}</strong>
              <span>{(version.byteLength / 1024).toFixed(1)} KB</span>
            </div>
            <dl>
              <dt>Acquisition</dt>
              <dd>{label(version.acquisition)}</dd>
              <dt>Parser</dt>
              <dd>{version.parserVersion}</dd>
              <dt>Content hash</dt>
              <dd className="hash">{version.contentHash}</dd>
            </dl>
            {connected && (
              <button className="text-button" onClick={() => void download()}>
                <ArrowDownToLine size={14} />
                Download original bytes
              </button>
            )}
            <button
              className="text-button reparse-action"
              disabled={busy}
              onClick={() =>
                connected
                  ? void act(
                      `/api/projects/${source.projectId}/run`,
                      { kind: "reparse", sourceVersionIds: [version.id] },
                      "Stored original queued for parsing. Existing source evidence remains preserved.",
                    )
                  : onConnect()
              }
            >
              Reparse stored original <ArrowRight size={14} />
            </button>
            {downloadError && (
              <p className="warning-text" role="alert">
                {downloadError}
              </p>
            )}
          </div>
          {version.warnings.map((warning) => (
            <div className="notice warning" key={warning}>
              {warning}
            </div>
          ))}
        </>
      )}
      {selected && (
        <section
          className="detail-section selected-observation"
          ref={selectedRef}
          tabIndex={-1}
          aria-label="Selected observation evidence"
        >
          <div className="detail-section-heading">
            <h3>{label(selected.field)}</h3>
            <Badge value={selected.status} />
          </div>
          <div className="record-field-value">
            <Value value={selected.value} />
          </div>
          <EvidenceCard
            evidence={selected.evidence}
            data={data}
            go={go}
            observationIds={[selected.id]}
          />
          <div className="detail-meta">
            <div>
              <span>Extraction</span>
              <strong>{label(selected.mode)}</strong>
            </div>
            <div>
              <span>Confidence</span>
              <strong>
                {selected.confidence === null
                  ? "Not supplied"
                  : `${Math.round(selected.confidence * 100)}%`}
              </strong>
            </div>
            <div>
              <span>Model</span>
              <strong>{selected.model}</strong>
            </div>
            <div>
              <span>Observed</span>
              <strong>{date(selected.observedAt, true)}</strong>
            </div>
          </div>
          {Object.keys(selected.scope).length > 0 && (
            <div className="scope-definition">
              {Object.entries(selected.scope).map(([key, value]) => (
                <span key={key}>
                  <strong>{label(key)}:</strong> {value}
                </span>
              ))}
            </div>
          )}
          <details className="full-schema">
            <summary>Observation provenance</summary>
            <pre>
              {JSON.stringify(
                {
                  id: selected.id,
                  schemaId: selected.schemaId,
                  runId: selected.runId,
                  extractionSpecHash: selected.extractionSpecHash,
                  validFrom: selected.validFrom,
                  validTo: selected.validTo,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </section>
      )}
      <section className="detail-section">
        <div className="detail-section-heading">
          <h3>Observations</h3>
          <span className="quiet-tag">{observations.length}</span>
        </div>
        <p className="muted">
          Select a field to highlight its exact evidence in the stored passage.
        </p>
        <div className="observation-list">
          {observations.map((observation) => {
            const entity = data.entities.find(
                (e) => e.id === observation.entityId,
              ),
              schema = data.schemas.find((s) => s.id === observation.schemaId);
            return (
              <button
                key={observation.id}
                className={`observation-row ${selected?.id === observation.id ? "selected" : ""}`}
                onClick={() => go({ observation: observation.id }, true)}
              >
                <span>
                  <strong>{observation.field}</strong>
                  <small>
                    {entity?.label ?? observation.entityType} · schema v
                    {schema?.version ?? "?"}
                  </small>
                </span>
                <span className="observation-value">
                  {displayValue(observation.value)}
                </span>
                <Badge value={observation.status} />
              </button>
            );
          })}
          {!observations.length && (
            <p className="panel-empty">
              No observations are attached to this version.
            </p>
          )}
        </div>
      </section>
      <section className="detail-section">
        <div className="detail-section-heading">
          <h3>Stored passages</h3>
          <span>{segments.length} segments</span>
        </div>
        {selected && (
          <div className="notice success">
            <ShieldCheck size={16} />
            <span>
              Highlighted evidence for <strong>{selected.field}</strong>.
              Characters {selected.evidence.start}–{selected.evidence.end}{" "}
              within the segment.
            </span>
          </div>
        )}
        {segments.map((segment) => {
          const evidence =
              selected?.evidence.segmentId === segment.id
                ? selected.evidence
                : null,
            exact =
              evidence &&
              segment.text.slice(evidence.start, evidence.end) ===
                evidence.quote;
          return (
            <article
              className={`segment-card ${evidence ? "selected" : ""}`}
              key={segment.id}
            >
              <header>
                <span>
                  <FileText size={14} />
                  {segment.heading || `Segment ${segment.index + 1}`}
                </span>
                <Badge value={segment.quality} />
              </header>
              {segment.page && (
                <p className="small-mono">Page {segment.page}</p>
              )}
              <pre className="source-passage">
                {evidence && exact ? (
                  <>
                    {segment.text.slice(0, evidence.start)}
                    <mark>{evidence.quote}</mark>
                    {segment.text.slice(evidence.end)}
                  </>
                ) : (
                  segment.text
                )}
              </pre>
              {segment.context && (
                <details>
                  <summary>Document context</summary>
                  <pre className="source-passage">{segment.context}</pre>
                </details>
              )}
              {segment.warnings.map((warning) => (
                <p className="warning-text" key={warning}>
                  {warning}
                </p>
              ))}
            </article>
          );
        })}
        {!segments.length && (
          <Empty title="No usable text segments">
            Inspect the original source or parsing diagnostics. An empty parse
            is not evidence that facts are absent.
          </Empty>
        )}
      </section>
    </div>
  );
}
function FindingDetail({
  finding,
  data,
  go,
  connected,
  act,
  onConnect,
  busy,
}: DetailProps & { finding: Finding }) {
  const [resolution, setResolution] = useState("");
  const proposals = data.proposals.filter((p) =>
    p.findingIds.includes(finding.id),
  );
  async function decide(status: "resolved" | "dismissed") {
    if (
      await act(
        `/api/findings/${finding.id}`,
        { status, resolution },
        status === "resolved"
          ? "Finding marked resolved."
          : "Finding dismissed with a recorded reason.",
        "PATCH",
      )
    )
      setResolution("");
  }
  return (
    <div className="detail-body">
      <div className="detail-status-row">
        <Badge value={finding.severity} />
        <Badge value={finding.status} />
        <span className="quiet-tag">{label(finding.kind)}</span>
      </div>
      <p className="description">{finding.description}</p>
      <div className="notice action-notice">
        <ArrowRight size={18} />
        <div>
          <strong>Recommended action</strong>
          <p>{finding.action}</p>
        </div>
      </div>
      <section className="detail-section">
        <div className="detail-section-heading">
          <h3>Supporting evidence</h3>
          <span>{finding.evidence.length} passages</span>
        </div>
        {finding.evidence.map((evidence, index) => (
          <EvidenceCard
            key={`${evidence.segmentId}-${index}`}
            evidence={evidence}
            data={data}
            go={go}
          />
        ))}
        {!finding.evidence.length && (
          <div className="notice">
            This acquisition finding has no extracted passage. Its description
            records the source or fetch failure.
          </div>
        )}
      </section>
      {proposals.length > 0 && (
        <section className="detail-section">
          <h3>Related schema proposals</h3>
          {proposals.map((proposal) => (
            <button
              className="related-card"
              key={proposal.id}
              onClick={() => go({ view: "schemas", detail: proposal.id })}
            >
              <GitBranch size={19} />
              <span>
                <strong>Schema v{proposal.candidate.version}</strong>
                <small>{proposal.changes.join(" · ")}</small>
              </span>
              <Badge value={proposal.status} />
              <ArrowRight size={16} />
            </button>
          ))}
        </section>
      )}
      <div className="detail-meta">
        <div>
          <span>Project</span>
          <strong>{projectName(data, finding.projectId)}</strong>
        </div>
        <div>
          <span>Created</span>
          <strong>{date(finding.createdAt, true)}</strong>
        </div>
        {finding.field && (
          <div>
            <span>Affected field</span>
            <strong className="mono">{finding.field}</strong>
          </div>
        )}
        <div>
          <span>Finding ID</span>
          <strong className="small-mono">{shortId(finding.id)}</strong>
        </div>
      </div>
      {finding.status === "open" ? (
        <section className="decision-section">
          <h3>Record a decision</h3>
          <ReadOnlyNote connected={connected} onConnect={onConnect} />
          <label className="form-label" htmlFor="finding-resolution">
            Resolution or dismissal reason
            <textarea
              id="finding-resolution"
              placeholder="What was checked, corrected, or ruled out?"
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              minLength={5}
              rows={3}
            />
          </label>
          <div className="form-actions">
            <button
              className="button primary"
              disabled={!connected || busy || resolution.trim().length < 5}
              onClick={() => void decide("resolved")}
            >
              <Check size={15} />
              Mark resolved
            </button>
            <button
              className="button"
              disabled={!connected || busy || resolution.trim().length < 5}
              onClick={() => void decide("dismissed")}
            >
              Dismiss finding
            </button>
          </div>
        </section>
      ) : (
        <div className="notice success">
          <strong>{label(finding.status)}</strong>
          <p>{finding.resolution ?? "Decision recorded."}</p>
        </div>
      )}
    </div>
  );
}
function ProposalDetail({
  proposal,
  data,
  go,
  connected,
  act,
  onConnect,
  busy,
}: DetailProps & { proposal: Proposal }) {
  const base = data.schemas.find((s) => s.id === proposal.baseSchemaId),
    differences = schemaDifferences(base, proposal.candidate).filter(
      (d) => d.change !== "unchanged",
    ),
    findings = data.findings.filter((f) => proposal.findingIds.includes(f.id));
  const [reason, setReason] = useState(""),
    [allowBreaking, setAllowBreaking] = useState(false);
  async function decide(decision: "approve" | "reject") {
    if (
      await act(
        `/api/proposals/${proposal.id}/decision`,
        { decision, reason, allowBreaking },
        decision === "approve"
          ? "Schema approved and replay queued. Publication remains explicit."
          : "Schema proposal rejected.",
      )
    )
      setReason("");
  }
  return (
    <div className="detail-body">
      <div className="detail-status-row">
        <Badge value={proposal.status} />
        <span className="version-transition">
          v{base?.version ?? "?"}
          <ArrowRight size={14} />v{proposal.candidate.version}
        </span>
        <Badge value={proposal.breaking ? "critical" : "info"}>
          {proposal.breaking ? "Breaking change" : "Additive change"}
        </Badge>
      </div>
      <p className="description">{proposal.rationale}</p>
      <div className="notice">
        <GitBranch size={18} />
        <span>
          Approval updates the research schema and queues replay for{" "}
          <strong>
            {proposal.affectedSourceVersionIds.length} source versions
          </strong>
          . A published release stays pinned until you publish again.
        </span>
      </div>
      <section className="detail-section">
        <h3>What changes</h3>
        <ul className="declared-changes">
          {proposal.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
        {differences.map((difference) => (
          <div
            className="field-diff"
            key={`${difference.type}.${difference.field}`}
          >
            <header>
              <span className={`change-tag ${difference.change}`}>
                {label(difference.change)}
              </span>
              <strong>
                {difference.type}.{difference.field}
              </strong>
            </header>
            <div className="diff-columns">
              <div className="diff-before">
                <span>Current</span>
                <pre>{difference.before || "Field does not exist"}</pre>
              </div>
              <div className="diff-after">
                <span>Proposed</span>
                <pre>{difference.after || "Field removed"}</pre>
              </div>
            </div>
          </div>
        ))}
        <details className="full-schema">
          <summary>Compare complete schema definitions</summary>
          <div className="diff-columns">
            <pre>
              {base ? JSON.stringify(base, null, 2) : "Base schema unavailable"}
            </pre>
            <pre>{JSON.stringify(proposal.candidate, null, 2)}</pre>
          </div>
        </details>
      </section>
      <section className="detail-section">
        <h3>Why this structure is needed</h3>
        {findings.map((finding) => (
          <div key={finding.id}>
            <button
              className="text-button"
              onClick={() => go({ view: "audit", detail: finding.id })}
            >
              {finding.title}
              <ArrowUpRight size={13} />
            </button>
            {finding.evidence.map((evidence, index) => (
              <EvidenceCard
                key={`${evidence.segmentId}-${index}`}
                evidence={evidence}
                data={data}
                go={go}
              />
            ))}
          </div>
        ))}
        {!findings.length && (
          <p className="muted">
            No linked findings are included in this snapshot.
          </p>
        )}
      </section>
      <details className="full-schema">
        <summary>
          Affected source versions ({proposal.affectedSourceVersionIds.length})
        </summary>
        <ul className="source-link-list">
          {proposal.affectedSourceVersionIds.map((id) => {
            const version = data.sourceVersions.find((v) => v.id === id);
            return (
              <li key={id}>
                {version ? (
                  <button
                    className="text-button"
                    onClick={() =>
                      go({
                        view: "sources",
                        detail: version.sourceId,
                        version: version.id,
                      })
                    }
                  >
                    {version.title}
                    <ArrowUpRight size={13} />
                  </button>
                ) : (
                  shortId(id)
                )}
              </li>
            );
          })}
        </ul>
      </details>
      {proposal.status === "pending" ? (
        <section className="decision-section">
          <h3>Review decision</h3>
          <ReadOnlyNote connected={connected} onConnect={onConnect} />
          <label className="form-label" htmlFor="proposal-reason">
            Decision reason
            <textarea
              id="proposal-reason"
              placeholder="Explain why this change should be accepted or rejected."
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              minLength={5}
            />
          </label>
          {proposal.breaking && (
            <label className="checkbox-label breaking-confirm">
              <input
                type="checkbox"
                checked={allowBreaking}
                onChange={(event) => setAllowBreaking(event.target.checked)}
              />
              I approve the breaking schema change and its replay plan.
            </label>
          )}
          <div className="form-actions">
            <button
              className="button primary"
              disabled={
                !connected ||
                busy ||
                reason.trim().length < 5 ||
                (proposal.breaking && !allowBreaking)
              }
              onClick={() => void decide("approve")}
            >
              <Check size={15} />
              Approve & replay
            </button>
            <button
              className="button"
              disabled={!connected || busy || reason.trim().length < 5}
              onClick={() => void decide("reject")}
            >
              Reject proposal
            </button>
          </div>
        </section>
      ) : (
        <div className="notice success">
          <strong>
            {label(proposal.status)}
            {proposal.decidedAt ? ` · ${date(proposal.decidedAt)}` : ""}
          </strong>
          <p>{proposal.decision ?? "Decision recorded."}</p>
        </div>
      )}
    </div>
  );
}
function SchemaDetail({
  schema,
  data,
}: {
  schema: DomainSchema;
  data: WorkspaceSnapshot;
}) {
  return (
    <div className="detail-body">
      <div className="detail-status-row">
        <Badge
          value={
            data.projects.some((p) => p.currentSchemaId === schema.id)
              ? "ready"
              : "archived"
          }
        >
          {data.projects.some((p) => p.currentSchemaId === schema.id)
            ? "Current research schema"
            : "Historical schema"}
        </Badge>
        <span>{date(schema.createdAt)}</span>
      </div>
      <p className="description">{schema.description}</p>
      <div className="notice">
        <strong>Rationale</strong>
        <p>{schema.rationale}</p>
      </div>
      {schema.entityTypes.map((type) => (
        <section className="detail-section" key={type.id}>
          <h3>
            {type.label}
            <span className="quiet-tag">{type.id}</span>
          </h3>
          <p className="muted">{type.description}</p>
          <div className="scope-definition">
            <span>
              <strong>Identity:</strong> {type.identityFields.join(" + ")}
            </span>
            <span>
              <strong>Scope:</strong>{" "}
              {type.scopeFields.length
                ? type.scopeFields.join(" + ")
                : "Project scope"}
            </span>
          </div>
          <div className="schema-fields">
            {type.fields.map((field) => (
              <article key={field.id}>
                <div>
                  <strong>{field.label}</strong>
                  <span className="small-mono">{field.id}</span>
                </div>
                <div>
                  <span className="quiet-tag">{field.type}</span>
                  {field.required && (
                    <span className="mini-label">Required</span>
                  )}
                  {field.unit && (
                    <span className="mini-label">{field.unit}</span>
                  )}
                </div>
                <p>{field.description}</p>
                {field.jsonSchema && (
                  <details>
                    <summary>JSON structure</summary>
                    <pre>{JSON.stringify(field.jsonSchema, null, 2)}</pre>
                  </details>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
function RunDetail({ run, data }: { run: Run; data: WorkspaceSnapshot }) {
  const events = data.events
      .filter((event) => event.runId === run.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    usage = data.usage.filter((u) => u.runId === run.id);
  return (
    <div className="detail-body">
      <div className="detail-status-row">
        <Badge value={run.status} />
        <span className="quiet-tag">{label(run.phase)}</span>
      </div>
      {run.error && (
        <div className="notice warning">
          <strong>Run stopped</strong>
          <p>{run.error}</p>
        </div>
      )}
      <div className="detail-meta">
        <div>
          <span>Started</span>
          <strong>{date(run.startedAt, true)}</strong>
        </div>
        <div>
          <span>Finished</span>
          <strong>{date(run.completedAt, true)}</strong>
        </div>
        <div>
          <span>Search queries</span>
          <strong>{run.stats.queries}</strong>
        </div>
        <div>
          <span>Sources processed</span>
          <strong>{run.stats.sources}</strong>
        </div>
        <div>
          <span>Observations / findings</span>
          <strong>
            {run.stats.observations} / {run.stats.findings}
          </strong>
        </div>
        <div>
          <span>Estimated cost</span>
          <strong>{money(run.stats.estimatedCostUsd)}</strong>
        </div>
      </div>
      <section className="detail-section">
        <h3>Execution timeline</h3>
        <ol className="timeline">
          {events.map((event) => (
            <li key={event.id}>
              <span className={`event-dot ${event.level}`} />
              <div>
                <span className="timeline-label">
                  {label(event.phase)} ·{" "}
                  {new Intl.DateTimeFormat("en-GB", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    timeZone: "UTC",
                  }).format(new Date(event.createdAt))}{" "}
                  UTC
                </span>
                <strong>{event.message}</strong>
                {Object.keys(event.data).length > 0 && (
                  <details>
                    <summary>Event data</summary>
                    <pre>{JSON.stringify(event.data, null, 2)}</pre>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
        {!events.length && (
          <p className="muted">
            No detailed events were recorded for this run.
          </p>
        )}
      </section>
      <section className="detail-section">
        <h3>Provider operations</h3>
        <div className="usage-detail-list">
          {usage.map((item) => (
            <div key={item.id}>
              <span>
                <strong>{label(item.operation)}</strong>
                <small>
                  {item.provider} · {item.model}
                </small>
              </span>
              <span>
                {money(item.reportedCostUsd ?? item.estimatedCostUsd)}
                <small>
                  {item.reportedCostUsd === null ? "Estimated" : "Reported"}
                </small>
              </span>
            </div>
          ))}
          {!usage.length && (
            <p className="muted">No provider calls were recorded.</p>
          )}
        </div>
      </section>
    </div>
  );
}
function RecordDetail({
  item,
  data,
  go,
}: {
  item: ReturnType<typeof currentRecords>[number];
  data: WorkspaceSnapshot;
  go: Navigate;
}) {
  const schema = data.schemas.find((s) => s.id === item.schemaId),
    type = schema?.entityTypes.find((t) => t.id === item.record.entityType),
    release = data.publications.find((r) => r.id === item.releaseId);
  return (
    <div className="detail-body">
      <div className="detail-status-row">
        <Badge value="ready">Release {item.version}</Badge>
        <span className="quiet-tag">{label(item.record.entityType)}</span>
        {item.project.mode === "demo" && (
          <span className="mini-label">Synthetic data</span>
        )}
      </div>
      <div className="scope-definition">
        <strong>Applies to</strong>
        {Object.entries(item.record.scope).map(([key, value]) => (
          <span key={key}>
            <span className="muted">{label(key)}:</span> {value}
          </span>
        ))}
      </div>
      <p className="muted">
        {item.record.sourceCount} contributing sources · schema v
        {schema?.version ?? "?"} · published {date(release?.createdAt)}
      </p>
      {item.record.warnings.map((warning) => (
        <div className="notice warning" key={warning}>
          {warning}
        </div>
      ))}
      <div className="record-fields">
        {Object.entries(item.record.fields).map(([key, field]) => {
          const definition = type?.fields.find((f) => f.id === key);
          return (
            <section
              className={`record-field ${field.conflict ? "conflicted" : ""}`}
              key={key}
            >
              <header>
                <h3>{definition?.label ?? label(key)}</h3>
                {field.conflict ? (
                  <Badge value="warning">Value withheld</Badge>
                ) : (
                  <Badge value="supported">Source-backed</Badge>
                )}
              </header>
              {field.conflict ? (
                <div>
                  <p>Sources disagree. No single value was selected.</p>
                  <div className="alternatives">
                    {field.alternatives.map((value, index) => (
                      <span key={index}>
                        <Value value={value} unit={field.unit} />
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="record-field-value">
                  <Value value={field.value} unit={field.unit} />
                </div>
              )}
              <details>
                <summary>Inspect evidence ({field.evidence.length})</summary>
                {field.evidence.map((evidence, index) => (
                  <EvidenceCard
                    key={`${evidence.segmentId}-${index}`}
                    evidence={evidence}
                    data={data}
                    go={go}
                    observationIds={field.observationIds}
                  />
                ))}
                <div className="observation-provenance">
                  {field.observationIds.map((id) => {
                    const observation = data.observations.find(
                      (o) => o.id === id,
                    );
                    return observation ? (
                      <p key={id}>
                        <span className="small-mono">
                          {shortId(observation.id)}
                        </span>{" "}
                        · {observation.model} · {observation.mode}
                      </p>
                    ) : null;
                  })}
                </div>
              </details>
            </section>
          );
        })}
      </div>
    </div>
  );
}
