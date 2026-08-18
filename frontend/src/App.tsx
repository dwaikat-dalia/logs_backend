import { useEffect, useMemo, useState } from "react";
import "./App.css";

type Log = {
  id: string;
  timestamp: string;
  level: string;
  service: string;
  message: string;
  attributes: Record<string, unknown>;
  createdAt: string;
};

type LogsResponse = {
  logs: Log[];
  next_cursor: string | null;
};

type AggregateBucket = {
  start: string;
  group: string | null;
  count: number;
};

type AggregateResponse = {
  buckets: AggregateBucket[];
};

const API_URL = "http://localhost:8080";

function App() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [activity, setActivity] = useState<AggregateBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        setLoading(true);
        setError("");

        // -----------------------------
        // Load recent logs
        // -----------------------------
        const logsResponse = await fetch(`${API_URL}/logs`);

        if (!logsResponse.ok) {
          throw new Error(
            `Request failed with status ${logsResponse.status}`
          );
        }

        const logsData: LogsResponse = await logsResponse.json();
        setLogs(logsData.logs);

        // -----------------------------
        // Load aggregation for last 24h
        // -----------------------------
        const until = new Date();
        const since = new Date(
          until.getTime() - 24 * 60 * 60 * 1000
        );

        const aggregateParams = new URLSearchParams({
          since: since.toISOString(),
          until: until.toISOString(),
          bucket: "1h",
        });

        const aggregateResponse = await fetch(
          `${API_URL}/logs/aggregate?${aggregateParams.toString()}`
        );

        if (!aggregateResponse.ok) {
          throw new Error(
            `Aggregate request failed with status ${aggregateResponse.status}`
          );
        }

        const aggregateData: AggregateResponse =
          await aggregateResponse.json();

        setActivity(aggregateData.buckets);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load dashboard"
        );
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  // -----------------------------
  // Dashboard metrics
  // -----------------------------

  const services = useMemo(
    () => [...new Set(logs.map((log) => log.service))],
    [logs]
  );

  const errors = useMemo(
    () =>
      logs.filter(
        (log) => log.level.toLowerCase() === "error"
      ).length,
    [logs]
  );

  // -----------------------------
  // Build exactly 24 hourly bars
  // -----------------------------
  const activityBars = useMemo(() => {
    const now = new Date();

    // Round current time down to the beginning of the hour
    const currentHour = new Date(now);
    currentHour.setMinutes(0, 0, 0);

    const bars: AggregateBucket[] = [];

    for (let i = 23; i >= 0; i--) {
      const hour = new Date(currentHour);
      hour.setHours(currentHour.getHours() - i);

      const matchingBucket = activity.find((bucket) => {
        const bucketDate = new Date(bucket.start);

        return (
          bucketDate.getFullYear() === hour.getFullYear() &&
          bucketDate.getMonth() === hour.getMonth() &&
          bucketDate.getDate() === hour.getDate() &&
          bucketDate.getHours() === hour.getHours()
        );
      });

      bars.push({
        start: hour.toISOString(),
        group: null,
        count: matchingBucket?.count ?? 0,
      });
    }

    return bars;
  }, [activity]);

  const maxActivity = useMemo(
    () =>
      Math.max(
        ...activityBars.map((item) => item.count),
        1
      ),
    [activityBars]
  );

  return (
    <div className="app">
      {/* =========================================
          SIDEBAR
      ========================================= */}

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">L</div>

          <div>
            <h1>LOGSCOPE</h1>
            <span>OBSERVABILITY</span>
          </div>
        </div>

        <nav className="navigation">
          <p className="nav-label">WORKSPACE</p>

          <button className="nav-item active">
            <span>01</span>
            Overview
          </button>

          <button className="nav-item">
            <span>02</span>
            Logs
          </button>

          <button className="nav-item">
            <span>03</span>
            Analytics
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="connection">
            <span className="status-dot" />

            <div>
              <strong>BACKEND</strong>
              <small>localhost:8080</small>
            </div>
          </div>
        </div>
      </aside>

      {/* =========================================
          MAIN
      ========================================= */}

      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              LOG INGESTION SERVICE
            </span>

            <h2>Overview</h2>
          </div>

          <div className="topbar-status">
            <span className="live-dot" />
            <span>LIVE</span>
          </div>
        </header>

        <div className="content">
          {/* =====================================
              WELCOME
          ===================================== */}

          <section className="welcome">
            <div>
              <span className="section-number">01</span>

              <div>
                <p>OPERATIONS</p>
                <h3>
                  System activity at a glance.
                </h3>
              </div>
            </div>

            <div className="gold-line" />
          </section>

          {/* =====================================
              METRICS
          ===================================== */}

          <section className="metrics">
            <article className="metric-card primary">
              <span>TOTAL LOGS</span>

              <strong>
                {loading ? "—" : logs.length}
              </strong>

              <small>returned by API</small>
            </article>

            <article className="metric-card">
              <span>ERRORS</span>

              <strong>
                {loading ? "—" : errors}
              </strong>

              <small>current result set</small>
            </article>

            <article className="metric-card">
              <span>SERVICES</span>

              <strong>
                {loading ? "—" : services.length}
              </strong>

              <small>unique services</small>
            </article>
          </section>

          {/* =====================================
              ACTIVITY + HEALTH
          ===================================== */}

          <section className="workspace-grid">
            {/* ACTIVITY */}

            <div className="panel activity-panel">
              <div className="panel-header">
                <div>
                  <span>ACTIVITY</span>
                  <h3>Log stream</h3>
                </div>

                <div className="api-badge">
                  GET /logs/aggregate
                </div>
              </div>

              <div className="activity-visual">
                <div className="activity-bars">
                  {loading ? (
                    <div className="activity-empty">
                      Loading activity...
                    </div>
                  ) : (
                    activityBars.map((bucket) => {
                      const height =
                        bucket.count === 0
                          ? 4
                          : Math.max(
                              12,
                              (bucket.count /
                                maxActivity) *
                                100
                            );

                      const hour = new Date(
                        bucket.start
                      ).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      });

                      return (
                        <div
                          className="activity-bar-wrapper"
                          key={bucket.start}
                          title={`${hour} — ${bucket.count} logs`}
                        >
                          <span
                            className="activity-bar"
                            style={{
                              height: `${height}%`,
                            }}
                          />
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="activity-footer">
                  <span>LOW</span>
                  <span>LAST 24 HOURS</span>
                  <span>HIGH</span>
                </div>
              </div>
            </div>

            {/* HEALTH */}

            <div className="panel health-panel">
              <div className="panel-header">
                <div>
                  <span>SYSTEM</span>
                  <h3>Health</h3>
                </div>

                <span className="healthy-badge">
                  HEALTHY
                </span>
              </div>

              <div className="health-content">
                <div className="health-score">
                  OK
                </div>

                <div className="health-items">
                  <div>
                    <span className="status-dot" />
                    <span>PostgreSQL</span>
                    <strong>ONLINE</strong>
                  </div>

                  <div>
                    <span className="status-dot" />
                    <span>Ingestion API</span>
                    <strong>ONLINE</strong>
                  </div>

                  <div>
                    <span className="status-dot" />
                    <span>Query API</span>
                    <strong>ONLINE</strong>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* =====================================
              RECENT LOGS
          ===================================== */}

          <section className="panel logs-panel">
            <div className="panel-header logs-header">
              <div>
                <span>STREAM</span>
                <h3>Recent logs</h3>
              </div>

              <span className="log-count">
                {logs.length} EVENTS
              </span>
            </div>

            {loading && (
              <div className="empty-state">
                Loading logs from backend...
              </div>
            )}

            {!loading && error && (
              <div className="empty-state error-state">
                {error}
              </div>
            )}

            {!loading &&
              !error &&
              logs.length === 0 && (
                <div className="empty-state">
                  No logs found.
                </div>
              )}

            {!loading &&
              !error &&
              logs.length > 0 && (
                <div className="log-table">
                  <div className="log-table-head">
                    <span>TIME</span>
                    <span>LEVEL</span>
                    <span>SERVICE</span>
                    <span>MESSAGE</span>
                  </div>

                  {logs.slice(0, 10).map((log) => (
                    <div
                      className="log-row"
                      key={log.id}
                    >
                      <time>
                        {new Date(
                          log.timestamp
                        ).toLocaleTimeString()}
                      </time>

                      <span
                        className={`level level-${log.level.toLowerCase()}`}
                      >
                        {log.level.toUpperCase()}
                      </span>

                      <span className="service">
                        {log.service}
                      </span>

                      <p>{log.message}</p>
                    </div>
                  ))}
                </div>
              )}
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;