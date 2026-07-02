import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Papa from "papaparse";
import {
  RefreshCw,
  Package,
  CheckCircle2,
  XCircle,
  Boxes,
  Users,
  Warehouse,
  Timer,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from "recharts";

/* =========================================================================
 * Warehouse Picklist Dashboard  —  single-file React app
 * Data source: public Google Sheet fetched as CSV via gviz endpoint.
 * ========================================================================= */

// ---------- Config ----------------------------------------------------------
const SHEET_ID = "1VGcAyTHOepHiUQuXVmJCLrbbnx2Mx4eF1XqUwbDcJNA";
const GID = "0";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`;
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${GID}#gid=${GID}`;

// ---------- Types -----------------------------------------------------------
interface Row {
  source_warehouse: string;
  TL_ID: string;
  bin_id: string;
  Floor: string;
  fsn: string;
  picklist_created_at: string;
  picklist_assigned_to: string;
  picklist_item_updated_at: string;
  picklist_status: string;
  IRT_type: string;
  reservation_item_status: string;
  quantity: number;
  wid: string;
  cms_vertical: string;
  destination_id: string;
  Date: string;
  Hour: number;
  Pathway: string;
  Aisle: string;
  Key: string;
  Key2: string;
  Qty: number;
  Shift: string;
  destination_type: string;
  _createdAt?: Date | null;
  _updatedAt?: Date | null;
  _cycleMins?: number | null;
}

interface FilterState {
  warehouse: string;
  floor: string;
  shift: string;
  status: string;
  irt: string;
  vertical: string;
  destType: string;
  search: string;
}

const emptyFilters: FilterState = {
  warehouse: "",
  floor: "",
  shift: "",
  status: "",
  irt: "",
  vertical: "",
  destType: "",
  search: "",
};

// ---------- Helpers ---------------------------------------------------------
function parseDateTime(v: string): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function fetchRows(): Promise<Row[]> {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Failed to fetch sheet: ${res.status}`);
  const text = await res.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const rows: Row[] = (parsed.data || [])
    .map((r) => {
      const norm: Record<string, string> = {};
      for (const k of Object.keys(r)) norm[k.trim()] = (r[k] ?? "").toString().trim();
      const created = parseDateTime(norm["picklist_created_at"]);
      const updated = parseDateTime(norm["picklist_item_updated_at"]);
      const cycle =
        created && updated
          ? Math.max(0, (updated.getTime() - created.getTime()) / 60000)
          : null;

      return {
        source_warehouse: norm["source_warehouse"] || "",
        TL_ID: norm["TL_ID"] || "",
        bin_id: norm["bin_id"] || "",
        Floor: norm["Floor"] || norm["Floor_1"] || "",
        fsn: norm["fsn"] || "",
        picklist_created_at: norm["picklist_created_at"] || "",
        picklist_assigned_to: norm["picklist_assigned_to"] || "",
        picklist_item_updated_at: norm["picklist_item_updated_at"] || "",
        picklist_status: norm["picklist_status"] || "",
        IRT_type: norm["IRT_type"] || "",
        reservation_item_status: norm["reservation_item_status"] || "",
        quantity: Number(norm["quantity"]) || 0,
        wid: norm["wid"] || "",
        cms_vertical: norm["cms_vertical"] || "",
        destination_id: norm["destination_id"] || "",
        Date: norm["Date"] || "",
        Hour: Number(norm["Hour"]) || 0,
        Pathway: norm["Pathway"] || "",
        Aisle: norm["Aisle"] || "",
        Key: norm["Key"] || "",
        Key2: norm["Key2"] || "",
        Qty: Number(norm["Qty"]) || 0,
        Shift: norm["Shift"] || "",
        destination_type: norm["destination_type"] || "",
        _createdAt: created,
        _updatedAt: updated,
        _cycleMins: cycle,
      };
    })
    .filter((r) => r.TL_ID || r.fsn);

  return rows;
}

function groupCount<T extends string | number>(
  rows: Row[],
  key: (r: Row) => T | undefined | null,
  qty: (r: Row) => number = (r) => r.quantity || 0
) {
  const map = new Map<T, { count: number; qty: number }>();
  for (const r of rows) {
    const k = key(r);
    if (k === undefined || k === null || (k as unknown) === "") continue;
    const cur = map.get(k as T) || { count: 0, qty: 0 };
    cur.count += 1;
    cur.qty += qty(r);
    map.set(k as T, cur);
  }
  return Array.from(map.entries()).map(([k, v]) => ({
    name: String(k),
    count: v.count,
    qty: v.qty,
  }));
}

function topN<T extends { count: number }>(arr: T[], n: number): T[] {
  return [...arr].sort((a, b) => b.count - a.count).slice(0, n);
}

function formatNumber(n: number): string {
  if (!isFinite(n)) return "-";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function formatMins(m: number | null | undefined): string {
  if (m == null || !isFinite(m)) return "-";
  if (m < 60) return `${m.toFixed(0)}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return `${h}h ${rem}m`;
}

function uniqueSorted(rows: Row[], key: keyof Row): string[] {
  const s = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (v !== undefined && v !== null && v !== "") s.add(String(v));
  }
  return Array.from(s).sort();
}

function applyFilters(rows: Row[], f: FilterState): Row[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.warehouse && r.source_warehouse !== f.warehouse) return false;
    if (f.floor && r.Floor !== f.floor) return false;
    if (f.shift && r.Shift !== f.shift) return false;
    if (f.status && r.picklist_status !== f.status) return false;
    if (f.irt && r.IRT_type !== f.irt) return false;
    if (f.vertical && r.cms_vertical !== f.vertical) return false;
    if (f.destType && r.destination_type !== f.destType) return false;
    if (q) {
      const hay =
        `${r.fsn} ${r.TL_ID} ${r.bin_id} ${r.wid} ${r.destination_id} ${r.picklist_assigned_to}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---------- Small UI atoms --------------------------------------------------
const CHART_COLORS = [
  "#60a5fa", "#34d399", "#fbbf24", "#f87171", "#a78bfa",
  "#22d3ee", "#f472b6", "#facc15", "#4ade80", "#fb7185",
];

const tooltipStyle = {
  backgroundColor: "#0f172a",
  border: "1px solid #334155",
  borderRadius: "8px",
  color: "#e2e8f0",
  fontSize: "12px",
};

const kpiAccent: Record<string, string> = {
  blue: "from-blue-500/20 to-blue-500/5 text-blue-300 border-blue-500/30",
  green: "from-emerald-500/20 to-emerald-500/5 text-emerald-300 border-emerald-500/30",
  amber: "from-amber-500/20 to-amber-500/5 text-amber-300 border-amber-500/30",
  rose: "from-rose-500/20 to-rose-500/5 text-rose-300 border-rose-500/30",
  violet: "from-violet-500/20 to-violet-500/5 text-violet-300 border-violet-500/30",
  cyan: "from-cyan-500/20 to-cyan-500/5 text-cyan-300 border-cyan-500/30",
};

function Kpi({
  label, value, sub, icon, accent = "blue",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ReactNode;
  accent?: keyof typeof kpiAccent;
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl border bg-gradient-to-br p-4 backdrop-blur-sm ${kpiAccent[accent]}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider opacity-80">{label}</div>
          <div className="mt-2 text-2xl font-bold text-white">{value}</div>
          {sub && <div className="mt-1 text-xs opacity-70">{sub}</div>}
        </div>
        {icon && <div className="opacity-70">{icon}</div>}
      </div>
    </div>
  );
}

function ChartCard({
  title, subtitle, children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
      <div className="h-64 w-full">{children}</div>
    </div>
  );
}

function BarChartCard({
  title, subtitle, data, color = "#60a5fa", layout = "horizontal",
}: {
  title: string;
  subtitle?: string;
  data: { name: string; count: number }[];
  color?: string;
  layout?: "horizontal" | "vertical";
}) {
  return (
    <ChartCard title={title} subtitle={subtitle}>
      <ResponsiveContainer>
        <BarChart data={data} layout={layout} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          {layout === "horizontal" ? (
            <>
              <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={60} />
              <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
            </>
          ) : (
            <>
              <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} width={140} />
            </>
          )}
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#33415533" }} />
          <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function PieChartCard({
  title, subtitle, data,
}: {
  title: string;
  subtitle?: string;
  data: { name: string; count: number }[];
}) {
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <ChartCard title={title} subtitle={subtitle}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={90}
            innerRadius={45}
            paddingAngle={2}
            label={(props: { name?: string; value?: number }) =>
              total ? `${props.name} (${(((props.value ?? 0) / total) * 100).toFixed(0)}%)` : (props.name ?? "")
            }
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="#0f172a" />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function LineChartCard({
  title, subtitle, data, lines,
}: {
  title: string;
  subtitle?: string;
  data: Record<string, string | number>[];
  lines: { key: string; color: string; label: string }[];
}) {
  return (
    <ChartCard title={title} subtitle={subtitle}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12, color: "#cbd5e1" }} />
          {lines.map((l) => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={l.color} strokeWidth={2} dot={{ r: 3 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// ---------- Filters bar -----------------------------------------------------
function Filters({
  rows, filters, setFilters,
}: {
  rows: Row[];
  filters: FilterState;
  setFilters: (f: FilterState) => void;
}) {
  const options = {
    warehouse: uniqueSorted(rows, "source_warehouse"),
    floor: uniqueSorted(rows, "Floor"),
    shift: uniqueSorted(rows, "Shift"),
    status: uniqueSorted(rows, "picklist_status"),
    irt: uniqueSorted(rows, "IRT_type"),
    vertical: uniqueSorted(rows, "cms_vertical"),
    destType: uniqueSorted(rows, "destination_type"),
  };

  const update = (k: keyof FilterState, v: string) => setFilters({ ...filters, [k]: v });

  const select = (label: string, key: keyof FilterState, opts: string[]) => (
    <div className="flex flex-col">
      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</label>
      <select
        value={filters[key]}
        onChange={(e) => update(key, e.target.value)}
        className="mt-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1.5 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
      >
        <option value="">All</option>
        {opts.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );

  const activeCount = Object.values(filters).filter((v) => v !== "").length;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Filters</h3>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">
              {activeCount} active
            </span>
          )}
          <button
            onClick={() => setFilters(emptyFilters)}
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            Reset
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        {select("Warehouse", "warehouse", options.warehouse)}
        {select("Floor", "floor", options.floor)}
        {select("Shift", "shift", options.shift)}
        {select("Status", "status", options.status)}
        {select("IRT Type", "irt", options.irt)}
        {select("Vertical", "vertical", options.vertical)}
        {select("Dest Type", "destType", options.destType)}
        <div className="flex flex-col col-span-2 md:col-span-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Search</label>
          <input
            value={filters.search}
            onChange={(e) => update("search", e.target.value)}
            placeholder="FSN, TL_ID, bin..."
            className="mt-1 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}

// ---------- Data table ------------------------------------------------------
const tableColumns: { key: keyof Row | "_cycleMins"; label: string }[] = [
  { key: "picklist_created_at", label: "Created" },
  { key: "TL_ID", label: "TL ID" },
  { key: "fsn", label: "FSN" },
  { key: "bin_id", label: "Bin" },
  { key: "Floor", label: "Floor" },
  { key: "cms_vertical", label: "Vertical" },
  { key: "IRT_type", label: "IRT" },
  { key: "picklist_status", label: "Status" },
  { key: "reservation_item_status", label: "Reservation" },
  { key: "quantity", label: "Qty" },
  { key: "Shift", label: "Shift" },
  { key: "destination_id", label: "Destination" },
  { key: "picklist_assigned_to", label: "Assignee" },
  { key: "_cycleMins", label: "Cycle" },
];

const statusColor: Record<string, string> = {
  COMPLETED: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  PENDING: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  ASSIGNED: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  CANCELLED: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  cancelled: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  sent_for_planning: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
};

function statusPill(v: string) {
  const cls = statusColor[v] || "bg-slate-700/40 text-slate-300 border-slate-600";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {v || "-"}
    </span>
  );
}

function DataTable({ rows }: { rows: Row[] }) {
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = page * pageSize;
  const paged = useMemo(() => rows.slice(start, start + pageSize), [rows, start]);

  useEffect(() => { setPage(0); }, [rows]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-100">
          Records <span className="text-slate-400">({total.toLocaleString()})</span>
        </h3>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <button
            className="rounded-md border border-slate-700 px-2 py-1 disabled:opacity-40"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Prev
          </button>
          <span>Page {page + 1} / {pageCount}</span>
          <button
            className="rounded-md border border-slate-700 px-2 py-1 disabled:opacity-40"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next →
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-800/50 text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              {tableColumns.map((c) => (
                <th key={String(c.key)} className="whitespace-nowrap px-3 py-2 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((r, i) => (
              <tr key={i} className="border-t border-slate-800/60 hover:bg-slate-800/40">
                {tableColumns.map((c) => {
                  const raw = (r as unknown as Record<string, unknown>)[c.key as string];
                  let cell: ReactNode = raw as ReactNode;
                  if (c.key === "picklist_status" || c.key === "reservation_item_status") {
                    cell = statusPill(String(raw ?? ""));
                  } else if (c.key === "_cycleMins") {
                    cell = formatMins(raw as number | null);
                  } else if (raw === "" || raw == null) {
                    cell = <span className="text-slate-600">—</span>;
                  }
                  return (
                    <td key={String(c.key)} className="whitespace-nowrap px-3 py-2 text-slate-200">
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={tableColumns.length} className="px-3 py-10 text-center text-slate-500">
                  No records match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Main App --------------------------------------------------------
export default function App() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchRows();
      setRows(r);
      setLastRefreshed(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  const kpis = useMemo(() => {
    const totalItems = filtered.length;
    const totalQty = filtered.reduce((s, r) => s + (r.quantity || 0), 0);
    const completed = filtered.filter((r) => r.picklist_status === "COMPLETED").length;
    const cancelled = filtered.filter(
      (r) => r.reservation_item_status?.toLowerCase() === "cancelled"
    ).length;
    const uniquePicklists = new Set(filtered.map((r) => r.TL_ID).filter(Boolean)).size;
    const uniqueBins = new Set(filtered.map((r) => r.bin_id).filter(Boolean)).size;
    const uniquePickers = new Set(
      filtered.map((r) => r.picklist_assigned_to?.toLowerCase()).filter(Boolean)
    ).size;
    const uniqueWarehouses = new Set(filtered.map((r) => r.source_warehouse).filter(Boolean)).size;
    const cycles = filtered.map((r) => r._cycleMins).filter((v): v is number => v != null && isFinite(v));
    const avgCycle = cycles.length ? cycles.reduce((s, v) => s + v, 0) / cycles.length : 0;
    const compRate = totalItems ? (completed / totalItems) * 100 : 0;
    return { totalItems, totalQty, completed, cancelled, uniquePicklists, uniqueBins, uniquePickers, uniqueWarehouses, avgCycle, compRate };
  }, [filtered]);

  const byStatus = useMemo(() => topN(groupCount(filtered, (r) => r.picklist_status), 8), [filtered]);
  const byShift = useMemo(() => groupCount(filtered, (r) => r.Shift), [filtered]);
  const byFloor = useMemo(() => groupCount(filtered, (r) => r.Floor), [filtered]);
  const byIRT = useMemo(() => groupCount(filtered, (r) => r.IRT_type), [filtered]);
  const byVertical = useMemo(() => topN(groupCount(filtered, (r) => r.cms_vertical), 10), [filtered]);
  const byDest = useMemo(() => topN(groupCount(filtered, (r) => r.destination_id), 10), [filtered]);
  const byPathway = useMemo(() => topN(groupCount(filtered, (r) => r.Pathway), 10), [filtered]);
  const topPickers = useMemo(
    () => topN(groupCount(filtered, (r) => r.picklist_assigned_to?.toUpperCase()), 10),
    [filtered]
  );

  const byHour = useMemo(() => {
    const map = new Map<number, { name: string; Day: number; Night: number; total: number }>();
    for (let h = 0; h < 24; h++) {
      map.set(h, { name: String(h).padStart(2, "0") + ":00", Day: 0, Night: 0, total: 0 });
    }
    for (const r of filtered) {
      const h = Number(r.Hour);
      if (!isFinite(h) || h < 0 || h > 23) continue;
      const bucket = map.get(h)!;
      bucket.total += 1;
      if (r.Shift === "Day") bucket.Day += 1;
      else if (r.Shift === "Night") bucket.Night += 1;
    }
    return Array.from(map.values());
  }, [filtered]);

  const byDate = useMemo(() => {
    const g = groupCount(filtered, (r) => r.Date);
    return g
      .map((d) => {
        const [dd, mm, yy] = d.name.split("-").map(Number);
        const t = new Date(yy, (mm || 1) - 1, dd || 1).getTime();
        return { ...d, _t: t };
      })
      .sort((a, b) => a._t - b._t)
      .map(({ _t: _ignored, ...rest }) => { void _ignored; return rest; });
  }, [filtered]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-950/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 shadow-lg shadow-blue-500/30">
              <Warehouse className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Warehouse Picklist Dashboard</h1>
              <p className="text-xs text-slate-400">Live monitoring of pick operations, cycle times & performance</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastRefreshed && (
              <span className="text-xs text-slate-400">Updated {lastRefreshed.toLocaleTimeString()}</span>
            )}
            <a
              href={SHEET_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Source Sheet
            </a>
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow hover:bg-blue-500 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-5 px-6 py-6">
        {error && (
          <div className="flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div>
              <div className="font-semibold">Could not load data</div>
              <div className="mt-1 text-rose-200/80">{error}</div>
              <div className="mt-2 text-xs text-rose-200/60">
                Make sure the Google Sheet is shared publicly ("Anyone with the link").
              </div>
            </div>
          </div>
        )}

        {/* KPI row */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Total Items" value={formatNumber(kpis.totalItems)} sub={`${formatNumber(kpis.totalQty)} qty`} icon={<Package className="h-5 w-5" />} accent="blue" />
          <Kpi label="Completed" value={formatNumber(kpis.completed)} sub={`${kpis.compRate.toFixed(1)}% completion rate`} icon={<CheckCircle2 className="h-5 w-5" />} accent="green" />
          <Kpi label="Cancelled Items" value={formatNumber(kpis.cancelled)} sub="reservation cancelled" icon={<XCircle className="h-5 w-5" />} accent="rose" />
          <Kpi label="Picklists" value={formatNumber(kpis.uniquePicklists)} sub={`${formatNumber(kpis.uniqueBins)} unique bins`} icon={<Boxes className="h-5 w-5" />} accent="violet" />
          <Kpi label="Pickers" value={formatNumber(kpis.uniquePickers)} sub={`${kpis.uniqueWarehouses} warehouses`} icon={<Users className="h-5 w-5" />} accent="cyan" />
          <Kpi label="Avg Cycle Time" value={formatMins(kpis.avgCycle)} sub="created → updated" icon={<Timer className="h-5 w-5" />} accent="amber" />
        </section>

        {/* Filters */}
        <Filters rows={rows} filters={filters} setFilters={setFilters} />

        {/* Charts row 1 */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <LineChartCard
            title="Hourly Activity"
            subtitle="Picks per hour split by shift"
            data={byHour}
            lines={[
              { key: "Day", color: "#fbbf24", label: "Day" },
              { key: "Night", color: "#60a5fa", label: "Night" },
              { key: "total", color: "#a78bfa", label: "Total" },
            ]}
          />
          <PieChartCard title="Picklist Status" data={byStatus} />
          <PieChartCard title="IRT Type Mix" data={byIRT} />
        </section>

        {/* Charts row 2 */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BarChartCard title="Top Verticals" subtitle="Items picked by CMS vertical" data={byVertical} color="#34d399" layout="vertical" />
          <BarChartCard title="Top Destinations" subtitle="Downstream fulfillment centers" data={byDest} color="#a78bfa" layout="vertical" />
        </section>

        {/* Charts row 3 */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <BarChartCard title="By Floor" data={byFloor} color="#22d3ee" />
          <BarChartCard title="By Shift" data={byShift} color="#f472b6" />
          <BarChartCard title="Top Pathways" data={byPathway} color="#fbbf24" />
        </section>

        {/* Top pickers + Date trend */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BarChartCard title="Top Pickers" subtitle="Items picked per user" data={topPickers} color="#60a5fa" layout="vertical" />
          {byDate.length > 1 ? (
            <LineChartCard
              title="Daily Volume"
              subtitle="Total items per date"
              data={byDate}
              lines={[{ key: "count", color: "#34d399", label: "Items" }]}
            />
          ) : (
            <BarChartCard title="Daily Volume" subtitle="Total items per date" data={byDate} color="#34d399" />
          )}
        </section>

        {/* Data table */}
        <DataTable rows={filtered} />

        <footer className="pt-4 pb-8 text-center text-xs text-slate-500">
          Data source:{" "}
          <a href={SHEET_URL} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
            Google Sheet
          </a>{" "}
          · Rendered {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} rows
        </footer>
      </main>
    </div>
  );
}
