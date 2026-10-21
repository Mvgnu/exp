"use client";
import { useEffect, useRef } from "react";
import { ArrowUpRight, Check, Database, FileText, X } from "lucide-react";
import type {
  Evidence,
  JsonValue,
  WorkspaceSnapshot,
} from "@deeplake/core/contract";
import type { LocationState } from "../lib/model";
import { date, evidenceObservation, host, label } from "../lib/model";
export type Navigate = (
  patch: Partial<LocationState>,
  replace?: boolean,
) => void;
export type Act = (
  path: string,
  body: unknown,
  message: string,
  method?: string,
) => Promise<boolean>;
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-icon">
        <svg
          width="27"
          height="27"
          viewBox="0 0 32 32"
          fill="none"
          aria-hidden="true"
        >
          <ellipse cx="16" cy="10" rx="10" ry="4" />
          <path d="M6 10v6c0 2.2 4.5 4 10 4s10-1.8 10-4v-6M6 16v6c0 2.2 4.5 4 10 4s10-1.8 10-4v-6" />
        </svg>
      </span>
      deeplake<span className="brand-dot">.</span>
    </span>
  );
}
export function Badge({
  value,
  children,
}: {
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <span className={`badge badge-${value.replaceAll("_", "-")}`}>
      <span aria-hidden="true" />
      {children ?? label(value)}
    </span>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Database size={25} strokeWidth={1.4} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function PanelHeading({
  title,
  caption,
  aside,
}: {
  title: string;
  caption?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {caption && <p>{caption}</p>}
      </div>
      {aside}
    </div>
  );
}
export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  drawer = false,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  onClose: () => void;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={drawer ? "modal drawer" : "modal"}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <header className="modal-heading">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close detail"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function EvidenceCard({
  evidence,
  data,
  go,
  observationIds,
}: {
  evidence: Evidence;
  data: WorkspaceSnapshot;
  go: Navigate;
  observationIds?: readonly string[];
}) {
  const version = data.sourceVersions.find(
      (v) => v.id === evidence.sourceVersionId,
    ),
    segment = data.segments.find((s) => s.id === evidence.segmentId);
  const exact =
    segment?.text.slice(evidence.start, evidence.end) === evidence.quote;
  return (
    <div className="evidence-card">
      <div className="evidence-top">
        <FileText size={14} />
        <span>{version?.title ?? "Source evidence"}</span>
        {version?.acquisition === "fixture" && (
          <span className="mini-label">Fixture</span>
        )}
      </div>
      <blockquote>{evidence.quote}</blockquote>
      <div className="evidence-meta">
        <span>
          {evidence.page ? `Page ${evidence.page} · ` : ""}Characters{" "}
          {evidence.start}–{evidence.end}
        </span>
        {version && (
          <button
            className="text-button"
            onClick={() =>
              go({
                view: "sources",
                detail: version.sourceId,
                version: version.id,
                observation:
                  evidenceObservation(data, evidence, observationIds)?.id ?? "",
              })
            }
          >
            Open source <ArrowUpRight size={13} />
          </button>
        )}
      </div>
      <details>
        <summary>Read passage in context</summary>
        {segment ? (
          <pre className="source-passage">
            {exact ? (
              <>
                {segment.text.slice(0, evidence.start)}
                <mark>{evidence.quote}</mark>
                {segment.text.slice(evidence.end)}
              </>
            ) : (
              segment.text
            )}
          </pre>
        ) : (
          <p className="muted">
            The full stored passage is unavailable in this snapshot.
          </p>
        )}
        {!exact && segment && (
          <p className="warning-text">
            The supplied quote does not match this stored passage. Inspect the
            source before using it.
          </p>
        )}
      </details>
    </div>
  );
}
export function ReadOnlyNote({
  connected,
  onConnect,
}: {
  connected: boolean;
  onConnect: () => void;
}) {
  return connected ? null : (
    <div className="readonly-note">
      <span>
        This snapshot is read-only. Connect an API to make and record changes.
      </span>
      <button className="text-button" onClick={onConnect}>
        Connect API <ArrowUpRight size={13} />
      </button>
    </div>
  );
}
export function SourceLink({
  url,
  synthetic = false,
}: {
  url: string;
  synthetic?: boolean;
}) {
  return synthetic ? (
    <span className="source-address">
      {host(url)} <span className="mini-label">Synthetic fixture</span>
    </span>
  ) : (
    <a
      className="external-link"
      href={url}
      target="_blank"
      rel="noreferrer noopener"
    >
      {host(url)}
      <ArrowUpRight size={13} />
    </a>
  );
}
export function Value({ value, unit }: { value: JsonValue; unit?: string }) {
  return typeof value === "object" && value !== null ? (
    <pre className="json-value">{JSON.stringify(value, null, 2)}</pre>
  ) : (
    <span>
      {value === null ? (
        <span className="muted">Unresolved</span>
      ) : typeof value === "boolean" ? (
        value ? (
          "Yes"
        ) : (
          "No"
        )
      ) : (
        String(value)
      )}
      {unit && value !== null && <span className="unit"> {unit}</span>}
    </span>
  );
}
export function Timestamp({ value }: { value: string | null }) {
  return (
    <time dateTime={value ?? undefined} title={value ?? undefined}>
      {date(value, true)}
    </time>
  );
}
export function SuccessMark() {
  return (
    <span className="success-mark">
      <Check size={16} />
    </span>
  );
}
