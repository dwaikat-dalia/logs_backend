import {
  useEffect,
  useState,
} from "react";

import "./App.css";
import LogsPage from "./LogsPage";
import AnalyticsPage from "./AnalyticsPage";

type StatsResponse = {
  total_logs: number;
  errors: number;
  services: number;
};

const API_URL = "http://localhost:8080";

type Page =
  | "overview"
  | "logs"
  | "analytics";

type BackendStatus =
  | "online"
  | "offline";

function App() {
  const [page, setPage] =
    useState<Page>("overview");

  const [backendStatus, setBackendStatus] =
    useState<BackendStatus>("offline");

  useEffect(() => {
    let mounted = true;

    async function checkBackend() {
      const controller =
        new AbortController();

      const timeout = window.setTimeout(() => {
        controller.abort();
      }, 2000);

      try {
        const response = await fetch(
          `${API_URL}/health`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(
            "Backend unhealthy"
          );
        }

        const data =
          await response.json();

        if (
          mounted &&
          data?.status === "healthy" &&
          data?.database === "connected"
        ) {
          setBackendStatus("online");
        } else if (mounted) {
          setBackendStatus("offline");
        }
      } catch {
        if (mounted) {
          setBackendStatus("offline");
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    // Initial check
    checkBackend();

    // Check every 5 seconds
    const interval =
      window.setInterval(() => {
        checkBackend();
      }, 5000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  /*
    QUICK NAVIGATION
  */
  useEffect(() => {
    function handleNavigation(
      event: Event
    ) {
      const customEvent =
        event as CustomEvent<Page>;

      const target =
        customEvent.detail;

      if (
        target === "overview" ||
        target === "logs" ||
        target === "analytics"
      ) {
        setPage(target);
      }
    }

    window.addEventListener(
      "logscope:navigate",
      handleNavigation
    );

    return () => {
      window.removeEventListener(
        "logscope:navigate",
        handleNavigation
      );
    };
  }, []);

  return (
    <div className="app">
      <Sidebar
        page={page}
        setPage={setPage}
        backendStatus={backendStatus}
      />

      {page === "overview" && (
        <OverviewPage
          backendStatus={backendStatus}
        />
      )}

      {page === "logs" && (
        <LogsPage
          backendStatus={backendStatus}
        />
      )}

      {page === "analytics" && (
        <AnalyticsPage
          backendStatus={backendStatus}
        />
      )}
    </div>
  );
}

/* =========================================================
   SIDEBAR
========================================================= */

type SidebarProps = {
  page: Page;
  setPage: (page: Page) => void;
  backendStatus: BackendStatus;
};

function Sidebar({
  page,
  setPage,
  backendStatus,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          L
        </div>

        <div>
          <h1>LOGSCOPE</h1>
          <span>OBSERVABILITY</span>
        </div>
      </div>

      <nav className="navigation">
        <p className="nav-label">
          WORKSPACE
        </p>

        <button
          className={`nav-item ${
            page === "overview"
              ? "active"
              : ""
          }`}
          onClick={() =>
            setPage("overview")
          }
        >
          <span>01</span>
          Overview
        </button>

        <button
          className={`nav-item ${
            page === "logs"
              ? "active"
              : ""
          }`}
          onClick={() =>
            setPage("logs")
          }
        >
          <span>02</span>
          Logs
        </button>

        <button
          className={`nav-item ${
            page === "analytics"
              ? "active"
              : ""
          }`}
          onClick={() =>
            setPage("analytics")
          }
        >
          <span>03</span>
          Analytics
        </button>
      </nav>

      <div className="sidebar-footer">
        <div
          className={`connection ${
            backendStatus === "online"
              ? "connection-online"
              : "connection-offline"
          }`}
        >
          <span
            className={`status-dot ${
              backendStatus === "online"
                ? "status-online"
                : "status-offline"
            }`}
          />

          <div>
            <strong>BACKEND</strong>

            <small>
              localhost:8080
            </small>

            <em>
              {backendStatus === "online"
                ? "ONLINE"
                : "OFFLINE"}
            </em>
          </div>
        </div>
      </div>
    </aside>
  );
}

/* =========================================================
   OVERVIEW PAGE
========================================================= */

type OverviewPageProps = {
  backendStatus: BackendStatus;
};

function OverviewPage({
  backendStatus,
}: OverviewPageProps) {
  const [stats, setStats] =
    useState<StatsResponse | null>(
      null
    );

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    async function loadStats() {
      if (
        backendStatus === "offline"
      ) {
        setStats(null);
        setLoading(false);
        setError("");

        return;
      }

      try {
        setLoading(true);
        setError("");

        const controller =
          new AbortController();

        const timeout =
          window.setTimeout(() => {
            controller.abort();
          }, 2000);

        const response =
          await fetch(
            `${API_URL}/stats`,
            {
              cache: "no-store",
              signal:
                controller.signal,
            }
          );

        window.clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(
            `Stats request failed with status ${response.status}`
          );
        }

        const data: StatsResponse =
          await response.json();

        setStats(data);
      } catch (err) {
        setStats(null);

        setError(
          err instanceof Error
            ? err.message
            : "Failed to load overview"
        );
      } finally {
        setLoading(false);
      }
    }

    loadStats();
  }, [backendStatus]);

  return (
    <main className="main">
      <header className="topbar">
        <div>
          <span className="eyebrow">
            LOG INGESTION SERVICE
          </span>

          <h2>Overview</h2>
        </div>

        <div
          className={`topbar-status ${
            backendStatus === "online"
              ? "topbar-online"
              : "topbar-offline"
          }`}
        >
          <span
            className={`live-dot ${
              backendStatus === "online"
                ? "status-online"
                : "status-offline"
            }`}
          />

          <span>
            {backendStatus === "online"
              ? "LIVE"
              : "OFFLINE"}
          </span>
        </div>
      </header>

      <div className="content">
        <section className="welcome">
          <div>
            <span className="section-number">
              01
            </span>

            <div>
              <p>OPERATIONS</p>

              <h3>
                System status at a glance.
              </h3>
            </div>
          </div>

          <div className="gold-line" />
        </section>

        {backendStatus ===
          "offline" && (
          <section className="panel">
            <div className="empty-state error-state">
              Backend is offline. Start
              the backend service and
              database to load system
              data.
            </div>
          </section>
        )}

        {error &&
          backendStatus ===
            "online" && (
            <section className="panel">
              <div className="empty-state error-state">
                {error}
              </div>
            </section>
          )}

        <section className="metrics">
          <article className="metric-card primary">
            <span>TOTAL LOGS</span>

            <strong>
              {backendStatus ===
                "offline" ||
              loading
                ? "—"
                : stats?.total_logs.toLocaleString() ??
                  "—"}
            </strong>

            <small>
              all stored events
            </small>
          </article>

          <article className="metric-card">
            <span>ERRORS</span>

            <strong>
              {backendStatus ===
                "offline" ||
              loading
                ? "—"
                : stats?.errors.toLocaleString() ??
                  "—"}
            </strong>

            <small>
              all stored error events
            </small>
          </article>

          <article className="metric-card">
            <span>SERVICES</span>

            <strong>
              {backendStatus ===
                "offline" ||
              loading
                ? "—"
                : stats?.services ??
                  "—"}
            </strong>

            <small>
              unique services
            </small>
          </article>
        </section>

        <section className="panel health-panel">
          <div className="panel-header">
            <div>
              <span>SYSTEM</span>

              <h3>Health</h3>
            </div>

            <span
              className={`healthy-badge ${
                backendStatus === "online"
                  ? "health-online"
                  : "health-offline"
              }`}
            >
              {backendStatus === "online"
                ? "HEALTHY"
                : "OFFLINE"}
            </span>
          </div>

          <div className="health-content">
            <div
              className={`health-score ${
                backendStatus === "online"
                  ? "health-score-online"
                  : "health-score-offline"
              }`}
            >
              {backendStatus === "online"
                ? "OK"
                : "OFF"}
            </div>

            <div className="health-items">
              <div>
                <span
                  className={`status-dot ${
                    backendStatus ===
                    "online"
                      ? "status-online"
                      : "status-offline"
                  }`}
                />

                <span>
                  PostgreSQL
                </span>

                <strong
                  className={
                    backendStatus ===
                    "online"
                      ? "health-text-online"
                      : "health-text-offline"
                  }
                >
                  {backendStatus ===
                  "online"
                    ? "ONLINE"
                    : "OFFLINE"}
                </strong>
              </div>

              <div>
                <span
                  className={`status-dot ${
                    backendStatus ===
                    "online"
                      ? "status-online"
                      : "status-offline"
                  }`}
                />

                <span>
                  Ingestion API
                </span>

                <strong
                  className={
                    backendStatus ===
                    "online"
                      ? "health-text-online"
                      : "health-text-offline"
                  }
                >
                  {backendStatus ===
                  "online"
                    ? "ONLINE"
                    : "OFFLINE"}
                </strong>
              </div>

              <div>
                <span
                  className={`status-dot ${
                    backendStatus ===
                    "online"
                      ? "status-online"
                      : "status-offline"
                  }`}
                />

                <span>
                  Query API
                </span>

                <strong
                  className={
                    backendStatus ===
                    "online"
                      ? "health-text-online"
                      : "health-text-offline"
                  }
                >
                  {backendStatus ===
                  "online"
                    ? "ONLINE"
                    : "OFFLINE"}
                </strong>
              </div>
            </div>
          </div>
        </section>

        <section className="workspace-grid">
          <div className="panel quick-panel">
            <div className="panel-header">
              <div>
                <span>02</span>

                <h3>Logs</h3>
              </div>
            </div>

            <p>
              Search, filter and inspect
              stored log events.
            </p>

            <button
              className="quick-panel-link"
              onClick={() =>
                setPageFromQuick(
                  "logs"
                )
              }
            >
              OPEN LOG EXPLORER →
            </button>
          </div>

          <div className="panel quick-panel">
            <div className="panel-header">
              <div>
                <span>03</span>

                <h3>Analytics</h3>
              </div>
            </div>

            <p>
              Explore log volume, trends
              and grouped aggregations.
            </p>

            <button
              className="quick-panel-link"
              onClick={() =>
                setPageFromQuick(
                  "analytics"
                )
              }
            >
              OPEN ANALYTICS →
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function setPageFromQuick(
  page: Page
) {
  window.dispatchEvent(
    new CustomEvent(
      "logscope:navigate",
      {
        detail: page,
      }
    )
  );
}

export default App;