import type {
  DomainSchema,
  Evidence,
  Finding,
  JsonValue,
  Observation,
  Project,
  PublishedRecord,
  WorkspaceSnapshot,
} from "@deeplake/core/contract";

export function evidenceObservation(
  data: WorkspaceSnapshot,
  evidence: Evidence,
  preferredIds: readonly string[] = [],
): Observation | undefined {
  const candidates = data.observations.filter(
    (observation) =>
      observation.evidence.sourceVersionId === evidence.sourceVersionId &&
      observation.evidence.segmentId === evidence.segmentId &&
      observation.evidence.start === evidence.start &&
      observation.evidence.end === evidence.end &&
      observation.evidence.quote === evidence.quote,
  );
  if (preferredIds.length) {
    return candidates.find((observation) =>
      preferredIds.includes(observation.id),
    );
  }
  return candidates.sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
}

export const views = [
  "overview",
  "sources",
  "audit",
  "schemas",
  "runs",
  "explore",
] as const;
export type View = (typeof views)[number];
export interface LocationState {
  view: View;
  project: string;
  q: string;
  status: string;
  kind: string;
  detail: string;
  version: string;
  observation: string;
}
export const initialLocation: LocationState = {
  view: "overview",
  project: "all",
  q: "",
  status: "",
  kind: "",
  detail: "",
  version: "",
  observation: "",
};
export function readLocation(search: string): LocationState {
  const params = new URLSearchParams(search),
    requested = params.get("view");
  const view = views.find((v) => v === requested) ?? "overview";
  return {
    view,
    project: params.get("project") ?? "all",
    q: params.get("q") ?? "",
    status: params.get("status") ?? "",
    kind: params.get("kind") ?? "",
    detail: params.get("detail") ?? "",
    version: params.get("version") ?? "",
    observation: params.get("observation") ?? "",
  };
}
export function locationHref(state: LocationState): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state))
    if (
      value &&
      !(key === "view" && value === "overview") &&
      !(key === "project" && value === "all")
    )
      params.set(key, value);
  return params.size ? `/?${params}` : "/";
}
export function projectName(data: WorkspaceSnapshot, id: string): string {
  return data.projects.find((p) => p.id === id)?.name ?? "Unknown project";
}
export function inProject<T extends { projectId: string }>(
  items: T[],
  project: string,
): T[] {
  return project === "all"
    ? items
    : items.filter((item) => item.projectId === project);
}
export function shownProjects(
  data: WorkspaceSnapshot,
  project: string,
): Project[] {
  return project === "all"
    ? data.projects
    : data.projects.filter((p) => p.id === project);
}
export function matches(query: string, ...parts: unknown[]): boolean {
  return (
    !query ||
    parts
      .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase())
  );
}
export function displayValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "Unresolved";
  if (typeof value === "string") return value;
  if (typeof value === "number")
    return new Intl.NumberFormat("en", { maximumFractionDigits: 6 }).format(
      value,
    );
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return JSON.stringify(value, null, 2);
}
export function shortId(value: string): string {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-7)}` : value;
}
export function date(
  value: string | null | undefined,
  includeTime = false,
): string {
  if (!value) return "Not yet";
  return (
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(includeTime
        ? { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }
        : { timeZone: "UTC" }),
    }).format(new Date(value)) + (includeTime ? " UTC" : "")
  );
}
export function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
}
export function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
export function label(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (x) => x.toUpperCase());
}
export function sortFindings(findings: Finding[]): Finding[] {
  const severity = { critical: 0, warning: 1, info: 2 };
  return [...findings].sort(
    (a, b) =>
      severity[a.severity] - severity[b.severity] ||
      b.createdAt.localeCompare(a.createdAt),
  );
}
export function currentRecords(
  data: WorkspaceSnapshot,
  project = "all",
  releaseId = "",
): {
  record: PublishedRecord;
  project: Project;
  releaseId: string;
  version: number;
  schemaId: string;
}[] {
  return shownProjects(data, project).flatMap((p) => {
    const release = data.publications.find(
      (r) => r.id === (releaseId || p.publishedReleaseId),
    );
    return release?.projectId === p.id
      ? release.records.map((record) => ({
          record,
          project: p,
          releaseId: release.id,
          version: release.version,
          schemaId: release.schemaId,
        }))
      : [];
  });
}
export interface FieldDifference {
  type: string;
  field: string;
  label: string;
  change: "added" | "removed" | "changed" | "unchanged";
  before: string;
  after: string;
}
export function schemaDifferences(
  base: DomainSchema | undefined,
  candidate: DomainSchema,
): FieldDifference[] {
  const types = new Set([
    ...(base?.entityTypes.map((t) => t.id) ?? []),
    ...candidate.entityTypes.map((t) => t.id),
  ]);
  return [...types].flatMap((type) => {
    const before = base?.entityTypes.find((t) => t.id === type),
      after = candidate.entityTypes.find((t) => t.id === type);
    const ids = new Set([
      ...(before?.fields.map((f) => f.id) ?? []),
      ...(after?.fields.map((f) => f.id) ?? []),
    ]);
    return [...ids].map((field) => {
      const a = before?.fields.find((f) => f.id === field),
        b = after?.fields.find((f) => f.id === field),
        old = a ? JSON.stringify(a, null, 2) : "",
        next = b ? JSON.stringify(b, null, 2) : "";
      return {
        type,
        field,
        label: b?.label ?? a?.label ?? field,
        change: !a
          ? "added"
          : !b
            ? "removed"
            : old === next
              ? "unchanged"
              : "changed",
        before: old,
        after: next,
      };
    });
  });
}
