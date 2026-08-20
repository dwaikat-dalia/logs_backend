
import { useEffect, useMemo, useState } from "react";
import "./AnalyticsPage.css";

type AggregateBucket = {
  start: string;
  group: string | null;
  count: number;
};

type AggregateResponse = {
  buckets: AggregateBucket[];
};

type Log = {
  id: string;
  timestamp: string;
  level: string;
  service: string;
  message: string;
  attributes: Record<string, unknown>;
  createdAt: string;
};

type BucketSize = "1m" | "5m" | "1h" | "1d";
type GroupBy = "none" | "service" | "level";

type BackendStatus = "online" | "offline";

type AnalyticsPageProps = {
  backendStatus: BackendStatus;
};

const API_URL = "http://localhost:8080";

function AnalyticsPage({
  backendStatus,
}: AnalyticsPageProps) {
  const [bucket, setBucket] =
    useState<BucketSize>("1h");

  const [groupBy, setGroupBy] =
    useState<GroupBy>("none");

  const [data, setData] =
    useState<AggregateBucket[]>([]);

  const [logs, setLogs] =
    useState<Log[]>([]);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const isOffline =
    backendStatus === "offline";

  /* =========================================================
     LOAD ANALYTICS
  ========================================================= */

  useEffect(() => {
    if (backendStatus === "online") {
      loadAnalytics();
    } else {
      setData([]);
      setLogs([]);
      setError("");
      setLoading(false);
    }
  }, [backendStatus, bucket, groupBy]);

  async function loadAnalytics() {
    try {
      setLoading(true);
      setError("");

      const until = new Date();

      const since = new Date(
        until.getTime() -
          24 * 60 * 60 * 1000
      );

      const params = new URLSearchParams({
        since: since.toISOString(),
        until: until.toISOString(),
        bucket,
      });

      if (groupBy !== "none") {
        params.set(
          "group_by",
          groupBy
        );
      }

      const response = await fetch(
        `${API_URL}/logs/aggregate?${params.toString()}`,
        {
          cache: "no-store",
        }
      );

      if (!response.ok) {
        throw new Error(
          `Analytics request failed with status ${response.status}`
        );
      }

      const result: AggregateResponse =
        await response.json();

      setData(result.buckets ?? []);

      /*
        Recent logs are used for
        service/level summaries.
      */

      const logsResponse = await fetch(
        `${API_URL}/logs?limit=1000`,
        {
          cache: "no-store",
        }
      );

      if (logsResponse.ok) {
        const logsData =
          await logsResponse.json();

        setLogs(
          logsData.logs ?? []
        );
      } else {
        setLogs([]);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load analytics"
      );

      setData([]);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }

  /* =========================================================
     TIME SERIES
  ========================================================= */

  const timeSeries = useMemo(() => {
    /*
      When group_by is selected, several rows can
      have the same timestamp.

      Combine them into one total bucket
      for the main Events over time chart.
    */

    const map =
      new Map<string, number>();

    for (const item of data) {
      const key = item.start;

      map.set(
        key,
        (map.get(key) ?? 0) +
          Number(item.count)
      );
    }

    return Array.from(
      map.entries()
    )
      .map(([start, count]) => ({
        start,
        count,
      }))
      .sort(
        (a, b) =>
          new Date(a.start).getTime() -
          new Date(b.start).getTime()
      );
  }, [data]);

  /* =========================================================
     CHART BARS
  ========================================================= */

  const chartBars = useMemo(() => {
    /*
      Only fill missing hours automatically
      for the default 1h view.
    */

    if (bucket !== "1h") {
      return timeSeries;
    }

    const now = new Date();

    const currentHour =
      new Date(now);

    currentHour.setMinutes(
      0,
      0,
      0
    );

    const bars: {
      start: string;
      count: number;
    }[] = [];

    for (
      let i = 23;
      i >= 0;
      i--
    ) {
      const hour =
        new Date(currentHour);

      hour.setHours(
        currentHour.getHours() -
          i
      );

      const matching =
        timeSeries.find(
          (item) => {
            const date =
              new Date(item.start);

            return (
              date.getFullYear() ===
                hour.getFullYear() &&
              date.getMonth() ===
                hour.getMonth() &&
              date.getDate() ===
                hour.getDate() &&
              date.getHours() ===
                hour.getHours()
            );
          }
        );

      bars.push({
        start:
          hour.toISOString(),
        count:
          matching?.count ?? 0,
      });
    }

    return bars;
  }, [
    timeSeries,
    bucket,
  ]);

  /* =========================================================
     TOTAL EVENTS
  ========================================================= */

  const totalEvents = useMemo(() => {
    return chartBars.reduce(
      (sum, item) =>
        sum + item.count,
      0
    );
  }, [chartBars]);

  /* =========================================================
     PEAK
  ========================================================= */

  const peak = useMemo(() => {
    if (chartBars.length === 0) {
      return {
        count: 0,
        start:
          null as string | null,
      };
    }

    return chartBars.reduce(
      (max, item) =>
        item.count > max.count
          ? item
          : max,
      chartBars[0]
    );
  }, [chartBars]);

  /* =========================================================
     AVERAGE
  ========================================================= */

  const average = useMemo(() => {
    if (chartBars.length === 0) {
      return 0;
    }

    return Math.round(
      totalEvents /
        chartBars.length
    );
  }, [
    chartBars,
    totalEvents,
  ]);

  /* =========================================================
     MAX CHART COUNT
  ========================================================= */

  const maxCount = useMemo(() => {
    return Math.max(
      ...chartBars.map(
        (item) => item.count
      ),
      1
    );
  }, [chartBars]);

  /* =========================================================
     SERVICE DISTRIBUTION
  ========================================================= */

  const serviceDistribution =
    useMemo(() => {
      const map =
        new Map<string, number>();

      for (const log of logs) {
        map.set(
          log.service,
          (map.get(
            log.service
          ) ?? 0) + 1
        );
      }

      return Array.from(
        map.entries()
      )
        .map(
          ([name, count]) => ({
            name,
            count,
          })
        )
        .sort(
          (a, b) =>
            b.count - a.count
        )
        .slice(0, 8);
    }, [logs]);

  const maxServiceCount =
    Math.max(
      ...serviceDistribution.map(
        (item) => item.count
      ),
      1
    );

  /* =========================================================
     LEVEL DISTRIBUTION
  ========================================================= */

  const levelDistribution =
    useMemo(() => {
      const map =
        new Map<string, number>();

      for (const log of logs) {
        const level =
          log.level.toLowerCase();

        map.set(
          level,
          (map.get(level) ?? 0) +
            1
        );
      }

      return Array.from(
        map.entries()
      )
        .map(
          ([level, count]) => ({
            level,
            count,
          })
        )
        .sort(
          (a, b) =>
            b.count - a.count
        );
    }, [logs]);

  const maxLevelCount =
    Math.max(
      ...levelDistribution.map(
        (item) => item.count
      ),
      1
    );

  /* =========================================================
     HELPERS
  ========================================================= */

  function formatNumber(
    value: number
  ) {
    return value.toLocaleString();
  }

  function formatTime(
    value: string
  ) {
    return new Date(
      value
    ).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDateTime(
    value: string
  ) {
    return new Date(
      value
    ).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatPeakTime(
    value: string | null
  ) {
    if (!value) {
      return "—";
    }

    return formatDateTime(
      value
    );
  }

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <main className="main">

      {/* =====================================================
          TOPBAR
      ===================================================== */}

      <header className="topbar">

        <div>
          <span className="eyebrow">
            LOG INGESTION SERVICE
          </span>

          <h2>
            Analytics
          </h2>
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
            INTRO
        ================================================= */}

        <section className="welcome">

          <div>

            <span className="section-number">
              03
            </span>

            <div>

              <p>
                ANALYSIS
              </p>

              <h3>
                Understand your log activity.
              </h3>

            </div>

          </div>

          <div className="gold-line" />

        </section>

        {/* =================================================
            OFFLINE WARNING
        ================================================= */}

        {isOffline && (
          <section className="panel analytics-error">

            <div className="logs-offline-content">

              <span className="status-dot status-offline" />

              <div>

                <strong>
                  BACKEND OFFLINE
                </strong>

                <p>
                  Unable to connect to
                  localhost:8080.
                  Start the backend service
                  to load analytics.
                </p>

              </div>

            </div>

          </section>
        )}

        {/* =================================================
            FILTERS
        ================================================= */}

        <section className="panel analytics-controls">

          <div className="panel-header">

            <div>

              <span>
                QUERY
              </span>

              <h3>
                Analytics filters
              </h3>

            </div>

            <div className="api-badge">
              GET /logs/aggregate
            </div>

          </div>

          <div className="analytics-control-grid">

            {/* TIME BUCKET */}

            <div className="analytics-control">

              <label>
                TIME BUCKET
              </label>

              <select
                value={bucket}
                disabled={isOffline}
                onChange={(event) =>
                  setBucket(
                    event.target
                      .value as BucketSize
                  )
                }
              >

                <option value="1m">
                  1 minute
                </option>

                <option value="5m">
                  5 minutes
                </option>

                <option value="1h">
                  1 hour
                </option>

                <option value="1d">
                  1 day
                </option>

              </select>

            </div>

            {/* GROUP BY */}

            <div className="analytics-control">

              <label>
                GROUP BY
              </label>

              <select
                value={groupBy}
                disabled={isOffline}
                onChange={(event) =>
                  setGroupBy(
                    event.target
                      .value as GroupBy
                  )
                }
              >

                <option value="none">
                  Total events
                </option>

                <option value="service">
                  Service
                </option>

                <option value="level">
                  Level
                </option>

              </select>

            </div>

          </div>

        </section>

        {/* =================================================
            ERROR
        ================================================= */}

        {!isOffline &&
          error && (
            <div className="panel analytics-error">
              {error}
            </div>
          )}

        {/* =================================================
            KEY METRICS
        ================================================= */}

        <section className="analytics-metrics">

          <article className="analytics-metric primary">

            <span>
              TOTAL EVENTS
            </span>

            <strong>
              {isOffline ||
              loading
                ? "—"
                : formatNumber(
                    totalEvents
                  )}
            </strong>

            <small>
              last 24 hours
            </small>

          </article>

          <article className="analytics-metric">

            <span>
              PEAK ACTIVITY
            </span>

            <strong>
              {isOffline ||
              loading
                ? "—"
                : formatNumber(
                    peak.count
                  )}
            </strong>

            <small>
              events in one bucket
            </small>

          </article>

          <article className="analytics-metric">

            <span>
              AVERAGE
            </span>

            <strong>
              {isOffline ||
              loading
                ? "—"
                : formatNumber(
                    average
                  )}
            </strong>

            <small>
              events per bucket
            </small>

          </article>

          <article className="analytics-metric">

            <span>
              PEAK TIME
            </span>

            <strong className="top-service-name">
              {isOffline ||
              loading
                ? "—"
                : formatPeakTime(
                    peak.start
                  )}
            </strong>

            <small>
              highest activity period
            </small>

          </article>

        </section>

        {/* =================================================
            EVENTS OVER TIME
        ================================================= */}

        <section className="panel analytics-chart-panel">

          <div className="panel-header">

            <div>

              <span>
                TIME SERIES
              </span>

              <h3>
                Events over time
              </h3>

            </div>

            <span className="chart-range">
              LAST 24 HOURS
            </span>

          </div>

          {isOffline ? (

            <div className="analytics-empty">

              <span className="status-dot status-offline" />

              <strong>
                Backend offline
              </strong>

              <p>
                Start the backend to
                view activity.
              </p>

            </div>

          ) : loading ? (

            <div className="analytics-empty">
              Loading activity...
            </div>

          ) : chartBars.length === 0 ? (

            <div className="analytics-empty">
              No events found for this time range.
            </div>

          ) : (

            <div className="chart-wrapper">

              <div className="chart-bars">

                {chartBars.map(
                  (item, index) => {

                    const height =
                      item.count === 0
                        ? 3
                        : Math.max(
                            8,
                            (item.count /
                              maxCount) *
                              100
                          );

                    return (
                      <div
                        className="chart-bar-wrapper"
                        key={`${item.start}-${index}`}
                        title={`${formatDateTime(
                          item.start
                        )} — ${formatNumber(
                          item.count
                        )} events`}
                      >

                        <span
                          className="chart-bar"
                          style={{
                            height:
                              `${height}%`,
                          }}
                        />

                      </div>
                    );
                  }
                )}

              </div>

              <div className="chart-footer">

                <span>
                  {chartBars.length > 0
                    ? formatTime(
                        chartBars[0].start
                      )
                    : ""}
                </span>

                <span>
                  PEAK:{" "}
                  {formatNumber(
                    peak.count
                  )} EVENTS
                </span>

                <span>
                  {chartBars.length > 0
                    ? formatTime(
                        chartBars[
                          chartBars.length -
                            1
                        ].start
                      )
                    : ""}
                </span>

              </div>

            </div>

          )}

        </section>

        {/* =================================================
            BREAKDOWNS
        ================================================= */}

        <section className="analytics-breakdown-grid">

          {/* SERVICE */}

          <div className="panel breakdown-panel">

            <div className="panel-header">

              <div>

                <span>
                  DISTRIBUTION
                </span>

                <h3>
                  By service
                </h3>

              </div>

              <span className="api-badge">
                TOP SERVICES
              </span>

            </div>

            {isOffline ? (

              <div className="analytics-empty">
                Backend offline.
              </div>

            ) : serviceDistribution.length ===
              0 ? (

              <div className="analytics-empty">
                No service data available.
              </div>

            ) : (

              <div className="distribution-list">

                {serviceDistribution.map(
                  (item) => {

                    const width =
                      (item.count /
                        maxServiceCount) *
                      100;

                    return (
                      <div
                        className="distribution-item"
                        key={item.name}
                      >

                        <div className="distribution-top">

                          <span>
                            {item.name}
                          </span>

                          <strong>
                            {formatNumber(
                              item.count
                            )}
                          </strong>

                        </div>

                        <div className="distribution-track">

                          <span
                            style={{
                              width:
                                `${width}%`,
                            }}
                          />

                        </div>

                        <small>
                          {totalEvents > 0
                            ? `${Math.round(
                                (item.count /
                                  totalEvents) *
                                  100
                              )}% of events`
                            : "—"}
                        </small>

                      </div>
                    );
                  }
                )}

              </div>

            )}

          </div>

          {/* LEVEL */}

          <div className="panel breakdown-panel">

            <div className="panel-header">

              <div>

                <span>
                  DISTRIBUTION
                </span>

                <h3>
                  By level
                </h3>

              </div>

              <span className="api-badge">
                LOG LEVELS
              </span>

            </div>

            {isOffline ? (

              <div className="analytics-empty">
                Backend offline.
              </div>

            ) : levelDistribution.length ===
              0 ? (

              <div className="analytics-empty">
                No level data available.
              </div>

            ) : (

              <div className="distribution-list">

                {levelDistribution.map(
                  (item) => {

                    const width =
                      (item.count /
                        maxLevelCount) *
                      100;

                    return (
                      <div
                        className="distribution-item"
                        key={item.level}
                      >

                        <div className="distribution-top">

                          <span
                            className={`analytics-level analytics-level-${item.level}`}
                          >
                            {item.level.toUpperCase()}
                          </span>

                          <strong>
                            {formatNumber(
                              item.count
                            )}
                          </strong>

                        </div>

                        <div className="distribution-track">

                          <span
                            style={{
                              width:
                                `${width}%`,
                            }}
                          />

                        </div>

                        <small>
                          {totalEvents > 0
                            ? `${Math.round(
                                (item.count /
                                  totalEvents) *
                                  100
                              )}% of events`
                            : "—"}
                        </small>

                      </div>
                    );
                  }
                )}

              </div>

            )}

          </div>

        </section>

      </div>

    </main>
  );
}

export default AnalyticsPage;

