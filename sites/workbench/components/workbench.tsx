"use client";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Braces,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Database,
  FileText,
  GitBranch,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Unplug,
  X,
} from "lucide-react";
import { ProjectSchema } from "@deeplake/core/contract";
import type { Project, WorkspaceSnapshot } from "@deeplake/core/contract";
import { z } from "zod";
import {
  connectionKey,
  fetchSnapshot,
  normalizeConnection,
  request,
} from "../lib/api";
import type { Connection } from "../lib/api";
import {
  date,
  initialLocation,
  locationHref,
  readLocation,
  shownProjects,
} from "../lib/model";
import type { LocationState, View } from "../lib/model";
import { Brand } from "./primitives";
import { Overview, Sources, Audits, Schemas, Runs, Explorer } from "./views";
import { Detail } from "./details";
import { ConnectionForm, NewProjectForm, PublishForm } from "./forms";
import type { NewProjectInput } from "./forms";
const navigation = [
  { id: "overview" as const, label: "Overview", icon: LayoutDashboard },
  { id: "sources" as const, label: "Source library", icon: FileText },
  { id: "audit" as const, label: "Audit queue", icon: CircleAlert },
  { id: "schemas" as const, label: "Schema registry", icon: GitBranch },
  { id: "runs" as const, label: "Run history", icon: Activity },
  { id: "explore" as const, label: "Published explorer", icon: Database },
];
const descriptions: Record<View, string> = {
  overview: "A clear view of what you know, and what needs your attention.",
  sources:
    "Original sources, immutable snapshots and the passages behind every observation.",
  audit:
    "Inspect the evidence, identify the failure and record the next decision.",
  schemas: "Evolve the representation without rewriting the source evidence.",
  runs: "Trace each discovery, extraction and replay through its recorded events.",
  explore: "Inspect the facts and disagreements in your published collections.",
};
const ConnectionSchema = z.object({ url: z.string(), token: z.string() });
export function Workbench({ initialData }: { initialData: WorkspaceSnapshot }) {
  const [data, setData] = useState(initialData),
    [state, setState] = useState<LocationState>(initialLocation),
    [menuOpen, setMenuOpen] = useState(false),
    [connection, setConnection] = useState<Connection | null>(null),
    [connectionStatus, setConnectionStatus] = useState<
      "offline" | "connecting" | "connected" | "error"
    >("offline"),
    [providers, setProviders] = useState<Record<string, boolean>>({}),
    [connectionError, setConnectionError] = useState(""),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [modal, setModal] = useState<"connect" | "new" | "publish" | null>(null),
    [publishProject, setPublishProject] = useState<Project | null>(null),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(
      null,
    );
  const searchRef = useRef<HTMLInputElement>(null),
    connectionRef = useRef<Connection | null>(null);
  const connected = connection !== null && connectionStatus === "connected";
  function go(patch: Partial<LocationState>, replace = false) {
    setState((previous) => {
      const changedView =
        patch.view !== undefined && patch.view !== previous.view;
      const next = {
        ...previous,
        ...(changedView
          ? {
              q: "",
              status: "",
              kind: "",
              detail: "",
              version: "",
              observation: "",
            }
          : {}),
        ...(patch.project !== undefined && patch.project !== previous.project
          ? { detail: "", version: "", observation: "" }
          : {}),
        ...patch,
      };
      const href = locationHref(next);
      if (replace) window.history.replaceState({}, "", href);
      else window.history.pushState({}, "", href);
      return next;
    });
    setMenuOpen(false);
  }
  async function refresh(active: Connection | null = connectionRef.current) {
    if (!active) return;
    setRefreshing(true);
    try {
      const snapshot = await fetchSnapshot(active);
      if (
        connectionRef.current?.url === active.url &&
        connectionRef.current?.token === active.token
      ) {
        setData(snapshot);
        setConnectionStatus("connected");
        setConnectionError("");
      }
    } catch (error) {
      if (connectionRef.current?.url === active.url) {
        setConnectionStatus("error");
        setConnectionError(
          error instanceof Error
            ? error.message
            : "The API could not be reached.",
        );
      }
    } finally {
      setRefreshing(false);
    }
  }
  async function connect(next: Connection) {
    setConnectionStatus("connecting");
    try {
      const snapshot = await fetchSnapshot(next);
      connectionRef.current = next;
      setConnection(next);
      setData(snapshot);
      setConnectionStatus("connected");
      setConnectionError("");
      sessionStorage.setItem(connectionKey, JSON.stringify(next));
      setModal(null);
      setToast({
        message: "Workspace connected. Actions now use your operator API.",
        error: false,
      });
      try {
        const result = z
          .object({ providers: z.record(z.boolean()) })
          .parse(await request(next, "/api/config", undefined, "GET"));
        setProviders(result.providers);
      } catch {
        setProviders({});
      }
    } catch (error) {
      setConnectionStatus(connectionRef.current ? "error" : "offline");
      throw error;
    }
  }
  function disconnect() {
    connectionRef.current = null;
    setConnection(null);
    setConnectionStatus("offline");
    setConnectionError("");
    setProviders({});
    sessionStorage.removeItem(connectionKey);
    setData(initialData);
    setModal(null);
    go({ ...initialLocation }, true);
    setToast({
      message: "Disconnected. The read-only demonstration is restored.",
      error: false,
    });
  }
  useEffect(() => {
    setState(readLocation(window.location.search));
    const popstate = () => setState(readLocation(window.location.search));
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("popstate", popstate);
    window.addEventListener("keydown", shortcut);
    try {
      const raw = sessionStorage.getItem(connectionKey);
      if (raw) {
        const saved = normalizeConnection(
          ConnectionSchema.parse(JSON.parse(raw)),
        );
        void connect(saved).catch((error) =>
          setConnectionError(
            error instanceof Error
              ? error.message
              : "Saved connection is unavailable.",
          ),
        );
      }
    } catch {
      sessionStorage.removeItem(connectionKey);
    }
    return () => {
      window.removeEventListener("popstate", popstate);
      window.removeEventListener("keydown", shortcut);
    };
  }, []);
  useEffect(() => {
    if (!connection) return;
    const timer = setInterval(() => {
      void refresh(connection);
    }, 5000);
    return () => clearInterval(timer);
  }, [connection]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function act(
    path: string,
    body: unknown,
    message: string,
    method = "POST",
  ): Promise<boolean> {
    if (!connection || !connected) {
      setModal("connect");
      return false;
    }
    if (busy) return false;
    setBusy(true);
    try {
      await request(connection, path, body, method);
      await refresh(connection);
      setToast({ message, error: false });
      return true;
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "The action failed.",
        error: true,
      });
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function create(input: NewProjectInput) {
    if (!connection || !connected)
      throw new Error("Connect an operator API first.");
    setBusy(true);
    try {
      const project = ProjectSchema.parse(
        await request(connection, "/api/projects", input),
      );
      await refresh(connection);
      setModal(null);
      go({ view: "overview", project: project.id });
      setToast({
        message: "Project created. Start discovery when you are ready.",
        error: false,
      });
    } finally {
      setBusy(false);
    }
  }
  const onConnect = () => setModal("connect"),
    onNew = () => setModal("new"),
    onPublish = (project: Project) => {
      setPublishProject(project);
      setModal("publish");
    };
  const props = {
    data,
    state,
    go,
    connected,
    act,
    onConnect,
    onNew,
    onPublish,
    busy,
  };
  const current = shownProjects(data, state.project),
    title =
      navigation.find((item) => item.id === state.view)?.label ?? "Overview",
    openFindings = data.findings.filter((f) => f.status === "open").length,
    pendingProposals = data.proposals.filter(
      (p) => p.status === "pending",
    ).length;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-main">
        Skip to workspace
      </a>
      {menuOpen && (
        <button
          className="sidebar-backdrop"
          onClick={() => setMenuOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <a
          className="brand-link"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            go({ ...initialLocation });
          }}
          aria-label="Deeplake overview"
        >
          <Brand />
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">D</span>
          <span>
            Evidence workspace
            <small>
              {connection ? "Connected environment" : "Demonstration"}
            </small>
          </span>
        </div>
        <p className="nav-label">Workspace</p>
        <nav aria-label="Main navigation">
          {navigation.map((item) => {
            const count =
              item.id === "audit"
                ? openFindings
                : item.id === "schemas"
                  ? pendingProposals
                  : 0;
            return (
              <a
                key={item.id}
                href={locationHref({
                  ...initialLocation,
                  view: item.id,
                  project: state.project,
                })}
                aria-current={state.view === item.id ? "page" : undefined}
                className={`nav-link ${state.view === item.id ? "active" : ""}`}
                onClick={(event) => {
                  event.preventDefault();
                  go({ view: item.id });
                }}
              >
                <item.icon size={17} />
                <span>{item.label}</span>
                {count > 0 && (
                  <span
                    className={`nav-count ${item.id === "audit" ? "attention" : ""}`}
                  >
                    {count}
                  </span>
                )}
              </a>
            );
          })}
        </nav>
        <div className="sidebar-note">
          <span className="side-note-icon">
            <ShieldCheck size={17} />
          </span>
          <strong>Evidence comes first.</strong>
          <p>
            Sources stay immutable.
            <br />
            Your understanding can evolve.
          </p>
        </div>
        <div className="sidebar-bottom">
          <button className="connection-link" onClick={onConnect}>
            <span className={`connection-dot ${connectionStatus}`} />
            <span>
              {connectionStatus === "connected"
                ? "API connected"
                : connectionStatus === "connecting"
                  ? "Connecting…"
                  : connectionStatus === "error"
                    ? "Connection lost"
                    : "Connect operator API"}
              <small>
                {connection ? "Manage connection" : "Enable runs and decisions"}
              </small>
            </span>
            <ChevronDown size={14} />
          </button>
          <div className="build-label">
            <span>DEEPLAKE</span>
            <span>v0.1</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button menu-button"
              aria-label="Open navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              Workspace <span>/</span> <strong>{title}</strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className={`environment-tag ${connected ? "connected" : ""}`}>
              <span />
              {connectionStatus === "connecting"
                ? "Connecting"
                : connectionStatus === "error"
                  ? "Last saved snapshot"
                  : connected
                    ? "Connected workspace"
                    : "Read-only demo"}
            </span>
            <button className="button small top-new" onClick={onNew}>
              <Plus size={15} />
              New project
            </button>
          </div>
        </header>
        <main id="workspace-main" className="workspace-main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {state.project === "all"
                  ? "WORKSPACE"
                  : (current[0]?.name ?? "PROJECT")}
              </p>
              <h1>{title}</h1>
              <p>{descriptions[state.view]}</p>
            </div>
            <div className="page-heading-side">
              <label className="project-select-label" htmlFor="project-filter">
                Project
              </label>
              <select
                id="project-filter"
                aria-label="Project"
                value={state.project}
                onChange={(event) => go({ project: event.target.value }, true)}
              >
                <option value="all">All projects</option>
                {data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {!connection && (
            <div className="demo-strip">
              <span className="demo-badge">DEMO</span>
              <span>
                Synthetic curricula and procurement fixtures. Explore the full
                evidence trail.
              </span>
              <button className="text-button" onClick={onConnect}>
                Connect your data <ArrowRight size={13} />
              </button>
            </div>
          )}
          {connectionError && (
            <div className="connection-error" role="alert">
              <CircleAlert size={17} />
              <span>
                <strong>The API is unavailable.</strong> {connectionError} The
                last snapshot remains visible; mutations are disabled.
              </span>
              <button className="text-button" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          <div className="workspace-toolbar">
            <div className="search-input">
              <Search size={17} />
              <input
                ref={searchRef}
                type="search"
                aria-label="Search current view"
                placeholder={
                  state.view === "overview"
                    ? "Search source titles, families and URLs…"
                    : `Search ${title.toLowerCase()}…`
                }
                value={state.q}
                onChange={(event) => {
                  if (state.view === "overview")
                    go({ view: "sources", q: event.target.value }, true);
                  else go({ q: event.target.value }, true);
                }}
              />
              <kbd>⌘ K</kbd>
            </div>
            <div className="snapshot-meta">
              <span>
                {connection
                  ? `Updated ${date(data.generatedAt, true)}`
                  : "Engine-generated snapshot"}
              </span>
              {connection && (
                <button
                  className="icon-button"
                  aria-label="Refresh workspace"
                  onClick={() => void refresh()}
                  disabled={refreshing || busy}
                >
                  <RefreshCw size={15} className={refreshing ? "spin" : ""} />
                </button>
              )}
            </div>
          </div>
          {state.view === "overview" && <Overview {...props} />}{" "}
          {state.view === "sources" && <Sources {...props} />}{" "}
          {state.view === "audit" && <Audits {...props} />}{" "}
          {state.view === "schemas" && <Schemas {...props} />}{" "}
          {state.view === "runs" && <Runs {...props} />}{" "}
          {state.view === "explore" && <Explorer {...props} />}
          <footer className="workspace-footer">
            <span>
              <span className="footer-dot" />
              Evidence → understanding → publication
            </span>
            <span>
              {data.projects.length} projects ·{" "}
              {connected ? "Operator API" : "Synthetic demo data"}
            </span>
          </footer>
        </main>
      </div>
      {state.detail && (
        <Detail
          {...props}
          apiUrl={connection?.url}
          apiToken={connection?.token}
        />
      )}
      {modal === "connect" && (
        <ConnectionForm
          connection={connection}
          onConnect={connect}
          onDisconnect={disconnect}
          onClose={() => setModal(null)}
          providers={providers}
        />
      )}
      {modal === "new" && (
        <NewProjectForm
          connected={connected}
          onConnect={onConnect}
          onCreate={create}
          onClose={() => setModal(null)}
          busy={busy}
        />
      )}
      {modal === "publish" && publishProject && (
        <PublishForm
          project={publishProject}
          data={data}
          connected={connected}
          onConnect={onConnect}
          onClose={() => setModal(null)}
          act={act}
          busy={busy}
        />
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleAlert size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
