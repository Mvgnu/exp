import { describe, expect, it } from "vitest";
import { WorkspaceSnapshotSchema } from "@deeplake/core/contract";
import raw from "../data/snapshot.json";
import {
  currentRecords,
  evidenceObservation,
  initialLocation,
  locationHref,
  readLocation,
  schemaDifferences,
} from "../lib/model";

const snapshot = WorkspaceSnapshotSchema.parse(raw);

describe("operator URL state", () => {
  it("keeps a scoped evidence deep link and punctuation intact through reload", () => {
    const state = {
      ...initialLocation,
      view: "sources" as const,
      project: "project_curricula",
      q: "A & B + 6 ECTS / 2026",
      kind: "module-handbook",
      status: "unchanged",
      detail: "source_evidence",
      version: "sourceversion_preserved",
      observation: "observation_selected",
    };
    const url = new URL(locationHref(state), "https://workbench.example");
    expect(readLocation(url.search)).toEqual(state);
  });

  it("handles an unknown route without losing the operator search", () => {
    expect(readLocation("?view=missing&q=renewal")).toMatchObject({
      view: "overview",
      project: "all",
      q: "renewal",
    });
  });
});

describe("publication boundary", () => {
  it("uses each project’s pinned release instead of mixing historical releases", () => {
    const records = currentRecords(snapshot);
    expect(records.length).toBeGreaterThan(0);
    for (const item of records) {
      expect(item.releaseId).toBe(item.project.publishedReleaseId);
      const release = snapshot.publications.find(
        (p) => p.id === item.releaseId,
      );
      expect(item.schemaId).toBe(release?.schemaId);
      expect(item.version).toBe(release?.version);
    }
    expect(records).toHaveLength(
      snapshot.projects.reduce((total, project) => {
        const release = snapshot.publications.find(
          (p) => p.id === project.publishedReleaseId,
        );
        return total + (release?.records.length ?? 0);
      }, 0),
    );
  });

  it("allows an explicit historical release without crossing project scope", () => {
    const project = snapshot.projects.find(
      (p) =>
        snapshot.publications.filter((r) => r.projectId === p.id).length > 1,
    );
    expect(project).toBeDefined();
    if (!project)
      throw new Error("The engine snapshot must include publication history.");
    const historical = snapshot.publications.find(
      (p) => p.projectId === project.id && p.id !== project.publishedReleaseId,
    );
    const other = snapshot.projects.find((p) => p.id !== project.id);
    expect(historical).toBeDefined();
    expect(other).toBeDefined();
    if (!historical || !other)
      throw new Error(
        "The engine snapshot must include two domains and a historical release.",
      );
    const records = currentRecords(snapshot, project.id, historical.id);
    expect(records).toHaveLength(historical.records.length);
    expect(
      records.every(
        (item) =>
          item.releaseId === historical.id &&
          item.schemaId === historical.schemaId,
      ),
    ).toBe(true);
    expect(currentRecords(snapshot, other.id, historical.id)).toEqual([]);
  });

  it("keeps the published observation identity when replay reused the same passage", () => {
    const replayed = snapshot.observations.find((observation) =>
      snapshot.observations.some(
        (other) =>
          other.id !== observation.id &&
          other.schemaId !== observation.schemaId &&
          other.evidence.segmentId === observation.evidence.segmentId &&
          other.evidence.start === observation.evidence.start &&
          other.evidence.end === observation.evidence.end,
      ),
    );
    expect(replayed).toBeDefined();
    if (!replayed)
      throw new Error(
        "The engine snapshot must include schema replay provenance.",
      );
    expect(
      evidenceObservation(snapshot, replayed.evidence, [replayed.id])?.id,
    ).toBe(replayed.id);
    expect(
      evidenceObservation(snapshot, replayed.evidence, ["missing_observation"]),
    ).toBeUndefined();
  });
});

describe("schema review", () => {
  it("shows the complete nested field definition for the actual proposed schema gap", () => {
    const proposal = snapshot.proposals.find((p) => p.status === "pending");
    expect(proposal).toBeDefined();
    if (!proposal)
      throw new Error("The engine snapshot must include a pending review.");
    const base = snapshot.schemas.find((s) => s.id === proposal.baseSchemaId);
    const differences = schemaDifferences(base, proposal.candidate).filter(
      (d) => d.change !== "unchanged",
    );
    expect(differences.length).toBeGreaterThan(0);
    for (const difference of differences) {
      const current = base?.entityTypes
        .find((t) => t.id === difference.type)
        ?.fields.find((f) => f.id === difference.field);
      const proposed = proposal.candidate.entityTypes
        .find((t) => t.id === difference.type)
        ?.fields.find((f) => f.id === difference.field);
      expect(
        difference.before ? JSON.parse(difference.before) : undefined,
      ).toEqual(current);
      expect(
        difference.after ? JSON.parse(difference.after) : undefined,
      ).toEqual(proposed);
    }
  });
});
