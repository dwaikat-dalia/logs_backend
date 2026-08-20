import {
  useCallback,
  useEffect,
  useState,
} from "react";

import "./LogsPage.css";

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

type BackendStatus =
  | "online"
  | "offline";

type LogsPageProps = {
  backendStatus: BackendStatus;
};

const API_URL =
  "http://localhost:8080";

function LogsPage({
  backendStatus,
}: LogsPageProps) {
  const [logs, setLogs] =
    useState<Log[]>([]);

  const [nextCursor, setNextCursor] =
    useState<string | null>(null);

  const [cursorHistory, setCursorHistory] =
    useState<(string | null)[]>([
      null,
    ]);

  const [pageIndex, setPageIndex] =
    useState(0);

  const [limit, setLimit] =
    useState(50);

  const [level, setLevel] =
    useState("");

  const [service, setService] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [inputSearch, setInputSearch] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  /* =====================================================
     LOAD LOGS
  ===================================================== */

  const loadLogs = useCallback(
    async (cursor: string | null) => {
      if (
        backendStatus === "offline"
      ) {
        setLogs([]);
        setNextCursor(null);
        setLoading(false);
        return;
      }

      const controller =
        new AbortController();

      const timeout =
        window.setTimeout(() => {
          controller.abort();
        }, 3000);

      try {
        setLoading(true);
        setError("");

        const params =
          new URLSearchParams();

        params.set(
          "limit",
          String(limit)
        );

        if (cursor) {
          params.set(
            "cursor",
            cursor
          );
        }

        if (level) {
          params.set(
            "level",
            level
          );
        }

        if (service.trim()) {
          params.set(
            "service",
            service.trim()
          );
        }

        if (search.trim()) {
          params.set(
            "q",
            search.trim()
          );
        }

        const response =
          await fetch(
            `${API_URL}/logs?${params.toString()}`,
            {
              method: "GET",
              cache: "no-store",
              signal:
                controller.signal,
            }
          );

        if (!response.ok) {
          let message =
            `Request failed with status ${response.status}`;

          try {
            const body =
              await response.json();

            if (body?.error) {
              message =
                body.error;
            }
          } catch {
            // Ignore JSON parsing errors
          }

          throw new Error(
            message
          );
        }

        const data: LogsResponse =
          await response.json();

        setLogs(
          data.logs ?? []
        );

        setNextCursor(
          data.next_cursor
        );
      } catch (err) {
        if (
          err instanceof
            DOMException &&
          err.name === "AbortError"
        ) {
          setError(
            "Backend request timed out."
          );
        } else {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load logs"
          );
        }

        setLogs([]);
        setNextCursor(null);
      } finally {
        window.clearTimeout(
          timeout
        );

        setLoading(false);
      }
    },
    [
      backendStatus,
      limit,
      level,
      service,
      search,
    ]
  );

  /* =====================================================
     INITIAL LOAD + BACKEND STATUS CHANGES
  ===================================================== */

  useEffect(() => {
    if (
      backendStatus === "online"
    ) {
      loadLogs(null);
    } else {
      setLogs([]);
      setNextCursor(null);
      setError("");
      setLoading(false);

      setPageIndex(0);
      setCursorHistory([
        null,
      ]);
    }
  }, [
    loadLogs,
    backendStatus,
  ]);

  /* =====================================================
     SEARCH
  ===================================================== */

  function applySearch() {
    const newSearch =
      inputSearch.trim();

    setSearch(newSearch);

    setPageIndex(0);

    setCursorHistory([
      null,
    ]);
  }

  /* =====================================================
     CLEAR FILTERS
  ===================================================== */

  function clearFilters() {
    setLevel("");
    setService("");
    setInputSearch("");
    setSearch("");

    setPageIndex(0);

    setCursorHistory([
      null,
    ]);
  }

  /* =====================================================
     NEXT PAGE
  ===================================================== */

  async function goNext() {
    if (
      !nextCursor ||
      loading ||
      backendStatus === "offline"
    ) {
      return;
    }

    const newPageIndex =
      pageIndex + 1;

    setCursorHistory(
      (history) => {
        const updated = [
          ...history,
        ];

        updated[
          newPageIndex
        ] = nextCursor;

        return updated;
      }
    );

    setPageIndex(
      newPageIndex
    );

    await loadLogs(
      nextCursor
    );
  }

  /* =====================================================
     PREVIOUS PAGE
  ===================================================== */

  async function goPrevious() {
    if (
      pageIndex === 0 ||
      loading ||
      backendStatus === "offline"
    ) {
      return;
    }

    const previousPageIndex =
      pageIndex - 1;

    const previousCursor =
      cursorHistory[
        previousPageIndex
      ] ?? null;

    setPageIndex(
      previousPageIndex
    );

    await loadLogs(
      previousCursor
    );
  }

  /* =====================================================
     PAGE SIZE
  ===================================================== */

  function changeLimit(
    event: React.ChangeEvent<HTMLSelectElement>
  ) {
    const newLimit =
      Number(
        event.target.value
      );

    setLimit(newLimit);

    setPageIndex(0);

    setCursorHistory([
      null,
    ]);
  }

  /* =====================================================
     FILTER STATUS
  ===================================================== */

  const hasFilters =
    Boolean(level) ||
    Boolean(
      service.trim()
    ) ||
    Boolean(
      search.trim()
    );

  const isOffline =
    backendStatus ===
    "offline";

  /* =====================================================
     RENDER
  ===================================================== */

  return (
    <main className="main logs-page">
      {/* =================================================
          TOPBAR
      ================================================= */}

      <header className="topbar">
        <div>
          <span className="eyebrow">
            LOG INGESTION SERVICE
          </span>

          <h2>Logs</h2>
        </div>

        <div
          className={`topbar-status ${
            isOffline
              ? "topbar-offline"
              : "topbar-online"
          }`}
        >
          <span
            className={`live-dot ${
              isOffline
                ? "status-offline"
                : "status-online"
            }`}
          />

          <span>
            {isOffline
              ? "OFFLINE"
              : "LIVE"}
          </span>
        </div>
      </header>

      <div className="content">
        {/* =================================================
            HEADER
        ================================================= */}

        <section className="welcome">
          <div>
            <span className="section-number">
              02
            </span>

            <div>
              <p>
                LOG EXPLORER
              </p>

              <h3>
                Search and inspect
                stored events.
              </h3>
            </div>
          </div>

          <div className="gold-line" />
        </section>

        {/* =================================================
            OFFLINE WARNING
        ================================================= */}

        {isOffline && (
          <section className="panel logs-offline-panel">
            <div className="logs-offline-content">
              <span className="status-dot status-offline" />

              <div>
                <strong>
                  BACKEND OFFLINE
                </strong>

                <p>
                  Unable to connect to
                  localhost:8080.
                  Start the backend
                  service to load and
                  inspect logs.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* =================================================
            FILTERS
        ================================================= */}

        <section className="panel logs-filters">
          <div className="panel-header">
            <div>
              <span>
                QUERY
              </span>

              <h3>
                Filters
              </h3>
            </div>

            <div className="api-badge">
              GET /logs
            </div>
          </div>

          <div className="filters-grid">
            {/* SEARCH */}

            <div className="filter-field search-field">
              <label htmlFor="log-search">
                MESSAGE SEARCH
              </label>

              <div className="search-control">
                <input
                  id="log-search"
                  type="text"
                  value={
                    inputSearch
                  }
                  placeholder="Search messages..."
                  disabled={
                    isOffline
                  }
                  onChange={(
                    event
                  ) =>
                    setInputSearch(
                      event.target
                        .value
                    )
                  }
                  onKeyDown={(
                    event
                  ) => {
                    if (
                      event.key ===
                      "Enter"
                    ) {
                      applySearch();
                    }
                  }}
                />

                <button
                  type="button"
                  onClick={
                    applySearch
                  }
                  disabled={
                    isOffline
                  }
                >
                  SEARCH
                </button>
              </div>
            </div>

            {/* LEVEL */}

            <div className="filter-field">
              <label htmlFor="log-level">
                LEVEL
              </label>

              <select
                id="log-level"
                value={level}
                disabled={
                  isOffline
                }
                onChange={(
                  event
                ) => {
                  setLevel(
                    event.target
                      .value
                  );

                  setPageIndex(
                    0
                  );

                  setCursorHistory([
                    null,
                  ]);
                }}
              >
                <option value="">
                  ALL LEVELS
                </option>

                <option value="debug">
                  DEBUG
                </option>

                <option value="info">
                  INFO
                </option>

                <option value="warn">
                  WARN
                </option>

                <option value="error">
                  ERROR
                </option>
              </select>
            </div>

            {/* SERVICE */}

            <div className="filter-field">
              <label htmlFor="log-service">
                SERVICE
              </label>

              <input
                id="log-service"
                type="text"
                value={service}
                disabled={
                  isOffline
                }
                placeholder="e.g. api-service"
                onChange={(
                  event
                ) => {
                  setService(
                    event.target
                      .value
                  );

                  setPageIndex(
                    0
                  );

                  setCursorHistory([
                    null,
                  ]);
                }}
              />
            </div>

            {/* RESULTS */}

            <div className="filter-field">
              <label htmlFor="log-limit">
                RESULTS
              </label>

              <select
                id="log-limit"
                value={limit}
                disabled={
                  isOffline
                }
                onChange={
                  changeLimit
                }
              >
                <option value={25}>
                  25
                </option>

                <option value={50}>
                  50
                </option>

                <option value={100}>
                  100
                </option>

                <option value={250}>
                  250
                </option>

                <option value={500}>
                  500
                </option>
              </select>
            </div>
          </div>

          <div className="filter-actions">
            <div className="filter-status">
              {isOffline
                ? "BACKEND OFFLINE"
                : hasFilters
                  ? "FILTERS ACTIVE"
                  : "ALL LOGS"}
            </div>

            <button
              type="button"
              className="clear-filters"
              onClick={
                clearFilters
              }
              disabled={
                !hasFilters ||
                isOffline
              }
            >
              CLEAR FILTERS
            </button>
          </div>
        </section>

        {/* =================================================
            LOG TABLE
        ================================================= */}

        <section className="panel logs-panel">
          <div className="panel-header logs-header">
            <div>
              <span>
                STREAM
              </span>

              <h3>
                {isOffline
                  ? "Backend unavailable"
                  : loading
                    ? "Loading logs..."
                    : "Log events"}
              </h3>
            </div>

            <span className="log-count">
              {isOffline
                ? "OFFLINE"
                : loading
                  ? "—"
                  : `${logs.length} EVENTS`}
            </span>
          </div>

          {/* OFFLINE */}

          {isOffline && (
            <div className="empty-state logs-offline-state">
              <span className="status-dot status-offline" />

              <strong>
                BACKEND OFFLINE
              </strong>

              <p>
                No log data can be
                loaded while the
                backend is
                unavailable.
              </p>
            </div>
          )}

          {/* LOADING */}

          {!isOffline &&
            loading && (
              <div className="empty-state">
                Loading logs from
                backend...
              </div>
            )}

          {/* ERROR */}

          {!isOffline &&
            !loading &&
            error && (
              <div className="empty-state error-state">
                {error}
              </div>
            )}

          {/* EMPTY */}

          {!isOffline &&
            !loading &&
            !error &&
            logs.length === 0 && (
              <div className="empty-state">
                No logs match the
                current filters.
              </div>
            )}

          {/* TABLE */}

          {!isOffline &&
            !loading &&
            !error &&
            logs.length > 0 && (
              <div className="log-table logs-explorer-table">
                <div className="log-table-head">
                  <span>
                    TIME
                  </span>

                  <span>
                    LEVEL
                  </span>

                  <span>
                    SERVICE
                  </span>

                  <span>
                    MESSAGE
                  </span>

                  <span>
                    ATTRIBUTES
                  </span>
                </div>

                {logs.map(
                  (log) => (
                    <div
                      className="log-row"
                      key={log.id}
                    >
                      {/* TIME */}

                      <time
                        title={new Date(
                          log.timestamp
                        ).toISOString()}
                      >
                        {new Date(
                          log.timestamp
                        ).toLocaleString(
                          [],
                          {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          }
                        )}
                      </time>

                      {/* LEVEL */}

                      <span
                        className={`level level-${log.level.toLowerCase()}`}
                      >
                        {log.level.toUpperCase()}
                      </span>

                      {/* SERVICE */}

                      <span className="service">
                        {log.service}
                      </span>

                      {/* MESSAGE */}

                      <p
                        className="log-message"
                        title={
                          log.message
                        }
                      >
                        {
                          log.message
                        }
                      </p>

                      {/* ATTRIBUTES */}

                      <code className="log-attributes">
                        {Object.keys(
                          log.attributes ??
                            {}
                        ).length >
                        0
                          ? JSON.stringify(
                              log.attributes
                            )
                          : "—"}
                      </code>
                    </div>
                  )
                )}
              </div>
            )}

          {/* =================================================
              PAGINATION
          ================================================= */}

          {!isOffline &&
            !loading &&
            !error &&
            logs.length > 0 && (
              <div className="pagination">
                <div className="pagination-info">
                  PAGE{" "}
                  <strong>
                    {pageIndex +
                      1}
                  </strong>

                  <span>
                    •
                  </span>

                  {logs.length}{" "}
                  RESULTS
                </div>

                <div className="pagination-actions">
                  <button
                    type="button"
                    onClick={
                      goPrevious
                    }
                    disabled={
                      pageIndex ===
                        0 ||
                      loading
                    }
                  >
                    ← PREVIOUS
                  </button>

                  <button
                    type="button"
                    onClick={
                      goNext
                    }
                    disabled={
                      !nextCursor ||
                      loading
                    }
                  >
                    NEXT →
                  </button>
                </div>
              </div>
            )}
        </section>
      </div>
    </main>
  );
}

export default LogsPage;